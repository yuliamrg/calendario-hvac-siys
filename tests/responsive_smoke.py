from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from browser_safety import (
    assert_browser_network_guard_clean,
    install_browser_network_guard,
    write_offline_html,
)


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


def menu_action_metrics(page, button_id: str) -> dict:
    return page.evaluate(
        """buttonId => {
          const button = document.getElementById(buttonId);
          const panel = button.closest('details.action-menu').querySelector('.action-menu-panel');
          const buttonRect = button.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          return {
            viewport: { width: innerWidth, height: innerHeight },
            panel: { x: panelRect.x, y: panelRect.y, right: panelRect.right, bottom: panelRect.bottom },
            button: { x: buttonRect.x, y: buttonRect.y, right: buttonRect.right, bottom: buttonRect.bottom },
            scrollHeight: panel.scrollHeight,
            clientHeight: panel.clientHeight,
            scrollTop: panel.scrollTop,
            overflowY: getComputedStyle(panel).overflowY
          };
        }""",
        button_id,
    )


def click_menu_action(page, button_id: str, *, verify_reachability: bool = False) -> None:
    if page.locator("#mobileMoreButton").is_visible() and not page.locator("body").evaluate(
        "element => element.classList.contains('mobile-more-open')"
    ):
        page.locator("#mobileMoreButton").click()
    menu = page.locator(f".action-menu:has(#{button_id})")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    button = page.locator(f"#{button_id}")
    if verify_reachability:
        before = menu_action_metrics(page, button_id)
        panel = before["panel"]
        viewport = before["viewport"]
        assert panel["x"] >= 0 and panel["y"] >= 0, before
        assert panel["right"] <= viewport["width"] + 1, before
        assert panel["bottom"] <= viewport["height"] + 1, before
        assert before["overflowY"] in {"auto", "scroll"}, before
        initially_reachable = (
            before["button"]["x"] >= panel["x"] - 1
            and before["button"]["right"] <= panel["right"] + 1
            and before["button"]["y"] >= panel["y"] - 1
            and before["button"]["bottom"] <= panel["bottom"] + 1
        )
        if before["scrollHeight"] > before["clientHeight"] and not initially_reachable:
            button.scroll_into_view_if_needed()
            after = menu_action_metrics(page, button_id)
            assert after["scrollTop"] > before["scrollTop"], {"before": before, "after": after}
        else:
            after = before
        panel = after["panel"]
        action = after["button"]
        assert action["x"] >= panel["x"] - 1, after
        assert action["right"] <= panel["right"] + 1, after
        assert action["y"] >= panel["y"] - 1, after
        assert action["bottom"] <= panel["bottom"] + 1, after
        if button_id == "helpButton" and viewport["height"] <= 400:
            assert after["scrollHeight"] > after["clientHeight"], after
            assert after["scrollTop"] > 0, after
    button.click()


def dialog_metrics(page, dialog_id: str) -> dict:
    return page.evaluate(
        """dialogId => {
          const dialog = document.getElementById(dialogId);
          const rect = dialog.getBoundingClientRect();
          const elements = [dialog, ...dialog.querySelectorAll('*')];
          const scrollables = elements
            .filter(element => {
              const overflowY = getComputedStyle(element).overflowY;
              return ['auto', 'scroll'].includes(overflowY)
                && element.scrollHeight > element.clientHeight + 1;
            })
            .map(element => ({
              id: element.id,
              tag: element.tagName,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              scrollTop: element.scrollTop
            }));
          return {
            open: dialog.open,
            rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
            viewport: { width: innerWidth, height: innerHeight },
            overflowing: scrollables.length > 0,
            scrollables
          };
        }""",
        dialog_id,
    )


def assert_dialog_fits_viewport(metrics: dict) -> None:
    assert metrics["open"], metrics
    rect = metrics["rect"]
    viewport = metrics["viewport"]
    assert rect["x"] >= 0 and rect["y"] >= 0, metrics
    assert rect["right"] <= viewport["width"] + 1, metrics
    assert rect["bottom"] <= viewport["height"] + 1, metrics
    if metrics["overflowing"]:
        assert metrics["scrollables"], metrics


def assert_control_inside_dialog(page, dialog_id: str, selector: str) -> None:
    result = page.evaluate(
        """({ dialogId, selector }) => {
          const dialog = document.getElementById(dialogId);
          const control = dialog.querySelector(selector);
          const rect = control.getBoundingClientRect();
          const dialogRect = dialog.getBoundingClientRect();
          return {
            visible: rect.width > 0 && rect.height > 0,
            rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
            dialog: { x: dialogRect.x, y: dialogRect.y, right: dialogRect.right, bottom: dialogRect.bottom },
            viewport: { width: innerWidth, height: innerHeight }
          };
        }""",
        {"dialogId": dialog_id, "selector": selector},
    )
    assert result["visible"], result
    assert result["rect"]["x"] >= result["dialog"]["x"] - 1, result
    assert result["rect"]["right"] <= result["dialog"]["right"] + 1, result
    assert result["rect"]["y"] >= result["dialog"]["y"] - 1, result
    assert result["rect"]["y"] >= 0, result
    assert result["rect"]["bottom"] <= result["dialog"]["bottom"] + 1, result
    assert result["rect"]["bottom"] <= result["viewport"]["height"] + 1, result


def open_dialog_from_menu(page, button_id: str, dialog_id: str) -> None:
    click_menu_action(page, button_id, verify_reachability=True)
    dialog = page.locator(f"#{dialog_id}")
    expect(dialog).to_be_visible()
    assert_dialog_fits_viewport(dialog_metrics(page, dialog_id))
    assert_no_document_overflow(page)


def run_dialog_height_flow(browser, uri: str, width: int, height: int) -> dict:
    context = browser.new_context(
        viewport={"width": width, "height": height},
        locale="es-CO",
        has_touch=width < 900,
    )
    blocked_requests = install_browser_network_guard(context)
    page = context.new_page()
    page_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(uri, wait_until="load")
    wait_ready(page)

    open_dialog_from_menu(page, "calendarSettingsButton", "calendarSettingsDialog")
    settings_close = page.locator(
        '#calendarSettingsDialog button[aria-label="Cerrar"]'
    )
    expect(settings_close).to_be_visible()
    assert_control_inside_dialog(page, "calendarSettingsDialog", 'button[aria-label="Cerrar"]')
    settings_close.focus()
    assert page.evaluate("element => document.activeElement === element", settings_close.element_handle())
    settings_close.press("Enter")
    expect(page.locator("#calendarSettingsDialog")).not_to_be_visible()

    open_dialog_from_menu(page, "calendarSettingsButton", "calendarSettingsDialog")
    page.locator("#calendarName").fill(f"Prueba responsive {width}x{height}")
    save_button = page.locator('#calendarSettingsForm button[type="submit"]')
    save_button.scroll_into_view_if_needed()
    expect(save_button).to_be_visible()
    assert_control_inside_dialog(page, "calendarSettingsDialog", 'button[type="submit"]')
    settings_after_scroll = dialog_metrics(page, "calendarSettingsDialog")
    if settings_after_scroll["overflowing"]:
        assert any(item["scrollTop"] > 0 for item in settings_after_scroll["scrollables"]), settings_after_scroll
    save_button.click()
    expect(page.locator("#calendarSettingsDialog")).not_to_be_visible()
    expect(page.locator("#calendarIdentity")).to_contain_text(
        f"Prueba responsive {width}x{height}"
    )
    assert_no_document_overflow(page)

    open_dialog_from_menu(page, "helpButton", "helpDialog")
    help_close = page.locator('#helpDialog button[aria-label="Cerrar"]')
    expect(help_close).to_be_visible()
    assert_control_inside_dialog(page, "helpDialog", 'button[aria-label="Cerrar"]')
    help_close.focus()
    assert page.evaluate("element => document.activeElement === element", help_close.element_handle())
    help_close.press("Enter")
    expect(page.locator("#helpDialog")).not_to_be_visible()

    open_dialog_from_menu(page, "helpButton", "helpDialog")
    page.locator("#helpDialog .legend").scroll_into_view_if_needed()
    help_after_content_scroll = dialog_metrics(page, "helpDialog")
    if help_after_content_scroll["overflowing"]:
        assert any(item["scrollTop"] > 0 for item in help_after_content_scroll["scrollables"]), help_after_content_scroll
    help_footer_close = page.locator("#helpDialog footer button")
    help_footer_close.scroll_into_view_if_needed()
    expect(help_footer_close).to_be_visible()
    assert_control_inside_dialog(page, "helpDialog", "footer button")
    help_footer_close.click()
    expect(page.locator("#helpDialog")).not_to_be_visible()
    assert_no_document_overflow(page)

    assert not page_errors, page_errors
    assert_browser_network_guard_clean(blocked_requests)
    context.close()
    return {
        "viewport": f"{width}x{height}",
        "calendarSettings": {"closeKeyboard": True, "saveReachable": True},
        "help": {"closeKeyboard": True, "footerReachable": True},
        "documentOverflow": False,
    }


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
    blocked_requests = install_browser_network_guard(context)
    context.add_init_script(
        """(() => {
          const NativeDate = Date;
          const fixedNow = NativeDate.parse('2026-07-01T12:00:00Z');
          class FixedDate extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [fixedNow])); }
            static now() { return fixedNow; }
          }
          FixedDate.parse = NativeDate.parse;
          FixedDate.UTC = NativeDate.UTC;
          window.Date = FixedDate;
        })();"""
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
    expect(page.locator("#monthGridWrap")).not_to_be_visible()
    assert_no_document_overflow(page)

    page.locator("#mobileMonthButton").click()
    expect(page.locator("#mobileMonthDialog")).to_be_visible()
    page.locator('#calendarGrid [data-date="2026-07-30"] .day-number').click()
    expect(page.locator("#mobileMonthDialog")).not_to_be_visible()
    expect(page.locator("#activityDialog")).not_to_be_visible()
    expect(page.locator("#mobileAgendaTitle")).to_contain_text("30")
    page.locator("#newActivityButton").click()
    expect(page.locator("#activityDate")).to_have_value("2026-07-30")
    page.select_option("#activityServiceType", "administrative")
    page.fill("#activityObservations", "Flujo táctil responsive")
    page.locator("#activityForm button[type=submit]").click()
    expect(page.locator("#mobileAgendaList .activity-card")).to_have_count(1)
    expect(page.locator("#mobileAgendaList .service-code")).to_have_text("AD")
    wait_saved(page)
    wait_activity_count(page, 1)

    original_id = get_state(page)["activities"][0]["id"]
    if "open" in (page.locator("#detailDrawer").get_attribute("class") or ""):
        page.locator("#closeDrawerButton").click()
    page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"]').click()
    expect(page.locator("#detailDrawer")).to_have_class("detail-drawer open")
    expect(page.get_by_role("button", name="Mover · Duplicar · Ampliar")).to_be_visible()
    expect(page.locator("#drawerStatusSelect")).to_be_visible()
    page.locator("#drawerStatusSelect").select_option("in_progress")
    page.get_by_role("button", name="Aplicar estado").click()
    wait_saved(page)
    expect(page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"] .status-icon-in_progress')).to_be_visible()

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
    expect(page.locator("#seriesRangeDialog")).to_be_visible()
    page.locator("#seriesRangeExtendButton").click()
    expect(page.locator("#seriesRangeDialog")).not_to_be_visible()
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

    page.locator("#closeDrawerButton").click()
    page.locator("#mobileMonthButton").click()
    page.locator('#calendarGrid [data-date="2026-08-02"] .day-number').click()
    expect(page.locator(f'#mobileAgendaList [data-activity-id="{original_id}"]')).to_be_visible()
    page.locator("#mobileMoreButton").click()
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
    with page.expect_download() as day_image_download:
        page.locator("#mobileAgendaExportButton").click()
    day_png_path = artifacts / "phone-day-export.png"
    day_image_download.value.save_as(str(day_png_path))
    assert day_png_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    click_menu_action(page, "exportDayImageButton")
    expect(page.locator("#dayExportDialog")).to_be_visible()
    page.fill("#dayExportDate", "2026-08-02")
    with page.expect_download() as shared_day_image_download:
        page.locator("#dayExportForm button[type=submit]").click()
    assert shared_day_image_download.value.suggested_filename.startswith("2026-08-02_actividades_")
    shared_day_png_path = artifacts / "phone-shared-day-export.png"
    shared_day_image_download.value.save_as(str(shared_day_png_path))
    assert shared_day_png_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert_no_document_overflow(page)
    page.screenshot(path=str(artifacts / "phone-390x844.png"), full_page=True)
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert_browser_network_guard_clean(blocked_requests)
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
    blocked_requests = install_browser_network_guard(context)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(uri, wait_until="load")
    wait_ready(page)
    if compact:
        expect(page.locator("#mobileAgenda")).to_be_visible()
        page.locator("#mobileAgenda").scroll_into_view_if_needed()
        expect(page.locator("#newActivityButton")).to_be_visible()
        expect(page.locator("#mobileMonthButton")).to_be_visible()
        expect(page.locator("#mobileMoreButton")).to_be_visible()
        expect(page.locator("#monthGridWrap")).not_to_be_visible()
    else:
        expect(page.locator("#mobileAgenda")).not_to_be_visible()
        expect(page.locator("#calendarGrid")).to_be_visible()
    assert_no_document_overflow(page)
    page.screenshot(path=str(artifacts / f"viewport-{width}x{height}.png"), full_page=True)
    assert not errors, errors
    assert_browser_network_guard_clean(blocked_requests)
    context.close()
    return {"viewport": f"{width}x{height}", "compactAgenda": compact, "documentOverflow": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--dialogs-only", action="store_true")
    args = parser.parse_args()
    artifacts = args.artifacts or Path(tempfile.mkdtemp(prefix="siys-responsive-"))
    artifacts.mkdir(parents=True, exist_ok=True)
    source_html_path = args.html.resolve()

    with tempfile.TemporaryDirectory(prefix="siys-responsive-offline-") as isolated_dir:
        html_path = write_offline_html(
            source_html_path, Path(isolated_dir) / "index.html"
        )
        uri = html_path.as_uri()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            if args.dialogs_only:
                results = [
                    run_dialog_height_flow(browser, uri, width, height)
                    for width, height in [(844, 390), (667, 375), (568, 320), (390, 844)]
                ]
            else:
                results = [run_phone_flow(browser, uri, artifacts)]
                for width, height, compact in [
                    (320, 640, True),
                    (844, 390, True),
                    (768, 1024, True),
                    (1024, 768, False),
                    (1440, 900, False),
                ]:
                    results.append(check_viewport(browser, uri, width, height, compact, artifacts))
                results.extend(
                    run_dialog_height_flow(browser, uri, width, height)
                    for width, height in [(844, 390), (667, 375), (568, 320), (390, 844)]
                )
            browser.close()

    print(json.dumps({
        "status": "ok",
        "results": results,
        "artifacts": str(artifacts.resolve()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
