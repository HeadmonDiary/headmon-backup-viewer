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
  const editorRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [bundle, setBundle] = useState<BackupBundle | null>(null);
  const [diary, setDiary] = useState<PortableDiary | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [weather, setWeather] = useState<WeatherRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [modifiedDates, setModifiedDates] = useState<Set<string>>(() => new Set());
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const [error, setError] = useState<string[] | null>(null);

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
    if (!query) return sortedDays;
    return sortedDays.filter((day) =>
      [
        day.date,
        day.note,
        day.locationName,
        ...day.triggers,
        ...day.episodes.flatMap((episode) => [episode.note, ...episode.triggers]),
        ...day.medications.map((medication) => medication.name),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [search, sortedDays]);

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

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const opened = await openBackup(file);
      const nextDiary = cloneDiary(opened.diary);
      const newestDate = [...nextDiary.days].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
      setBundle(opened);
      setDiary(nextDiary);
      setManifest(structuredClone(opened.manifest));
      setWeather(structuredClone(opened.weather));
      setSelectedDate(newestDate);
      setSearch("");
      setDirty(false);
      setModifiedDates(new Set());
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

  function updateDay(updater: (day: BackupDay) => BackupDay) {
    if (!diary || !selectedDate) return;
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
    }));
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
    }));
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
    }));
  }

  function removeMedication(medicationIndex: number) {
    updateDay((day) => ({
      ...day,
      medications: day.medications.filter((_, index) => index !== medicationIndex),
    }));
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
    updateDay((day) => ({ ...day, [key]: value }));
    setWeather((current) =>
      current.map((record) =>
        record.date === selectedDate ? { ...record, [key]: value } : record,
      ),
    );
  }

  function updateAttachmentNote(attachmentId: string, note: string) {
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

  function discardChanges() {
    if (!bundle) return;
    setDiary(cloneDiary(bundle.diary));
    setManifest(structuredClone(bundle.manifest));
    setWeather(structuredClone(bundle.weather));
    setDirty(false);
    setModifiedDates(new Set());
  }

  function downloadCorrectedBackup() {
    if (!bundle || !diary || !manifest) return;
    try {
      const blob = exportBackup(bundle, diary, manifest, weather);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = correctedFileName(bundle.fileName);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof BackupValidationError
          ? caught.issues
          : ["The corrected backup could not be created."],
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
    setError(null);
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="https://headmondiary.com/" aria-label="Go to the Headmon website">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}headmon-icon.png`} alt="" />
          <span><strong>Headmon</strong><small>Backup Studio</small></span>
        </a>
        <div className="topbar-actions">
          <button className="theme-button" type="button" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <div className="privacy-pill"><span className="privacy-dot" aria-hidden="true" />Processed locally</div>
        </div>
      </header>

      {!bundle ? (
        <section className="welcome" id="top">
          <div className="welcome-copy">
            <p className="eyebrow">PRIVATE BACKUP TOOL</p>
            <h1>See what your diary remembers.</h1>
            <p className="welcome-intro">Open a complete Headmon backup to browse your history and correct days, episodes, medication, triggers, weather, and photo captions. Your archive never leaves this device.</p>
            <div className="trust-row" aria-label="Privacy guarantees"><span>No account</span><span>No upload</span><span>Original stays untouched</span></div>
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
            <p>Drop any dated Headmon full-backup ZIP here or choose it from your device.</p>
            <button className="primary-button" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>{loading ? "Opening…" : "Choose backup ZIP"}</button>
            <input ref={inputRef} type="file" accept=".zip,application/zip" onChange={handleFileInput} hidden />
            <small>Current prototype limit: 512 MB</small>
          </div>

          {error && (
            <div className="error-panel" role="alert">
              <strong>This file could not be opened</strong>
              {error.map((issue) => <p key={issue}>{issue}</p>)}
            </div>
          )}
        </section>
      ) : (
        <div className="viewer-layout" id="top">
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

            <div className="archive-note"><span className="privacy-dot" aria-hidden="true" /><p><strong>Still local.</strong> This archive exists only in your browser&apos;s working memory.</p></div>
            {bundle.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
            <button className="text-button" type="button" onClick={closeBackup}>Close this backup</button>
          </aside>

          <section className="entry-browser">
            <div className="browser-heading">
              <div><p className="eyebrow">DIARY CONTENTS</p><h1>Your entries</h1><p>{stats.migraineDays} migraine days · {stats.headacheOnlyDays} headache-only days</p></div>
              <label className="search-field"><span className="sr-only">Search entries</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search notes, places, triggers…" /></label>
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
                      {modifiedDates.has(selectedDay.date) && <span className="changed-badge">Modified</span>}
                    </div>

                    <section className="editor-section">
                      <div className="section-title"><h3>Day details</h3><span aria-hidden="true">☀</span></div>
                      <div className="day-detail-grid">
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
                      <div className="field-meta"><span>Kept while this ZIP remains open</span><span>{selectedDay.note.length.toLocaleString()} characters</span></div>
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
                              <figcaption><label className="control-field" htmlFor={`photo-note-${attachment.id}`}><span>Photo caption</span><input id={`photo-note-${attachment.id}`} value={attachment.note} maxLength={500} placeholder="Untitled photo" onChange={(event) => updateAttachmentNote(attachment.id, event.target.value)} /></label></figcaption>
                            </figure>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                ) : <p className="empty-editor">Select an entry to inspect it.</p>}
              </article>
            </div>
          </section>

          <footer className="save-bar">
            <div><strong>{dirty ? `${modifiedDates.size} edited ${modifiedDates.size === 1 ? "day" : "days"} in this session` : "No changes yet"}</strong>{error ? <span className="save-error">{error[0]}</span> : <span>{dirty ? "Switch days freely. Export before refreshing or closing." : "Changes stay in memory until you export a corrected ZIP."}</span>}</div>
            <div className="save-actions"><button className="secondary-button" type="button" onClick={discardChanges} disabled={!dirty}>Discard changes</button><button className="primary-button" type="button" onClick={downloadCorrectedBackup} disabled={!dirty}>Export corrected ZIP</button></div>
          </footer>
        </div>
      )}
    </main>
  );
}
