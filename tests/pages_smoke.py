from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

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
    if page.locator("#detailDrawer").is_visible():
        page.locator("#closeDrawerButton").dispatch_event("click")
    menu = page.locator(f".action-menu:has(#{button_id})")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    page.locator(f"#{button_id}").click()


def cloud_backup(page, url: str, email: str, password: str, artifact_dir: Path, label: str) -> dict:
    page.goto(url, wait_until="load")
    if page.locator("#cloudAuthDialog").is_visible():
        page.fill("#cloudAuthEmail", email)
        page.fill("#cloudAuthPassword", password)
        page.locator("#cloudAuthForm button[type=submit]").click()
    wait_ready(page)
    expect(page.locator("#storageStatusTitle")).to_have_text("Datos guardados en Supabase")
    expect(page.locator("#storageStatusText")).to_contain_text("Base compartida")
    expect(page.locator("#saveIndicatorText")).to_have_text("Guardado en Supabase")
    calendar_select = page.locator("#cloudCalendarSelect")
    refresh_calendars = page.locator("#refreshCloudCalendarsButton")
    expect(calendar_select).to_be_visible()
    expect(refresh_calendars).to_be_visible()
    calendar_count = calendar_select.locator("option").count()
    refresh_calendars.click()
    expect(page.locator("#toastRegion .toast").filter(
        has_text="cronogramas disponibles"
    )).to_be_visible(timeout=10_000)
    with page.expect_download() as download_info:
        click_menu_action(page, "backupButton")
    backup_path = artifact_dir / f"respaldo-{label}.json"
    download_info.value.save_as(str(backup_path))
    backup = json.loads(backup_path.read_text(encoding="utf-8"))
    expected_channel = "beta" if "/beta/" in url else "stable"
    assert backup["format"] == "calendario-hvac-siys-backup"
    assert backup["channel"] == expected_channel
    assert backup["document"]["schemaVersion"] == 4
    return {**backup, "calendarCount": calendar_count}


def is_supabase_rest_mutation(request) -> bool:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return False
    return urlsplit(request.url).path.startswith("/rest/v1/")


def check_responsible_selector(page, *, expect_beta: bool) -> dict:
    click_menu_action(page, "helpButton")
    page.wait_for_selector("#helpDialog", state="visible", timeout=10_000)
    page.wait_for_selector("#versionLabel", state="visible", timeout=10_000)
    version_text = page.locator("#versionLabel").inner_text()
    assert re.search(r"Versión \d+\.\d+\.\d+", version_text), version_text
    page.locator('[data-close-dialog="helpDialog"]').last.click()
    page.wait_for_selector("#helpDialog", state="hidden", timeout=10_000)
    if expect_beta:
        page.wait_for_selector("#betaBadge", state="visible", timeout=10_000)
    else:
        page.wait_for_selector("#betaBadge", state="hidden", timeout=10_000)

    page.locator("#newActivityButton").click()
    page.wait_for_selector("#activityDialog", state="visible", timeout=10_000)
    picker = page.locator("#responsiblePicker")
    page.wait_for_selector("#responsiblePicker", state="visible", timeout=10_000)
    page.wait_for_function(
        "() => Number(document.querySelector('#responsiblePicker')?.dataset.filteredCount || 0) > 0",
        timeout=10_000,
    )
    initial_count = int(picker.get_attribute("data-filtered-count"))
    assert initial_count > 1, initial_count
    initial_ids = picker.locator('input[name="responsibleIds"]').evaluate_all(
        "els => els.map(el => el.value)"
    )
    assert len(initial_ids) == len(set(initial_ids)), "responsables duplicados en el selector"

    name = picker.locator(".responsible-option strong").first.inner_text().lstrip("★").strip()
    assert name, "el selector no expone nombres de responsables"
    page.locator("#responsibleSearch").fill(name)
    page.wait_for_function(
        "(expected) => {"
        " const count = Number(document.querySelector('#responsiblePicker')?.dataset.filteredCount || 0);"
        " return count > 0 && count < expected;"
        " }",
        arg=initial_count,
        timeout=10_000,
    )
    filtered_count = int(picker.get_attribute("data-filtered-count"))
    filtered_ids = picker.locator('input[name="responsibleIds"]').evaluate_all(
        "els => els.map(el => el.value)"
    )
    assert filtered_ids, "el filtro de responsables no devolvió coincidencias"
    assert len(filtered_ids) == len(set(filtered_ids)), "responsables duplicados al filtrar"

    page.locator("#responsibleSearch").fill("")
    page.wait_for_function(
        "(expected) => Number(document.querySelector('#responsiblePicker')?.dataset.filteredCount || 0) === expected",
        arg=initial_count,
        timeout=10_000,
    )
    restored_ids = picker.locator('input[name="responsibleIds"]').evaluate_all(
        "els => els.map(el => el.value)"
    )
    assert set(restored_ids) == set(initial_ids), "el filtro no restauró el listado de responsables"

    recommended = page.locator("#responsiblePicker .responsible-option.recommended")
    assert recommended.count() == 0, "sin ciudad no debería haber responsables sugeridos"
    detail_texts = picker.locator(".responsible-option small").evaluate_all(
        "els => els.map(el => el.textContent || '')"
    )
    derived = [text.split("·")[0].strip() for text in detail_texts]
    datalist = page.locator("#citySuggestions option").evaluate_all(
        "els => els.map(el => el.value).filter(Boolean)"
    )
    city_candidates = list(dict.fromkeys([city for city in derived + datalist if city]))
    city_checked = False
    for candidate in city_candidates[:40]:
        page.locator("#activityCity").fill(candidate)
        page.wait_for_timeout(200)
        if recommended.count() > 0:
            city_checked = True
            break
    assert city_checked, "cambiar la ciudad no marcó responsables sugeridos"
    page.locator("#activityCity").fill("")
    page.wait_for_timeout(200)

    page.locator('[data-close-dialog="activityDialog"]').first.click()
    page.wait_for_selector("#activityDialog", state="hidden", timeout=10_000)

    return {
        "version": version_text,
        "initialCount": initial_count,
        "filteredCount": filtered_count,
        "restoredCount": len(restored_ids),
        "duplicates": 0,
        "cityChecked": city_checked,
    }


def redact(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return text


def run_cloud_smoke(args, artifact_dir: Path) -> None:
    email = os.environ.get("SIYS_SMOKE_EMAIL")
    password = os.environ.get(args.cloud_password_env)
    if not email or not password:
        raise SystemExit(
            "El smoke cloud requiere las variables de entorno "
            f"SIYS_SMOKE_EMAIL y {args.cloud_password_env}."
        )
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            context = browser.new_context(accept_downloads=True, locale="es-CO")
            page_errors: list[str] = []
            console_errors: list[str] = []
            bad_responses: list[tuple[str, int]] = []
            rest_mutations: list[str] = []
            page = context.new_page()
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
            context.on(
                "request",
                lambda request: rest_mutations.append(
                    f"{request.method} {urlsplit(request.url).path}"
                )
                if is_supabase_rest_mutation(request)
                else None,
            )
            stable_backup = cloud_backup(page, args.url, email, password, artifact_dir, "stable")
            selector = None
            if args.beta_url:
                beta_page = context.new_page()
                beta_backup = cloud_backup(beta_page, args.beta_url, email, password, artifact_dir, "beta")
                assert beta_backup["channel"] == "beta"
                if args.check_responsibles:
                    rest_mutations.clear()
                    selector = check_responsible_selector(beta_page, expect_beta=True)
                    assert not rest_mutations, rest_mutations
                beta_page.close()
            elif args.check_responsibles:
                rest_mutations.clear()
                selector = check_responsible_selector(page, expect_beta=False)
                assert not rest_mutations, rest_mutations
            assert stable_backup["channel"] == "stable"
            assert not page_errors, page_errors
            assert not console_errors, console_errors
            assert all(url.endswith("/favicon.ico") and status == 404 for url, status in bad_responses), bad_responses
            context.close()
            browser.close()
        payload = {
            "status": "ok",
            "mode": "cloud-read-authenticated",
            "stableChannel": stable_backup["channel"],
            "betaChannel": bool(args.beta_url),
            "supabase": True,
            "responsibleSelector": selector,
            "restMutationsDuringSelector": len(rest_mutations) if selector is not None else None,
            "authenticatedScreenshots": 0,
            "artifacts": str(artifact_dir.resolve())
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    except SystemExit:
        raise
    except Exception as error:
        message = redact(f"{type(error).__name__}: {error}", [email, password])
        raise SystemExit(message) from None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--beta-url")
    parser.add_argument("--merge-fixture", type=Path)
    parser.add_argument("--local-html", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--expect-cloud", action="store_true")
    parser.add_argument("--check-responsibles", action="store_true")
    parser.add_argument("--cloud-password-env", default="SIYS_SMOKE_PASSWORD")
    args = parser.parse_args()
    if args.check_responsibles and not args.expect_cloud:
        parser.error("--check-responsibles requiere --expect-cloud")
    artifact_dir = args.artifacts or Path(tempfile.mkdtemp(prefix="calendario-pages-"))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    if args.expect_cloud:
        run_cloud_smoke(args, artifact_dir)
        return
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
        storage_text = page.locator("#storageStatusText").inner_text()
        assert (
            "Guardado en este navegador" in storage_text
            or "Modo GitHub Pages" in storage_text
        ), storage_text
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
            beta_revision = get_state(beta_page)["calendarMeta"]["revision"]
            click_menu_action(beta_page, "themeButton")
            expect(beta_page.locator("html")).to_have_attribute("data-theme", "light")
            click_menu_action(beta_page, "themeButton")
            expect(beta_page.locator("html")).to_have_attribute("data-theme", "dark")
            assert get_state(beta_page)["calendarMeta"]["revision"] == beta_revision
            beta_theme_page = context.new_page()
            beta_theme_page.goto(args.beta_url, wait_until="load")
            wait_ready(beta_theme_page)
            expect(beta_theme_page.locator("html")).to_have_attribute("data-theme", "dark")
            beta_theme_page.close()
            with beta_page.expect_download() as image_download:
                click_menu_action(beta_page, "exportImageButton")
            beta_image = artifact_dir / "beta-dark.png"
            image_download.value.save_as(str(beta_image))
            assert beta_image.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
            if args.merge_fixture:
                beta_page.set_input_files("#mergeJsonFileInput", str(args.merge_fixture.resolve()))
                expect(beta_page.locator("#mergeJsonDialog")).to_be_visible()
                expect(beta_page.locator("#mergeJsonWarnings")).to_contain_text("canal local")
                beta_page.locator("#mergeJsonForm button[type=submit]").click()
                wait_saved(beta_page)
                assert len(get_state(beta_page)["activities"]) == 2
                merge_toast = beta_page.locator("#toastRegion .toast").filter(
                    has_text="registros añadidos"
                )
                merge_toast.get_by_role("button", name="Deshacer").click()
                wait_saved(beta_page)
                assert len(get_state(beta_page)["activities"]) == 1
            stable_after_beta = get_state(page)
            assert stable_after_beta and len(stable_after_beta["activities"]) == 1
            assert stable_after_beta["activities"][0]["id"] == activity_id
            beta_page.close()
            system_context = browser.new_context(locale="es-CO", color_scheme="dark")
            system_context.add_init_script(
                """localStorage.setItem("siys-sync-ui:beta", JSON.stringify({theme: "system"}));"""
            )
            system_page = system_context.new_page()
            system_page.goto(args.beta_url, wait_until="load")
            wait_ready(system_page)
            expect(system_page.locator("html")).to_have_attribute("data-theme", "dark")
            system_context.close()

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
        "betaThemePersistent": bool(args.beta_url),
        "systemThemeDetected": bool(args.beta_url),
        "darkPngExported": bool(args.beta_url),
        "networkRequestsAfterLoad": 0,
        "artifacts": str(artifact_dir.resolve())
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
