from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlsplit


SAFE_HTTP_METHODS = {"GET", "HEAD", "OPTIONS"}
SUPABASE_CONFIG_PATTERN = re.compile(
    r"globalThis\.__SIYS_SUPABASE_CONFIG__\s*=\s*\{[^;]*\};"
)
OFFLINE_SUPABASE_CONFIG = (
    'globalThis.__SIYS_SUPABASE_CONFIG__ = '
    '{"enabled":false,"url":"","publishableKey":""};'
)


def offline_html_text(source_html: str) -> str:
    isolated_html, replacements = SUPABASE_CONFIG_PATTERN.subn(
        OFFLINE_SUPABASE_CONFIG, source_html, count=1
    )
    if replacements != 1:
        raise AssertionError("No fue posible aislar la configuración cloud del HTML local")
    return isolated_html


def write_offline_html(source_path: Path, destination_path: Path) -> Path:
    source_path = source_path.resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"No existe el HTML local de prueba: {source_path}")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    destination_path.write_text(
        offline_html_text(source_path.read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    return destination_path


def install_browser_network_guard(
    context,
    *,
    allowed_origins: set[str] | None = None,
    blocked_requests: list[str] | None = None,
):
    """Block every unexpected HTTP target and every HTTP mutation in browser tests."""
    allowed = allowed_origins if allowed_origins is not None else set()
    blocked = blocked_requests if blocked_requests is not None else []

    def guard(route) -> None:
        request = route.request
        parsed = urlsplit(request.url)
        if parsed.scheme.lower() not in {"http", "https"}:
            route.continue_()
            return

        origin = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
        if origin not in {item.rstrip("/").lower() for item in allowed}:
            blocked.append("unexpected HTTP origin")
            route.abort("blockedbyclient")
            return

        if request.method.upper() not in SAFE_HTTP_METHODS:
            blocked.append("HTTP mutation")
            route.abort("blockedbyclient")
            return

        route.continue_()

    context.route("**/*", guard)
    return blocked


def assert_browser_network_guard_clean(blocked: list[str]) -> None:
    if blocked:
        counts = {kind: blocked.count(kind) for kind in sorted(set(blocked))}
        raise AssertionError(f"La guarda de red bloqueó solicitudes: {counts}")
