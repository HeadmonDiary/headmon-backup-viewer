# Contributing

Contributions that improve the viewer's safety, accessibility, backup-format
compatibility, or clarity are welcome.

## Privacy rules

Never open, attach, commit, paste, upload, or submit a real Headmon backup,
export, diary entry, private photo, medical document, exact location, or other
personal information. Tests and bug reports must use minimal invented data.
Generated fixtures must not be derived from a real person's diary.

Public reports belong in the main
[Headmon issue tracker](https://github.com/HeadmonDiary/headmon/issues), whose
templates require a privacy check. Security reports follow
[SECURITY.md](SECURITY.md).

## Development checks

Use Node.js 22.13.0 or newer and install exactly from the lockfile:

```bash
npm ci
npm run check
```

Keep changes focused. New parsing or export behavior should include tests for
both valid input and hostile or malformed input. Do not weaken file-count,
expanded-size, compression-ratio, path, schema, attachment-type, or checksum
validation without a documented security reason.

By contributing, you agree that your contribution is licensed under GPL-3.0.
