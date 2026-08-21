import assert from "node:assert/strict";
import test from "node:test";

import { backupCsv, compareDiaries } from "../lib/workbench.ts";

const day = (date, note = "") => ({
  date,
  hadHeadache: false,
  note,
  isSkipped: false,
  weatherCondition: "",
  pressureTrend: "",
  locationName: "",
  triggers: [],
  episodes: [],
  medications: [],
});

const diary = (days) => ({
  format: "headmon-portable-backup",
  formatVersion: 2,
  exportedAtEpochMillis: 1,
  sourcePlatform: "ios",
  days,
  triggerCatalog: [],
  medicationCatalog: [],
  omittedAttachmentCount: 0,
});

test("compares missing, matching, and conflicting dates", () => {
  const comparison = compareDiaries(
    diary([day("2026-08-17"), day("2026-08-18", "Current")]),
    diary([day("2026-08-17"), day("2026-08-18", "Incoming"), day("2026-08-19")]),
  );
  assert.deepEqual(comparison.matchingDates, ["2026-08-17"]);
  assert.deepEqual(comparison.conflictingDates, ["2026-08-18"]);
  assert.deepEqual(comparison.missingDates, ["2026-08-19"]);
});

test("CSV export prevents spreadsheet formula execution", () => {
  for (const payload of [
    "=HYPERLINK(\"https://example.invalid\")",
    "   =1+1",
    "\t@SUM(1,1)",
    "\r-2+2",
    "＋1+1",
  ]) {
    const csv = backupCsv([day("2026-08-17", payload)]);
    assert.ok(csv.includes(`"'${payload.replaceAll('"', '""')}"`));
    assert.match(csv, /2026-08-17/);
  }
});
