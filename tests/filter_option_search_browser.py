from __future__ import annotations

import argparse
import json
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


SEED_DOCUMENT = {
    "schemaVersion": 4,
    "appVersion": "0.19.0",
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
                expect(page.locator("#versionLabel")).to_contain_text("Versión 0.19.0")
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
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
