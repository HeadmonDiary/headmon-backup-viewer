# Headmon Backup Viewer

Private prototype for a browser-based viewer and editor for Headmon full-backup
exports.

## Privacy boundary

- Backup contents are read in browser memory and are never uploaded.
- Editing produces a new corrected ZIP; the original remains untouched.
- Photo bytes are verified against the manifest before the archive is shown.
- The included example and any personal backup files stay outside Git.
- The viewer has no backend, account, analytics, or durable data store.

## Current MVP

1. Open and validate a Headmon full-backup v1 ZIP.
2. Verify the expected files and attachment SHA-256 checksums.
3. Browse and search diary entries.
4. Inspect episodes, medication records, and locally loaded photos.
5. Edit day and episode notes.
6. Export a corrected, uncompressed ZIP that preserves the remaining files.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then choose a Headmon full-backup ZIP from your
device. Do not add real backup archives to this repository.
