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

  const withoutPhoto = exportBackup(opened, opened.diary, {
    ...opened.manifest,
    attachments: [],
  });
  const reopenedWithoutPhoto = await openBackup(new File([await withoutPhoto.arrayBuffer()], "without-photo.zip"));
  assert.equal(reopenedWithoutPhoto.manifest.attachments.length, 0);
});

test("opens portable calendar JSON from both supported source platforms", async () => {
  for (const sourcePlatform of ["ios", "android"]) {
    const portable = { ...diary, sourcePlatform };
    const opened = await openBackup(new File(
      [JSON.stringify(portable)],
      `${sourcePlatform}-calendar.json`,
      { type: "application/json" },
    ));
    assert.equal(opened.manifest.sourcePlatform, sourcePlatform);
    assert.equal(opened.diary.days.length, 1);
    assert.equal(opened.weather.length, 0);
    assert.match(opened.warnings[0], /does not contain photo files/i);

    const corrected = exportBackup(opened, opened.diary);
    const reopened = await openBackup(new File([await corrected.arrayBuffer()], `${sourcePlatform}-corrected.zip`));
    assert.equal(reopened.diary.sourcePlatform, sourcePlatform);
  }
});

test("applies portable-schema defaults omitted by Android JSON serialization", async () => {
  const minimalAndroidDiary = {
    format: "headmon-portable-backup",
    formatVersion: 2,
    exportedAtEpochMillis: 1,
    sourcePlatform: "android",
    days: [{
      date: "2026-08-13",
      hadHeadache: false,
      triggers: [],
      episodes: [],
      medications: [],
    }],
  };
  const opened = await openBackup(new File(
    [JSON.stringify(minimalAndroidDiary)],
    "android-calendar.json",
    { type: "application/json" },
  ));
  assert.equal(opened.diary.days[0].note, "");
  assert.equal(opened.diary.days[0].weatherCondition, "");
  assert.equal(opened.diary.omittedAttachmentCount, 0);
});

test("rejects extreme ZIP compression ratios before extraction", async () => {
  const archive = zipSync({
    "diary.json": strToU8("0".repeat(2 * 1024 * 1024)),
  }, { level: 9 });

  await assert.rejects(
    openBackup(new File([archive], "compressed-bomb.zip")),
    /unsafe compression ratio/i,
  );
});

test("rejects malformed nested diary records without throwing an implementation error", async () => {
  const malformed = {
    ...diary,
    days: [{
      ...diary.days[0],
      episodes: ["not-an-object"],
    }],
  };

  await assert.rejects(
    openBackup(new File([JSON.stringify(malformed)], "malformed-calendar.json")),
    /malformed episodes/i,
  );
});

test("rejects invalid attachment metadata before using it", async () => {
  const manifest = {
    format: "headmon-full-backup",
    formatVersion: 1,
    exportedAtEpochMillis: 1,
    sourcePlatform: "ios",
    diaryPath: "diary.json",
    weatherHistoryPath: "weather-history.json",
    attachments: [{
      id: 42,
      date: "2026-08-13",
      episodeIndex: null,
      mimeType: "image/jpeg",
      addedAtEpochMillis: 1,
      note: "",
      path: "photos/42.jpg",
      byteSize: 1,
      sha256: "0".repeat(64),
    }],
  };
  const archive = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "diary.json": strToU8(JSON.stringify(diary)),
    "weather-history.json": strToU8("[]"),
    "photos/42.jpg": strToU8("x"),
  }, { level: 0 });

  await assert.rejects(
    openBackup(new File([archive], "invalid-manifest.zip")),
    /attachment manifest contains invalid values/i,
  );
});
