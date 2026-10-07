from __future__ import annotations

import argparse
import json
import re
import statistics
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from browser_safety import (
    assert_browser_network_guard_clean,
    install_browser_network_guard,
    write_offline_html,
)


WEB_VERSION_SOURCE = Path(__file__).resolve().parents[1] / "apps" / "web" / "src" / "ui" / "web-version.js"
WEB_VERSION_MATCH = re.search(
    r'export const WEB_VERSION = "([^"]+)";',
    WEB_VERSION_SOURCE.read_text(encoding="utf-8"),
)
if WEB_VERSION_MATCH is None:
    raise RuntimeError("No se encontró WEB_VERSION en su fuente de autoridad.")
WEB_VERSION = WEB_VERSION_MATCH.group(1)


SEED_DOCUMENT = {
    "schemaVersion": 4,
    "appVersion": WEB_VERSION,
    "calendarMeta": {
        "id": "filter-search-fixture",
        "name": "Filtro QA",
        "coordinator": "",
        "revision": 1,
        "createdAt": "2026-10-06T12:00:00.000Z",
        "updatedAt": "2026-10-06T12:00:00.000Z",
    },
    "catalog": {
        "cities": [
            {"id": "city-pereira", "name": "Pereira", "active": True},
            {"id": "city-cali", "name": "Cali", "active": True},
        ],
        "clients": [
            {"id": "client-aguila", "name": "Águila Tecnología", "active": True},
            {"id": "client-sol", "name": "Distribuciones Sol", "active": True},
        ],
        "sites": [
            {
                "id": "site-aguila-norte",
                "clientId": "client-aguila",
                "name": "Sede Águila Norte",
                "city": "Pereira",
                "active": True,
            },
            {
                "id": "site-sol-sur",
                "clientId": "client-sol",
                "name": "Sede Sol Sur",
                "city": "Cali",
                "active": True,
            },
        ],
        "responsibles": [
            {
                "id": "responsible-maria",
                "name": "María Núñez",
                "responsibleType": "payroll",
                "baseCity": "Pereira",
                "active": True,
            },
            {
                "id": "responsible-luis",
                "name": "Luis Torres",
                "responsibleType": "contractor",
                "baseCity": "Cali",
                "active": True,
            },
        ],
    },
    "activities": [],
    "series": [],
    "settings": {
        "currentDate": "2026-10-06",
        "filters": {
            "query": "",
            "cities": [],
            "clients": ["client-sol"],
            "sites": [],
            "responsibles": [],
            "serviceTypes": [],
            "statuses": [],
            "planningBuckets": [],
            "dateFrom": None,
            "dateTo": None,
        },
    },
    "holidayOverrides": [],
    "importMetadata": None,
    "audit": [],
}


SEED_DATABASE = """async (document) => new Promise((resolve, reject) => {
  const request = indexedDB.open('calendario-hvac-siys', 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('documents')) {
      request.result.createObjectStore('documents', { keyPath: 'key' });
    }
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction('documents', 'readwrite');
    transaction.objectStore('documents').put({
      key: 'current',
      savedAt: '2026-10-06T12:00:00.000Z',
      document
    });
    transaction.oncomplete = () => {
      database.close();
      resolve(true);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  };
})"""


READ_FILTERS = """async () => new Promise((resolve, reject) => {
  const request = indexedDB.open('calendario-hvac-siys', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction('documents', 'readonly');
    const get = transaction.objectStore('documents').get('current');
    get.onsuccess = () => {
      database.close();
      resolve(get.result?.document?.settings?.filters ?? null);
    };
    get.onerror = () => reject(get.error);
  };
})"""


FILTER_PERFORMANCE_INIT = """(() => {
  const metrics = { lastOpen: null, searches: [] };
  let openStartedAt = null;
  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("#filterButton")) {
      openStartedAt = performance.now();
      metrics.lastOpen = null;
    }
  }, true);
  const nativeShowModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function(...args) {
    if (this.id === "filterDialog" && openStartedAt !== null) {
      const startedAt = openStartedAt;
      const renderMs = performance.now() - startedAt;
      const result = nativeShowModal.apply(this, args);
      queueMicrotask(() => {
        metrics.lastOpen = { renderMs, totalMs: performance.now() - startedAt };
        openStartedAt = null;
      });
      return result;
    }
    return nativeShowModal.apply(this, args);
  };
  document.addEventListener("input", event => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.classList.contains("filter-option-search")) {
      const startedAt = performance.now();
      const id = input.id;
      const value = input.value;
      queueMicrotask(() => metrics.searches.push({
        id,
        value,
        durationMs: performance.now() - startedAt
      }));
    }
  }, true);
  window.__filterPerformance = metrics;
})();"""


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *args) -> None:
        return


def assert_no_horizontal_overflow(page) -> None:
    dimensions = page.evaluate(
        """() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth
        })"""
    )
    assert dimensions["document"] <= dimensions["viewport"], dimensions


def option_row(page, key: str, value: str):
    return page.locator(
        f'input[name="filter-{key}"][value="{value}"]'
    ).locator("xpath=..")


def open_filters(page) -> None:
    page.locator("#filterButton").click()
    expect(page.locator("#filterDialog")).to_be_visible()


def close_filters(page) -> None:
    page.locator('[data-close-dialog="filterDialog"]').click()
    expect(page.locator("#filterDialog")).not_to_be_visible()


def verify_filter_search(page, *, key: str, query: str, matching: str, hidden: str) -> None:
    open_filters(page)
    search = page.locator(f"#filterSearch-{key}")
    search.fill(query)
    expect(option_row(page, key, matching)).to_be_visible()
    expect(option_row(page, key, hidden)).to_be_hidden()
    assert_no_horizontal_overflow(page)
    search.fill("")
    expect(option_row(page, key, matching)).to_be_visible()
    expect(option_row(page, key, hidden)).to_be_visible()
    assert_no_horizontal_overflow(page)
    close_filters(page)


def large_catalog_document() -> dict:
    document = json.loads(json.dumps(SEED_DOCUMENT))
    document["catalog"]["cities"] = [
        {"id": "city-synthetic", "name": "Ciudad sintética", "active": True}
    ]
    document["catalog"]["clients"] = [
        {
            "id": f"client-synthetic-{index:04d}",
            "name": f"Cliente sintético {index:04d}",
            "active": True,
        }
        for index in range(200)
    ]
    document["catalog"]["sites"] = [
        {
            "id": f"site-synthetic-{index:04d}",
            "clientId": f"client-synthetic-{index % 200:04d}",
            "name": f"Sede sintética {index:04d}",
            "city": "Ciudad sintética",
            "active": True,
        }
        for index in range(1_000)
    ]
    document["catalog"]["responsibles"] = [
        {
            "id": f"responsible-synthetic-{index:04d}",
            "name": f"Responsable sintético {index:04d}",
            "responsibleType": "payroll" if index % 2 == 0 else "contractor",
            "baseCity": "Ciudad sintética",
            "active": True,
        }
        for index in range(500)
    ]
    document["activities"] = [
        {
            "id": f"activity-synthetic-{index:04d}",
            "date": f"2026-10-{index % 28 + 1:02d}",
            "clientId": f"client-synthetic-{index % 200:04d}",
            "siteId": f"site-synthetic-{index % 1_000:04d}",
            "city": "Ciudad sintética",
            "responsibleIds": [f"responsible-synthetic-{index % 500:04d}"],
            "serviceType": "preventive",
            "status": "scheduled",
            "observations": "",
            "planningBucket": "calendar",
            "history": [],
        }
        for index in range(1_000)
    ]
    document["settings"]["currentDate"] = "2026-10-06"
    document["settings"]["filters"] = {
        "query": "",
        "cities": [],
        "clients": ["client-synthetic-0123"],
        "sites": [],
        "responsibles": [],
        "serviceTypes": [],
        "statuses": [],
        "planningBuckets": [],
        "dateFrom": None,
        "dateTo": None,
    }
    return document


def performance_summary(samples: list[float]) -> dict:
    return {
        "medianMs": round(statistics.median(samples), 3),
        "maxMs": round(max(samples), 3),
        "samplesMs": [round(sample, 3) for sample in samples],
    }


def measure_large_catalog(page, origin: str) -> dict:
    page.add_init_script(FILTER_PERFORMANCE_INIT)
    page.goto(f"{origin}/seed.html", wait_until="load")
    assert page.evaluate(SEED_DATABASE, large_catalog_document()) is True
    page.goto(f"{origin}/index.html", wait_until="load")
    page.wait_for_selector('body[data-ready="true"]', timeout=20_000)
    expect(page.locator("#versionLabel")).to_contain_text(f"Versión {WEB_VERSION}")

    expected_counts = {"clients": 200, "sites": 1_000, "responsibles": 500}
    expected_activity_counts = {"clients": 5, "sites": 1, "responsibles": 1}
    queries = {
        "clients": "Cliente sintético 0123",
        "sites": "Sede sintética 0123",
        "responsibles": "Responsable sintético 0123",
    }
    search_samples = {key: [] for key in expected_counts}
    clear_samples = {key: [] for key in expected_counts}
    open_samples: list[float] = []
    render_samples: list[float] = []
    reopen_samples: list[float] = []
    dom_volume = None

    for repetition in range(5):
        open_filters(page)
        open_timing = page.evaluate("window.__filterPerformance.lastOpen")
        assert open_timing, "Falta la medición de apertura/render de filtros."
        render_samples.append(open_timing["renderMs"])
        open_samples.append(open_timing["totalMs"])
        if repetition:
            reopen_samples.append(open_timing["totalMs"])

        current_dom = page.evaluate(
            """expected => ({
              categories: Object.fromEntries(Object.entries(expected).map(([key]) => [
                key,
                document.querySelectorAll(`#filterGrid input[name="filter-${key}"]`).length
              ])),
              optionInputs: document.querySelectorAll("#filterGrid input[type=checkbox]").length,
              optionLabels: document.querySelectorAll("#filterGrid label.check-row").length
            })""",
            expected_counts,
        )
        assert current_dom["categories"] == expected_counts, current_dom
        if dom_volume is None:
            dom_volume = current_dom
        else:
            assert current_dom == dom_volume, current_dom
        assert_no_horizontal_overflow(page)

        for key, query in queries.items():
            input_id = f"filterSearch-{key}"
            timing = page.evaluate(
                """({ inputId, value }) => {
                  const input = document.getElementById(inputId);
                  input.value = value;
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  return Promise.resolve().then(() => window.__filterPerformance.searches.at(-1));
                }""",
                {"inputId": input_id, "value": query},
            )
            assert timing and timing["id"] == input_id and timing["value"] == query, timing
            search_samples[key].append(timing["durationMs"])
            matching_row = option_row(
                page,
                key,
                f"{key[:-1] if key.endswith('s') else key}-synthetic-0123",
            )
            expect(matching_row).to_be_visible()
            expect(matching_row).to_contain_text(f"({expected_activity_counts[key]})")
            visible_count = page.evaluate(
                """key => [...document.querySelectorAll(`#filterGrid input[name="filter-${key}"]`)]
                  .filter(input => !input.parentElement.hidden).length""",
                key,
            )
            assert visible_count == 1, {"category": key, "query": query, "visible": visible_count}

            timing = page.evaluate(
                """inputId => {
                  const input = document.getElementById(inputId);
                  input.value = "";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  return Promise.resolve().then(() => window.__filterPerformance.searches.at(-1));
                }""",
                input_id,
            )
            assert timing and timing["id"] == input_id and timing["value"] == "", timing
            clear_samples[key].append(timing["durationMs"])
            expect(matching_row).to_be_visible()
            all_visible = page.evaluate(
                """key => [...document.querySelectorAll(`#filterGrid input[name="filter-${key}"]`)]
                  .filter(input => !input.parentElement.hidden).length""",
                key,
            )
            assert all_visible == expected_counts[key], {"category": key, "visible": all_visible}
            assert_no_horizontal_overflow(page)

        close_filters(page)

    return {
        "fixture": {**expected_counts, "activities": 1_000},
        "repetitions": 5,
        "renderInitialOptions": performance_summary(render_samples),
        "dialogOpen": performance_summary(open_samples),
        "reopen": performance_summary(reopen_samples),
        "search": {key: performance_summary(samples) for key, samples in search_samples.items()},
        "clearQuery": {key: performance_summary(samples) for key, samples in clear_samples.items()},
        "domVolume": dom_volume,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regresión DOM de búsqueda temporal de opciones de filtro en viewport móvil."
    )
    parser.add_argument("--html", type=Path, default=Path("dist/index.html"))
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="siys-filter-search-browser-") as temp_dir:
        root = Path(temp_dir)
        html_path = write_offline_html(args.html, root / "index.html")
        (root / "seed.html").write_text(
            "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"></head><body></body></html>",
            encoding="utf-8",
        )
        handler = partial(QuietStaticHandler, directory=str(root))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel="chrome", headless=True)
                context = browser.new_context(
                    viewport={"width": 390, "height": 844},
                    locale="es-CO",
                    has_touch=True,
                    service_workers="block",
                )
                blocked_requests = install_browser_network_guard(
                    context, allowed_origins={origin}
                )
                page = context.new_page()
                page_errors: list[str] = []
                console_errors: list[str] = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on(
                    "console",
                    lambda message: console_errors.append(message.text)
                    if message.type == "error" and not message.text.startswith("Failed to load resource:")
                    else None,
                )

                page.goto(f"{origin}/seed.html", wait_until="load")
                assert page.evaluate(SEED_DATABASE, SEED_DOCUMENT) is True
                page.goto(f"{origin}/index.html", wait_until="load")
                page.wait_for_selector('body[data-ready="true"]', timeout=20_000)
                expect(page.locator("#versionLabel")).to_contain_text(f"Versión {WEB_VERSION}")
                assert_no_horizontal_overflow(page)

                global_search = page.locator("#globalSearch")
                global_search.fill("solo-global")
                page.wait_for_function(
                    """async () => {
                      const request = indexedDB.open('calendario-hvac-siys', 1);
                      const database = await new Promise((resolve, reject) => {
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                      });
                      const transaction = database.transaction('documents', 'readonly');
                      const get = transaction.objectStore('documents').get('current');
                      const filters = await new Promise((resolve, reject) => {
                        get.onsuccess = () => resolve(get.result?.document?.settings?.filters);
                        get.onerror = () => reject(get.error);
                      });
                      database.close();
                      return filters?.query === 'solo-global';
                    }""",
                    timeout=10_000,
                )

                open_filters(page)
                assert_no_horizontal_overflow(page)
                client_search = page.locator("#filterSearch-clients")
                selected_hidden_client = option_row(page, "clients", "client-sol")
                matching_client = option_row(page, "clients", "client-aguila")
                expect(selected_hidden_client.locator("input")).to_be_checked()
                client_search.fill("  AGUILA  ")
                expect(matching_client).to_be_visible()
                expect(selected_hidden_client).to_be_hidden()
                expect(selected_hidden_client.locator("input")).to_be_checked()
                assert_no_horizontal_overflow(page)
                client_search.fill("")
                expect(matching_client).to_be_visible()
                expect(selected_hidden_client).to_be_visible()
                expect(selected_hidden_client.locator("input")).to_be_checked()
                assert_no_horizontal_overflow(page)
                expect(global_search).to_have_value("solo-global")
                close_filters(page)

                open_filters(page)
                client_search = page.locator("#filterSearch-clients")
                expect(client_search).to_have_value("")
                expect(option_row(page, "clients", "client-sol").locator("input")).to_be_checked()
                expect(global_search).to_have_value("solo-global")
                page.locator("#filterForm button[type=submit]").click()
                expect(page.locator("#filterDialog")).not_to_be_visible()

                page.wait_for_function(
                    """async () => {
                      const request = indexedDB.open('calendario-hvac-siys', 1);
                      const database = await new Promise((resolve, reject) => {
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                      });
                      const transaction = database.transaction('documents', 'readonly');
                      const get = transaction.objectStore('documents').get('current');
                      const filters = await new Promise((resolve, reject) => {
                        get.onsuccess = () => resolve(get.result?.document?.settings?.filters);
                        get.onerror = () => reject(get.error);
                      });
                      database.close();
                      return filters?.clients?.length === 1
                        && filters.clients[0] === 'client-sol'
                        && filters.query === 'solo-global';
                    }""",
                    timeout=10_000,
                )
                saved_filters = page.evaluate(READ_FILTERS)
                assert saved_filters["clients"] == ["client-sol"], saved_filters
                assert saved_filters["query"] == "solo-global", saved_filters

                verify_filter_search(
                    page,
                    key="sites",
                    query="nORTE",
                    matching="site-aguila-norte",
                    hidden="site-sol-sur",
                )
                verify_filter_search(
                    page,
                    key="responsibles",
                    query="MARIA NUNEZ",
                    matching="responsible-maria",
                    hidden="responsible-luis",
                )

                synthetic_performance = measure_large_catalog(page, origin)

                assert not page_errors, page_errors
                assert not console_errors, console_errors
                assert_browser_network_guard_clean(blocked_requests)
                context.close()
                browser.close()

        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=5)

    print(json.dumps({
        "status": "ok",
        "browser": "Chrome",
        "viewport": "390x844",
        "categories": ["clients", "sites", "responsibles"],
        "normalization": ["case-insensitive", "accent-insensitive", "trimmed whitespace"],
        "selectedHiddenOptionRetained": True,
        "temporarySearchResetsOnReopen": True,
        "globalSearchIndependent": True,
        "horizontalOverflow": False,
        "blockedRequests": 0,
        "syntheticPerformance": synthetic_performance,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
