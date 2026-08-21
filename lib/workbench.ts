import type { BackupBundle, BackupDay, PortableDiary } from "./backup";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  // Spreadsheet programs may ignore leading whitespace or control characters
  // before interpreting a formula. Prefix every such value as literal text.
  const formulaSafe = /^[\u0000-\u0020]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(text)
    ? `'${text}`
    : text;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

function episodeLabel(day: BackupDay): string {
  if (day.episodes.some((episode) => episode.isMigraine)) return "Migraine";
  if (day.episodes.some((episode) => episode.isAuraOnly)) return "Aura only";
  if (day.episodes.length > 0 || day.hadHeadache) return "Headache";
  if (day.isSkipped) return "Skipped";
  return "Pain-free";
}

export function backupCsv(days: BackupDay[]): string {
  const rows = [[
    "Date",
    "Status",
    "Episodes",
    "Peak pain",
    "Migraine intensity",
    "Stress",
    "Medication",
    "Triggers",
    "Location",
    "Weather",
    "Day note",
    "Episode notes",
  ]];

  for (const day of [...days].sort((left, right) => left.date.localeCompare(right.date))) {
    rows.push([
      day.date,
      episodeLabel(day),
      String(day.episodes.length),
      String(Math.max(0, ...day.episodes.map((episode) => episode.peakPainLevel))),
      String(Math.max(0, ...day.episodes.map((episode) => episode.migraineIntensity))),
      day.stressLevel == null ? "" : String(day.stressLevel),
      day.medications.map((medication) => `${medication.name}${medication.doseMg == null ? "" : ` ${medication.doseMg} mg`}`).join("; "),
      [...new Set([...day.triggers, ...day.episodes.flatMap((episode) => episode.triggers)])].join("; "),
      day.locationName,
      day.weatherCondition,
      day.note,
      day.episodes.map((episode) => episode.note).filter(Boolean).join(" | "),
    ]);
  }

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function backupReportHtml(days: BackupDay[], title = "Headmon backup report"): string {
  const sorted = [...days].sort((left, right) => left.date.localeCompare(right.date));
  const episodeCount = sorted.reduce((sum, day) => sum + day.episodes.length, 0);
  const migraineDays = sorted.filter((day) => day.episodes.some((episode) => episode.isMigraine)).length;
  const rows = sorted.map((day) => `
    <tr>
      <td>${escapeHtml(day.date)}</td>
      <td>${escapeHtml(episodeLabel(day))}</td>
      <td>${day.episodes.length}</td>
      <td>${escapeHtml(day.stressLevel ?? "—")}</td>
      <td>${escapeHtml(day.medications.map((item) => item.name).join(", ") || "—")}</td>
      <td>${escapeHtml([...new Set([...day.triggers, ...day.episodes.flatMap((item) => item.triggers)])].join(", ") || "—")}</td>
      <td>${escapeHtml(day.note || day.episodes.map((item) => item.note).filter(Boolean).join(" · ") || "—")}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title>
<style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#152522;margin:2rem}h1{font-size:2rem}p{color:#526662}.summary{display:flex;gap:1rem;flex-wrap:wrap;margin:1.5rem 0}.summary strong{display:block;font-size:1.6rem}.summary div{border:1px solid #cbd9d5;border-radius:12px;padding:.8rem 1rem}table{width:100%;border-collapse:collapse}th,td{padding:.55rem;text-align:left;vertical-align:top;border-bottom:1px solid #dce6e3}th{font-size:.75rem;text-transform:uppercase;color:#526662}@media print{body{margin:.5in}.no-print{display:none}}
</style></head><body>
<h1>${escapeHtml(title)}</h1><p>Generated locally from a Headmon backup. This report may contain sensitive health information.</p>
<div class="summary"><div><strong>${sorted.length}</strong>days</div><div><strong>${episodeCount}</strong>episodes</div><div><strong>${migraineDays}</strong>migraine days</div></div>
<p class="no-print">Use your browser’s Print command to print or save this report as a PDF.</p>
<table><thead><tr><th>Date</th><th>Status</th><th>Episodes</th><th>Stress</th><th>Medication</th><th>Triggers</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

export interface BackupComparison {
  missingDates: string[];
  conflictingDates: string[];
  matchingDates: string[];
}

export function compareDiaries(current: PortableDiary, incoming: PortableDiary): BackupComparison {
  const currentByDate = new Map(current.days.map((day) => [day.date, day]));
  const missingDates: string[] = [];
  const conflictingDates: string[] = [];
  const matchingDates: string[] = [];
  for (const day of incoming.days) {
    const existing = currentByDate.get(day.date);
    if (!existing) missingDates.push(day.date);
    else if (JSON.stringify(existing) === JSON.stringify(day)) matchingDates.push(day.date);
    else conflictingDates.push(day.date);
  }
  const descending = (left: string, right: string) => right.localeCompare(left);
  return {
    missingDates: missingDates.sort(descending),
    conflictingDates: conflictingDates.sort(descending),
    matchingDates: matchingDates.sort(descending),
  };
}

export function bundleLabel(bundle: BackupBundle): string {
  return `${bundle.manifest.sourcePlatform.toUpperCase()} · ${bundle.diary.days.length} days · ${new Date(bundle.manifest.exportedAtEpochMillis).toLocaleDateString()}`;
}
