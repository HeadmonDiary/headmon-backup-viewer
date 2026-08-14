import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { exportBackup, openBackup } from "../lib/backup.ts";

const diary = {
  format: "headmon-portable-backup",
  formatVersion: 2,
  exportedAtEpochMillis: 1,
  sourcePlatform: "ios",
  days: [{
    date: "2026-08-13",
    hadHeadache: false,
    note: "",
    isSkipped: false,
    weatherCondition: "",
    pressureTrend: "",
    locationName: "",
    triggers: [],
    episodes: [],
    medications: [],
  }],
  triggerCatalog: [],
  medicationCatalog: [],
  omittedAttachmentCount: 0,
};

test("accepts an iOS day-level photo with omitted episodeIndex", async () => {
  const photo = strToU8("not a real image, but integrity-valid test bytes");
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", photo)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const attachment = {
    id: "headmon-attachment:ios:test",
    date: "2026-08-13",
    mimeType: "image/jpeg",
    addedAtEpochMillis: 1,
    note: "Day photo",
    path: "photos/headmon-attachment_ios_test.jpg",
    byteSize: photo.byteLength,
    sha256,
  };
  const manifest = {
    format: "headmon-full-backup",
    formatVersion: 1,
    exportedAtEpochMillis: 1,
    sourcePlatform: "ios",
    diaryPath: "diary.json",
    weatherHistoryPath: "weather-history.json",
    attachments: [attachment],
  };
  const archive = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "diary.json": strToU8(JSON.stringify(diary)),
    "weather-history.json": strToU8("[]"),
    [attachment.path]: photo,
  }, { level: 0 });

  const opened = await openBackup(new File([archive], "ios-backup.zip"));
  assert.equal(opened.manifest.attachments[0].episodeIndex, null);

  const corrected = exportBackup(opened, opened.diary);
  const reopened = await openBackup(new File([await corrected.arrayBuffer()], "corrected.zip"));
  assert.equal(reopened.manifest.attachments[0].episodeIndex, null);
});
