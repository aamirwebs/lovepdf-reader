# LovePDF Reader and Editor — Windows build & release (Urdu guide)

## 1) GitHub par code daalna (ek baar)
1. github.com → **New repository** → name `lovepdf-reader` → Public → (README/gitignore add na karein) → Create.
2. Apne PC par ye folder (`lovepdf-reader`) kahin bhi rakhein, e.g. `C:\lovepdf-reader`.
3. **Windows PowerShell** (normal, admin nahi) mein — Git install (agar nahi hai):
   ```
   winget install --id Git.Git -e --source winget
   ```
   PowerShell band kar ke dobara kholein, phir:
   ```
   cd C:\lovepdf-reader
   git init
   git add .
   git commit -m "LovePDF Reader v1.0.0"
   git branch -M main
   git remote add origin https://github.com/aamirwebs/lovepdf-reader.git
   git push -u origin main
   ```
   Pehli baar browser mein GitHub login window khulegi — Authorize karein. **Expected:** `main -> main` aur 100% push.

## 2) Installer banana (GitHub khud banata hai, ~8 minute)
- Test build: repo → **Actions** → "Build Windows" → **Run workflow** → run complete hone par neeche **Artifacts → LovePDF-Reader-Setup** download.
- Public release (auto-update ke liye zaroori): repo → **Releases** → **Draft a new release** → Tag: `v1.0.0` (package.json ki version se match) → Title `LovePDF Reader 1.0.0` → **Publish release** → Actions build chalega aur release mein `LovePDF-Reader-Setup.exe` + `latest.yml` lag jayengi.

## 3) Website par link
adminweb → Settings → **Mobile app** → "Windows app download URL":
`https://github.com/aamirwebs/lovepdf-reader/releases/latest/download/LovePDF-Reader-Setup.exe`
→ Save. Page: `https://www.lovepdf.me/windows` (footer mein bhi link).

## 4) Nayi version release karna
`package.json` mein `"version"` barhayen (e.g. 1.0.1) → commit + push → Releases → new release tag `v1.0.1` → Publish. Installed apps ko khud "update available" dikhega.

## Notes
- Pehli baar Windows SmartScreen "unknown publisher" dikhayega (More info → Run anyway). Hatane ke liye code-signing certificate chahiye (optional, ~$200–400/saal).
- Installer `.pdf` ko register karta hai; Windows 10/11 mein user ko Settings → Default apps mein LovePDF chunna hota hai (app ke Settings mein button hai).
