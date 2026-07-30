from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def get_state(page: Page) -> dict:
    return page.evaluate(
        """
        async () => new Promise((resolve, reject) => {
          const request = indexedDB.open("calendario-hvac-siys", 1);
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


def wait_saved(page: Page) -> None:
    expect(page.locator("#saveIndicatorText")).to_have_text("Guardado", timeout=15_000)


def launch_and_check(
    playwright,
    channel: str,
    html_path: Path,
    base_path: Path,
    artifact_dir: Path,
    run_full: bool,
) -> dict:
    browser = playwright.chromium.launch(channel=channel, headless=True)
    context = browser.new_context(
        accept_downloads=True,
        locale="es-CO",
        timezone_id="America/Bogota",
        viewport={"width": 1600, "height": 1000},
    )
    page = context.new_page()
    page_errors: list[str] = []
    console_errors: list[str] = []
    network_requests: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on(
        "request",
        lambda request: network_requests.append(request.url)
        if request.url.startswith(("http://", "https://"))
        else None,
    )

    page.goto(html_path.as_uri(), wait_until="load")
    page.wait_for_selector('body[data-ready="true"]', timeout=20_000)
    expect(page).to_have_title("Calendario HVAC SI&S")
    expect(page.get_by_test_id("month-title")).to_have_text("Julio de 2026")
    weekdays = page.locator("#weekdayRow > div").all_inner_texts()
    assert weekdays == [
        "Lunes",
        "Martes",
        "Miércoles",
        "Jueves",
        "Viernes",
        "Sábado",
        "Domingo",
    ], weekdays
    assert page.locator(".calendar-grid .day-cell").count() == 42
    assert page.locator(".calendar-grid .day-number").count() == 42
    assert page.locator('.calendar-grid .day-number[tabindex="0"]').count() == 1
    page.locator('[data-date="2026-07-30"] .day-number').focus()
    page.keyboard.press("ArrowLeft")
    assert page.evaluate(
        "document.activeElement.closest('.day-cell')?.dataset.date"
    ) == "2026-07-29"
    for dialog_id in (
        "activityDialog",
        "catalogDialog",
        "importDialog",
        "holidayDialog",
        "bulkMoveDialog",
        "bulkStatusDialog",
        "restoreDialog",
        "helpDialog",
    ):
        labelled_by = page.locator(f"#{dialog_id}").get_attribute("aria-labelledby")
        assert labelled_by and page.locator(f"#{labelled_by}").count() == 1
    assert page.locator("#detailDrawer").evaluate("element => element.inert") is True
    expect(page.locator('[data-date="2026-07-13"]')).to_have_class(
        re.compile(r"\bholiday\b")
    )
    expect(page.locator('[data-date="2026-07-12"]')).to_have_class(
        re.compile(r"\bsunday\b")
    )

    if not run_full:
        page.screenshot(path=str(artifact_dir / f"{channel}-smoke.png"), full_page=True)
        assert not page_errors, page_errors
        assert not console_errors, console_errors
        assert not network_requests, network_requests
        context.close()
        browser.close()
        return {"channel": channel, "status": "ok", "mode": "smoke"}

    before_hash = file_hash(base_path)
    page.set_input_files("#baseFileInput", str(base_path))
    expect(page.locator("#importDialog")).to_be_visible(timeout=20_000)
    expect(page.locator("#importFileSummary")).to_contain_text(base_path.name)
    expect(page.locator("#importWarnings")).to_contain_text("K1 está vacío")
    page.get_by_test_id("apply-import").click()
    expect(page.locator("#importDialog")).not_to_be_visible()
    wait_saved(page)
    after_hash = file_hash(base_path)
    assert before_hash == after_hash

    state = get_state(page)
    assert len(state["catalog"]["clients"]) == 3
    assert len(state["catalog"]["sites"]) == 18
    assert len(state["catalog"]["responsibles"]) == 30
    serialized = json.dumps(state, ensure_ascii=False)
    for forbidden_key in [
        "cedula_nit",
        '"Correo"',
        '"contacto"',
        '"Contactos"',
        "created_by",
        '"photos"',
        '"files"',
    ]:
        assert forbidden_key not in serialized

    client = next(
        item for item in state["catalog"]["clients"] if item["name"] == "Coopidrogas"
    )
    site = next(
        item
        for item in state["catalog"]["sites"]
        if item["clientId"] == client["id"]
        and item.get("active", True)
        and item.get("city")
        and item["city"] != "No aplica"
    )
    payroll = next(
        item
        for item in state["catalog"]["responsibles"]
        if item["responsibleType"] == "payroll" and item.get("active", True)
    )
    contractor = next(
        item
        for item in state["catalog"]["responsibles"]
        if item["responsibleType"] == "contractor" and item.get("active", True)
    )

    site_card = page.locator(
        f'[data-drag-type="site"][data-site-id="{site["id"]}"]'
    )
    target_day = page.locator('[data-date="2026-07-30"]')
    site_card.drag_to(target_day)
    expect(page.get_by_test_id("activity-dialog")).to_be_visible()
    assert page.locator("#activityClient").input_value() == client["id"]
    assert page.locator("#activitySite").input_value() == site["id"]
    page.select_option("#activityStatus", "confirmed")
    page.locator(
        f'#responsiblePicker input[value="{payroll["id"]}"]'
    ).check()
    page.locator(
        f'#responsiblePicker input[value="{contractor["id"]}"]'
    ).check()
    page.fill("#activityObservations", "Prueba integral local")
    page.get_by_test_id("save-activity").click()
    expect(page.get_by_test_id("activity-dialog")).not_to_be_visible()
    wait_saved(page)
    state = get_state(page)
    assert len(state["activities"]) == 1
    activity_id = state["activities"][0]["id"]
    card = page.locator(f'[data-activity-id="{activity_id}"]')
    expect(card).to_have_class(re.compile(r"\bmixed\b"))
    if "open" in (page.locator("#detailDrawer").get_attribute("class") or ""):
        page.locator("#closeDrawerButton").click()
        page.wait_for_timeout(300)

    target_locator = page.locator('[data-date="2026-07-28"]')
    source_box = card.bounding_box()
    target_box = target_locator.bounding_box()
    assert source_box and target_box
    page.mouse.move(
        source_box["x"] + source_box["width"] / 2,
        source_box["y"] + source_box["height"] / 2,
    )
    page.mouse.down()
    page.mouse.move(
        target_box["x"] + target_box["width"] / 2,
        target_box["y"] + target_box["height"] / 2,
        steps=12,
    )
    page.mouse.up()
    wait_saved(page)
    state = get_state(page)
    activity = next(item for item in state["activities"] if item["id"] == activity_id)
    assert activity["date"] == "2026-07-28", {
        "activity": activity,
        "toasts": page.locator("#toastRegion").inner_text(),
        "targetClass": target_locator.get_attribute("class"),
    }
    assert any(item["action"] == "rescheduled" for item in activity["history"])

    page.locator(f'[data-activity-id="{activity_id}"]').click()
    expect(page.locator("#detailDrawer")).to_have_class(re.compile(r"\bopen\b"))
    assert page.locator("#detailDrawer").evaluate("element => element.inert") is False
    expect(page.locator("#drawerBody")).to_contain_text("Prueba integral local")
    expect(page.locator("#drawerStatusSelect")).to_have_attribute(
        "aria-label", "Nuevo estado de la actividad"
    )
    page.select_option("#drawerStatusSelect", "completed")
    page.get_by_role("button", name="Aplicar estado").click()
    wait_saved(page)
    expect(page.locator(f'[data-activity-id="{activity_id}"]')).to_have_class(
        re.compile(r"\bcompleted\b")
    )
    opacity = page.locator(
        f'[data-activity-id="{activity_id}"]'
    ).evaluate("element => getComputedStyle(element).opacity")
    assert float(opacity) < 0.7
    page.locator("#closeDrawerButton").click()
    assert page.locator("#detailDrawer").evaluate("element => element.inert") is True

    page.get_by_test_id("new-activity").click()
    page.fill("#activityDate", "2026-07-09")
    page.fill("#activityEndDate", "2026-07-14")
    page.select_option("#activityServiceType", "administrative")
    page.fill("#activityObservations", "Actividad administrativa multidía")
    expect(page.locator("#rangePreview")).to_contain_text("4 tarjetas")
    expect(page.locator("#rangePreview")).to_contain_text("2 fechas")
    page.get_by_test_id("save-activity").click()
    expect(page.get_by_test_id("activity-dialog")).not_to_be_visible()
    wait_saved(page)

    state = get_state(page)
    assert len(state["activities"]) == 5
    series_id = next(
        item["seriesId"]
        for item in state["activities"]
        if item.get("seriesId") is not None
    )
    series_items = sorted(
        [item for item in state["activities"] if item.get("seriesId") == series_id],
        key=lambda item: item["date"],
    )
    assert [item["date"] for item in series_items] == [
        "2026-07-09",
        "2026-07-10",
        "2026-07-11",
        "2026-07-14",
    ]
    assert len({item["id"] for item in series_items}) == 4

    for item in series_items[:2]:
        page.locator(
            f'[data-activity-id="{item["id"]}"] .activity-select'
        ).check()
    expect(page.locator("#selectionBar")).to_be_visible()
    page.locator("#bulkMoveButton").click()
    page.fill("#bulkMoveDate", "2026-07-21")
    page.locator("#bulkMoveForm button[type=submit]").click()
    expect(page.locator("#bulkMoveDialog")).not_to_be_visible()
    wait_saved(page)
    state = get_state(page)
    moved_series = sorted(
        [item for item in state["activities"] if item.get("seriesId") == series_id],
        key=lambda item: item["date"],
    )
    assert {item["date"] for item in moved_series}.issuperset(
        {"2026-07-21", "2026-07-22"}
    )

    anchor = next(item for item in moved_series if item["date"] == "2026-07-21")
    page.locator(f'[data-activity-id="{anchor["id"]}"]').click()
    page.select_option("#drawerStatusSelect", "completed")
    page.locator(
        'input[name="drawerStatusScope"][value="series"]'
    ).check()
    page.get_by_role("button", name="Aplicar estado").click()
    wait_saved(page)
    state = get_state(page)
    assert all(
        item["status"] == "completed"
        for item in state["activities"]
        if item.get("seriesId") == series_id
    )
    page.locator("#closeDrawerButton").click()

    page.locator("#holidayButton").click()
    page.fill("#overrideDate", "2026-07-29")
    page.select_option("#overrideType", "manual-closure")
    page.fill("#overrideName", "Cierre de prueba")
    page.fill("#overrideReason", "Validación automatizada")
    page.locator("#holidayForm button[type=submit]").click()
    expect(page.locator("#overrideList")).to_contain_text("Cierre de prueba")
    page.locator('[data-close-dialog="holidayDialog"]').last.click()
    expect(page.locator('[data-date="2026-07-29"]')).to_have_class(
        re.compile(r"\bholiday\b")
    )
    wait_saved(page)

    state_before_reload = get_state(page)
    page.reload(wait_until="load")
    page.wait_for_selector('body[data-ready="true"]', timeout=20_000)
    state_after_reload = get_state(page)
    assert len(state_after_reload["activities"]) == len(
        state_before_reload["activities"]
    )
    assert len(state_after_reload["holidayOverrides"]) == 1

    with page.expect_download() as download_info:
        page.locator("#backupButton").click()
    backup_download = download_info.value
    backup_path = artifact_dir / "respaldo-prueba.json"
    backup_download.save_as(str(backup_path))
    backup = json.loads(backup_path.read_text(encoding="utf-8"))
    assert len(backup["activities"]) == len(state_after_reload["activities"])

    with page.expect_download() as download_info:
        page.locator("#exportCsvButton").click()
    csv_download = download_info.value
    csv_path = artifact_dir / "programacion-prueba.csv"
    csv_download.save_as(str(csv_path))
    csv_text = csv_path.read_text(encoding="utf-8-sig")
    assert "Responsables nómina" in csv_text
    assert "Responsables contratistas" in csv_text
    assert "Prueba integral local" in csv_text
    assert "cedula_nit" not in csv_text

    page.get_by_test_id("new-activity").click()
    page.fill("#activityDate", "2026-07-28")
    page.select_option("#activityServiceType", "administrative")
    page.fill("#activityObservations", "Temporal para probar restauración")
    page.get_by_test_id("save-activity").click()
    wait_saved(page)
    assert len(get_state(page)["activities"]) == len(backup["activities"]) + 1

    page.set_input_files("#restoreFileInput", str(backup_path))
    expect(page.locator("#restoreDialog")).to_be_visible()
    page.locator("#restoreForm button[type=submit]").click()
    expect(page.locator("#restoreDialog")).not_to_be_visible()
    wait_saved(page)
    assert len(get_state(page)["activities"]) == len(backup["activities"])

    page.screenshot(path=str(artifact_dir / f"{channel}-full.png"), full_page=True)
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not network_requests, network_requests

    context.close()
    browser.close()
    return {
        "channel": channel,
        "status": "ok",
        "mode": "full",
        "catalog": {"clients": 3, "sites": 18, "responsibles": 30},
        "activities": len(backup["activities"]),
        "baseSha256": before_hash,
        "networkRequests": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path)
    args = parser.parse_args()

    html_path = args.html.resolve()
    base_path = args.base.resolve()
    artifact_dir = (
        args.artifacts.resolve()
        if args.artifacts
        else Path(tempfile.mkdtemp(prefix="calendario-hvac-qa-"))
    )
    artifact_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        results = [
            launch_and_check(
                playwright,
                "chrome",
                html_path,
                base_path,
                artifact_dir,
                run_full=True,
            ),
            launch_and_check(
                playwright,
                "msedge",
                html_path,
                base_path,
                artifact_dir,
                run_full=False,
            ),
        ]

    print(
        json.dumps(
            {
                "status": "ok",
                "results": results,
                "artifacts": str(artifact_dir),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
