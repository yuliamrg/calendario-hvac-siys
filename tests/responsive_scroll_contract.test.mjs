import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "src", "styles", "responsive.css"), "utf8");

test("F-03 define un propietario de scroll para calendario, catálogo y drawer", () => {
  assert.match(css, /\.calendar-panel,\s*\.catalog-panel\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /\.month-grid-wrap\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /\.catalog-list\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /\.catalog-panel:has\(\.catalog-list\[hidden\]\)\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /\.detail-drawer\[open\]\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /\.drawer-body\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
});

test("F-03 conserva un solo scroll para agenda, formularios y cambio agenda/mes", () => {
  assert.match(css, /\.mobile-agenda-list\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /dialog > form\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?scroll-padding-block:\s*12px 96px;/);
  assert.match(css, /\.mobile-month-modal\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(css, /dialog\.mobile-month-modal \.mobile-month-grid-host \.month-grid-wrap\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?overscroll-behavior:\s*auto;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?scroll-behavior:\s*auto !important;[\s\S]*?transition:\s*none !important;[\s\S]*?animation:\s*none !important;/);
});
