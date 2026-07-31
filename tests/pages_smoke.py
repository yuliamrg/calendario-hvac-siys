from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def get_state(page) -> dict | None:
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


def wait_ready(page) -> None:
    page.wait_for_selector('body[data-ready="true"]', timeout=30_000)


def wait_saved(page) -> None:
    expect(page.locator("#saveIndicatorText")).to_have_text("Guardado", timeout=15_000)


def click_menu_action(page, button_id: str) -> None:
    menu = page.locator(f".action-menu:has(#{button_id})")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    page.locator(f"#{button_id}").click()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--beta-url")
    parser.add_argument("--local-html", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path)
    args = parser.parse_args()
    artifact_dir = args.artifacts or Path(tempfile.mkdtemp(prefix="calendario-pages-"))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    local_uri = args.local_html.resolve().as_uri()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(accept_downloads=True, locale="es-CO")
        page = context.new_page()
        page_errors: list[str] = []
        console_errors: list[str] = []
        bad_responses: list[tuple[str, int]] = []
        requests_after_load: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error" and not message.text.startswith("Failed to load resource:")
            else None,
        )
        page.on(
            "response",
            lambda response: bad_responses.append((response.url, response.status))
            if response.status >= 400
            else None,
        )
        page.goto(args.url, wait_until="load")
        wait_ready(page)
        page.on("request", lambda request: requests_after_load.append(request.url))
        expect(page.locator("#storageStatusTitle")).to_have_text("Datos guardados solamente en este navegador")
        expect(page.locator("#storageStatusText")).to_contain_text("Modo GitHub Pages")
        if "/beta/" in args.url:
            expect(page.locator("#betaBadge")).to_be_visible()

        page.locator("#newActivityButton").click()
        page.fill("#activityDate", "2026-07-30")
        page.select_option("#activityServiceType", "administrative")
        page.fill("#activityObservations", "Persistencia GitHub Pages")
        page.locator("#activityForm button[type=submit]").click()
        wait_saved(page)
        state = get_state(page)
        assert state and len(state["activities"]) == 1
        activity_id = state["activities"][0]["id"]

        page.reload(wait_until="load")
        wait_ready(page)
        requests_after_load.clear()
        persisted = get_state(page)
        assert persisted and persisted["activities"][0]["id"] == activity_id

        if args.beta_url:
            beta_page = context.new_page()
            beta_page.goto(args.beta_url, wait_until="load")
            wait_ready(beta_page)
            expect(beta_page.locator("#betaBadge")).to_be_visible()
            beta_state = get_state(beta_page)
            assert not beta_state or len(beta_state["activities"]) == 0
            beta_page.locator("#newActivityButton").click()
            beta_page.fill("#activityDate", "2026-07-31")
            beta_page.select_option("#activityServiceType", "administrative")
            beta_page.fill("#activityObservations", "Persistencia BETA aislada")
            beta_page.locator("#activityForm button[type=submit]").click()
            wait_saved(beta_page)
            assert len(get_state(beta_page)["activities"]) == 1
            stable_after_beta = get_state(page)
            assert stable_after_beta and len(stable_after_beta["activities"]) == 1
            assert stable_after_beta["activities"][0]["id"] == activity_id
            beta_page.close()

        second_page = context.new_page()
        second_page.goto(args.url, wait_until="load")
        wait_ready(second_page)
        expect(second_page.locator("#accessBanner")).to_be_visible()
        expect(second_page.locator("#newActivityButton")).to_be_disabled()
        second_page.close()

        with page.expect_download() as download_info:
            click_menu_action(page, "backupButton")
        backup_path = artifact_dir / "respaldo-pages.json"
        download_info.value.save_as(str(backup_path))
        backup = json.loads(backup_path.read_text(encoding="utf-8"))
        assert backup["format"] == "calendario-hvac-siys-backup"
        assert backup["document"]["activities"][0]["id"] == activity_id

        local_page = context.new_page()
        local_page.goto(local_uri, wait_until="load")
        wait_ready(local_page)
        local_state = get_state(local_page)
        assert not local_state or len(local_state["activities"]) == 0
        local_page.set_input_files("#restoreFileInput", str(backup_path))
        expect(local_page.locator("#restoreDialog")).to_be_visible()
        local_page.locator("#restoreForm button[type=submit]").click()
        wait_saved(local_page)
        restored_local = get_state(local_page)
        assert restored_local and restored_local["activities"][0]["id"] == activity_id

        clean_context = browser.new_context(accept_downloads=True, locale="es-CO")
        clean_page = clean_context.new_page()
        clean_page.goto(args.url, wait_until="load")
        wait_ready(clean_page)
        clean_state = get_state(clean_page)
        assert not clean_state or len(clean_state["activities"]) == 0
        clean_page.set_input_files("#restoreFileInput", str(backup_path))
        expect(clean_page.locator("#restoreDialog")).to_be_visible()
        clean_page.locator("#restoreForm button[type=submit]").click()
        wait_saved(clean_page)
        restored_clean = get_state(clean_page)
        assert restored_clean and restored_clean["activities"][0]["id"] == activity_id

        page.screenshot(path=str(artifact_dir / "pages-production.png"), full_page=True)
        assert not page_errors, page_errors
        assert not console_errors, console_errors
        assert all(url.endswith("/favicon.ico") and status == 404 for url, status in bad_responses), bad_responses
        assert not requests_after_load, requests_after_load

        clean_context.close()
        context.close()
        browser.close()

    print(json.dumps({
        "status": "ok",
        "url": args.url,
        "persistedActivities": 1,
        "secondTabReadOnly": True,
        "localOriginSeparated": True,
        "jsonPortable": True,
        "cleanContextRestore": True,
        "networkRequestsAfterLoad": 0,
        "artifacts": str(artifact_dir.resolve())
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
