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

## 5) v1.2.0 — kya naya hai
- **Set as default fix**: installer ab Windows ko "LovePDF Reader" naam se register karta hai (`build/installer.nsh`): Settings ▸ Apps ▸ Default apps ki list mein **LovePDF Reader** alag entry, "Open with" mein bhi ab naam dikhta hai (pehle lamba description dikhta tha). App ka "Set as default" button seedha us page par le jata hai — wahan `.pdf` par click karke LovePDF Reader chunein.
  - Purana v1.1 install hai to **pehle uninstall karein** (Settings ▸ Apps ▸ LovePDF Reader and Editor ▸ Uninstall), phir v1.2.0 install karein — tab hi registry entries sahi banti hain.
- **Rotate button fix**: dropdown toolbar ke `overflow:hidden` mein chhup jata tha — ab sab menus (Rotate, menubar, right-click) ek alag layer mein khulte hain.
- **Adobe-style header**: upar menubar (File · Edit · View · Page · Tools · Help, Alt+F / Alt+E…), neeche toolbar; Sign in button; Help ▸ Keyboard shortcuts.
- **Right-click page menu** (left sidebar thumbnails, aur page par bhi): Insert pages (blank / PDF / images), Extract, Replace, Duplicate, Rotate, Crop, Move, Copy/Save as image, Properties, Delete. Thumbnails mein Ctrl/Shift se multi-select, drag se reorder, Delete key.
- **Scanned PDF edit**: Edit ▸ Edit text par agar page image hai to neeli bar aati hai — "Make this page editable" (sirf wo page server par OCR hota hai, baqi file waisi rehti hai) ya "Whole document". Phir text par click karke edit.
- **Ads / promo / limits** sab **adminweb → Windows app** page se (section 6).

## 6) adminweb → Windows app (promo, banners, AdSense, limits, notice)
Website zip **v3.3.0** install karne ke baad admin sidebar mein naya page **Windows app**:
- **Status & notice**: Latest version (users ko 'update available' dikhega), Notice text (app ke Home + top bar mein pill).
- **What to show**: guests / free / paid ke liye on-off; apne promo cards (built-in + apni lines: `Title | Text | link | image | button | icon`); teen sources ka % mix (promo / banners / AdSense).
- **Banners**: Ads & Banners → New banner → position **win_home / win_side / win_bottom / win_inter** (direct advertisers).
- **Where & how often**: Home card, sidebar, bottom strip (✕ closable), interstitial har N actions + min minutes + per-day max + skip seconds; pehle N seconds koi ad nahi; rotation interval.
- **Free edit limits**: guest / free / paid per-day edited-PDF saves (0 = unlimited — launch ke liye sab 0 rakhein, sirf ads) aur limit par kya ho (ad / login / upgrade).
- **AdSense (default OFF)**: ⚠️ AdSense policy desktop software mein ads allow nahi karti (apps ke liye AdMob hai) — on karne se poora AdSense account risk mein aa sakta hai. Apne promo + direct banners + Pro promo safe hain.
- Stats isi page par: Windows PCs, opens, impressions/clicks per slot, versions, daily usage.

## 7) v1.3.0 — kya naya hai
- **Edit text ka white box**: ab cover ka rang page se sample hota hai (blue header cell → blue cover, white text → white rehta hai); screen par koi grey border nahi.
- **Logo / tasveer / koi bhi element move ya remove**: Edit text mode mein logo/picture par click → wo object ban jata hai (drag, resize, Delete). Naya tool **Move / remove area** (✂): page ke kisi bhi hisse ke gird box banayen → object ban jata hai — scanned pages par bhi kaam karta hai.
- **Ads**: AdSense hata diya (policy risk). Banners ab 100% dikhte hain (image URL fix) — slots: **Top strip** (toolbar ke neeche), Home card, Sidebar, Bottom strip, Interstitial. "Banners first" ON = jahan banner hai wahan promo nahi.
- **After save → website**: edited PDF save hone par browser mein aapki site khulti hai (adminweb → Windows app → card 4: URL, har N saves, per-day max).
- **Video**: app start ya close par aapki video (YouTube ya .mp4) — adminweb card 5.
- Help menu: Help & how to (`/windows/help`), Contact (`/contact-us` fix), Android/iOS app links jab Settings → Mobile app mein URL ho; About mein Soft Technologies (www.soft.com.pk).
- Website v3.4.0 zaroori hai (config ka naya format).

## Notes
- Pehli baar Windows SmartScreen "unknown publisher" dikhayega (More info → Run anyway). Hatane ke liye code-signing certificate chahiye (optional, ~$200–400/saal).
- Installer `.pdf` ko register karta hai; Windows 10/11 mein user ko Settings → Default apps mein LovePDF Reader chunna hota hai (app ke Settings / Help menu mein button hai).
