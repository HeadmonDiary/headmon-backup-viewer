"use client";

import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackupValidationError,
  type BackupBundle,
  type BackupDay,
  type BackupManifest,
  type BackupTriggerDefinition,
  type PortableDiary,
  type WeatherRecord,
  correctedFileName,
  exportBackup,
  openBackup,
} from "@/lib/backup";
import { deleteLegacyDraftDatabase } from "@/lib/drafts";
import {
  backupCsv,
  backupReportHtml,
  bundleLabel,
  compareDiaries,
} from "@/lib/workbench";

type SaveFilePickerWindow = typeof window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T12:00:00Z`));
}

function formatTime(epochMillis: number): string {
  if (!epochMillis || epochMillis < 0) return "Ongoing";
  return timeFormatter.format(new Date(epochMillis));
}

function dateTimeInputValue(epochMillis: number): string {
  if (!epochMillis || epochMillis < 0) return "";
  const date = new Date(epochMillis);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function statusFor(day: BackupDay): { label: string; tone: string } {
  if (day.isSkipped) return { label: "Skipped", tone: "neutral" };
  if (day.episodes.some((episode) => episode.isMigraine)) {
    return { label: "Migraine", tone: "migraine" };
  }
  if (day.episodes.length > 0 && day.episodes.every((episode) => episode.isAuraOnly)) {
    return { label: "Aura only", tone: "aura" };
  }
  if (day.hadHeadache) return { label: "Headache", tone: "pain" };
  return { label: "Headache-free", tone: "clear" };
}

function cloneDiary(diary: PortableDiary): PortableDiary {
  return structuredClone(diary);
}

type WorkspaceView = "entries" | "calendar" | "photos" | "catalogues" | "reports" | "compare";
type StatusFilter = "all" | "migraine" | "headache" | "aura" | "pain-free" | "skipped";

interface WorkspaceSnapshot {
  label: string;
  diary: PortableDiary;
  manifest: BackupManifest;
  weather: WeatherRecord[];
}

function workspaceIsDirty(
  bundle: BackupBundle | null,
  diary: PortableDiary | null,
  manifest: BackupManifest | null,
  weather: WeatherRecord[],
): boolean {
  if (!bundle || !diary || !manifest) return false;
  return (
    JSON.stringify(bundle.diary) !== JSON.stringify(diary) ||
    JSON.stringify(bundle.manifest) !== JSON.stringify(manifest) ||
    JSON.stringify(bundle.weather) !== JSON.stringify(weather)
  );
}

function changedDatesFor(
  bundle: BackupBundle | null,
  diary: PortableDiary | null,
  manifest: BackupManifest | null,
  weather: WeatherRecord[],
): Set<string> {
  if (!bundle || !diary || !manifest) return new Set();
  const dates = new Set<string>();
  const originalDays = new Map(bundle.diary.days.map((day) => [day.date, day]));
  const workingDays = new Map(diary.days.map((day) => [day.date, day]));
  for (const date of new Set([...originalDays.keys(), ...workingDays.keys()])) {
    if (JSON.stringify(originalDays.get(date)) !== JSON.stringify(workingDays.get(date))) dates.add(date);
  }
  const originalAttachments = new Map(bundle.manifest.attachments.map((item) => [item.id, item]));
  const workingAttachments = new Map(manifest.attachments.map((item) => [item.id, item]));
  for (const id of new Set([...originalAttachments.keys(), ...workingAttachments.keys()])) {
    const original = originalAttachments.get(id);
    const working = workingAttachments.get(id);
    if (JSON.stringify(original) !== JSON.stringify(working)) {
      if (original?.date) dates.add(original.date);
      if (working?.date) dates.add(working.date);
    }
  }
  const originalWeather = new Map(bundle.weather.map((item) => [item.date, item]));
  const workingWeather = new Map(weather.map((item) => [item.date, item]));
  for (const date of new Set([...originalWeather.keys(), ...workingWeather.keys()])) {
    if (JSON.stringify(originalWeather.get(date)) !== JSON.stringify(workingWeather.get(date))) dates.add(date);
  }
  return dates;
}

function uniqueLabels(value: string): string[] {
  return [...new Set(value.split(",").map((label) => label.trim()).filter(Boolean))];
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function newStableId(kind: "episode" | "medication"): string {
  return `headmon-${kind}:web:${crypto.randomUUID()}`;
}

function middayFor(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}

function TriggerEditor({
  id,
  label,
  value,
  catalog,
  onChange,
}: {
  id: string;
  label: string;
  value: string[];
  catalog: BackupTriggerDefinition[];
  onChange: (value: string[]) => void;
}) {
  const [customEntry, setCustomEntry] = useState("");
  const choices = catalog.filter(
    (trigger) =>
      trigger.name !== "Other..." && (!trigger.isHidden || value.includes(trigger.name)),
  );
  const catalogNames = new Set(catalog.map((trigger) => trigger.name.toLocaleLowerCase()));
  const customLabels = value.filter(
    (trigger) => !catalogNames.has(trigger.toLocaleLowerCase()),
  );

  function toggle(name: string) {
    onChange(
      value.includes(name)
        ? value.filter((trigger) => trigger !== name)
        : [...value, name],
    );
  }

  function addCustomTriggers() {
    const additions = uniqueLabels(customEntry).filter((trigger) => trigger.length <= 200);
    if (additions.length === 0) return;
    onChange([...new Set([...value, ...additions])]);
    setCustomEntry("");
  }

  return (
    <div className="trigger-editor">
      <span className="field-label">{label}</span>
      {choices.length > 0 && (
        <div className="choice-grid" aria-label={`${label} quick choices`}>
          {choices.map((trigger) => (
            <button
              className={value.includes(trigger.name) ? "choice-chip is-selected" : "choice-chip"}
              type="button"
              aria-pressed={value.includes(trigger.name)}
              key={trigger.name}
              onClick={() => toggle(trigger.name)}
            >
              {trigger.emoji && <span aria-hidden="true">{trigger.emoji}</span>}
              {trigger.name}
            </button>
          ))}
        </div>
      )}
      {customLabels.length > 0 && (
        <div className="custom-trigger-row" aria-label="Custom triggers">
          {customLabels.map((trigger) => <button className="choice-chip is-selected" type="button" key={trigger} onClick={() => toggle(trigger)}>{trigger}<span aria-hidden="true">×</span></button>)}
        </div>
      )}
      <form className="custom-trigger-form" onSubmit={(event) => { event.preventDefault(); addCustomTriggers(); }}>
        <label className="control-field" htmlFor={id}>
          <span>Custom trigger (one or a comma-separated list)</span>
          <input id={id} type="text" value={customEntry} maxLength={1_000} placeholder="Add your own…" onChange={(event) => setCustomEntry(event.target.value)} />
        </label>
        <button className="compact-button" type="submit" disabled={!customEntry.trim()}>Add</button>
      </form>
    </div>
  );
}

function LocalBackupImage({
  bytes,
  mimeType,
  alt,
}: {
  bytes: Uint8Array;
  mimeType: string;
  alt: string;
}) {
  const url = useMemo(() => {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return URL.createObjectURL(new Blob([copy], { type: mimeType }));
  }, [bytes, mimeType]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // The image bytes came from the user-selected local archive.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} />;
}

export default function BackupViewer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const historyRef = useRef<WorkspaceSnapshot[]>([]);
  const redoRef = useRef<WorkspaceSnapshot[]>([]);
  const lastHistoryRef = useRef<{ key: string } | null>(null);
  const [bundle, setBundle] = useState<BackupBundle | null>(null);
  const [diary, setDiary] = useState<PortableDiary | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [weather, setWeather] = useState<WeatherRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("entries");
  const [newDayDate, setNewDayDate] = useState("");
  const [showChangeReview, setShowChangeReview] = useState(false);
  const [comparison, setComparison] = useState<BackupBundle | null>(null);
  const [comparisonChoices, setComparisonChoices] = useState<Record<string, "current" | "incoming">>({});
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [modifiedDates, setModifiedDates] = useState<Set<string>>(() => new Set());
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [error, setError] = useState<string[] | null>(null);

  useEffect(() => {
    // Remove complete archives retained by earlier versions. The current
    // viewer deliberately keeps opened health data in memory only.
    void deleteLegacyDraftDatabase().catch(() => {
      // Storage can be unavailable in hardened browsing modes. The viewer
      // remains memory-only even when a legacy database cannot be inspected.
    });
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!bundle || !editor) return;
    const updateHeight = () => setEditorHeight(Math.ceil(editor.getBoundingClientRect().height));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [bundle]);

  const sortedDays = useMemo(
    () => [...(diary?.days ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
    [diary],
  );

  const filteredDays = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sortedDays.filter((day) => {
      if (fromDate && day.date < fromDate) return false;
      if (toDate && day.date > toDate) return false;
      const tone = statusFor(day).tone;
      if (statusFilter === "migraine" && tone !== "migraine") return false;
      if (statusFilter === "headache" && tone !== "pain") return false;
      if (statusFilter === "aura" && tone !== "aura") return false;
      if (statusFilter === "pain-free" && tone !== "clear") return false;
      if (statusFilter === "skipped" && tone !== "neutral") return false;
      if (!query) return true;
      return [
          day.date,
          day.note,
          day.locationName,
          ...day.triggers,
          ...day.episodes.flatMap((episode) => [episode.note, ...episode.triggers]),
          ...day.medications.map((medication) => medication.name),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query);
    });
  }, [fromDate, search, sortedDays, statusFilter, toDate]);

  const selectedDay = diary?.days.find((day) => day.date === selectedDate) ?? null;
  const selectedAttachments = useMemo(
    () => manifest?.attachments.filter((attachment) => attachment.date === selectedDate) ?? [],
    [manifest, selectedDate],
  );
  const selectedWeather = useMemo(() => {
    if (!selectedDay) return null;
    const history = weather.find((record) => record.date === selectedDay.date);
    return {
      temperatureCelsius: history?.temperatureCelsius ?? selectedDay.temperatureCelsius,
      temperatureMin: history?.temperatureMin,
      temperatureMax: history?.temperatureMax,
      temperatureDelta: history?.temperatureDelta ?? selectedDay.temperatureDelta,
      airPressureHpa: history?.airPressureHpa ?? selectedDay.airPressureHpa,
      pressureMin: history?.pressureMin,
      pressureMax: history?.pressureMax,
      pressureSwing: history?.pressureSwing,
      pressureTrend: history?.pressureTrend || selectedDay.pressureTrend,
      humidityPercent: history?.humidityPercent ?? selectedDay.humidityPercent,
      windSpeed: history?.windSpeed ?? selectedDay.windSpeed,
      weatherCondition: history?.weatherCondition || selectedDay.weatherCondition,
      uvIndex: history?.uvIndex ?? selectedDay.uvIndex,
      airQualityIndex: history?.airQualityIndex ?? selectedDay.airQualityIndex,
      locationName: history?.locationName || selectedDay.locationName,
    };
  }, [selectedDay, weather]);
  const hasSelectedWeather = Boolean(
    selectedWeather &&
      [
        selectedWeather.temperatureCelsius,
        selectedWeather.airPressureHpa,
        selectedWeather.humidityPercent,
        selectedWeather.windSpeed,
        selectedWeather.weatherCondition,
        selectedWeather.uvIndex,
        selectedWeather.airQualityIndex,
      ].some((value) => value !== undefined && value !== null && value !== ""),
  );

  const stats = useMemo(() => {
    const days = diary?.days ?? [];
    return {
      days: days.length,
      headacheDays: days.filter((day) => day.hadHeadache).length,
      migraineDays: days.filter((day) => day.episodes.some((episode) => episode.isMigraine)).length,
      headacheOnlyDays: days.filter((day) => day.hadHeadache && !day.episodes.some((episode) => episode.isMigraine)).length,
      episodes: days.reduce((sum, day) => sum + day.episodes.length, 0),
      photos: manifest?.attachments.length ?? 0,
      weather: weather.length,
      filledNotes:
        days.filter((day) => day.note.trim()).length +
        days.reduce(
          (sum, day) => sum + day.episodes.filter((episode) => episode.note.trim()).length,
          0,
        ) +
        (manifest?.attachments.filter((attachment) => attachment.note.trim()).length ?? 0),
    };
  }, [diary, manifest, weather]);

  const comparisonResult = useMemo(
    () => diary && comparison ? compareDiaries(diary, comparison.diary) : null,
    [comparison, diary],
  );

  const calendarMonths = useMemo(() => {
    const groups = new Map<string, BackupDay[]>();
    for (const day of filteredDays) {
      const month = day.date.slice(0, 7);
      groups.set(month, [...(groups.get(month) ?? []), day]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [filteredDays]);

  const changeDetails = useMemo(() => {
    if (!bundle || !diary || !manifest) return [] as Array<{ date: string; changes: string[] }>;
    const originalDays = new Map(bundle.diary.days.map((day) => [day.date, day]));
    const currentDays = new Map(diary.days.map((day) => [day.date, day]));
    const rows: Array<{ date: string; changes: string[] }> = [];
    for (const date of [...modifiedDates].sort((left, right) => right.localeCompare(left))) {
      const before = originalDays.get(date);
      const after = currentDays.get(date);
      const changes: string[] = [];
      if (!before && after) changes.push("Day added");
      else if (before && !after) changes.push("Day removed");
      else if (before && after) {
        if (before.note !== after.note || before.stressLevel !== after.stressLevel || before.isSkipped !== after.isSkipped) changes.push("Day details");
        if (JSON.stringify(before.triggers) !== JSON.stringify(after.triggers)) changes.push("Day triggers");
        if (JSON.stringify(before.episodes) !== JSON.stringify(after.episodes)) changes.push("Episodes");
        if (JSON.stringify(before.medications) !== JSON.stringify(after.medications)) changes.push("Medication");
        const weatherKeys = ["temperatureCelsius", "airPressureHpa", "humidityPercent", "windSpeed", "weatherCondition", "uvIndex", "airQualityIndex", "pressureTrend", "locationName"] as const;
        if (weatherKeys.some((key) => before[key] !== after[key])) changes.push("Weather or place");
      }
      const beforePhotos = bundle.manifest.attachments.filter((item) => item.date === date);
      const afterPhotos = manifest.attachments.filter((item) => item.date === date);
      if (JSON.stringify(beforePhotos) !== JSON.stringify(afterPhotos)) changes.push("Photos");
      rows.push({ date, changes: changes.length ? changes : ["Backup metadata"] });
    }
    if (JSON.stringify(bundle.diary.triggerCatalog) !== JSON.stringify(diary.triggerCatalog) || JSON.stringify(bundle.diary.medicationCatalog) !== JSON.stringify(diary.medicationCatalog)) {
      rows.unshift({ date: "Catalogue", changes: ["Trigger or medicine catalogue"] });
    }
    return rows;
  }, [bundle, diary, manifest, modifiedDates]);

  function captureHistory(label: string, key = label) {
    if (!diary || !manifest) return;
    if (lastHistoryRef.current?.key === key) return;
    historyRef.current.push({
      label,
      diary: structuredClone(diary),
      manifest: structuredClone(manifest),
      weather: structuredClone(weather),
    });
    if (historyRef.current.length > 80) historyRef.current.shift();
    redoRef.current = [];
    lastHistoryRef.current = { key };
    setHistoryCounts({ undo: historyRef.current.length, redo: 0 });
  }

  function restoreSnapshot(snapshot: WorkspaceSnapshot) {
    const nextDiary = structuredClone(snapshot.diary);
    const nextManifest = structuredClone(snapshot.manifest);
    const nextWeather = structuredClone(snapshot.weather);
    setDiary(nextDiary);
    setManifest(nextManifest);
    setWeather(nextWeather);
    setDirty(workspaceIsDirty(bundle, nextDiary, nextManifest, nextWeather));
    setModifiedDates(changedDatesFor(bundle, nextDiary, nextManifest, nextWeather));
  }

  function undoChange() {
    if (!diary || !manifest) return;
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push({
      label: previous.label,
      diary: structuredClone(diary),
      manifest: structuredClone(manifest),
      weather: structuredClone(weather),
    });
    restoreSnapshot(previous);
    lastHistoryRef.current = null;
    setHistoryCounts({ undo: historyRef.current.length, redo: redoRef.current.length });
  }

  function redoChange() {
    if (!diary || !manifest) return;
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push({
      label: next.label,
      diary: structuredClone(diary),
      manifest: structuredClone(manifest),
      weather: structuredClone(weather),
    });
    restoreSnapshot(next);
    lastHistoryRef.current = null;
    setHistoryCounts({ undo: historyRef.current.length, redo: redoRef.current.length });
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const opened = await openBackup(file);
      const nextDiary = cloneDiary(opened.diary);
      const nextManifest = structuredClone(opened.manifest);
      const nextWeather = structuredClone(opened.weather);
      const newestDate = [...nextDiary.days].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
      setBundle(opened);
      setDiary(nextDiary);
      setManifest(nextManifest);
      setWeather(nextWeather);
      setSelectedDate(newestDate);
      setSearch("");
      setStatusFilter("all");
      setFromDate("");
      setToDate("");
      setWorkspaceView("entries");
      setComparison(null);
      setComparisonChoices({});
      setDirty(workspaceIsDirty(opened, nextDiary, nextManifest, nextWeather));
      setModifiedDates(changedDatesFor(opened, nextDiary, nextManifest, nextWeather));
      historyRef.current = [];
      redoRef.current = [];
      lastHistoryRef.current = null;
      setHistoryCounts({ undo: 0, redo: 0 });
    } catch (caught) {
      setBundle(null);
      setDiary(null);
      setManifest(null);
      setWeather([]);
      setSelectedDate(null);
      setModifiedDates(new Set());
      setError(
        caught instanceof BackupValidationError
          ? caught.issues
          : ["The backup could not be opened."],
      );
    } finally {
      setLoading(false);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  }

  function updateDay(
    updater: (day: BackupDay) => BackupDay,
    label = "Edit day",
    historyKey = `day:${selectedDate ?? "none"}`,
  ) {
    if (!diary || !selectedDate) return;
    captureHistory(label, historyKey);
    setDiary({
      ...diary,
      days: diary.days.map((day) => {
        if (day.date !== selectedDate) return day;
        const updated = updater(day);
        return {
          ...updated,
          hadHeadache: updated.episodes.some((episode) => !episode.isAuraOnly),
        };
      }),
    });
    setDirty(true);
    setModifiedDates((current) => new Set(current).add(selectedDate));
  }

  function updateEpisode(
    episodeIndex: number,
    updater: (episode: BackupDay["episodes"][number]) => BackupDay["episodes"][number],
  ) {
    updateDay((day) => ({
      ...day,
      episodes: day.episodes.map((episode, index) =>
        index === episodeIndex ? updater(episode) : episode,
      ),
    }));
  }

  function addEpisode() {
    if (!selectedDay) return;
    const start = middayFor(selectedDay.date);
    updateDay((day) => ({
      ...day,
      isSkipped: false,
      episodes: [
        ...day.episodes,
        {
          id: newStableId("episode"),
          startTimeEpochMillis: start,
          endTimeEpochMillis: start + 60 * 60 * 1_000,
          peakPainLevel: 4,
          isMigraine: false,
          migraineIntensity: 0,
          hadAura: false,
          hadNausea: false,
          lightSensitivity: false,
          soundSensitivity: false,
          migraineMedicationHelped: false,
          note: "",
          isAuraOnly: false,
          triggers: [],
        },
      ],
    }), "Add episode", `add-episode:${selectedDay.date}`);
  }

  function removeEpisode(episodeIndex: number) {
    if (!selectedDay) return;
    const removedId = selectedDay.episodes[episodeIndex]?.id;
    updateDay((day) => ({
      ...day,
      episodes: day.episodes.filter((_, index) => index !== episodeIndex),
      medications: day.medications.map((medication) =>
        medication.episodeId === removedId
          ? { ...medication, episodeId: undefined }
          : medication,
      ),
    }), "Remove episode", `remove-episode:${selectedDay.date}:${episodeIndex}`);
    setManifest((current) =>
      current
        ? {
            ...current,
            attachments: current.attachments.map((attachment) => {
              if (attachment.date !== selectedDay.date || attachment.episodeIndex === null) {
                return attachment;
              }
              if (attachment.episodeIndex === episodeIndex) {
                return { ...attachment, episodeIndex: null };
              }
              if (attachment.episodeIndex > episodeIndex) {
                return { ...attachment, episodeIndex: attachment.episodeIndex - 1 };
              }
              return attachment;
            }),
          }
        : current,
    );
  }

  function updateMedication(
    medicationIndex: number,
    updater: (medication: BackupDay["medications"][number]) => BackupDay["medications"][number],
  ) {
    updateDay((day) => ({
      ...day,
      medications: day.medications.map((medication, index) =>
        index === medicationIndex ? updater(medication) : medication,
      ),
    }));
  }

  function addMedication() {
    if (!selectedDay || !diary) return;
    const first = diary.medicationCatalog.find((item) => !item.isHidden);
    updateDay((day) => ({
      ...day,
      medications: [
        ...day.medications,
        {
          id: newStableId("medication"),
          name: first?.name ?? "Medication",
          doseMg: first?.defaultDoseMg,
          takenAtEpochMillis: middayFor(day.date),
        },
      ],
    }), "Add medication", `add-medication:${selectedDay.date}`);
  }

  function removeMedication(medicationIndex: number) {
    updateDay((day) => ({
      ...day,
      medications: day.medications.filter((_, index) => index !== medicationIndex),
    }), "Remove medication", `remove-medication:${selectedDate}:${medicationIndex}`);
  }

  type EditableWeatherKey =
    | "locationName"
    | "weatherCondition"
    | "temperatureCelsius"
    | "airPressureHpa"
    | "humidityPercent"
    | "windSpeed"
    | "uvIndex"
    | "airQualityIndex"
    | "pressureTrend";

  function updateWeatherValue(key: EditableWeatherKey, value: string | number | undefined) {
    if (!selectedDate) return;
    updateDay((day) => ({ ...day, [key]: value }), "Edit weather", `weather:${selectedDate}:${key}`);
    setWeather((current) =>
      current.map((record) =>
        record.date === selectedDate ? { ...record, [key]: value } : record,
      ),
    );
  }

  function updateAttachmentNote(attachmentId: string, note: string) {
    captureHistory("Edit photo caption", `photo-caption:${attachmentId}`);
    setManifest((current) =>
      current
        ? {
            ...current,
            attachments: current.attachments.map((attachment) =>
              attachment.id === attachmentId ? { ...attachment, note } : attachment,
            ),
          }
        : current,
    );
    setDirty(true);
    if (selectedDate) {
      setModifiedDates((current) => new Set(current).add(selectedDate));
    }
  }

  function addDay() {
    if (!diary || !/^\d{4}-\d{2}-\d{2}$/.test(newDayDate)) return;
    if (diary.days.some((day) => day.date === newDayDate)) {
      setError(["That date already exists in this backup."]);
      return;
    }
    captureHistory("Add day", `add-day:${newDayDate}`);
    const now = middayFor(newDayDate);
    const nextDay: BackupDay = {
      date: newDayDate,
      hadHeadache: false,
      note: "",
      isSkipped: false,
      weatherCondition: "",
      pressureTrend: "",
      locationName: "",
      triggers: [],
      episodes: [],
      medications: [],
      createdAtEpochMillis: now,
      updatedAtEpochMillis: now,
    };
    setDiary({ ...diary, days: [...diary.days, nextDay] });
    setSelectedDate(newDayDate);
    setModifiedDates((current) => new Set(current).add(newDayDate));
    setDirty(true);
    setNewDayDate("");
    setWorkspaceView("entries");
    setError(null);
  }

  function deleteSelectedDay() {
    if (!diary || !selectedDay || !window.confirm(`Remove ${formatDate(selectedDay.date)} from this working backup? You can undo this.`)) return;
    captureHistory("Remove day", `remove-day:${selectedDay.date}`);
    const removedDate = selectedDay.date;
    const remaining = diary.days.filter((day) => day.date !== removedDate);
    setDiary({ ...diary, days: remaining });
    setManifest((current) => current ? { ...current, attachments: current.attachments.filter((item) => item.date !== removedDate) } : current);
    setWeather((current) => current.filter((item) => item.date !== removedDate));
    setSelectedDate([...remaining].sort((left, right) => right.date.localeCompare(left.date))[0]?.date ?? null);
    setModifiedDates((current) => new Set(current).add(removedDate));
    setDirty(true);
  }

  function moveSelectedDay(nextDate: string) {
    if (!diary || !selectedDay || nextDate === selectedDay.date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || diary.days.some((day) => day.date === nextDate)) {
      setError(["Choose a valid date that is not already in the backup."]);
      return;
    }
    const oldDate = selectedDay.date;
    const shift = middayFor(nextDate) - middayFor(oldDate);
    captureHistory("Move day", `move-day:${oldDate}`);
    setDiary({
      ...diary,
      days: diary.days.map((day) => day.date !== oldDate ? day : {
        ...day,
        date: nextDate,
        episodes: day.episodes.map((episode) => ({
          ...episode,
          startTimeEpochMillis: episode.startTimeEpochMillis + shift,
          endTimeEpochMillis: episode.endTimeEpochMillis === 0 ? 0 : episode.endTimeEpochMillis + shift,
        })),
        medications: day.medications.map((medication) => ({
          ...medication,
          takenAtEpochMillis: medication.takenAtEpochMillis == null ? undefined : medication.takenAtEpochMillis + shift,
        })),
      }),
    });
    setManifest((current) => current ? { ...current, attachments: current.attachments.map((item) => item.date === oldDate ? { ...item, date: nextDate } : item) } : current);
    setWeather((current) => current.map((item) => item.date === oldDate ? { ...item, date: nextDate } : item));
    setSelectedDate(nextDate);
    setModifiedDates((current) => new Set(current).add(oldDate).add(nextDate));
    setDirty(true);
    setError(null);
  }

  function downloadAttachment(attachmentId: string) {
    if (!bundle || !manifest) return;
    const attachment = manifest.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    const bytes = bundle.entries[attachment.path];
    if (!bytes) return;
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([copy], { type: attachment.mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.path.split("/").at(-1) ?? "headmon-photo";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function removeAttachment(attachmentId: string) {
    if (!manifest || !window.confirm("Remove this photo from the corrected backup? You can undo this.")) return;
    const attachment = manifest.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    captureHistory("Remove photo", `remove-photo:${attachmentId}`);
    setManifest({ ...manifest, attachments: manifest.attachments.filter((item) => item.id !== attachmentId) });
    setModifiedDates((current) => new Set(current).add(attachment.date));
    setDirty(true);
  }

  function moveAttachment(attachmentId: string, date: string, episodeIndex: number | null) {
    if (!manifest || !diary) return;
    const targetDay = diary.days.find((day) => day.date === date);
    if (!targetDay || (episodeIndex !== null && !targetDay.episodes[episodeIndex])) return;
    const attachment = manifest.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    captureHistory("Move photo", `move-photo:${attachmentId}`);
    setManifest({
      ...manifest,
      attachments: manifest.attachments.map((item) => item.id === attachmentId ? { ...item, date, episodeIndex } : item),
    });
    setModifiedDates((current) => new Set(current).add(attachment.date).add(date));
    setDirty(true);
  }

  function updateTriggerDefinition(index: number, updates: Partial<BackupTriggerDefinition>) {
    if (!diary) return;
    const definition = diary.triggerCatalog[index];
    if (!definition) return;
    const nextName = updates.name?.trim() || definition.name;
    if (nextName !== definition.name && diary.triggerCatalog.some((item, itemIndex) => itemIndex !== index && item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) return;
    captureHistory("Edit trigger catalogue", `trigger-definition:${index}`);
    setDiary({
      ...diary,
      triggerCatalog: diary.triggerCatalog.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates, name: nextName } : item),
      days: nextName === definition.name ? diary.days : diary.days.map((day) => ({
        ...day,
        triggers: day.triggers.map((name) => name === definition.name ? nextName : name),
        episodes: day.episodes.map((episode) => ({ ...episode, triggers: episode.triggers.map((name) => name === definition.name ? nextName : name) })),
      })),
    });
    setDirty(true);
  }

  function addTriggerDefinition() {
    if (!diary) return;
    const base = "Custom trigger";
    let name = base;
    let number = 2;
    while (diary.triggerCatalog.some((item) => item.name === name)) name = `${base} ${number++}`;
    captureHistory("Add trigger catalogue item", `add-trigger-definition:${name}`);
    setDiary({ ...diary, triggerCatalog: [...diary.triggerCatalog, { name, emoji: "✨", isBuiltIn: false, isHidden: false }] });
    setDirty(true);
  }

  function removeTriggerDefinition(index: number) {
    if (!diary || diary.triggerCatalog[index]?.isBuiltIn) return;
    captureHistory("Remove trigger catalogue item", `remove-trigger-definition:${index}`);
    setDiary({ ...diary, triggerCatalog: diary.triggerCatalog.filter((_, itemIndex) => itemIndex !== index) });
    setDirty(true);
  }

  function updateMedicationDefinition(index: number, updates: Partial<PortableDiary["medicationCatalog"][number]>) {
    if (!diary) return;
    const definition = diary.medicationCatalog[index];
    if (!definition) return;
    const nextName = updates.name?.trim() || definition.name;
    if (nextName !== definition.name && diary.medicationCatalog.some((item, itemIndex) => itemIndex !== index && item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) return;
    captureHistory("Edit medicine catalogue", `medicine-definition:${index}`);
    setDiary({
      ...diary,
      medicationCatalog: diary.medicationCatalog.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates, name: nextName } : item),
      days: nextName === definition.name ? diary.days : diary.days.map((day) => ({ ...day, medications: day.medications.map((item) => item.name === definition.name ? { ...item, name: nextName } : item) })),
    });
    setDirty(true);
  }

  function addMedicationDefinition() {
    if (!diary) return;
    const base = "Custom medicine";
    let name = base;
    let number = 2;
    while (diary.medicationCatalog.some((item) => item.name === name)) name = `${base} ${number++}`;
    captureHistory("Add medicine catalogue item", `add-medicine-definition:${name}`);
    setDiary({ ...diary, medicationCatalog: [...diary.medicationCatalog, { name, emoji: "💊", isBuiltIn: false, isHidden: false }] });
    setDirty(true);
  }

  function removeMedicationDefinition(index: number) {
    if (!diary || diary.medicationCatalog[index]?.isBuiltIn) return;
    captureHistory("Remove medicine catalogue item", `remove-medicine-definition:${index}`);
    setDiary({ ...diary, medicationCatalog: diary.medicationCatalog.filter((_, itemIndex) => itemIndex !== index) });
    setDirty(true);
  }

  function downloadTextFile(fileName: string, contents: string, mimeType: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function downloadCsvReport() {
    downloadTextFile("headmon-backup-report.csv", backupCsv(filteredDays), "text/csv;charset=utf-8");
  }

  function openPrintableReport() {
    const url = URL.createObjectURL(new Blob([backupReportHtml(filteredDays)], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadCalendarJson() {
    if (!diary) return;
    downloadTextFile("headmon-calendar-backup.json", `${JSON.stringify({ ...diary, exportedAtEpochMillis: Date.now() }, null, 2)}\n`, "application/json");
  }

  async function loadComparisonFile(file: File | undefined) {
    if (!file) return;
    try {
      const opened = await openBackup(file);
      setComparison(opened);
      setComparisonChoices(Object.fromEntries(compareDiaries(diary ?? opened.diary, opened.diary).conflictingDates.map((date) => [date, "current"])));
      setError(null);
    } catch (caught) {
      setError(caught instanceof BackupValidationError ? caught.issues : ["The comparison backup could not be opened."]);
    }
  }

  function safeMergedPhotoPath(id: string, originalPath: string): string {
    const safeId = Array.from(id).map((character) => (/^[\p{L}\p{N}_-]$/u.test(character) ? character : "_")).join("").slice(0, 180);
    const candidateExtension = originalPath.split(".").at(-1)?.toLocaleLowerCase() ?? "jpg";
    const extension = /^[a-z0-9]{1,10}$/.test(candidateExtension) ? candidateExtension : "jpg";
    return `photos/${safeId}.${extension}`;
  }

  function applyComparisonMerge() {
    if (!bundle || !diary || !manifest || !comparison || !comparisonResult) return;
    const chosenDates = new Set([
      ...comparisonResult.missingDates,
      ...comparisonResult.conflictingDates.filter((date) => comparisonChoices[date] === "incoming"),
    ]);
    if (chosenDates.size === 0) return;
    captureHistory("Merge backup", `merge:${comparison.fileName}`);
    const incomingDays = comparison.diary.days.filter((day) => chosenDates.has(day.date));
    const nextDiary: PortableDiary = {
      ...diary,
      days: [...diary.days.filter((day) => !chosenDates.has(day.date)), ...structuredClone(incomingDays)],
      triggerCatalog: [
        ...diary.triggerCatalog,
        ...comparison.diary.triggerCatalog.filter((incoming) => !diary.triggerCatalog.some((current) => current.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase())),
      ],
      medicationCatalog: [
        ...diary.medicationCatalog,
        ...comparison.diary.medicationCatalog.filter((incoming) => !diary.medicationCatalog.some((current) => current.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase())),
      ],
    };
    const retainedAttachments = manifest.attachments.filter((item) => !chosenDates.has(item.date));
    const nextEntries = { ...bundle.entries };
    const usedPaths = new Set(retainedAttachments.map((item) => item.path));
    const usedIds = new Set(retainedAttachments.map((item) => item.id));
    const incomingAttachments = comparison.manifest.attachments.filter((item) => chosenDates.has(item.date)).map((item) => {
      let next = structuredClone(item);
      if (usedPaths.has(next.path) || usedIds.has(next.id)) {
        next = { ...next, id: `${next.id}-merged-${crypto.randomUUID()}` };
        next.path = safeMergedPhotoPath(next.id, item.path);
      }
      const bytes = comparison.entries[item.path];
      if (bytes) nextEntries[next.path] = bytes;
      usedPaths.add(next.path);
      usedIds.add(next.id);
      return next;
    });
    const nextManifest = { ...manifest, attachments: [...retainedAttachments, ...incomingAttachments] };
    const nextWeather = [
      ...weather.filter((item) => !chosenDates.has(item.date)),
      ...structuredClone(comparison.weather.filter((item) => chosenDates.has(item.date))),
    ];
    const nextBundle = {
      ...bundle,
      fileName: bundle.fileName.toLowerCase().endsWith(".json") ? bundle.fileName.replace(/\.json$/i, "-working.zip") : bundle.fileName,
      entries: nextEntries,
    };
    // Validate the merged archive before replacing the in-memory workspace.
    exportBackup(nextBundle, nextDiary, nextManifest, nextWeather);
    setBundle(nextBundle);
    setDiary(nextDiary);
    setManifest(nextManifest);
    setWeather(nextWeather);
    setDirty(true);
    setModifiedDates((current) => new Set([...current, ...chosenDates]));
    setComparison(null);
    setComparisonChoices({});
    setWorkspaceView("entries");
  }

  function discardChanges() {
    if (!bundle) return;
    setDiary(cloneDiary(bundle.diary));
    setManifest(structuredClone(bundle.manifest));
    setWeather(structuredClone(bundle.weather));
    setDirty(false);
    setModifiedDates(new Set());
    historyRef.current = [];
    redoRef.current = [];
    setHistoryCounts({ undo: 0, redo: 0 });
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function downloadCorrectedBackup() {
    if (!bundle || !diary || !manifest) return;
    try {
      const blob = exportBackup(bundle, diary, manifest, weather);
      const fileName = correctedFileName(bundle.fileName);
      const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
      if (saveFilePicker) {
        const handle = await saveFilePicker.call(window, {
          suggestedName: fileName,
          types: [{
            description: "Headmon corrected backup",
            accept: { "application/zip": [".zip"] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadBlob(blob, fileName);
      }
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(
        caught instanceof BackupValidationError
          ? caught.issues
          : ["The corrected backup could not be saved."],
      );
    }
  }

  function closeBackup() {
    setBundle(null);
    setDiary(null);
    setManifest(null);
    setWeather([]);
    setSelectedDate(null);
    setDirty(false);
    setModifiedDates(new Set());
    setComparison(null);
    setComparisonChoices({});
    historyRef.current = [];
    redoRef.current = [];
    setHistoryCounts({ undo: 0, redo: 0 });
    setError(null);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="site-brand" href="https://headmondiary.com/" aria-label="Headmon home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bv/headmon-icon.png" alt="" />
          <span>Headmon</span>
        </a>
        <nav className="site-nav" aria-label="Primary navigation">
          <a href="/in-action/">In action</a>
          <a href="/about/">About</a>
          <a href="/privacy/">Privacy</a>
          <a href="/backup/">Backups</a>
          <a href="/support/">Support</a>
          <a href="https://github.com/HeadmonDiary/headmon">GitHub</a>
        </nav>
      </header>

      <main className="site-main" id="top">
        {!bundle || !diary || !manifest ? (
          <section className="welcome">
          <div className="welcome-copy">
            <p className="eyebrow">Private backup tool</p>
            <h1>See what your diary remembers.</h1>
            <p className="welcome-intro">Open a complete ZIP or calendar JSON backup to browse, repair, compare, and report on your diary. Headmon processes it only in this tab and never uploads or saves it in browser storage.</p>
            <div className="trust-row" role="group" aria-label="Privacy guarantees"><span>No account</span><span>No upload</span><span>No persistent browser storage</span></div>
          </div>

          <div
            className={`drop-zone${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="zip-icon" aria-hidden="true"><span>ZIP</span></div>
            <h2>{loading ? "Checking your backup…" : "Open a Headmon backup"}</h2>
            <p>Drop any dated Headmon complete ZIP or calendar JSON backup here, or choose it from your device.</p>
            <button className="primary-button" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>{loading ? "Opening…" : "Choose backup"}</button>
            <input ref={inputRef} type="file" accept=".zip,.json,application/zip,application/json" onChange={handleFileInput} hidden />
            <small>Maximum archive size: 256 MB</small>
          </div>

          {error && (
            <div className="error-panel" role="alert">
              <strong>This file could not be opened</strong>
              {error.map((issue) => <p key={issue}>{issue}</p>)}
            </div>
          )}
          </section>
        ) : (
          <div className="viewer-layout">
          <aside className="archive-sidebar">
            <div className="archive-file">
              <div className="mini-zip" aria-hidden="true">ZIP</div>
              <div><strong>{bundle.fileName}</strong><span>Verified Headmon backup</span></div>
            </div>

            <div className="archive-facts">
              <div><span>Source</span><strong>{bundle.manifest.sourcePlatform}</strong></div>
              <div><span>Format</span><strong>Full backup v{bundle.manifest.formatVersion}</strong></div>
              <div><span>Exported</span><strong>{new Date(bundle.manifest.exportedAtEpochMillis).toLocaleDateString()}</strong></div>
            </div>

            <div className="metric-grid">
              <div><strong>{stats.days}</strong><span>Days</span></div>
              <div><strong>{stats.episodes}</strong><span>Episodes</span></div>
              <div><strong>{stats.photos}</strong><span>Photos</span></div>
              <div><strong>{stats.weather}</strong><span>Weather days</span></div>
              <div><strong>{stats.filledNotes}</strong><span title="Day notes, episode notes, and photo captions">Filled notes</span></div>
            </div>

            <div className="archive-note"><span className="privacy-dot" aria-hidden="true" /><p><strong>Memory only.</strong> Changes disappear when you close or reload this tab unless you export them.</p></div>
            {bundle.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
            <button className="text-button" type="button" onClick={closeBackup}>Close this backup</button>
          </aside>

          <section className="entry-browser">
            <nav className="workspace-tabs" aria-label="Backup workbench sections">
              {([
                ["entries", "Entries"],
                ["calendar", "Calendar"],
                ["photos", "Photos"],
                ["catalogues", "Catalogues"],
                ["reports", "Reports"],
                ["compare", "Compare"],
              ] as Array<[WorkspaceView, string]>).map(([value, label]) => (
                <button className={workspaceView === value ? "is-active" : ""} type="button" key={value} onClick={() => setWorkspaceView(value)}>{label}</button>
              ))}
            </nav>

            {workspaceView === "entries" && <>
            <div className="browser-heading">
              <div><p className="eyebrow">DIARY CONTENTS</p><h1>Your entries</h1><p>{stats.migraineDays} migraine days · {stats.headacheOnlyDays} headache-only days</p></div>
              <label className="search-field"><span className="sr-only">Search entries</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search notes, places, triggers…" /></label>
            </div>

            <div className="entry-tools">
              <label className="control-field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All entries</option><option value="migraine">Migraine</option><option value="headache">Headache</option><option value="aura">Aura only</option><option value="pain-free">Pain-free</option><option value="skipped">Skipped</option></select></label>
              <label className="control-field"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
              <label className="control-field"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
              <div className="add-day-control"><label className="control-field"><span>Add missing day</span><input type="date" value={newDayDate} onChange={(event) => setNewDayDate(event.target.value)} /></label><button className="compact-button" type="button" onClick={addDay} disabled={!newDayDate}>Add day</button></div>
            </div>

            <div
              className="entries-and-editor"
              style={editorHeight ? { "--entry-editor-height": `${editorHeight}px` } as CSSProperties : undefined}
            >
              <nav className="entry-list" aria-label="Diary entries">
                <div className="entry-list-count">{filteredDays.length} entries</div>
                {filteredDays.map((day) => {
                  const status = statusFor(day);
                  return (
                    <button className={`entry-row${day.date === selectedDate ? " is-selected" : ""}`} key={day.date} type="button" onClick={() => setSelectedDate(day.date)}>
                      <span className={`status-mark ${status.tone}`} aria-hidden="true" />
                      <span className="entry-row-copy"><span className="entry-row-title"><strong>{formatDate(day.date)}</strong>{modifiedDates.has(day.date) && <span className="edited-pill">Edited</span>}</span><span>{status.label}{day.locationName ? ` · ${day.locationName}` : day.note ? ` · ${day.note}` : ""}</span></span>
                      <span className="episode-count">{day.episodes.length || "—"}</span>
                    </button>
                  );
                })}
                {filteredDays.length === 0 && <p className="empty-list">No entries match that search.</p>}
              </nav>

              <article className="entry-editor" ref={editorRef}>
                {selectedDay ? (
                  <>
                    <div className="editor-heading">
                      <div>
                        <div className="date-and-status"><h2>{formatDate(selectedDay.date)}</h2><span className={`status-badge ${statusFor(selectedDay).tone}`}>{statusFor(selectedDay).label}</span></div>
                        <p>{selectedDay.locationName || "No location"}{selectedDay.stressLevel != null ? ` · Stress ${selectedDay.stressLevel}/10` : ""}</p>
                      </div>
                      <div className="editor-heading-actions">{modifiedDates.has(selectedDay.date) && <span className="changed-badge">Modified</span>}<button className="danger-button" type="button" onClick={deleteSelectedDay}>Remove day</button></div>
                    </div>

                    <section className="editor-section">
                      <div className="section-title"><h3>Day details</h3><span aria-hidden="true">☀</span></div>
                      <div className="day-detail-grid">
                        <label className="control-field"><span>Entry date</span><input type="date" value={selectedDay.date} onChange={(event) => moveSelectedDay(event.target.value)} /></label>
                        <label className="control-field"><span>Stress (0–10, blank if unset)</span><input type="number" min="0" max="10" value={selectedDay.stressLevel ?? ""} onChange={(event) => updateDay((day) => ({ ...day, stressLevel: optionalNumber(event.target.value) }))} /></label>
                        <label className="check-control day-skip"><input type="checkbox" checked={selectedDay.isSkipped} disabled={selectedDay.episodes.length > 0} onChange={(event) => updateDay((day) => ({ ...day, isSkipped: event.target.checked }))} /><span>Marked as skipped</span></label>
                      </div>
                      {selectedDay.episodes.length > 0 && <p className="field-help">A day with episodes cannot also be skipped.</p>}
                      <TriggerEditor
                        id={`day-triggers-${selectedDay.date}`}
                        label="Day triggers"
                        value={selectedDay.triggers}
                        catalog={diary.triggerCatalog}
                        onChange={(triggers) => updateDay((day) => ({ ...day, triggers }))}
                      />
                    </section>

                    <section className="editor-section">
                      <label className="field-label" htmlFor="day-note">Day note</label>
                      <textarea id="day-note" value={selectedDay.note} maxLength={10_000} placeholder="No note for this day" onChange={(event) => updateDay((day) => ({ ...day, note: event.target.value }))} />
                      <div className="field-meta"><span>Kept only in this tab until export</span><span>{selectedDay.note.length.toLocaleString()} characters</span></div>
                    </section>

                    <section className="editor-section weather-section">
                      <div className="section-title"><h3>Weather on this day</h3><span aria-hidden="true">☁</span></div>
                      {hasSelectedWeather && selectedWeather ? (
                        <>
                          <div className="weather-lead">
                            <strong>{selectedWeather.weatherCondition || "Recorded conditions"}</strong>
                            <span>{selectedWeather.locationName || "Location not named"}</span>
                          </div>
                          <div className="weather-grid">
                            <div><span>Temperature</span><strong>{selectedWeather.temperatureCelsius != null ? `${selectedWeather.temperatureCelsius.toFixed(1)} °C` : "—"}</strong><small>{selectedWeather.temperatureMin != null && selectedWeather.temperatureMax != null ? `${selectedWeather.temperatureMin.toFixed(1)}–${selectedWeather.temperatureMax.toFixed(1)} °C` : "No daily range"}</small></div>
                            <div><span>Pressure</span><strong>{selectedWeather.airPressureHpa != null ? `${Math.round(selectedWeather.airPressureHpa)} hPa` : "—"}</strong><small>{selectedWeather.pressureTrend || (selectedWeather.pressureSwing != null ? `${selectedWeather.pressureSwing.toFixed(1)} hPa swing` : "No trend")}</small></div>
                            <div><span>Humidity</span><strong>{selectedWeather.humidityPercent != null ? `${selectedWeather.humidityPercent}%` : "—"}</strong><small>{selectedWeather.windSpeed != null ? `Wind ${selectedWeather.windSpeed.toFixed(1)} m/s` : "No wind reading"}</small></div>
                            <div><span>UV / air quality</span><strong>{selectedWeather.uvIndex != null ? `UV ${selectedWeather.uvIndex.toFixed(1)}` : "UV —"}</strong><small>{selectedWeather.airQualityIndex != null ? `AQI ${selectedWeather.airQualityIndex}` : "No AQI reading"}</small></div>
                          </div>
                        </>
                      ) : <p className="weather-empty">No weather was recorded for this day.</p>}
                      {selectedWeather && (
                        <details className="context-editor">
                          <summary>Correct recorded weather or place</summary>
                          <p>This edits values already stored in the backup. It does not look up a new location or fetch weather.</p>
                          <div className="context-form-grid">
                            <label className="control-field wide-field"><span>Place label</span><input type="text" value={selectedWeather.locationName ?? ""} onChange={(event) => updateWeatherValue("locationName", event.target.value)} /></label>
                            <label className="control-field wide-field"><span>Condition</span><input type="text" value={selectedWeather.weatherCondition ?? ""} onChange={(event) => updateWeatherValue("weatherCondition", event.target.value)} /></label>
                            <label className="control-field"><span>Temperature °C</span><input type="number" step="0.1" value={selectedWeather.temperatureCelsius ?? ""} onChange={(event) => updateWeatherValue("temperatureCelsius", optionalNumber(event.target.value))} /></label>
                            <label className="control-field"><span>Pressure hPa</span><input type="number" step="0.1" value={selectedWeather.airPressureHpa ?? ""} onChange={(event) => updateWeatherValue("airPressureHpa", optionalNumber(event.target.value))} /></label>
                            <label className="control-field"><span>Humidity %</span><input type="number" min="0" max="100" value={selectedWeather.humidityPercent ?? ""} onChange={(event) => updateWeatherValue("humidityPercent", optionalNumber(event.target.value))} /></label>
                            <label className="control-field"><span>Wind m/s</span><input type="number" min="0" step="0.1" value={selectedWeather.windSpeed ?? ""} onChange={(event) => updateWeatherValue("windSpeed", optionalNumber(event.target.value))} /></label>
                            <label className="control-field"><span>UV index</span><input type="number" min="0" step="0.1" value={selectedWeather.uvIndex ?? ""} onChange={(event) => updateWeatherValue("uvIndex", optionalNumber(event.target.value))} /></label>
                            <label className="control-field"><span>Air quality index</span><input type="number" min="0" value={selectedWeather.airQualityIndex ?? ""} onChange={(event) => updateWeatherValue("airQualityIndex", optionalNumber(event.target.value))} /></label>
                            <label className="control-field wide-field"><span>Pressure trend</span><input type="text" value={selectedWeather.pressureTrend ?? ""} onChange={(event) => updateWeatherValue("pressureTrend", event.target.value)} /></label>
                          </div>
                        </details>
                      )}
                    </section>

                    <section className="editor-section">
                        <div className="section-title section-title-actions"><div><h3>Episodes</h3><span>{selectedDay.episodes.length}</span></div><button className="compact-button" type="button" onClick={addEpisode}>Add episode</button></div>
                        {selectedDay.episodes.length === 0 && <p className="section-empty">No episodes on this day.</p>}
                        <div className="episode-stack">
                          {selectedDay.episodes.map((episode, episodeIndex) => (
                            <div className="episode-card" key={episode.id}>
                              <div className="episode-summary">
                                <div><strong>{episode.isAuraOnly ? "Aura only" : episode.isMigraine ? "Migraine" : "Headache"}</strong><span>{formatTime(episode.startTimeEpochMillis)}–{formatTime(episode.endTimeEpochMillis)}</span></div>
                                <button className="danger-button" type="button" onClick={() => removeEpisode(episodeIndex)}>Remove episode</button>
                              </div>
                              <div className="episode-form-grid">
                                <label className="control-field"><span>Starts</span><input type="datetime-local" value={dateTimeInputValue(episode.startTimeEpochMillis)} onChange={(event) => {
                                  const start = new Date(event.target.value).getTime();
                                  if (!Number.isFinite(start)) return;
                                  updateEpisode(episodeIndex, (item) => ({
                                    ...item,
                                    startTimeEpochMillis: start,
                                    endTimeEpochMillis: item.endTimeEpochMillis !== 0 && item.endTimeEpochMillis < start ? start : item.endTimeEpochMillis,
                                  }));
                                }} /></label>
                                <label className="control-field"><span>Ends</span><input type="datetime-local" value={dateTimeInputValue(episode.endTimeEpochMillis)} min={dateTimeInputValue(episode.startTimeEpochMillis)} disabled={episode.endTimeEpochMillis === 0} onChange={(event) => {
                                  const end = new Date(event.target.value).getTime();
                                  if (Number.isFinite(end)) updateEpisode(episodeIndex, (item) => ({ ...item, endTimeEpochMillis: end }));
                                }} /></label>
                              </div>
                              <label className="check-control"><input type="checkbox" checked={episode.endTimeEpochMillis === 0} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, endTimeEpochMillis: event.target.checked ? 0 : Math.max(item.startTimeEpochMillis, Date.now()) }))} /><span>Episode is ongoing</span></label>

                              <div className="episode-form-grid">
                                <label className="control-field"><span>Peak pain</span><input type="number" min="0" max="10" value={episode.peakPainLevel} disabled={episode.isAuraOnly} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, peakPainLevel: Math.min(10, Math.max(1, Number(event.target.value))) }))} /></label>
                                <label className="control-field"><span>Migraine intensity</span><input type="number" min="0" max="10" value={episode.migraineIntensity} disabled={!episode.isMigraine} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, migraineIntensity: Math.min(10, Math.max(1, Number(event.target.value))) }))} /></label>
                              </div>

                              <div className="episode-checks">
                                <label className="check-control"><input type="checkbox" checked={episode.isMigraine} disabled={episode.isAuraOnly} onChange={(event) => updateEpisode(episodeIndex, (item) => event.target.checked ? { ...item, isMigraine: true, isAuraOnly: false, peakPainLevel: Math.max(1, item.peakPainLevel), migraineIntensity: Math.max(1, item.migraineIntensity) } : { ...item, isMigraine: false, migraineIntensity: 0, migraineMedicationHelped: false })} /><span>Migraine</span></label>
                                <label className="check-control"><input type="checkbox" checked={episode.isAuraOnly} onChange={(event) => updateEpisode(episodeIndex, (item) => event.target.checked ? { ...item, isAuraOnly: true, hadAura: true, peakPainLevel: 0, isMigraine: false, migraineIntensity: 0, migraineMedicationHelped: false } : { ...item, isAuraOnly: false, peakPainLevel: Math.max(1, item.peakPainLevel) })} /><span>Aura only</span></label>
                                <label className="check-control"><input type="checkbox" checked={episode.hadAura} disabled={episode.isAuraOnly} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, hadAura: event.target.checked }))} /><span>Aura</span></label>
                                <label className="check-control"><input type="checkbox" checked={episode.hadNausea} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, hadNausea: event.target.checked }))} /><span>Nausea</span></label>
                                <label className="check-control"><input type="checkbox" checked={episode.lightSensitivity} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, lightSensitivity: event.target.checked }))} /><span>Light sensitivity</span></label>
                                <label className="check-control"><input type="checkbox" checked={episode.soundSensitivity} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, soundSensitivity: event.target.checked }))} /><span>Sound sensitivity</span></label>
                                <label className="check-control"><input type="checkbox" checked={episode.migraineMedicationHelped} disabled={!episode.isMigraine} onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, migraineMedicationHelped: event.target.checked }))} /><span>Migraine medicine helped</span></label>
                              </div>

                              <TriggerEditor
                                id={`episode-triggers-${episode.id}`}
                                label="Episode triggers"
                                value={episode.triggers}
                                catalog={diary.triggerCatalog}
                                onChange={(triggers) => updateEpisode(episodeIndex, (item) => ({ ...item, triggers }))}
                              />
                              <label className="field-label" htmlFor={`episode-note-${episode.id}`}>Episode note</label>
                              <textarea
                                id={`episode-note-${episode.id}`}
                                className="episode-note"
                                value={episode.note}
                                maxLength={10_000}
                                placeholder="No note for this episode"
                                onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, note: event.target.value }))}
                              />
                            </div>
                          ))}
                        </div>
                      </section>

                    <section className="editor-section">
                      <div className="section-title section-title-actions"><div><h3>Medication</h3><span>{selectedDay.medications.length}</span></div><button className="compact-button" type="button" onClick={addMedication}>Add medication</button></div>
                      <datalist id="medication-catalog">
                        {diary.medicationCatalog.filter((item) => !item.isHidden).map((item) => <option value={item.name} key={item.name}>{item.emoji} {item.name}</option>)}
                      </datalist>
                      {selectedDay.medications.length === 0 && <p className="section-empty">No medication recorded for this day.</p>}
                      <div className="medication-editor-list">
                        {selectedDay.medications.map((medication, medicationIndex) => (
                          <div className="medication-card" key={medication.id}>
                            <div className="medication-card-heading"><strong>{medication.name || "Medication"}</strong><button className="danger-button" type="button" onClick={() => removeMedication(medicationIndex)}>Remove</button></div>
                            <div className="context-form-grid">
                              <label className="control-field wide-field"><span>Medicine (catalogue or custom)</span><input list="medication-catalog" value={medication.name} maxLength={200} onChange={(event) => {
                                const name = event.target.value;
                                const definition = diary.medicationCatalog.find((item) => item.name === name);
                                updateMedication(medicationIndex, (item) => ({ ...item, name, doseMg: item.doseMg ?? definition?.defaultDoseMg }));
                              }} /></label>
                              <label className="control-field"><span>Dose (mg)</span><input type="number" min="0" max="99999" value={medication.doseMg ?? ""} onChange={(event) => updateMedication(medicationIndex, (item) => ({ ...item, doseMg: optionalNumber(event.target.value) }))} /></label>
                              <label className="control-field"><span>Taken at</span><input type="datetime-local" value={dateTimeInputValue(medication.takenAtEpochMillis ?? 0)} onChange={(event) => {
                                const takenAt = new Date(event.target.value).getTime();
                                updateMedication(medicationIndex, (item) => ({ ...item, takenAtEpochMillis: Number.isFinite(takenAt) ? takenAt : undefined }));
                              }} /></label>
                              <label className="control-field wide-field"><span>Linked to</span><select value={medication.episodeId ?? ""} onChange={(event) => updateMedication(medicationIndex, (item) => ({ ...item, episodeId: event.target.value || undefined }))}>
                                <option value="">The day (no specific episode)</option>
                                {selectedDay.episodes.map((episode, index) => <option value={episode.id} key={episode.id}>Episode {index + 1} · {formatTime(episode.startTimeEpochMillis)}</option>)}
                              </select></label>
                            </div>
                            <label className="check-control"><input type="checkbox" checked={medication.helped ?? false} onChange={(event) => updateMedication(medicationIndex, (item) => ({ ...item, helped: event.target.checked }))} /><span>Medication helped</span></label>
                          </div>
                        ))}
                      </div>
                    </section>

                    {selectedAttachments.length > 0 && (
                      <section className="editor-section">
                        <div className="section-title"><h3>Photos</h3><span>{selectedAttachments.length}</span></div>
                        <div className="photo-grid">
                          {selectedAttachments.map((attachment) => (
                            <figure key={attachment.id}>
                              {bundle.entries[attachment.path] ? (
                                <LocalBackupImage
                                  bytes={bundle.entries[attachment.path]}
                                  mimeType={attachment.mimeType}
                                  alt={attachment.note || "Backup attachment"}
                                />
                              ) : <div className="photo-placeholder">Preview unavailable</div>}
                              <figcaption>
                                <label className="control-field" htmlFor={`photo-note-${attachment.id}`}><span>Photo caption</span><input id={`photo-note-${attachment.id}`} value={attachment.note} maxLength={500} placeholder="Untitled photo" onChange={(event) => updateAttachmentNote(attachment.id, event.target.value)} /></label>
                                <label className="control-field"><span>Attached to</span><select value={attachment.episodeIndex === null ? "day" : String(attachment.episodeIndex)} onChange={(event) => moveAttachment(attachment.id, attachment.date, event.target.value === "day" ? null : Number(event.target.value))}><option value="day">The day</option>{selectedDay.episodes.map((episode, index) => <option value={index} key={episode.id}>Episode {index + 1} · {formatTime(episode.startTimeEpochMillis)}</option>)}</select></label>
                                <div className="photo-actions"><button className="compact-button" type="button" onClick={() => downloadAttachment(attachment.id)}>Download</button><button className="danger-button" type="button" onClick={() => removeAttachment(attachment.id)}>Remove</button></div>
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                ) : <p className="empty-editor">Select an entry to inspect it.</p>}
              </article>
            </div>
            </>}

            {workspaceView === "calendar" && (
              <section className="workspace-panel">
                <div className="browser-heading"><div><p className="eyebrow">LARGE-SCREEN OVERVIEW</p><h1>Calendar</h1><p>{filteredDays.length} matching days</p></div></div>
                <div className="entry-tools compact-filters">
                  <label className="control-field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All entries</option><option value="migraine">Migraine</option><option value="headache">Headache</option><option value="aura">Aura only</option><option value="pain-free">Pain-free</option><option value="skipped">Skipped</option></select></label>
                  <label className="control-field"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
                  <label className="control-field"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
                </div>
                <div className="calendar-months">
                  {calendarMonths.map(([month, days]) => (
                    <section className="calendar-month" key={month}><h2>{new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</h2><div className="calendar-grid">{days.map((day) => { const status = statusFor(day); return <button type="button" className={`calendar-day ${status.tone}${modifiedDates.has(day.date) ? " is-edited" : ""}`} key={day.date} onClick={() => { setSelectedDate(day.date); setWorkspaceView("entries"); }}><span>{Number(day.date.slice(-2))}</span><small>{status.label}</small><strong>{day.episodes.length || "—"}</strong></button>; })}</div></section>
                  ))}
                </div>
              </section>
            )}

            {workspaceView === "photos" && (
              <section className="workspace-panel">
                <div className="browser-heading"><div><p className="eyebrow">ATTACHMENTS</p><h1>Photo gallery</h1><p>{manifest.attachments.length} photos in this working backup</p></div></div>
                {manifest.attachments.length === 0 ? <p className="workspace-empty">This backup has no photos.</p> : <div className="gallery-grid">{manifest.attachments.map((attachment) => {
                  const targetDay = diary.days.find((day) => day.date === attachment.date);
                  return <figure className="gallery-card" key={attachment.id}>{bundle.entries[attachment.path] ? <LocalBackupImage bytes={bundle.entries[attachment.path]} mimeType={attachment.mimeType} alt={attachment.note || `Photo from ${attachment.date}`} /> : <div className="photo-placeholder">Preview unavailable</div>}<figcaption><strong>{formatDate(attachment.date)}</strong><label className="control-field"><span>Caption</span><input value={attachment.note} maxLength={500} onChange={(event) => updateAttachmentNote(attachment.id, event.target.value)} /></label><label className="control-field"><span>Move to day</span><select value={attachment.date} onChange={(event) => moveAttachment(attachment.id, event.target.value, null)}>{sortedDays.map((day) => <option key={day.date} value={day.date}>{formatDate(day.date)}</option>)}</select></label>{targetDay && <label className="control-field"><span>Attach within day</span><select value={attachment.episodeIndex === null ? "day" : String(attachment.episodeIndex)} onChange={(event) => moveAttachment(attachment.id, attachment.date, event.target.value === "day" ? null : Number(event.target.value))}><option value="day">The day</option>{targetDay.episodes.map((episode, index) => <option value={index} key={episode.id}>Episode {index + 1}</option>)}</select></label>}<div className="photo-actions"><button className="compact-button" type="button" onClick={() => downloadAttachment(attachment.id)}>Download</button><button className="danger-button" type="button" onClick={() => removeAttachment(attachment.id)}>Remove</button></div></figcaption></figure>;
                })}</div>}
              </section>
            )}

            {workspaceView === "catalogues" && (
              <section className="workspace-panel">
                <div className="browser-heading"><div><p className="eyebrow">BACKUP DEFINITIONS</p><h1>Catalogues</h1><p>Correct custom choices and the defaults preserved with this diary.</p></div></div>
                <div className="catalogue-columns">
                  <section className="catalogue-panel"><div className="section-title section-title-actions"><div><h3>Triggers</h3><span>{diary.triggerCatalog.length}</span></div><button className="compact-button" type="button" onClick={addTriggerDefinition}>Add custom</button></div><div className="catalogue-list">{diary.triggerCatalog.map((item, index) => <article className="catalogue-row" key={`${item.name}-${index}`}><input aria-label="Trigger emoji" value={item.emoji ?? ""} maxLength={8} onChange={(event) => updateTriggerDefinition(index, { emoji: event.target.value })} /><input aria-label="Trigger name" value={item.name} disabled={item.isBuiltIn} onChange={(event) => updateTriggerDefinition(index, { name: event.target.value })} /><label className="check-control"><input type="checkbox" checked={item.isHidden} onChange={(event) => updateTriggerDefinition(index, { isHidden: event.target.checked })} /><span>Hidden</span></label>{!item.isBuiltIn && <button className="danger-button" type="button" onClick={() => removeTriggerDefinition(index)}>Remove</button>}</article>)}</div></section>
                  <section className="catalogue-panel"><div className="section-title section-title-actions"><div><h3>Medicines</h3><span>{diary.medicationCatalog.length}</span></div><button className="compact-button" type="button" onClick={addMedicationDefinition}>Add custom</button></div><div className="catalogue-list">{diary.medicationCatalog.map((item, index) => <article className="catalogue-row medicine" key={`${item.name}-${index}`}><input aria-label="Medicine emoji" value={item.emoji} maxLength={8} onChange={(event) => updateMedicationDefinition(index, { emoji: event.target.value })} /><input aria-label="Medicine name" value={item.name} disabled={item.isBuiltIn} onChange={(event) => updateMedicationDefinition(index, { name: event.target.value })} /><input aria-label="Default dose in milligrams" type="number" min="0" max="99999" value={item.defaultDoseMg ?? ""} onChange={(event) => updateMedicationDefinition(index, { defaultDoseMg: optionalNumber(event.target.value) })} /><label className="check-control"><input type="checkbox" checked={item.isHidden} onChange={(event) => updateMedicationDefinition(index, { isHidden: event.target.checked })} /><span>Hidden</span></label>{!item.isBuiltIn && <button className="danger-button" type="button" onClick={() => removeMedicationDefinition(index)}>Remove</button>}</article>)}</div></section>
                </div>
              </section>
            )}

            {workspaceView === "reports" && (
              <section className="workspace-panel">
                <div className="browser-heading"><div><p className="eyebrow">LOCAL EXPORTS</p><h1>Reports</h1><p>CSV and printable reports use the current filters: {filteredDays.length} days selected. Calendar JSON keeps the entire edited diary.</p></div></div>
                <div className="report-grid"><article><strong>Spreadsheet report</strong><p>Formula-safe CSV with statuses, medication, triggers, weather, and notes.</p><button className="primary-button" type="button" onClick={downloadCsvReport}>Download CSV</button></article><article><strong>Printable report</strong><p>Open a readable local report, then print or save it as a PDF.</p><button className="primary-button" type="button" onClick={openPrintableReport}>Open printable report</button></article><article><strong>Calendar backup</strong><p>Export the edited diary and catalogues as portable Headmon JSON without photos or weather history.</p><button className="secondary-button" type="button" onClick={downloadCalendarJson}>Download JSON</button></article></div>
                <p className="privacy-warning"><strong>Keep reports private.</strong> CSV, HTML/PDF, and JSON files can contain sensitive health information, exact dates, places, and notes.</p>
              </section>
            )}

            {workspaceView === "compare" && (
              <section className="workspace-panel">
                <div className="browser-heading"><div><p className="eyebrow">RECOVERY TOOL</p><h1>Compare backups</h1><p>Bring missing dates across and choose deliberately when the same date differs.</p></div></div>
                <div className="compare-picker"><button className="primary-button" type="button" onClick={() => compareInputRef.current?.click()}>Choose second backup</button><input ref={compareInputRef} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(event) => { void loadComparisonFile(event.target.files?.[0]); event.target.value = ""; }} />{comparison && <span>{comparison.fileName} · {bundleLabel(comparison)}</span>}</div>
                {comparisonResult && comparison && <div className="comparison-results"><div className="comparison-summary"><article><strong>{comparisonResult.missingDates.length}</strong><span>Missing here</span></article><article><strong>{comparisonResult.conflictingDates.length}</strong><span>Conflicts</span></article><article><strong>{comparisonResult.matchingDates.length}</strong><span>Already identical</span></article></div>{comparisonResult.missingDates.length > 0 && <section><h2>Dates that will be added</h2><div className="date-chip-row">{comparisonResult.missingDates.map((date) => <span key={date}>{formatDate(date)}</span>)}</div></section>}{comparisonResult.conflictingDates.length > 0 && <section><h2>Choose each conflict</h2><div className="conflict-list">{comparisonResult.conflictingDates.map((date) => <article key={date}><strong>{formatDate(date)}</strong><label><input type="radio" name={`conflict-${date}`} checked={(comparisonChoices[date] ?? "current") === "current"} onChange={() => setComparisonChoices((current) => ({ ...current, [date]: "current" }))} /> Keep current</label><label><input type="radio" name={`conflict-${date}`} checked={comparisonChoices[date] === "incoming"} onChange={() => setComparisonChoices((current) => ({ ...current, [date]: "incoming" }))} /> Use incoming</label></article>)}</div></section>}<div className="compare-actions"><button className="primary-button" type="button" onClick={applyComparisonMerge} disabled={comparisonResult.missingDates.length === 0 && !comparisonResult.conflictingDates.some((date) => comparisonChoices[date] === "incoming")}>Apply selected merge</button><button className="secondary-button" type="button" onClick={() => { setComparison(null); setComparisonChoices({}); }}>Clear comparison</button></div><p className="field-help">The current backup remains the base. Incoming dates, their weather, catalogue definitions, and attached photos are copied only when selected.</p></div>}
              </section>
            )}
          </section>

          {showChangeReview && (
            <aside className="change-review" aria-label="Change review">
              <div><p className="eyebrow">BEFORE EXPORT</p><h2>Review changes</h2></div>
              {changeDetails.length === 0 ? <p>No differences from the opened backup were detected.</p> : <div className="change-list">{changeDetails.map((row) => <article key={row.date}><strong>{row.date === "Catalogue" ? row.date : formatDate(row.date)}</strong><span>{row.changes.join(" · ")}</span></article>)}</div>}
              <button className="text-button" type="button" onClick={() => setShowChangeReview(false)}>Close review</button>
            </aside>
          )}

          <footer className="save-bar">
            <div><strong>{dirty ? modifiedDates.size > 0 ? `${modifiedDates.size} edited ${modifiedDates.size === 1 ? "day" : "days"}` : "Backup definitions edited" : "No changes yet"}</strong>{error ? <span className="save-error">{error[0]}</span> : <span>{dirty ? "Changes exist only in this tab. Export before closing or reloading." : "Open entries, compare archives, or create a report."}</span>}</div>
            <div className="save-actions"><button className="secondary-button" type="button" onClick={undoChange} disabled={historyCounts.undo === 0}>Undo</button><button className="secondary-button" type="button" onClick={redoChange} disabled={historyCounts.redo === 0}>Redo</button><button className="secondary-button" type="button" onClick={() => setShowChangeReview((current) => !current)} disabled={!dirty}>Review</button><button className="secondary-button" type="button" onClick={discardChanges} disabled={!dirty}>Discard</button><button className="primary-button" type="button" onClick={() => void downloadCorrectedBackup()} disabled={!dirty}>Export corrected ZIP</button></div>
          </footer>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <span>© 2026 Headmon</span>
        <a href="/privacy/">Privacy</a>
      </footer>
    </div>
  );
}
