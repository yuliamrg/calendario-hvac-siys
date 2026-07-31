from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def wait_ready(page) -> None:
    page.wait_for_selector('body[data-ready="true"]', timeout=20_000)


def wait_saved(page) -> None:
    expect(page.locator("#saveIndicatorText")).to_have_text("Guardado", timeout=15_000)


def get_state(page) -> dict:
    return page.evaluate(
        """
        async () => new Promise((resolve, reject) => {
          const databaseName = location.pathname.includes("/beta/")
            ? "calendario-hvac-siys-beta"
            : "calendario-hvac-siys";
          const request = indexedDB.open(databaseName, 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("documents", "readonly");
            const get = tx.objectStore("documents").get("current");
            get.onerror = () => reject(get.error);
            get.onsuccess = () => resolve(get.result?.document ?? null);
          };
        })
        """
    )


def wait_activity_count(page, count: int) -> None:
    page.wait_for_function(
        """
        async (expected) => new Promise((resolve) => {
          const databaseName = location.pathname.includes("/beta/")
            ? "calendario-hvac-siys-beta"
            : "calendario-hvac-siys";
          const request = indexedDB.open(databaseName, 1);
          request.onerror = () => resolve(false);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("documents", "readonly");
            const get = tx.objectStore("documents").get("current");
            get.onsuccess = () => resolve((get.result?.document?.activities?.length ?? 0) === expected);
            get.onerror = () => resolve(false);
          };
        })
        """,
        arg=count,
        timeout=15_000,
    )


def click_menu_action(page, button_id: str) -> None:
    menu = page.locator(f".action-menu:has(#{button_id})")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    page.locator(f"#{button_id}").click()


def assert_no_document_overflow(page) -> None:
    dimensions = page.evaluate(
        """() => ({
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth
        })"""
    )
    assert dimensions["scrollWidth"] <= dimensions["width"], dimensions


def run_phone_flow(browser, uri: str, artifacts: Path) -> dict:
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        locale="es-CO",
        accept_downloads=True,
        has_touch=True,
    )
    page = context.new_page()
    page_errors: list[str] = []
    console_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.goto(uri, wait_until="load")
    wait_ready(page)
    expect(page.locator("#mobileAgenda")).to_be_visible()
    expect(page.locator("#weekdayRow div")).to_have_count(7)
    assert_no_document_overflow(page)

    page.locator('#calendarGrid [data-date="2026-07-30"]').dispatch_event("click")
    expect(page.locator("#mobileAgendaTitle")).to_contain_text("30")
    page.locator("#mobileAgendaAddButton").click()
    expect(page.locator("#activityDate")).to_have_value("2026-07-30")
    page.select_option("#activityServiceType", "administrative")
    page.fill("#activityObservations", "Flujo táctil responsive")
    page.locator("#activityForm button[type=submit]").click()
    expect(page.locator("#mobileAgendaList .activity-card")).to_have_count(1)
    wait_saved(page)
    wait_activity_count(page, 1)

    original_id = get_state(page)["activities"][0]["id"]
    if "open" in (page.locator("#detailDrawer").get_attribute("class") or ""):
        page.locator("#closeDrawerButton").click()
    page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"]').click()
    expect(page.locator("#detailDrawer")).to_have_class("detail-drawer open")
    expect(page.get_by_role("button", name="Mover · Duplicar · Ampliar")).to_be_visible()
    expect(page.locator("#drawerStatusSelect")).to_be_visible()

    page.get_by_role("button", name="Mover · Duplicar · Ampliar").click()
    page.fill("#activityDateActionDate", "2026-07-30")
    expect(page.locator("#touchMoveButton")).to_be_disabled()
    expect(page.locator("#touchExtendButton")).to_be_disabled()
    expect(page.locator("#touchDuplicateButton")).to_be_enabled()
    page.fill("#activityDateActionDate", "2026-07-31")
    page.locator("#activityDateActionDate").dispatch_event("change")
    page.locator("#touchDuplicateButton").click()
    expect(page.locator("#activityDateActionDialog")).not_to_be_visible()
    wait_saved(page)
    wait_activity_count(page, 2)
    assert len(get_state(page)["activities"]) == 2

    page.locator("#closeDrawerButton").click()
    page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"]').click()
    page.get_by_role("button", name="Mover · Duplicar · Ampliar").click()
    page.fill("#activityDateActionDate", "2026-08-01")
    page.locator("#activityDateActionDate").dispatch_event("change")
    page.locator("#touchExtendButton").click()
    wait_saved(page)
    wait_activity_count(page, 3)
    state = get_state(page)
    original = next(item for item in state["activities"] if item["id"] == original_id)
    extended = next(item for item in state["activities"] if item["date"] == "2026-08-01")
    assert original["seriesId"] and original["seriesId"] == extended["seriesId"]

    page.locator("#closeDrawerButton").click()
    page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"]').click()
    page.get_by_role("button", name="Mover · Duplicar · Ampliar").click()
    page.fill("#activityDateActionDate", "2026-08-02")
    page.locator("#activityDateActionDate").dispatch_event("change")
    page.locator("#touchMoveButton").click()
    wait_saved(page)
    moved = next(item for item in get_state(page)["activities"] if item["id"] == original_id)
    assert moved["date"] == "2026-08-02"
    assert any(item["action"] == "rescheduled" for item in moved["history"])

    page.locator('#calendarGrid [data-date="2026-08-02"]').dispatch_event("click")
    expect(page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"]')).to_be_visible()
    page.locator("#toggleCatalogButton").click()
    expect(page.locator("#catalogPanel")).to_be_visible()
    expect(page.locator("#closeCatalogMobileButton")).to_be_visible()
    page.locator("#closeCatalogMobileButton").click()

    if "open" in (page.locator("#detailDrawer").get_attribute("class") or ""):
        page.locator("#closeDrawerButton").click()
    with page.expect_download() as image_download:
        click_menu_action(page, "exportImageButton")
    png_path = artifacts / "phone-export.png"
    image_download.value.save_as(str(png_path))
    assert png_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert_no_document_overflow(page)
    page.screenshot(path=str(artifacts / "phone-390x844.png"), full_page=True)
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    context.close()
    return {
        "viewport": "390x844",
        "agenda": True,
        "touchActions": ["move", "duplicate", "extend", "edit", "status"],
        "documentOverflow": False,
    }


def check_viewport(browser, uri: str, width: int, height: int, compact: bool, artifacts: Path) -> dict:
    context = browser.new_context(
        viewport={"width": width, "height": height},
        locale="es-CO",
        has_touch=compact,
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(uri, wait_until="load")
    wait_ready(page)
    if compact:
        expect(page.locator("#mobileAgenda")).to_be_visible()
        page.locator("#mobileAgenda").scroll_into_view_if_needed()
        expect(page.locator("#mobileAgendaAddButton")).to_be_visible()
    else:
        expect(page.locator("#mobileAgenda")).not_to_be_visible()
        expect(page.locator("#calendarGrid")).to_be_visible()
    assert_no_document_overflow(page)
    page.screenshot(path=str(artifacts / f"viewport-{width}x{height}.png"), full_page=True)
    assert not errors, errors
    context.close()
    return {"viewport": f"{width}x{height}", "compactAgenda": compact, "documentOverflow": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--html", type=Path)
    source.add_argument("--url")
    parser.add_argument("--artifacts", type=Path)
    args = parser.parse_args()
    artifacts = args.artifacts or Path(tempfile.mkdtemp(prefix="siys-responsive-"))
    artifacts.mkdir(parents=True, exist_ok=True)
    uri = args.url or args.html.resolve().as_uri()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        results = [run_phone_flow(browser, uri, artifacts)]
        for width, height, compact in [
            (320, 640, True),
            (844, 390, True),
            (768, 1024, True),
            (1024, 768, False),
            (1440, 900, False),
        ]:
            results.append(check_viewport(browser, uri, width, height, compact, artifacts))
        browser.close()

    print(json.dumps({
        "status": "ok",
        "results": results,
        "artifacts": str(artifacts.resolve()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
