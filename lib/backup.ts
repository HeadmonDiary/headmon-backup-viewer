import {
  strFromU8,
  strToU8,
  type UnzipFileInfo,
  unzipSync,
  zipSync,
} from "fflate";

const FULL_BACKUP_FORMAT = "headmon-full-backup";
const FULL_BACKUP_VERSION = 1;
const PORTABLE_BACKUP_FORMAT = "headmon-portable-backup";
const MEBIBYTE = 1024 * 1024;
const MAX_BROWSER_ARCHIVE_BYTES = 256 * MEBIBYTE;
const MAX_CALENDAR_JSON_BYTES = 64 * MEBIBYTE;
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 512 * MEBIBYTE;
const MAX_ENTRY_BYTES = 64 * MEBIBYTE;
const MAX_MANIFEST_BYTES = 1 * MEBIBYTE;
const MAX_DIARY_BYTES = 64 * MEBIBYTE;
const MAX_WEATHER_BYTES = 64 * MEBIBYTE;
const MAX_COMPRESSION_RATIO = 200;
const MAX_ENTRY_COUNT = 2_000;
const MAX_DAYS = 20_000;
const MAX_TOTAL_EPISODES = 100_000;
const MAX_TOTAL_MEDICATIONS = 100_000;
const MAX_EPISODES_PER_DAY = 256;
const MAX_CATALOG_ITEMS = 2_000;
const MAX_TRIGGERS_PER_RECORD = 500;
const MAX_WEATHER_RECORDS = 50_000;

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

export interface BackupTriggerDefinition {
  name: string;
  emoji?: string | null;
  isBuiltIn: boolean;
  isHidden: boolean;
}

export interface BackupMedicationDefinition {
  name: string;
  emoji: string;
  defaultDoseMg?: number;
  isBuiltIn: boolean;
  isHidden: boolean;
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
  triggerCatalog: BackupTriggerDefinition[];
  medicationCatalog: BackupMedicationDefinition[];
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
  fetchCount?: number;
  lastFetchedEpochMillis?: number;
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
    path.length <= 240 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function safeArchiveEntries(fileBytes: Uint8Array): Record<string, Uint8Array> {
  let entryCount = 0;
  let expandedBytes = 0;
  let rejection: string | null = null;
  const entryNames = new Set<string>();

  const filter = (entry: UnzipFileInfo): boolean => {
    if (rejection) return false;
    entryCount += 1;
    if (entryCount > MAX_ENTRY_COUNT) {
      rejection = "The ZIP contains too many files.";
      return false;
    }
    if (!isSafeArchivePath(entry.name)) {
      rejection = "The ZIP contains an unsafe path.";
      return false;
    }
    if (entryNames.has(entry.name)) {
      rejection = "The ZIP contains duplicate file paths.";
      return false;
    }
    entryNames.add(entry.name);
    if (
      !Number.isSafeInteger(entry.size) ||
      !Number.isSafeInteger(entry.originalSize) ||
      entry.size < 0 ||
      entry.originalSize < 0 ||
      entry.originalSize > MAX_ENTRY_BYTES
    ) {
      rejection = "A ZIP entry is too large or has an invalid size.";
      return false;
    }
    if (entry.compression !== 0 && entry.compression !== 8) {
      rejection = "The ZIP uses an unsupported compression method.";
      return false;
    }

    expandedBytes += entry.originalSize;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES) {
      rejection = "The expanded ZIP is too large to open safely in a browser.";
      return false;
    }
    if (
      entry.originalSize > MEBIBYTE &&
      entry.originalSize / Math.max(1, entry.size) > MAX_COMPRESSION_RATIO
    ) {
      rejection = "The ZIP contains an unsafe compression ratio.";
      return false;
    }
    return true;
  };

  try {
    const entries = unzipSync(fileBytes, { filter });
    if (rejection) throw new BackupValidationError([rejection]);
    return entries;
  } catch (caught) {
    if (caught instanceof BackupValidationError) throw caught;
    throw new BackupValidationError(["The ZIP could not be opened safely."]);
  }
}

function requireEntrySize(bytes: Uint8Array, maximum: number, label: string): void {
  if (bytes.byteLength > maximum) {
    throw new BackupValidationError([`${label} is too large to open safely.`]);
  }
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
  } else if (manifest.attachments.length > MAX_ENTRY_COUNT - 3) {
    issues.push("The attachment manifest contains too many photos.");
  } else {
    const attachmentIds = new Set<string>();
    const attachmentPaths = new Set<string>();
    let declaredBytes = 0;
    for (const attachment of manifest.attachments) {
      if (
        !isObject(attachment) ||
        typeof attachment.id !== "string" ||
        attachment.id.length === 0 ||
        attachment.id.length > 500 ||
        !isIsoDate(attachment.date) ||
        (attachment.episodeIndex != null &&
          (!Number.isInteger(attachment.episodeIndex) || attachment.episodeIndex < 0)) ||
        typeof attachment.mimeType !== "string" ||
        attachment.mimeType.length === 0 ||
        attachment.mimeType.length > 100 ||
        !Number.isFinite(attachment.addedAtEpochMillis) ||
        attachment.addedAtEpochMillis <= 0 ||
        typeof attachment.note !== "string" ||
        attachment.note.length > 500 ||
        typeof attachment.path !== "string" ||
        !isSafeArchivePath(attachment.path) ||
        !Number.isSafeInteger(attachment.byteSize) ||
        attachment.byteSize <= 0 ||
        attachment.byteSize > MAX_ENTRY_BYTES ||
        typeof attachment.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/i.test(attachment.sha256)
      ) {
        issues.push("The attachment manifest contains invalid values.");
        continue;
      }
      if (attachmentIds.has(attachment.id)) {
        issues.push("The attachment manifest contains duplicate photo identities.");
      }
      if (attachmentPaths.has(attachment.path)) {
        issues.push("The attachment manifest contains duplicate photo paths.");
      }
      attachmentIds.add(attachment.id);
      attachmentPaths.add(attachment.path);
      declaredBytes += attachment.byteSize;
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES) {
        issues.push("The attachment manifest declares too much photo data.");
      }
    }
  }
  if (issues.length) throw new BackupValidationError(issues);
  return {
    ...manifest,
    attachments: manifest.attachments.map((attachment) => ({
      ...attachment,
      episodeIndex: attachment.episodeIndex ?? null,
    })),
  };
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
  if (!Number.isFinite(diary.exportedAtEpochMillis) || diary.exportedAtEpochMillis <= 0) {
    issues.push("The diary has an invalid export time.");
  }
  if (!["android", "ios", "legacy-android"].includes(diary.sourcePlatform)) {
    issues.push("The diary has an invalid source platform.");
  }
  if (!Array.isArray(diary.triggerCatalog)) diary.triggerCatalog = [];
  if (!Array.isArray(diary.medicationCatalog)) diary.medicationCatalog = [];
  diary.omittedAttachmentCount ??= 0;
  if (!Number.isSafeInteger(diary.omittedAttachmentCount) || diary.omittedAttachmentCount < 0) {
    issues.push("The omitted attachment count is invalid.");
  }
  if (
    diary.triggerCatalog.length > MAX_CATALOG_ITEMS ||
    diary.triggerCatalog.some((item) => !isObject(item))
  ) {
    issues.push("The trigger catalog is too large or malformed.");
    diary.triggerCatalog = [];
  }
  if (
    diary.medicationCatalog.length > MAX_CATALOG_ITEMS ||
    diary.medicationCatalog.some((item) => !isObject(item))
  ) {
    issues.push("The medicine catalog is too large or malformed.");
    diary.medicationCatalog = [];
  }
  diary.triggerCatalog = diary.triggerCatalog.map((item) => ({
    ...item,
    emoji: item.emoji ?? null,
    isBuiltIn: item.isBuiltIn ?? false,
    isHidden: item.isHidden ?? false,
  }));
  diary.medicationCatalog = diary.medicationCatalog.map((item) => ({
    ...item,
    emoji: item.emoji ?? "💊",
    isBuiltIn: item.isBuiltIn ?? false,
    isHidden: item.isHidden ?? false,
  }));
  const triggerNames = new Set<string>();
  for (const item of diary.triggerCatalog) {
    const key = typeof item.name === "string" ? item.name.toLocaleLowerCase() : "";
    if (
      typeof item.name !== "string" ||
      item.name.trim() !== item.name ||
      item.name.length === 0 ||
      item.name.length > 200 ||
      (item.emoji != null &&
        (typeof item.emoji !== "string" || item.emoji.trim() !== item.emoji || item.emoji.length > 32)) ||
      typeof item.isBuiltIn !== "boolean" ||
      typeof item.isHidden !== "boolean" ||
      triggerNames.has(key)
    ) {
      issues.push("The trigger catalog contains invalid or duplicate definitions.");
    }
    triggerNames.add(key);
  }
  const medicationNames = new Set<string>();
  for (const item of diary.medicationCatalog) {
    const key = typeof item.name === "string" ? item.name.toLocaleLowerCase() : "";
    if (
      typeof item.name !== "string" ||
      item.name.trim() !== item.name ||
      item.name.length === 0 ||
      item.name.length > 200 ||
      typeof item.emoji !== "string" ||
      item.emoji.trim() !== item.emoji ||
      item.emoji.length > 32 ||
      (item.defaultDoseMg != null &&
        (!Number.isInteger(item.defaultDoseMg) || item.defaultDoseMg < 0 || item.defaultDoseMg > 99_999)) ||
      typeof item.isBuiltIn !== "boolean" ||
      typeof item.isHidden !== "boolean" ||
      medicationNames.has(key)
    ) {
      issues.push("The medicine catalog contains invalid or duplicate definitions.");
    }
    medicationNames.add(key);
  }
  if (!Array.isArray(diary.days)) {
    issues.push("The diary has no day list.");
  } else if (diary.days.length > MAX_DAYS) {
    issues.push("The diary contains too many day records.");
  } else {
    let episodeCount = 0;
    let medicationCount = 0;
    for (const day of diary.days) {
      if (!isObject(day)) {
        issues.push("The diary contains a malformed day record.");
        continue;
      }
      for (const field of ["triggers", "episodes", "medications"] as const) {
        const nested = day[field];
        if (nested != null && !Array.isArray(nested)) {
          issues.push("A day contains malformed nested records.");
        }
      }
      if (Array.isArray(day.triggers) && day.triggers.length > MAX_TRIGGERS_PER_RECORD) {
        issues.push("A day contains too many triggers.");
      }
      if (Array.isArray(day.episodes)) {
        episodeCount += day.episodes.length;
        if (
          day.episodes.length > MAX_EPISODES_PER_DAY ||
          day.episodes.some((item) => !isObject(item))
        ) {
          issues.push("A day contains too many or malformed episodes.");
        }
        for (const episode of day.episodes) {
          if (
            isObject(episode) &&
            episode.triggers != null &&
            (!Array.isArray(episode.triggers) || episode.triggers.length > MAX_TRIGGERS_PER_RECORD)
          ) {
            issues.push("An episode contains too many or malformed triggers.");
          }
        }
      }
      if (Array.isArray(day.medications)) {
        medicationCount += day.medications.length;
        if (day.medications.some((item) => !isObject(item))) {
          issues.push("A day contains malformed medication records.");
        }
      }
    }
    if (episodeCount > MAX_TOTAL_EPISODES) issues.push("The diary contains too many episodes.");
    if (medicationCount > MAX_TOTAL_MEDICATIONS) {
      issues.push("The diary contains too many medication records.");
    }
    if (issues.length) throw new BackupValidationError([...new Set(issues)]);

    diary.days = diary.days.map((day) => ({
      ...day,
      note: day.note ?? "",
      isSkipped: day.isSkipped ?? false,
      weatherCondition: day.weatherCondition ?? "",
      pressureTrend: day.pressureTrend ?? "",
      locationName: day.locationName ?? "",
      triggers: day.triggers ?? [],
      episodes: (day.episodes ?? []).map((episode) => ({
        ...episode,
        endTimeEpochMillis: episode.endTimeEpochMillis ?? 0,
        isMigraine: episode.isMigraine ?? false,
        migraineIntensity: episode.migraineIntensity ?? 0,
        hadAura: episode.hadAura ?? false,
        hadNausea: episode.hadNausea ?? false,
        lightSensitivity: episode.lightSensitivity ?? false,
        soundSensitivity: episode.soundSensitivity ?? false,
        migraineMedicationHelped: episode.migraineMedicationHelped ?? false,
        note: episode.note ?? "",
        isAuraOnly: episode.isAuraOnly ?? false,
        triggers: episode.triggers ?? [],
      })),
      medications: day.medications ?? [],
    }));
    const dates = new Set<string>();
    const episodeIds = new Set<string>();
    const medicationIds = new Set<string>();
    diary.days.forEach((day, index) => {
      if (!isObject(day) || !isIsoDate(day.date)) {
        issues.push(`Day ${index + 1} has an invalid date.`);
        return;
      }
      if (typeof day.hadHeadache !== "boolean" || typeof day.isSkipped !== "boolean") {
        issues.push(`Day ${index + 1} has invalid status values.`);
      }
      if (dates.has(day.date)) issues.push("The diary contains duplicate dates.");
      dates.add(day.date);
      if (!Array.isArray(day.episodes) || !Array.isArray(day.medications) || !Array.isArray(day.triggers)) {
        issues.push(`Day ${index + 1} has invalid nested records.`);
      }
      if (typeof day.note !== "string" || day.note.length > 10_000) {
        issues.push(`Day ${index + 1} has an invalid note.`);
      }
      if (
        day.stressLevel != null &&
        (!Number.isInteger(day.stressLevel) || day.stressLevel < 0 || day.stressLevel > 10)
      ) {
        issues.push(`Day ${index + 1} has an invalid stress level.`);
      }
      if (day.hadHeadache && day.isSkipped) {
        issues.push(`Day ${index + 1} cannot be both skipped and a headache day.`);
      }
      if (
        typeof day.locationName !== "string" ||
        day.locationName.length > 200 ||
        typeof day.weatherCondition !== "string" ||
        day.weatherCondition.length > 200 ||
        typeof day.pressureTrend !== "string" ||
        day.pressureTrend.length > 200
      ) {
        issues.push(`Day ${index + 1} has invalid context labels.`);
      }
      if (
        [day.temperatureCelsius, day.airPressureHpa, day.windSpeed, day.uvIndex, day.temperatureDelta]
          .some((measurement) => measurement != null && !Number.isFinite(measurement)) ||
        (day.humidityPercent != null && (!Number.isInteger(day.humidityPercent) || day.humidityPercent < 0 || day.humidityPercent > 100)) ||
        (day.airQualityIndex != null && (!Number.isInteger(day.airQualityIndex) || day.airQualityIndex < 0)) ||
        (day.latitude != null && (!Number.isFinite(day.latitude) || day.latitude < -90 || day.latitude > 90)) ||
        (day.longitude != null && (!Number.isFinite(day.longitude) || day.longitude < -180 || day.longitude > 180))
      ) {
        issues.push(`Day ${index + 1} has invalid weather values.`);
      }
      if (Array.isArray(day.triggers) && (new Set(day.triggers).size !== day.triggers.length || day.triggers.some((trigger) => typeof trigger !== "string" || trigger.length === 0 || trigger.length > 200))) {
        issues.push(`Day ${index + 1} has an invalid trigger.`);
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
            typeof episode.id !== "string" ||
            episode.id.length === 0 ||
            episode.id.length > 500 ||
            episodeIds.has(episode.id) ||
            !validTimes ||
            !validPain ||
            !validMigraine ||
            !validAuraOnly ||
            !validMigraineIntensity ||
            [
              episode.isMigraine,
              episode.hadAura,
              episode.hadNausea,
              episode.lightSensitivity,
              episode.soundSensitivity,
              episode.migraineMedicationHelped,
              episode.isAuraOnly,
            ].some((flag) => typeof flag !== "boolean") ||
            typeof episode.note !== "string" ||
            episode.note.length > 10_000
          ) {
            issues.push("An episode contains invalid values.");
          }
          if (!Array.isArray(episode.triggers) || new Set(episode.triggers).size !== episode.triggers.length || episode.triggers.some((trigger) => typeof trigger !== "string" || trigger.length === 0 || trigger.length > 200)) {
            issues.push("An episode contains an invalid trigger.");
          }
          episodeIds.add(episode.id);
        });
        const hasPainEpisode = day.episodes.some((episode) => !episode.isAuraOnly);
        if (day.hadHeadache !== hasPainEpisode) {
          issues.push(`Day ${index + 1} does not match its episode records.`);
        }
      }
      if (Array.isArray(day.medications)) {
        for (const medication of day.medications) {
          if (
            !isObject(medication) ||
            typeof medication.id !== "string" ||
            medication.id.length === 0 ||
            medicationIds.has(medication.id) ||
            typeof medication.name !== "string" ||
            medication.name.trim().length === 0 ||
            medication.name.length > 200 ||
            (medication.doseMg != null &&
              (!Number.isInteger(medication.doseMg) || medication.doseMg < 0 || medication.doseMg > 99_999)) ||
            (medication.takenAtEpochMillis != null &&
              (!Number.isFinite(medication.takenAtEpochMillis) || medication.takenAtEpochMillis <= 0)) ||
            (medication.episodeId != null &&
              !day.episodes.some((episode) => episode.id === medication.episodeId)) ||
            (medication.helped != null && typeof medication.helped !== "boolean")
          ) {
            issues.push(`Day ${index + 1} has an invalid medication record.`);
          }
          medicationIds.add(medication.id);
        }
      }
    });
  }
  if (issues.length) throw new BackupValidationError([...new Set(issues)]);
  return diary;
}

function validateWeather(value: unknown): WeatherRecord[] {
  if (!Array.isArray(value)) {
    throw new BackupValidationError(["weather-history.json must contain a list."]);
  }
  if (value.length > MAX_WEATHER_RECORDS) {
    throw new BackupValidationError(["The weather history contains too many records."]);
  }

  const dates = new Set<string>();
  const issues: string[] = [];
  const numericFields = [
    "temperatureCelsius",
    "temperatureMin",
    "temperatureMax",
    "temperatureDelta",
    "airPressureHpa",
    "pressureMin",
    "pressureMax",
    "pressureSwing",
    "windSpeed",
    "uvIndex",
    "latitude",
    "longitude",
  ] as const;

  for (const record of value) {
    if (!isObject(record) || !isIsoDate(record.date)) {
      issues.push("The weather history contains an invalid date.");
      continue;
    }
    if (dates.has(record.date)) issues.push("The weather history contains duplicate dates.");
    dates.add(record.date);
    if (
      numericFields.some(
        (field) => record[field] != null &&
          (typeof record[field] !== "number" || !Number.isFinite(record[field])),
      )
    ) {
      issues.push("The weather history contains invalid measurements.");
    }
    const latitude = record.latitude;
    const longitude = record.longitude;
    if (
      (latitude != null &&
        (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude != null &&
        (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))
    ) {
      issues.push("The weather history contains invalid coordinates.");
    }
    const humidityPercent = record.humidityPercent;
    if (
      humidityPercent != null &&
      (typeof humidityPercent !== "number" ||
        !Number.isInteger(humidityPercent) ||
        humidityPercent < 0 ||
        humidityPercent > 100)
    ) {
      issues.push("The weather history contains invalid humidity.");
    }
    const airQualityIndex = record.airQualityIndex;
    if (
      airQualityIndex != null &&
      (typeof airQualityIndex !== "number" ||
        !Number.isInteger(airQualityIndex) ||
        airQualityIndex < 0)
    ) {
      issues.push("The weather history contains an invalid air quality index.");
    }
    if (
      ["weatherCondition", "pressureTrend", "locationName"].some(
        (field) =>
          record[field] != null &&
          (typeof record[field] !== "string" || record[field].length > 200),
      )
    ) {
      issues.push("The weather history contains invalid labels.");
    }
    const fetchCount = record.fetchCount;
    if (fetchCount != null &&
      (typeof fetchCount !== "number" || !Number.isSafeInteger(fetchCount) || fetchCount < 0)) {
      issues.push("The weather history contains an invalid fetch count.");
    }
    const lastFetchedEpochMillis = record.lastFetchedEpochMillis;
    if (
      lastFetchedEpochMillis != null &&
      (typeof lastFetchedEpochMillis !== "number" ||
        !Number.isFinite(lastFetchedEpochMillis) ||
        lastFetchedEpochMillis <= 0)
    ) {
      issues.push("The weather history contains an invalid fetch time.");
    }
  }

  if (issues.length) throw new BackupValidationError([...new Set(issues)]);
  return value as WeatherRecord[];
}

export async function openBackup(file: File): Promise<BackupBundle> {
  if (file.size > MAX_BROWSER_ARCHIVE_BYTES) {
    throw new BackupValidationError(["This viewer supports backups up to 256 MB."]);
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".json")) {
    if (fileBytes.byteLength > MAX_CALENDAR_JSON_BYTES) {
      throw new BackupValidationError(["This calendar JSON is too large to open safely."]);
    }
    const diary = validateDiary(parseJson<unknown>(fileBytes, file.name));
    const manifest: BackupManifest = {
      format: FULL_BACKUP_FORMAT,
      formatVersion: FULL_BACKUP_VERSION,
      exportedAtEpochMillis: diary.exportedAtEpochMillis,
      sourcePlatform: diary.sourcePlatform === "legacy-android" ? "android" : diary.sourcePlatform,
      diaryPath: "diary.json",
      weatherHistoryPath: "weather-history.json",
      attachments: [],
    };
    validateManifest(manifest);
    const weather: WeatherRecord[] = [];
    const warnings = [
      "This calendar backup does not contain photo files or continuous weather history.",
    ];
    if (diary.formatVersion === 1) warnings.push("This archive uses the older diary format.");
    if (diary.sourcePlatform === "legacy-android") {
      warnings.push("This calendar backup was converted from the legacy Android format.");
    }
    if (diary.omittedAttachmentCount > 0) {
      warnings.push(`${diary.omittedAttachmentCount} attachment(s) were omitted when the diary was created.`);
    }
    return {
      fileName: file.name,
      manifest,
      diary,
      weather,
      entries: {
        "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
        "diary.json": fileBytes,
        "weather-history.json": strToU8("[]\n"),
      },
      warnings,
    };
  }

  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new BackupValidationError(["Choose a Headmon complete ZIP or calendar JSON backup."]);
  }

  const entries = safeArchiveEntries(fileBytes);

  const paths = Object.keys(entries);
  if (paths.length > MAX_ENTRY_COUNT || paths.some((path) => !isSafeArchivePath(path))) {
    throw new BackupValidationError(["The ZIP contains too many files or an unsafe path."]);
  }

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new BackupValidationError(["manifest.json is missing."]);
  requireEntrySize(manifestBytes, MAX_MANIFEST_BYTES, "manifest.json");
  const manifest = validateManifest(parseJson<unknown>(manifestBytes, "manifest.json"));

  const diaryBytes = entries[manifest.diaryPath];
  const weatherBytes = entries[manifest.weatherHistoryPath];
  if (!diaryBytes || !weatherBytes) {
    throw new BackupValidationError(["The diary or weather history is missing."]);
  }
  requireEntrySize(diaryBytes, MAX_DIARY_BYTES, "diary.json");
  requireEntrySize(weatherBytes, MAX_WEATHER_BYTES, "weather-history.json");
  const diary = validateDiary(parseJson<unknown>(diaryBytes, "diary.json"));
  const weather = validateWeather(parseJson<unknown>(weatherBytes, "weather-history.json"));
  if (diary.sourcePlatform !== manifest.sourcePlatform) {
    throw new BackupValidationError(["The manifest and diary source platforms do not match."]);
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
    weather,
    entries,
    warnings,
  };
}

export function exportBackup(
  bundle: BackupBundle,
  diary: PortableDiary,
  manifest: BackupManifest = bundle.manifest,
  weather: WeatherRecord[] = bundle.weather,
): Blob {
  validateDiary(diary);
  validateManifest(manifest);
  validateWeather(weather);

  for (const attachment of manifest.attachments) {
    const episodeCount = diary.days.find((day) => day.date === attachment.date)?.episodes.length ?? 0;
    if (attachment.episodeIndex !== null && attachment.episodeIndex >= episodeCount) {
      throw new BackupValidationError(["A photo points to an episode that does not exist."]);
    }
  }

  const entries: Record<string, Uint8Array> = {};
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries[manifest.diaryPath] = strToU8(`${JSON.stringify(diary, null, 2)}\n`);
  entries[manifest.weatherHistoryPath] = strToU8(`${JSON.stringify(weather, null, 2)}\n`);
  for (const attachment of manifest.attachments) {
    const bytes = bundle.entries[attachment.path];
    if (!bytes) {
      throw new BackupValidationError(["A referenced photo is missing from the working backup."]);
    }
    entries[attachment.path] = bytes;
  }
  const archive = zipSync(entries, { level: 0 });
  const bytes = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  return new Blob([bytes], { type: "application/zip" });
}

export function correctedFileName(original: string): string {
  return original.replace(/\.(zip|json)$/i, "") + "-corrected.zip";
}
