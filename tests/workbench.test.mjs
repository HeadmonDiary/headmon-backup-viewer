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
  const csv = backupCsv([day("2026-08-17", "=HYPERLINK(\"https://example.invalid\")")]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /2026-08-17/);
});
