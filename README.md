# LovePDF Reader and Editor (Windows)

Free, fast PDF reader + editor by [LovePDF.me](https://www.lovepdf.me). Everything runs on your PC; online tools (convert, OCR, compress, translate) use the LovePDF.me API.

**Features:** tabs, thumbnails, bookmarks, search, zoom/rotate, print · Edit: add/edit text, draw, highlight, shapes, arrows, whiteout, images, signature, sticky notes · Pages: organize (drag/rotate/delete/insert), merge, split, extract, blank page, rotate all · Watermark, page numbers, crop · Convert to Word/Excel/PowerPoint/JPG, compress, OCR, protect, translate (online) · English + Urdu UI, dark mode, auto-update, opens .pdf files from Windows (default app).

## Build
GitHub Actions builds the installer: **Actions → Build Windows → Run workflow** (artifact) or publish a **Release** with a tag like `v1.0.1` (installer + `latest.yml` are attached; the app auto-updates from releases).

Local build (needs Node 20): `npm install` then `npm run dist` → `dist/LovePDF-Reader-Setup.exe`.

Download link for the website: `https://github.com/aamirwebs/lovepdf-reader/releases/latest/download/LovePDF-Reader-Setup.exe`

## Structure
- `src/main/` — Electron main process (window, app:// protocol, dialogs, recent files, settings, print, auto-update)
- `src/renderer/` — UI (vanilla JS modules): `app.js` shell, `viewer.js`, `editor.js`, `tools.js`, `i18n.js`
- `vendor/` — pdf.js + pdf-lib (self-hosted)
- `dev/server.mjs` — serves the UI in a normal browser for testing (`node dev/server.mjs` → http://127.0.0.1:4300)
