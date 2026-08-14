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

function statusFor(day: BackupDay): { label: string; tone: string } {
  if (day.isSkipped) return { label: "Skipped", tone: "neutral" };
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

  const stats = useMemo(() => {
    const days = diary?.days ?? [];
    return {
      days: days.length,
      headacheDays: days.filter((day) => day.hadHeadache).length,
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
      days: diary.days.map((day) => (day.date === selectedDate ? updater(day) : day)),
    });
    setDirty(true);
  }

  function discardChanges() {
    if (!bundle) return;
    setDiary(cloneDiary(bundle.diary));
    setDirty(false);
  }

  function downloadCorrectedBackup() {
    if (!bundle || !diary) return;
    const blob = exportBackup(bundle, diary);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = correctedFileName(bundle.fileName);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function closeBackup() {
    setBundle(null);
    setDiary(null);
    setSelectedDate(null);
    setDirty(false);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Headmon Backup Studio home">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span><strong>Headmon</strong><small>Backup Studio</small></span>
        </a>
        <div className="privacy-pill"><span className="privacy-dot" aria-hidden="true" />Processed locally</div>
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
              <div><p className="eyebrow">DIARY CONTENTS</p><h1>Your entries</h1><p>{stats.headacheDays} headache days across this backup</p></div>
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
                      <span className="entry-row-copy"><strong>{formatDate(day.date)}</strong><span>{day.note || day.locationName || status.label}</span></span>
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
                      <textarea id="day-note" value={selectedDay.note} maxLength={20_000} placeholder="No note for this day" onChange={(event) => updateDay((day) => ({ ...day, note: event.target.value }))} />
                      <div className="field-meta"><span>Saved only when you export a new ZIP</span><span>{selectedDay.note.length.toLocaleString()} characters</span></div>
                    </section>

                    {selectedDay.episodes.length > 0 && (
                      <section className="editor-section">
                        <div className="section-title"><h3>Episodes</h3><span>{selectedDay.episodes.length}</span></div>
                        <div className="episode-stack">
                          {selectedDay.episodes.map((episode, episodeIndex) => (
                            <div className="episode-card" key={episode.id}>
                              <div className="episode-summary"><strong>{formatTime(episode.startTimeEpochMillis)}–{formatTime(episode.endTimeEpochMillis)}</strong><span>Peak pain {episode.peakPainLevel}/10{episode.isMigraine ? " · Migraine" : ""}</span></div>
                              {episode.triggers.length > 0 && <div className="tag-row">{episode.triggers.map((trigger) => <span key={trigger}>{trigger}</span>)}</div>}
                              <label className="field-label" htmlFor={`episode-note-${episode.id}`}>Episode note</label>
                              <textarea
                                id={`episode-note-${episode.id}`}
                                className="episode-note"
                                value={episode.note}
                                maxLength={20_000}
                                placeholder="No note for this episode"
                                onChange={(event) => updateDay((day) => ({
                                  ...day,
                                  episodes: day.episodes.map((item, index) => index === episodeIndex ? { ...item, note: event.target.value } : item),
                                }))}
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
            <div><strong>{dirty ? "You have unsaved corrections" : "No changes yet"}</strong><span>The original ZIP will never be overwritten.</span></div>
            <div className="save-actions"><button className="secondary-button" type="button" onClick={discardChanges} disabled={!dirty}>Discard changes</button><button className="primary-button" type="button" onClick={downloadCorrectedBackup} disabled={!dirty}>Export corrected ZIP</button></div>
          </footer>
        </div>
      )}
    </main>
  );
}
