# LovePDF Reader and Editor (Windows)

Free, fast PDF reader + editor by [LovePDF.me](https://www.lovepdf.me). Everything runs on your PC; online tools (convert, OCR, compress, translate) use the LovePDF.me API.

**Features:** Acrobat-style menubar (File · Edit · View · Page · Tools · Help) + toolbar, tabs, thumbnails with multi-select / drag-reorder / right-click page menu (insert, extract, replace, duplicate, rotate, crop, move, delete, save as image), bookmarks, search, zoom/rotate, print · Edit: add/edit text, draw, highlight, shapes, arrows, whiteout, images, signature, sticky notes, object right-click menu · Scanned PDFs: one-click OCR (page or whole file) → editable text · Pages: organize, merge, split, extract, blank page, rotate all · Watermark, page numbers, visual crop · Convert to Word/Excel/PowerPoint/JPG, compress, OCR, protect, translate (online) · English + Urdu UI, dark mode, auto-update, registered as a Windows default-app candidate for .pdf · Promo / banner / (optional) AdSense slots, interstitials, notices and free-edit limits controlled from adminweb.lovepdf.me → Windows app.

## Build
GitHub Actions builds the installer: **Actions → Build Windows → Run workflow** (artifact) or publish a **Release** with a tag like `v1.0.1` (installer + `latest.yml` are attached; the app auto-updates from releases).

Local build (needs Node 20): `npm install` then `npm run dist` → `dist/LovePDF-Reader-Setup.exe`.

Download link for the website: `https://github.com/aamirwebs/lovepdf-reader/releases/latest/download/LovePDF-Reader-Setup.exe`

## Structure
- `src/main/` — Electron main process (window, app:// protocol, dialogs, recent files, settings, print, auto-update)
- `src/renderer/` — UI (vanilla JS modules): `app.js` shell + menus, `viewer.js`, `editor.js`, `tools.js` (page ops, OCR-to-edit, online tools), `menu.js` (popup menus), `ads.js` (remote-configured promo/ads/limits), `i18n.js`
- `build/installer.nsh` — extra NSIS steps: ProgID `LovePDF.Reader.pdf`, `RegisteredApplications` capabilities ("LovePDF Reader" in Settings ▸ Default apps), FriendlyAppName for "Open with"
- `vendor/` — pdf.js + pdf-lib (self-hosted)
- `dev/server.mjs` — serves the UI in a normal browser for testing (`node dev/server.mjs` → http://127.0.0.1:4300)
