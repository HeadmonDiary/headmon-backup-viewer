# Headmon Backup Viewer

Headmon Backup Viewer is the source for the browser-based workbench published
at `https://headmondiary.com/bv/`. It opens supported Headmon backup files
locally so their contents can be inspected, repaired, compared, and exported
without sending the backup to a server.

## Privacy and security boundary

- Backup contents are read in browser memory and are never uploaded.
- The production Content Security Policy sets `connect-src 'none'`.
- The viewer has no backend, account, analytics, service worker, or durable data
  store.
- Reloading or closing the tab discards the working copy unless it is explicitly
  exported.
- The original backup is never modified; editing creates a new file.
- Attachment bytes and manifest checksums are verified before the archive is
  shown.
- Unsafe paths, duplicate entries, excessive entry counts, oversized expanded
  content, extreme compression ratios, malformed records, and unsupported
  attachment types are rejected before use.
- On load, the viewer requests deletion of the IndexedDB draft database used by
  earlier preview versions.
- The viewer refuses to run when framed by another page.

This source makes the privacy boundary reviewable. The deployed artifact and
its Content Security Policy remain the controls users actually execute, so
release documentation records the source revision and built-file hashes.

## Supported workbench operations

1. Open and validate a Headmon complete-backup v1 ZIP or portable calendar JSON.
2. Verify expected files and attachment SHA-256 checksums.
3. Browse, search, filter, and inspect entries in list and calendar views.
4. Add, remove, move, and correct days, episodes, medication, weather, notes,
   triggers, and status.
5. Edit trigger and medicine catalogues while retaining free-form choices.
6. Browse, caption, download, reassign, and remove backed-up photos.
7. Undo and redo edits, review changed dates, and discard the working copy.
8. Create formula-hardened CSV, printable HTML/PDF, and portable calendar JSON.
9. Compare two backups, add missing dates, and explicitly resolve conflicts.
10. Export a validated corrected ZIP while preserving referenced attachment bytes.

## Reproducible static build

Requirements:

- Node.js 22.13.0 or newer
- npm, using the committed `package-lock.json`

From a clean checkout:

```bash
npm ci
npm run check
```

`npm run check` lints, type-checks, runs the complete test suite, builds the
server-rendered project, audits production dependencies, and creates the static
artifact in `static-dist/`. Vite content-hashes the generated JavaScript and CSS
filenames. To record the exact output hashes:

```bash
npm run hash:static
```

The deployed copy uses the static build produced by `npm run build:static`.

## Local development

```bash
npm ci
npm run dev
```

Open the local URL printed by the development server. Use invented test data.
Never add or submit a real Headmon backup, export, private photo, medical
record, exact location, or other personal information.

## Reporting and contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Public bug
reports and feature requests belong in the main
[Headmon issue tracker](https://github.com/HeadmonDiary/headmon/issues). Report
security or privacy vulnerabilities according to [SECURITY.md](SECURITY.md).

## License

Headmon Backup Viewer is licensed under the
[GNU General Public License version 3](LICENSE). Third-party packages retain
their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
