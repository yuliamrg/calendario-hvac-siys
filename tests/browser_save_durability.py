from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SOURCE_HTML = ROOT / "dist" / "index.html"

INIT_SCRIPT = '''(() => {
  const harness = {
    hold: false,
    writes: [],
    waiters: [],
    clearCalls: 0,
    write(snapshot, commit) {
      let resolveWrite;
      let rejectWrite;
      const record = {
        name: snapshot.calendarMeta.name,
        done: false,
        failed: false,
        release: null,
        fail: null
      };
      this.writes.push(record);
      const finish = () => Promise.resolve(commit()).then(() => { record.done = true; });
      if (!this.hold) return finish();
      const pending = new Promise((resolve, reject) => {
        resolveWrite = resolve;
        rejectWrite = reject;
      });
      record.release = () => finish().then(resolveWrite, rejectWrite);
      record.fail = (message) => {
        record.failed = true;
        rejectWrite(new Error(message));
      };
      return pending;
    }
  };
  window.__D_SAVE_HARNESS__ = harness;
})();'''


def instrumented_html() -> str:
    source = SOURCE_HTML.read_text(encoding="utf-8")
    source, config_count = re.subn(
        r"globalThis\.__SIYS_SUPABASE_CONFIG__\s*=\s*\{[^;]*\};",
        'globalThis.__SIYS_SUPABASE_CONFIG__ = {"enabled":false,"url":"","publishableKey":""};',
        source,
        count=1,
    )
    if config_count != 1:
        raise AssertionError("El HTML temporal no permitió aislar la configuración cloud")

    old_writer = '''function writeStoredDocument(documentSnapshot) {
  if (CLOUD_MODE) return cloudPersistence.write(documentSnapshot);
  return localDocumentStore.writeWithRecovery(database, documentSnapshot);
}'''
    new_writer = '''function writeStoredDocument(documentSnapshot) {
  if (globalThis.__D_SAVE_HARNESS__) {
    return globalThis.__D_SAVE_HARNESS__.write(documentSnapshot, () =>
      localDocumentStore.writeWithRecovery(database, documentSnapshot));
  }
  if (CLOUD_MODE) return cloudPersistence.write(documentSnapshot);
  return localDocumentStore.writeWithRecovery(database, documentSnapshot);
}'''
    if source.count(old_writer) != 1:
        raise AssertionError("No se encontró el punto de persistencia del build generado")
    source = source.replace(old_writer, new_writer, 1)

    old_clearer = '''function clearStoredDocuments() {
  if (CLOUD_MODE) return Promise.resolve();
  if (!database) return Promise.resolve();
  return localDocumentStore.clearDocuments(database);
}'''
    new_clearer = '''function clearStoredDocuments() {
  if (globalThis.__D_SAVE_HARNESS__) globalThis.__D_SAVE_HARNESS__.clearCalls += 1;
  if (CLOUD_MODE) return Promise.resolve();
  if (!database) return Promise.resolve();
  return localDocumentStore.clearDocuments(database);
}'''
    if source.count(old_clearer) != 1:
        raise AssertionError("No se encontró el punto de limpieza de datos para el test de reset")
    source = source.replace(old_clearer, new_clearer, 1)

    marker = "function appendAudit(action, detail) {"
    api = '''if (globalThis.__D_SAVE_HARNESS__) {
  const harness = globalThis.__D_SAVE_HARNESS__;
  const productionScheduleSave = scheduleSave;
  scheduleSave = function (options = {}) {
    const waiter = {name: appDocument.calendarMeta.name, resolved: false, rejected: ""};
    harness.waiters.push(waiter);
    const completion = productionScheduleSave(options);
    completion.then(
      () => { waiter.resolved = true; },
      error => { waiter.rejected = error.message; }
    );
    return completion;
  };
  harness.api = {
    edit(name, immediate = false) {
      appDocument.calendarMeta.name = name;
      renderAll();
      scheduleSave({immediate});
    },
    metrics() {
      return {
        ...saveQueue.getState(),
        waiters: harness.waiters.map(({name, resolved, rejected}) => ({name, resolved, rejected})),
        writes: harness.writes.map(({name, done, failed}) => ({name, done, failed})),
        clearCalls: harness.clearCalls,
        current: appDocument.calendarMeta.name,
        indicator: document.querySelector("#saveIndicatorText")?.textContent ?? "",
        lastBackupAt: appDocument.settings.lastBackupAt,
        storageAvailable,
        editControl: hasEditControl,
        exitGuard: saveExitGuard.isActive()
      };
    },
    async reset() {
      dom.resetConfirmation.value = "REINICIAR";
      await handleResetDataSubmit({preventDefault() {}});
      return dom.resetDataErrors.textContent.trim();
    },
    contractVersion(documentSnapshot) {
      return executeCalendarOperation(documentSnapshot, {operation: "calendar.inspect"}).contractVersion;
    },
    storedName(key = "current") {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("calendario-hvac-siys", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("documents", "readonly");
          const get = tx.objectStore("documents").get(key);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result?.document?.calendarMeta?.name ?? null);
          tx.oncomplete = () => db.close();
        };
      });
    }
  };
}

''' + marker
    if source.count(marker) != 1:
        raise AssertionError("No se encontró el punto temporal para observar la cola")
    source = source.replace(marker, api, 1)
    return source


def wait_for_writer(page, index: int) -> None:
    page.wait_for_function(
        "index => window.__D_SAVE_HARNESS__.writes.length > index",
        arg=index,
        timeout=5000,
    )


def save_baseline(page, name: str) -> None:
    page.evaluate("name => window.__D_SAVE_HARNESS__.api.edit(name, true)", name)
    page.wait_for_function(
        "name => window.__D_SAVE_HARNESS__.api.metrics().waiters.some(item => item.name === name && item.resolved)",
        arg=name,
        timeout=5000,
    )
    expect(page.locator("#saveIndicatorText")).to_have_text("Guardado")
    expect(page.locator("body")).to_have_attribute("data-ready", "true")


def dismiss_reload_dialog(page, dialogs: list[str]) -> None:
    def handle(dialog) -> None:
        dialogs.append(dialog.type)
        dialog.dismiss()

    page.on("dialog", handle)
    page.locator("#toggleCatalogButton").click()
    try:
        page.reload(wait_until="domcontentloaded", timeout=10000)
    except PlaywrightError:
        if not dialogs:
            raise
    finally:
        page.remove_listener("dialog", handle)


def open_context(browser, html_path: Path, external_requests: list[str], page_errors: list[str]):
    context = browser.new_context(
        locale="es-CO",
        timezone_id="America/Bogota",
        viewport={"width": 1440, "height": 900},
    )

    def guard(route) -> None:
        url = route.request.url
        if url.startswith(("https://", "http://")):
            external_requests.append(url.split("/")[2])
            route.abort()
        else:
            route.continue_()

    context.route("**/*", guard)
    context.add_init_script(INIT_SCRIPT)
    page = context.new_page()
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(html_path.as_uri(), wait_until="load")
    page.wait_for_selector('body[data-ready="true"]', timeout=20000)
    page.wait_for_function("window.__D_SAVE_HARNESS__.api.metrics().editControl", timeout=10000)
    return context, page


def run() -> dict:
    report = {"browser": None, "viewport": "1440x900", "d1": {}, "d2": {}, "error": {}}
    external_requests: list[str] = []
    page_errors: list[str] = []

    with tempfile.TemporaryDirectory(prefix="siys-save-d-browser-") as temp_dir:
        html_path = Path(temp_dir) / "index.html"
        html_path.write_text(instrumented_html(), encoding="utf-8")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            report["browser"] = browser.version

            context, page = open_context(browser, html_path, external_requests, page_errors)
            save_baseline(page, "Baseline D1")
            report["d1"]["baseline"] = page.evaluate("window.__D_SAVE_HARNESS__.api.storedName()")
            page.evaluate('() => { const h=window.__D_SAVE_HARNESS__; h.hold=true; h.writes=[]; h.waiters=[]; }')
            page.evaluate('window.__D_SAVE_HARNESS__.api.edit("D1-A")')
            wait_for_writer(page, 0)
            page.evaluate('window.__D_SAVE_HARNESS__.api.edit("D1-B")')
            page.wait_for_timeout(400)
            report["d1"]["before_a_completes"] = page.evaluate('''async () => ({
              ...window.__D_SAVE_HARNESS__.api.metrics(), stored: await window.__D_SAVE_HARNESS__.api.storedName()
            })''')
            page.evaluate("window.__D_SAVE_HARNESS__.writes[0].release()")
            wait_for_writer(page, 1)
            page.wait_for_function('window.__D_SAVE_HARNESS__.api.metrics().waiters[1]?.resolved === false')
            report["d1"]["after_a_before_b_completes"] = page.evaluate('''async () => ({
              ...window.__D_SAVE_HARNESS__.api.metrics(), stored: await window.__D_SAVE_HARNESS__.api.storedName()
            })''')
            page.evaluate("window.__D_SAVE_HARNESS__.writes[1].release()")
            page.wait_for_function('window.__D_SAVE_HARNESS__.api.metrics().waiters[1]?.resolved === true')
            expect(page.locator("#saveIndicatorText")).to_have_text("Guardado")
            report["d1"]["after_b_completes"] = page.evaluate('''async () => ({
              ...window.__D_SAVE_HARNESS__.api.metrics(),
              stored: await window.__D_SAVE_HARNESS__.api.storedName(),
              recovery: await window.__D_SAVE_HARNESS__.api.storedName("recovery")
            })''')
            context.close()

            context, page = open_context(browser, html_path, external_requests, page_errors)
            save_baseline(page, "Baseline D2")
            page.evaluate('() => { const h=window.__D_SAVE_HARNESS__; h.hold=true; h.writes=[]; h.waiters=[]; }')
            page.evaluate('window.__D_SAVE_HARNESS__.api.edit("D2-A")')
            wait_for_writer(page, 0)
            page.evaluate('window.__D_SAVE_HARNESS__.api.edit("D2-B")')
            page.wait_for_timeout(400)
            report["d2"]["before_reload"] = page.evaluate('''async () => ({
              ...window.__D_SAVE_HARNESS__.api.metrics(), stored: await window.__D_SAVE_HARNESS__.api.storedName()
            })''')
            dialogs: list[str] = []
            dismiss_reload_dialog(page, dialogs)
            report["d2"]["cancelled_reload"] = {
                "dialogs": dialogs,
                "document_ready": page.locator("body").get_attribute("data-ready"),
                **page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()"),
            }
            page.evaluate("window.__D_SAVE_HARNESS__.writes[0].release()")
            wait_for_writer(page, 1)
            page.evaluate("window.__D_SAVE_HARNESS__.writes[1].release()")
            page.wait_for_function('window.__D_SAVE_HARNESS__.api.metrics().pending === false')
            report["d2"]["after_last_save"] = page.evaluate('''async () => ({
              ...window.__D_SAVE_HARNESS__.api.metrics(), stored: await window.__D_SAVE_HARNESS__.api.storedName()
            })''')
            post_save_dialogs: list[str] = []

            def accept_any_dialog(dialog) -> None:
                post_save_dialogs.append(dialog.type)
                dialog.accept()

            page.on("dialog", accept_any_dialog)
            page.reload(wait_until="load")
            page.wait_for_selector('body[data-ready="true"]', timeout=20000)
            report["d2"]["reopened_after_save"] = {
                "dialogs": post_save_dialogs,
                "name": page.evaluate("window.__D_SAVE_HARNESS__.api.metrics().current"),
                "stored": page.evaluate("window.__D_SAVE_HARNESS__.api.storedName()"),
            }
            context.close()

            context, page = open_context(browser, html_path, external_requests, page_errors)
            save_baseline(page, "Baseline backup")
            page.evaluate('() => { const h=window.__D_SAVE_HARNESS__; h.hold=true; h.writes=[]; h.waiters=[]; }')
            downloads: list[str] = []
            page.on("download", lambda download: downloads.append(download.suggested_filename))
            page.locator(".action-menu:has(#backupButton) summary").click()
            page.locator("#backupButton").click()
            wait_for_writer(page, 0)
            page.wait_for_timeout(300)
            report["backup"] = {
                "before_persist": page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()"),
                "downloads_before_persist": list(downloads),
            }
            page.evaluate('window.__D_SAVE_HARNESS__.api.edit("Later edit during backup persistence")')
            page.wait_for_timeout(350)
            report["backup"]["later_edit_pending"] = page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()")
            with page.expect_download(timeout=5000) as download_info:
                page.evaluate("window.__D_SAVE_HARNESS__.writes[0].release()")
                wait_for_writer(page, 1)
            downloaded_path = download_info.value.path()
            report["backup"]["filename"] = download_info.value.suggested_filename
            report["backup"]["envelope"] = json.loads(Path(downloaded_path).read_text(encoding="utf-8"))
            download_info.value.cancel()
            page.evaluate("window.__D_SAVE_HARNESS__.writes[1].release()")
            page.wait_for_function('window.__D_SAVE_HARNESS__.api.metrics().pending === false')
            context.close()

            context, page = open_context(browser, html_path, external_requests, page_errors)
            save_baseline(page, "Baseline error")
            page.evaluate('() => { const h=window.__D_SAVE_HARNESS__; h.hold=true; h.writes=[]; h.waiters=[]; }')
            page.evaluate('window.__D_SAVE_HARNESS__.api.edit("Error snapshot")')
            wait_for_writer(page, 0)
            page.evaluate('window.__D_SAVE_HARNESS__.writes[0].fail("local quota exceeded")')
            expect(page.locator("#saveIndicatorText")).to_have_text("Sin guardado local", timeout=5000)
            report["error"]["after_failure"] = page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()")
            error_dialogs: list[str] = []
            dismiss_reload_dialog(page, error_dialogs)
            report["error"]["cancelled_reload"] = {
                "dialogs": error_dialogs,
                "document_ready": page.locator("body").get_attribute("data-ready"),
                **page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()"),
            }
            error_downloads: list[str] = []
            page.on("download", lambda download: error_downloads.append(download.suggested_filename))
            page.locator(".action-menu:has(#backupButton) summary").click()
            with page.expect_download(timeout=5000) as error_download_info:
                page.locator("#backupButton").click()
            error_backup_path = error_download_info.value.path()
            error_backup = json.loads(Path(error_backup_path).read_text(encoding="utf-8"))
            page.wait_for_timeout(300)
            report["error"]["rescue_backup"] = {
                "downloads": list(error_downloads),
                "filename": error_download_info.value.suggested_filename,
                "envelope": error_backup,
                "contractVersion": page.evaluate(
                    "documentSnapshot => window.__D_SAVE_HARNESS__.api.contractVersion(documentSnapshot)",
                    error_backup["document"],
                ),
                "state": page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()"),
            }
            error_download_info.value.cancel()

            reset_download_start = len(error_downloads)
            with page.expect_download(timeout=5000) as reset_download_info:
                reset_error = page.evaluate("window.__D_SAVE_HARNESS__.api.reset()")
            reset_backup_path = reset_download_info.value.path()
            reset_backup = json.loads(Path(reset_backup_path).read_text(encoding="utf-8"))
            page.wait_for_timeout(100)
            report["error"]["reset_after_failure"] = {
                "error": reset_error,
                "downloads": error_downloads[reset_download_start:],
                "envelope": reset_backup,
                "state": page.evaluate("window.__D_SAVE_HARNESS__.api.metrics()"),
                "stored": page.evaluate("window.__D_SAVE_HARNESS__.api.storedName()"),
            }
            reset_download_info.value.cancel()
            context.close()
            browser.close()

    report["external_requests"] = external_requests
    report["page_errors"] = page_errors
    if external_requests:
        raise AssertionError("La prueba intentó una solicitud HTTP(S) externa")
    if page_errors:
        raise AssertionError("Errores de página: " + json.dumps(page_errors, ensure_ascii=False))

    assert report["d1"]["before_a_completes"]["writes"] == [{"name": "D1-A", "done": False, "failed": False}]
    d1_after_a = report["d1"]["after_a_before_b_completes"]
    assert d1_after_a["indicator"] == "Guardando…"
    assert d1_after_a["waiters"][1]["resolved"] is False
    assert d1_after_a["stored"] == "D1-A"
    assert d1_after_a["writes"][1]["done"] is False
    assert report["d1"]["after_b_completes"]["stored"] == "D1-B"
    assert report["d1"]["after_b_completes"]["recovery"] == "D1-A"

    d2_before = report["d2"]["before_reload"]
    assert d2_before["timerPending"] is False
    assert d2_before["writes"] == [{"name": "D2-A", "done": False, "failed": False}]
    assert d2_before["stored"] == "Baseline D2"
    d2_cancel = report["d2"]["cancelled_reload"]
    assert "beforeunload" in d2_cancel["dialogs"]
    assert d2_cancel["document_ready"] == "true"
    assert d2_cancel["current"] == "D2-B"
    assert d2_cancel["writes"] == [{"name": "D2-A", "done": False, "failed": False}]
    assert d2_cancel["exitGuard"] is True
    assert d2_cancel["pending"] is True
    assert report["d2"]["after_last_save"]["exitGuard"] is False
    assert report["d2"]["reopened_after_save"]["dialogs"] == []
    assert report["d2"]["reopened_after_save"]["stored"] == "D2-B"

    assert report["backup"]["before_persist"]["waiters"][-1]["resolved"] is False
    assert report["backup"]["downloads_before_persist"] == []
    assert report["backup"]["later_edit_pending"]["waiters"][-1]["resolved"] is False
    assert report["backup"]["later_edit_pending"]["writes"] == [
        {"name": "Baseline backup", "done": False, "failed": False}
    ]
    assert report["backup"]["envelope"]["document"]["calendarMeta"]["name"] == "Baseline backup"
    assert report["backup"]["envelope"]["document"]["settings"]["lastBackupAt"]
    assert report["backup"]["envelope"]["document"]["audit"][-1]["action"] == "backup_created"

    error_state = report["error"]["after_failure"]
    assert error_state["storageAvailable"] is False
    assert error_state["exitGuard"] is True
    assert error_state["pending"] is True
    error_cancel = report["error"]["cancelled_reload"]
    assert "beforeunload" in error_cancel["dialogs"]
    assert error_cancel["document_ready"] == "true"
    assert error_cancel["writes"] == [{"name": "Error snapshot", "done": False, "failed": True}]
    rescue = report["error"]["rescue_backup"]
    assert len(rescue["downloads"]) == 1
    assert rescue["envelope"]["format"] == "calendario-hvac-siys-backup"
    assert rescue["envelope"]["formatVersion"] == 1
    assert rescue["envelope"]["document"]["schemaVersion"] == 4
    assert rescue["contractVersion"] == 1
    assert rescue["envelope"]["document"]["calendarMeta"]["name"] == "Error snapshot"
    assert rescue["envelope"]["document"]["settings"]["lastBackupAt"]
    assert rescue["envelope"]["exportedAt"] == rescue["envelope"]["document"]["settings"]["lastBackupAt"]
    assert rescue["envelope"]["document"]["audit"][-1]["action"] == "backup_created"
    rescue_state = rescue["state"]
    assert rescue_state["storageAvailable"] is False
    assert rescue_state["pending"] is True
    assert rescue_state["exitGuard"] is True
    assert rescue_state["indicator"] == "Sin guardado local"
    assert rescue_state["writes"] == [{"name": "Error snapshot", "done": False, "failed": True}]
    assert all(not waiter["resolved"] for waiter in rescue_state["waiters"])
    assert rescue_state["waiters"][-1]["rejected"] == "local quota exceeded"
    assert rescue_state["requestedGeneration"] == error_state["requestedGeneration"]
    assert rescue_state["persistedGeneration"] == error_state["persistedGeneration"]

    reset = report["error"]["reset_after_failure"]
    assert "No se pudo reiniciar" in reset["error"]
    assert len(reset["downloads"]) == 1
    assert reset["envelope"]["document"]["calendarMeta"]["name"] == "Error snapshot"
    assert reset["envelope"]["document"]["settings"]["lastBackupAt"]
    assert reset["state"]["current"] == "Error snapshot"
    assert reset["state"]["clearCalls"] == error_state["clearCalls"]
    assert reset["stored"] == "Baseline error"
    assert reset["state"]["writes"] == [{"name": "Error snapshot", "done": False, "failed": True}]
    assert reset["state"]["storageAvailable"] is False
    assert reset["state"]["pending"] is True
    assert reset["state"]["exitGuard"] is True
    assert reset["state"]["indicator"] == "Sin guardado local"

    return report


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
