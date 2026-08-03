from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def read_state(page):
    return page.evaluate(
        """async () => new Promise((resolve, reject) => {
          const request = indexedDB.open('calendario-hvac-siys', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('documents', 'readonly');
            const get = transaction.objectStore('documents').get('current');
            get.onerror = () => reject(get.error);
            get.onsuccess = () => resolve(get.result?.document ?? null);
          };
        })"""
    )


def wait_saved(page):
    expect(page.locator("#saveIndicatorText")).to_have_text("Guardado", timeout=15_000)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True, type=Path)
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="es-CO",
            timezone_id="America/Bogota",
        )
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(args.html.resolve().as_uri(), wait_until="load")
        page.wait_for_selector('body[data-ready="true"]', timeout=20_000)

        page.locator("#quarantineTab").click()
        expect(page.locator("#quarantineTab")).to_contain_text("Pendiente")
        page.locator("#newQuarantineButton").click()
        page.select_option("#activityServiceType", "administrative")
        page.fill("#activityObservations", "Tarjeta sin fecha")
        page.locator("#saveActivityButton").click()
        wait_saved(page)
        page.locator("#closeDrawerButton").click()
        expect(page.locator("#quarantineCount")).to_have_text("1")

        card = page.locator("#catalogList .quarantine-card")
        target = page.locator("#calendarGrid .day-cell:not(.sunday):not(.holiday)").nth(5)
        expect(card).to_have_count(1)
        expect(target).to_have_count(1)
        target_date = target.get_attribute("data-date")
        card.drag_to(target)
        wait_saved(page)
        state = read_state(page)
        assert state["activities"][0]["date"] == target_date, state
        assert state["activities"][0]["planningBucket"] == "calendar", state
        assert state["activities"][0]["status"] == "scheduled", state

        calendar_activity_id = state["activities"][0]["id"]
        calendar_card = page.locator(f'.activity-card[data-activity-id="{calendar_activity_id}"]')
        calendar_card.drag_to(page.locator("#catalogList"))
        expect(page.locator("#quarantineDialog")).to_be_visible()
        expect(page.locator("#quarantineScopeFieldset")).not_to_be_visible()
        page.locator("#quarantineForm button[type=submit]").click()
        wait_saved(page)
        state = read_state(page)
        assert state["activities"][0]["planningBucket"] == "quarantine", state
        assert state["activities"][0]["date"] is None, state
        page.locator("#closeDrawerButton").click()

        page.locator("#newActivityButton").click()
        page.fill("#activityDate", target_date)
        page.select_option("#activityServiceType", "administrative")
        page.fill("#activityObservations", "Enviar a Pendiente")
        page.locator("#saveActivityButton").click()
        page.get_by_role("button", name="Enviar a Pendiente").click()
        expect(page.locator("#quarantineDialog")).to_be_visible()
        expect(page.locator("#quarantineScopeFieldset")).not_to_be_visible()
        page.locator("#quarantineForm button[type=submit]").click()
        wait_saved(page)
        state = read_state(page)
        quarantined = [item for item in state["activities"] if item["planningBucket"] == "quarantine"]
        assert len(quarantined) == 2, state
        assert all(item["status"] == "to_schedule" and item["date"] is None for item in quarantined), state

        page.locator("#closeDrawerButton").click()
        with page.expect_download() as download_info:
            menu = page.locator(".action-menu", has_text="Compartir")
            menu.locator("summary").click()
            page.locator("#exportQuarantineCsvButton").click()
        assert download_info.value.suggested_filename.startswith("pendientes_")

        assert not page_errors, page_errors
        print({"status": "ok", "activities": len(state["activities"]), "quarantine": len(quarantined)})
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
