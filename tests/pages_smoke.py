from __future__ import annotations

import argparse
import json
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

from browser_safety import (
    assert_browser_network_guard_clean,
    install_browser_network_guard,
)


def origin_for(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("El smoke público sólo acepta una URL HTTPS con host explícito.")
    return f"https://{parsed.netloc.lower()}"


def inspect_public_channel(playwright, *, url: str, expected_channel: str, expected_version: str) -> dict:
    web_origin = origin_for(url)
    browser = playwright.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(locale="es-CO", service_workers="block")
    allowed_origins = {web_origin}
    blocked_requests = install_browser_network_guard(
        context, allowed_origins=allowed_origins
    )
    page = context.new_page()
    page_errors: list[str] = []
    console_errors: list[str] = []
    bad_responses: list[int] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error" and not message.text.startswith("Failed to load resource:")
        else None,
    )
    page.on(
        "response",
        lambda response: bad_responses.append(response.status)
        if response.status >= 400 and not response.url.endswith("/favicon.ico")
        else None,
    )

    response = page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    if response is None or response.status >= 400:
        raise AssertionError("La página pública no devolvió una respuesta HTTP válida.")

    page.wait_for_function(
        """() => Boolean(document.querySelector('#versionLabel')?.textContent.trim())
          && (document.body.dataset.ready === 'true'
            || document.querySelector('#cloudAuthDialog')?.open === true)""",
        timeout=20_000,
    )
    app = page.evaluate(
        """() => {
          const config = globalThis.__SIYS_SUPABASE_CONFIG__;
          const url = typeof config?.url === 'string' ? config.url.trim() : '';
          const key = typeof config?.publishableKey === 'string' ? config.publishableKey.trim() : '';
          const authDialog = document.querySelector('#cloudAuthDialog');
          return {
            version: document.querySelector('#versionLabel')?.textContent.trim() ?? '',
            channel: document.documentElement.dataset.runtimeChannel ?? '',
            cloudConfigured: config?.enabled === true && Boolean(url && key),
            cloudUrl: url,
            authRequired: Boolean(authDialog?.open),
            ready: document.body.dataset.ready === 'true',
            storageStatus: document.querySelector('#storageStatusTitle')?.textContent.trim() ?? ''
          };
        }"""
    )

    if app["channel"] != expected_channel:
        raise AssertionError(
            f"Canal público incorrecto: se esperaba {expected_channel} y se observó {app['channel'] or 'vacío'}."
        )
    if not app["version"].startswith(f"Versión {expected_version} ·"):
        raise AssertionError(f"La versión pública no coincide con {expected_version}.")
    if not app["cloudConfigured"]:
        raise AssertionError("La aplicación pública no reconoce una configuración cloud completa.")

    cloud_origin = origin_for(app["cloudUrl"])
    allowed_origins.add(cloud_origin)
    health = page.evaluate(
        """async () => {
          const config = globalThis.__SIYS_SUPABASE_CONFIG__;
          try {
            const base = config.url.replace(/\\/+$/, '');
            const response = await fetch(`${base}/auth/v1/health`, {
              headers: { apikey: config.publishableKey }
            });
            const payload = await response.json().catch(() => null);
            return { status: response.status, service: payload?.name ?? '' };
          } catch {
            return { status: 0, service: '' };
          }
        }"""
    )
    if health["status"] != 200 or health["service"].lower() != "gotrue":
        raise AssertionError(
            f"La comprobación de salud cloud falló (HTTP {health['status']}, servicio no reconocido)."
        )

    if app["authRequired"] and not app["ready"]:
        readiness = "AUTHENTICATION_REQUIRED"
    elif app["ready"] and "Supabase" in app["storageStatus"]:
        readiness = "READY"
    else:
        raise AssertionError(
            "La aplicación no llegó a READY ni mostró el estado AUTHENTICATION_REQUIRED esperado."
        )

    assert_browser_network_guard_clean(blocked_requests)
    if bad_responses:
        raise AssertionError(f"La página produjo respuestas HTTP inesperadas: {bad_responses}.")
    if page_errors:
        raise AssertionError(f"La página produjo errores JavaScript: {page_errors}.")
    if console_errors:
        raise AssertionError(f"La consola produjo errores: {console_errors}.")

    result = {
        "url": url,
        "channel": app["channel"],
        "version": expected_version,
        "status": "PUBLIC_APP_HEALTHY",
        "readiness": readiness,
        "cloudConfigured": True,
        "authHealth": "READY",
        "authService": health["service"],
        "networkPolicy": "allowlisted origins; GET/HEAD/OPTIONS only",
        "blockedRequests": len(blocked_requests),
        "pageErrors": len(page_errors),
        "consoleErrors": len(console_errors),
    }
    context.close()
    browser.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Smoke público de Pages read-only; nunca inicia sesión ni abre calendarios."
    )
    parser.add_argument("--url", required=True, help="URL pública de la Web estable")
    parser.add_argument("--beta-url", help="URL pública opcional de /beta/")
    parser.add_argument("--stable-version", default="0.19.0")
    parser.add_argument("--beta-version", default="0.19.0")
    args = parser.parse_args()

    targets = [(args.url, "stable", args.stable_version)]
    if args.beta_url:
        targets.append((args.beta_url, "beta", args.beta_version))

    with sync_playwright() as playwright:
        results = [
            inspect_public_channel(
                playwright,
                url=url,
                expected_channel=channel,
                expected_version=version,
            )
            for url, channel, version in targets
        ]

    print(json.dumps({"status": "ok", "channels": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
