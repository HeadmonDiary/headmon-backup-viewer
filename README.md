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
3. Browse and search diary entries with distinct migraine, headache, aura-only,
   skipped, and headache-free states.
4. Inspect day-level weather, medication records, and locally loaded photos.
5. Edit day notes and full episode details, including times, intensity,
   classification, symptoms, triggers, and notes.
6. Switch between Headmon's dark and light visual themes.
7. Export a validated, corrected, uncompressed ZIP that preserves the
   remaining files.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then choose a Headmon full-backup ZIP from your
device. Do not add real backup archives to this repository.
