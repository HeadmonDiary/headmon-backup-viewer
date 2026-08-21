# Headmon Backup Viewer

Private prototype for a browser-based viewer and editor for Headmon full-backup
exports.

## Privacy boundary

- Backup contents are read in browser memory and are never uploaded.
- Editing produces a new corrected ZIP; the original remains untouched.
- Photo bytes are verified against the manifest before the archive is shown.
- The included example and any personal backup files stay outside Git.
- The viewer has no backend, account, analytics, service worker, or durable data
  store. Reloading or closing the tab discards the working copy unless it is
  explicitly exported.
- On load, the viewer requests deletion of the IndexedDB draft database used by
  earlier preview versions.

## Current workbench

1. Open and validate a Headmon complete-backup v1 ZIP or portable calendar JSON.
2. Verify the expected files and attachment SHA-256 checksums.
3. Reject unsafe paths, excessive entry counts, oversized expanded content,
   extreme compression ratios, and malformed or over-quota records before use.
4. Browse, search, filter, and inspect entries in list and calendar views.
5. Add, remove, move, and correct days, episodes, medication, weather, notes,
   triggers, and status.
6. Edit trigger and medicine catalogues while retaining free-form choices.
7. Browse, caption, download, reassign, and remove backed-up photos.
8. Undo and redo edits, review changed dates, and discard the working copy.
9. Create formula-hardened CSV, printable HTML/PDF, and portable calendar JSON.
10. Compare two backups, add missing dates, and explicitly resolve conflicts.
11. Export a validated corrected ZIP while preserving referenced attachment bytes.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then choose a Headmon full-backup ZIP from your
device. Do not add real backup archives to this repository.
