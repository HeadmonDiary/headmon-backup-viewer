# Headmon Backup Viewer

Private prototype for a browser-based viewer and editor for Headmon backup
exports.

## Product constraints

- Backup contents stay on the user's device.
- The application must not upload backup data.
- Editing produces a new corrected ZIP; the original remains untouched.
- Unknown files and metadata should survive a read/edit/write round trip.
- The viewer should be deployable as a static site without a backend.

## MVP scope

1. Open a Headmon backup ZIP in the browser.
2. Validate and summarize its contents.
3. Browse and search diary entries.
4. Edit supported fields.
5. Export a validated corrected ZIP.

This repository is private while the format and user experience are being
tested. A public version may later become part of `headmondiary.com`.
