import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const FULL_BACKUP_FORMAT = "headmon-full-backup";
const FULL_BACKUP_VERSION = 1;
const PORTABLE_BACKUP_FORMAT = "headmon-portable-backup";
const MAX_BROWSER_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_COUNT = 10_000;

export interface BackupAttachment {
  id: string;
  date: string;
  episodeIndex: number | null;
  mimeType: string;
  addedAtEpochMillis: number;
  note: string;
  path: string;
  byteSize: number;
  sha256: string;
}

export interface BackupManifest {
  format: string;
  formatVersion: number;
  exportedAtEpochMillis: number;
  sourcePlatform: string;
  diaryPath: string;
  weatherHistoryPath: string;
  attachments: BackupAttachment[];
}

export interface BackupEpisode {
  id: string;
  startTimeEpochMillis: number;
  endTimeEpochMillis: number;
  peakPainLevel: number;
  isMigraine: boolean;
  migraineIntensity: number;
  hadAura: boolean;
  hadNausea: boolean;
  lightSensitivity: boolean;
  soundSensitivity: boolean;
  migraineMedicationHelped: boolean;
  note: string;
  isAuraOnly: boolean;
  triggers: string[];
}

export interface BackupMedication {
  id: string;
  name: string;
  episodeId?: string;
  doseMg?: number;
  takenAtEpochMillis?: number;
  helped?: boolean;
}

export interface BackupDay {
  date: string;
  hadHeadache: boolean;
  note: string;
  isSkipped: boolean;
  stressLevel?: number;
  temperatureCelsius?: number;
  airPressureHpa?: number;
  humidityPercent?: number;
  windSpeed?: number;
  weatherCondition: string;
  uvIndex?: number;
  airQualityIndex?: number;
  pressureTrend: string;
  temperatureDelta?: number;
  latitude?: number;
  longitude?: number;
  locationName: string;
  triggers: string[];
  episodes: BackupEpisode[];
  medications: BackupMedication[];
  [key: string]: unknown;
}

export interface PortableDiary {
  format: string;
  formatVersion: number;
  exportedAtEpochMillis: number;
  sourcePlatform: string;
  days: BackupDay[];
  triggerCatalog: unknown[];
  medicationCatalog: unknown[];
  omittedAttachmentCount: number;
  [key: string]: unknown;
}

export interface WeatherRecord {
  date: string;
  temperatureCelsius?: number;
  temperatureMin?: number;
  temperatureMax?: number;
  temperatureDelta?: number;
  airPressureHpa?: number;
  pressureMin?: number;
  pressureMax?: number;
  pressureSwing?: number;
  pressureTrend?: string;
  humidityPercent?: number;
  windSpeed?: number;
  weatherCondition?: string;
  uvIndex?: number;
  airQualityIndex?: number;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  [key: string]: unknown;
}

export interface BackupBundle {
  fileName: string;
  manifest: BackupManifest;
  diary: PortableDiary;
  weather: WeatherRecord[];
  entries: Record<string, Uint8Array>;
  warnings: string[];
}

export class BackupValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "BackupValidationError";
    this.issues = issues;
  }
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch {
    throw new BackupValidationError([`${label} is not valid JSON.`]);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeArchivePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function expectedPhotoPath(attachment: BackupAttachment): string | null {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/webp": "webp",
  };
  const extension = extensions[attachment.mimeType.toLowerCase()];
  if (!extension) return null;
  const safeId = Array.from(attachment.id)
    .map((character) => (/^[\p{L}\p{N}_-]$/u.test(character) ? character : "_"))
    .join("")
    .slice(0, 180);
  return safeId ? `photos/${safeId}.${extension}` : null;
}

function validateManifest(value: unknown): BackupManifest {
  if (!isObject(value)) {
    throw new BackupValidationError(["manifest.json must contain an object."]);
  }

  const manifest = value as unknown as BackupManifest;
  const issues: string[] = [];
  if (manifest.format !== FULL_BACKUP_FORMAT) {
    issues.push("This is not a Headmon full backup.");
  }
  if (manifest.formatVersion !== FULL_BACKUP_VERSION) {
    issues.push("This full-backup version is not supported.");
  }
  if (!Number.isFinite(manifest.exportedAtEpochMillis) || manifest.exportedAtEpochMillis <= 0) {
    issues.push("The backup has an invalid export time.");
  }
  if (!['android', 'ios'].includes(manifest.sourcePlatform)) {
    issues.push("The backup has an invalid source platform.");
  }
  if (manifest.diaryPath !== "diary.json" || manifest.weatherHistoryPath !== "weather-history.json") {
    issues.push("The backup uses unsupported internal paths.");
  }
  if (!Array.isArray(manifest.attachments)) {
    issues.push("The attachment manifest is missing.");
  }
  if (issues.length) throw new BackupValidationError(issues);
  return manifest;
}

function validateDiary(value: unknown): PortableDiary {
  if (!isObject(value)) {
    throw new BackupValidationError(["diary.json must contain an object."]);
  }
  const diary = value as unknown as PortableDiary;
  const issues: string[] = [];
  if (diary.format !== PORTABLE_BACKUP_FORMAT) {
    issues.push("diary.json is not a Headmon portable backup.");
  }
  if (![1, 2].includes(diary.formatVersion)) {
    issues.push("The diary format version is not supported.");
  }
  if (!Array.isArray(diary.days)) {
    issues.push("The diary has no day list.");
  } else {
    const dates = new Set<string>();
    const episodeIds = new Set<string>();
    diary.days.forEach((day, index) => {
      if (!isObject(day) || !isIsoDate(day.date)) {
        issues.push(`Day ${index + 1} has an invalid date.`);
        return;
      }
      if (dates.has(day.date)) issues.push("The diary contains duplicate dates.");
      dates.add(day.date);
      if (!Array.isArray(day.episodes) || !Array.isArray(day.medications) || !Array.isArray(day.triggers)) {
        issues.push(`Day ${index + 1} has invalid nested records.`);
      }
      if (typeof day.note !== "string" || day.note.length > 10_000) {
        issues.push(`Day ${index + 1} has an invalid note.`);
      }
      if (Array.isArray(day.episodes)) {
        day.episodes.forEach((episode) => {
          const validTimes =
            Number.isFinite(episode.startTimeEpochMillis) &&
            episode.startTimeEpochMillis > 0 &&
            (episode.endTimeEpochMillis === 0 ||
              episode.endTimeEpochMillis >= episode.startTimeEpochMillis);
          const validMigraine =
            episode.isMigraine ||
            (episode.migraineIntensity === 0 && !episode.migraineMedicationHelped);
          const validAuraOnly =
            !episode.isAuraOnly ||
            (episode.hadAura &&
              episode.peakPainLevel === 0 &&
              !episode.isMigraine &&
              episode.migraineIntensity === 0);
          const validPain =
            Number.isInteger(episode.peakPainLevel) &&
            episode.peakPainLevel >= 0 &&
            episode.peakPainLevel <= 10 &&
            (episode.isAuraOnly || episode.peakPainLevel > 0);
          const validMigraineIntensity =
            Number.isInteger(episode.migraineIntensity) &&
            episode.migraineIntensity >= 0 &&
            episode.migraineIntensity <= 10;
          if (
            !episode.id ||
            episodeIds.has(episode.id) ||
            !validTimes ||
            !validPain ||
            !validMigraine ||
            !validAuraOnly ||
            !validMigraineIntensity ||
            typeof episode.note !== "string" ||
            episode.note.length > 10_000
          ) {
            issues.push("An episode contains invalid values.");
          }
          episodeIds.add(episode.id);
        });
        const hasPainEpisode = day.episodes.some((episode) => !episode.isAuraOnly);
        if (day.hadHeadache !== hasPainEpisode) {
          issues.push(`Day ${index + 1} does not match its episode records.`);
        }
      }
    });
  }
  if (issues.length) throw new BackupValidationError([...new Set(issues)]);
  return diary;
}

export async function openBackup(file: File): Promise<BackupBundle> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new BackupValidationError(["Choose a Headmon full-backup ZIP file."]);
  }
  if (file.size > MAX_BROWSER_ARCHIVE_BYTES) {
    throw new BackupValidationError(["This prototype currently supports backups up to 512 MB."]);
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new BackupValidationError(["The ZIP could not be opened."]);
  }

  const paths = Object.keys(entries);
  if (paths.length > MAX_ENTRY_COUNT || paths.some((path) => !isSafeArchivePath(path))) {
    throw new BackupValidationError(["The ZIP contains too many files or an unsafe path."]);
  }

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new BackupValidationError(["manifest.json is missing."]);
  const manifest = validateManifest(parseJson<unknown>(manifestBytes, "manifest.json"));

  const diaryBytes = entries[manifest.diaryPath];
  const weatherBytes = entries[manifest.weatherHistoryPath];
  if (!diaryBytes || !weatherBytes) {
    throw new BackupValidationError(["The diary or weather history is missing."]);
  }
  const diary = validateDiary(parseJson<unknown>(diaryBytes, "diary.json"));
  const weather = parseJson<unknown>(weatherBytes, "weather-history.json");
  if (!Array.isArray(weather)) {
    throw new BackupValidationError(["weather-history.json must contain a list."]);
  }

  const expectedPaths = new Set([
    "manifest.json",
    manifest.diaryPath,
    manifest.weatherHistoryPath,
    ...manifest.attachments.map((attachment) => attachment.path),
  ]);
  if (expectedPaths.size !== paths.length || paths.some((path) => !expectedPaths.has(path))) {
    throw new BackupValidationError(["The backup contains an unexpected or missing file."]);
  }

  const attachmentIssues: string[] = [];
  const attachmentIds = new Set<string>();
  for (const attachment of manifest.attachments) {
    const photo = entries[attachment.path];
    if (
      !isObject(attachment) ||
      attachmentIds.has(attachment.id) ||
      expectedPhotoPath(attachment) !== attachment.path ||
      !isIsoDate(attachment.date) ||
      !photo ||
      photo.byteLength !== attachment.byteSize ||
      (await sha256(photo)) !== attachment.sha256.toLowerCase()
    ) {
      attachmentIssues.push("A photo failed its identity or integrity check.");
    }
    attachmentIds.add(attachment.id);
    if (attachment.episodeIndex !== null) {
      const episodeCount = diary.days.find((day) => day.date === attachment.date)?.episodes.length ?? 0;
      if (attachment.episodeIndex < 0 || attachment.episodeIndex >= episodeCount) {
        attachmentIssues.push("A photo points to an episode that does not exist.");
      }
    }
  }
  if (attachmentIssues.length) {
    throw new BackupValidationError([...new Set(attachmentIssues)]);
  }

  const warnings: string[] = [];
  if (diary.formatVersion === 1) warnings.push("This archive uses the older diary format.");
  if (diary.omittedAttachmentCount > 0) {
    warnings.push(`${diary.omittedAttachmentCount} attachment(s) were omitted when the diary was created.`);
  }

  return {
    fileName: file.name,
    manifest,
    diary,
    weather: weather as WeatherRecord[],
    entries,
    warnings,
  };
}

export function exportBackup(bundle: BackupBundle, diary: PortableDiary): Blob {
  validateDiary(diary);
  const entries = { ...bundle.entries };
  entries[bundle.manifest.diaryPath] = strToU8(`${JSON.stringify(diary, null, 2)}\n`);
  const archive = zipSync(entries, { level: 0 });
  const bytes = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  return new Blob([bytes], { type: "application/zip" });
}

export function correctedFileName(original: string): string {
  return original.replace(/\.zip$/i, "") + "-corrected.zip";
}
