"use client";

import {
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
  type PortableDiary,
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [bundle, setBundle] = useState<BackupBundle | null>(null);
  const [diary, setDiary] = useState<PortableDiary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

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
    () => bundle?.manifest.attachments.filter((attachment) => attachment.date === selectedDate) ?? [],
    [bundle, selectedDate],
  );
  const selectedWeather = useMemo(() => {
    if (!selectedDay) return null;
    const history = bundle?.weather.find((record) => record.date === selectedDay.date);
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
  }, [bundle, selectedDay]);
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
      photos: bundle?.manifest.attachments.length ?? 0,
      weather: bundle?.weather.length ?? 0,
    };
  }, [bundle, diary]);

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
      setSelectedDate(newestDate);
      setSearch("");
      setDirty(false);
    } catch (caught) {
      setBundle(null);
      setDiary(null);
      setSelectedDate(null);
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

  function discardChanges() {
    if (!bundle) return;
    setDiary(cloneDiary(bundle.diary));
    setDirty(false);
  }

  function downloadCorrectedBackup() {
    if (!bundle || !diary) return;
    try {
      const blob = exportBackup(bundle, diary);
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
    setSelectedDate(null);
    setDirty(false);
    setError(null);
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Headmon Backup Studio home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/headmon-icon.png" alt="" />
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
            <p className="welcome-intro">Open a complete Headmon backup to browse your history, inspect photos, and correct written notes. Your archive never leaves this device.</p>
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
            <p>Drop <code>headmon_full_backup.zip</code> here or choose it from your device.</p>
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

            <div className="entries-and-editor">
              <nav className="entry-list" aria-label="Diary entries">
                <div className="entry-list-count">{filteredDays.length} entries</div>
                {filteredDays.map((day) => {
                  const status = statusFor(day);
                  return (
                    <button className={`entry-row${day.date === selectedDate ? " is-selected" : ""}`} key={day.date} type="button" onClick={() => setSelectedDate(day.date)}>
                      <span className={`status-mark ${status.tone}`} aria-hidden="true" />
                      <span className="entry-row-copy"><strong>{formatDate(day.date)}</strong><span>{status.label}{day.locationName ? ` · ${day.locationName}` : day.note ? ` · ${day.note}` : ""}</span></span>
                      <span className="episode-count">{day.episodes.length || "—"}</span>
                    </button>
                  );
                })}
                {filteredDays.length === 0 && <p className="empty-list">No entries match that search.</p>}
              </nav>

              <article className="entry-editor">
                {selectedDay ? (
                  <>
                    <div className="editor-heading">
                      <div>
                        <div className="date-and-status"><h2>{formatDate(selectedDay.date)}</h2><span className={`status-badge ${statusFor(selectedDay).tone}`}>{statusFor(selectedDay).label}</span></div>
                        <p>{selectedDay.locationName || "No location"}{selectedDay.stressLevel != null ? ` · Stress ${selectedDay.stressLevel}/5` : ""}</p>
                      </div>
                      {dirty && <span className="changed-badge">Modified</span>}
                    </div>

                    <section className="editor-section">
                      <label className="field-label" htmlFor="day-note">Day note</label>
                      <textarea id="day-note" value={selectedDay.note} maxLength={10_000} placeholder="No note for this day" onChange={(event) => updateDay((day) => ({ ...day, note: event.target.value }))} />
                      <div className="field-meta"><span>Saved only when you export a new ZIP</span><span>{selectedDay.note.length.toLocaleString()} characters</span></div>
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
                    </section>

                    {selectedDay.episodes.length > 0 && (
                      <section className="editor-section">
                        <div className="section-title"><h3>Episodes</h3><span>{selectedDay.episodes.length}</span></div>
                        <div className="episode-stack">
                          {selectedDay.episodes.map((episode, episodeIndex) => (
                            <div className="episode-card" key={episode.id}>
                              <div className="episode-summary">
                                <strong>{episode.isAuraOnly ? "Aura only" : episode.isMigraine ? "Migraine" : "Headache"}</strong>
                                <span>{formatTime(episode.startTimeEpochMillis)}–{formatTime(episode.endTimeEpochMillis)}</span>
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

                              <label className="control-field trigger-field" htmlFor={`episode-triggers-${episode.id}`}><span>Triggers</span><input id={`episode-triggers-${episode.id}`} type="text" value={episode.triggers.join(", ")} placeholder="Stress, sleep, weather…" onChange={(event) => updateEpisode(episodeIndex, (item) => ({ ...item, triggers: [...new Set(event.target.value.split(",").map((value) => value.trim()).filter(Boolean))] }))} /></label>
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
                    )}

                    {selectedDay.medications.length > 0 && (
                      <section className="editor-section">
                        <div className="section-title"><h3>Medication</h3><span>{selectedDay.medications.length}</span></div>
                        <div className="medication-list">
                          {selectedDay.medications.map((medication) => (
                            <div key={medication.id}><strong>{medication.name}</strong><span>{medication.doseMg != null ? `${medication.doseMg} mg` : "Dose not recorded"}{medication.takenAtEpochMillis ? ` · ${formatTime(medication.takenAtEpochMillis)}` : ""}</span></div>
                          ))}
                        </div>
                      </section>
                    )}

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
                              <figcaption>{attachment.note || "Untitled photo"}</figcaption>
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
            <div><strong>{dirty ? "You have unsaved corrections" : "No changes yet"}</strong>{error ? <span className="save-error">{error[0]}</span> : <span>The original ZIP will never be overwritten.</span>}</div>
            <div className="save-actions"><button className="secondary-button" type="button" onClick={discardChanges} disabled={!dirty}>Discard changes</button><button className="primary-button" type="button" onClick={downloadCorrectedBackup} disabled={!dirty}>Export corrected ZIP</button></div>
          </footer>
        </div>
      )}
    </main>
  );
}
