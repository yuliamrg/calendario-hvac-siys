import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));
const channelContractPath = fileURLToPath(new URL("../src/styles/channel-contract.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");
const channelContract = readFileSync(channelContractPath, "utf8");

test("las tarjetas usan tokens semánticos en temas claro y oscuro", () => {
  assert.match(styles, /--activity-card-height:\s*48px;/);
  assert.match(styles, /--activity-card-payroll-bg:\s*#9bc1bc;/);
  assert.match(styles, /--activity-card-payroll-bg:\s*#23423e;/);
  assert.match(styles, /--activity-card-selection-outline:\s*#b7e79a;/);
  assert.match(styles, /height:\s*var\(--activity-card-height\);/);
  assert.match(styles, /min-height:\s*var\(--activity-card-height\);/);
  assert.match(styles, /max-height:\s*var\(--activity-card-height\);/);
});

test("beta y stable reutilizan el contrato común sin reducir la altura fija", () => {
  assert.doesNotMatch(channelContract, /--beta-/);
  assert.match(channelContract, /--channel-control-small-size:\s*32px;/);
  assert.match(channelContract, /--channel-weekday-height:\s*32px;/);
  assert.match(channelContract, /box-shadow:\s*var\(--activity-card-shadow\);/);
  assert.doesNotMatch(channelContract, /min-height:\s*var\(--beta-card-min-height\);/);
  assert.match(channelContract, /min-height:\s*56px;/);
});

test("el indicador play tiene una sola geometría y sigue centrado por la bandera", () => {
  const playGeometry = styles.match(/\.status-icon-in_progress\s*\{/g) ?? [];

  assert.equal(playGeometry.length, 1);
  assert.doesNotMatch(styles, /\.quick-open\s+\.status-icon-in_progress\s*\{/);
  assert.match(styles, /\.card-flags\s*\{[\s\S]*?align-self:\s*center;/);
  assert.match(styles, /\.quick-open,\s*\n\.quick-complete\s*\{[\s\S]*?width:\s*var\(--activity-card-action-size\);/);
});

test("se conservan overflow, reprogramadas y reduced motion", () => {
  assert.match(styles, /\.activity-card\.quarantine-card\s*\{[\s\S]*?overflow:\s*visible;/);
  assert.match(styles, /\.rescheduled-indicator\s*\{/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
});
