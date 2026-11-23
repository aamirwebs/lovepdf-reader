// Acrobat-style print dialog: printer, copies, pages, sizing (fit / actual / scale), pages per sheet, orientation,
// grayscale, duplex — with a live preview. Pages are rendered to images and sent silently to the chosen printer.
import { $, $$, esc, modal, closeModal, toast, status, parsePages, bridge } from "./util.js";
import { t } from "./i18n.js";

const PAPER = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420], a5: [148, 210] };
const opt = (v, l, sel) => `<option value="${v}"${sel === v ? " selected" : ""}>${esc(l)}</option>`;

export async function printDialog(app) {
  const d = app.cur; if (!d) return; const b = bridge();
  const prefs = Object.assign({ printer: "", paper: "a4", sizing: "fit", scale: 100, perSheet: 1, orient: "auto", gray: false, duplex: "none", copies: 1, pages: "all" }, app.settings.printPrefs || {});
  let printers = []; try { printers = b && b.printers ? await b.printers() : []; } catch {}
  if (prefs.printer && !printers.some((p) => p.name === prefs.printer)) prefs.printer = "";
  if (!prefs.printer) { const def = printers.find((p) => p.isDefault); if (def) prefs.printer = def.name; }
  const total = d.numPages; let preview = Math.max(1, d.current || 1);
  const html = `<div class="print-dlg">
    <div class="print-opts">
      <label>${esc(t("print_.printer"))}<select id="prPrinter">${printers.length ? printers.map((p) => opt(p.name, p.displayName || p.name, prefs.printer)).join("") : `<option value="">${esc(t("print_.systemDialog"))}</option>`}</select></label>
      <div class="row2"><label>${esc(t("print_.copies"))}<input type="number" id="prCopies" min="1" max="99" value="${prefs.copies}"></label>
      <label>${esc(t("print_.paper"))}<select id="prPaper">${opt("a4", "A4", prefs.paper)}${opt("letter", "Letter", prefs.paper)}${opt("legal", "Legal", prefs.paper)}${opt("a3", "A3", prefs.paper)}${opt("a5", "A5", prefs.paper)}</select></label></div>
      <fieldset><legend>${esc(t("print_.pages"))}</legend>
        <label class="inl"><input type="radio" name="prPages" value="all"${prefs.pages === "all" ? " checked" : ""}> ${esc(t("print_.all"))} (${total})</label>
        <label class="inl"><input type="radio" name="prPages" value="current"> ${esc(t("print_.current"))}</label>
        <label class="inl"><input type="radio" name="prPages" value="range"> ${esc(t("print_.range"))} <input type="text" id="prRange" placeholder="1-3, 5" style="width:110px"></label>
      </fieldset>
      <fieldset><legend>${esc(t("print_.sizing"))}</legend>
        <label class="inl"><input type="radio" name="prSizing" value="fit"${prefs.sizing === "fit" ? " checked" : ""}> ${esc(t("print_.fit"))}</label>
        <label class="inl"><input type="radio" name="prSizing" value="actual"${prefs.sizing === "actual" ? " checked" : ""}> ${esc(t("print_.actual"))}</label>
        <label class="inl"><input type="radio" name="prSizing" value="scale"${prefs.sizing === "scale" ? " checked" : ""}> ${esc(t("print_.scale"))} <input type="number" id="prScale" min="10" max="400" value="${prefs.scale}" style="width:70px"> %</label>
        <label class="inl">${esc(t("print_.perSheet"))} <select id="prPerSheet">${[1, 2, 4, 6, 9].map((n) => opt(String(n), String(n), String(prefs.perSheet))).join("")}</select></label>
      </fieldset>
      <fieldset><legend>${esc(t("print_.orientation"))}</legend>
        <label class="inl"><input type="radio" name="prOrient" value="auto"${prefs.orient === "auto" ? " checked" : ""}> ${esc(t("print_.auto"))}</label>
        <label class="inl"><input type="radio" name="prOrient" value="portrait"${prefs.orient === "portrait" ? " checked" : ""}> ${esc(t("print_.portrait"))}</label>
        <label class="inl"><input type="radio" name="prOrient" value="landscape"${prefs.orient === "landscape" ? " checked" : ""}> ${esc(t("print_.landscape"))}</label>
      </fieldset>
      <div class="row2"><label class="inl"><input type="checkbox" id="prGray"${prefs.gray ? " checked" : ""}> ${esc(t("print_.gray"))}</label>
      <label>${esc(t("print_.duplex"))}<select id="prDuplex">${opt("none", t("print_.oneSide"), prefs.duplex)}${opt("longEdge", t("print_.longEdge"), prefs.duplex)}${opt("shortEdge", t("print_.shortEdge"), prefs.duplex)}</select></label></div>
      <div class="row end"><button class="btn" id="prCancel">${esc(t("cancel"))}</button><button class="btn" id="prPdf" title="${esc(t("print_.savePdfHint"))}">${esc(t("print_.savePdf"))}</button><button class="btn btn-primary" id="prGo">🖨 ${esc(t("print"))}</button></div>
    </div>
    <div class="print-prev"><div class="paper" id="prPaperBox"><canvas id="prCanvas"></canvas></div>
      <div class="prev-nav"><button class="btn btn-sm" id="prPrev">‹</button><span id="prPos"></span><button class="btn btn-sm" id="prNext">›</button></div></div>
  </div>`;
  const body = modal(t("print"), html, { size: "lg" });
  const val = () => ({
    printer: $("#prPrinter", body).value, copies: Math.max(1, Math.min(99, +$("#prCopies", body).value || 1)), paper: $("#prPaper", body).value,
    pages: body.querySelector("input[name=prPages]:checked").value, range: $("#prRange", body).value, sizing: body.querySelector("input[name=prSizing]:checked").value, scale: Math.max(10, Math.min(400, +$("#prScale", body).value || 100)),
    perSheet: +$("#prPerSheet", body).value || 1, orient: body.querySelector("input[name=prOrient]:checked").value, gray: $("#prGray", body).checked, duplex: $("#prDuplex", body).value,
  });
  const pageList = (v) => v.pages === "current" ? [Math.max(1, d.current || 1)] : v.pages === "range" ? parsePages(v.range, total) : Array.from({ length: total }, (_, i) => i + 1);
  const landscapeFor = (v, p) => v.orient === "landscape" ? true : v.orient === "portrait" ? false : (() => { const pg = d.pages[p - 1]; const rot = ((pg.base.page.rotate + d.rotation) % 180) !== 0; const w = rot ? pg.base.h : pg.base.w, h = rot ? pg.base.w : pg.base.h; return w > h; })();
  /** Draw page `n` as it will appear on paper into a canvas of paper aspect. */
  async function drawPreview() {
    const v = val(); const list = pageList(v); if (!list.length) return; if (!list.includes(preview)) preview = list[0];
    const cellsN = v.perSheet; $("#prPos", body).textContent = t("print_.pageOf", { n: Math.floor(list.indexOf(preview) / cellsN) + 1, total: Math.ceil(list.length / cellsN) });
    const land = landscapeFor(v, preview); const [pw0, ph0] = PAPER[v.paper] || PAPER.a4; const pw = land ? ph0 : pw0, ph = land ? pw0 : ph0;
    const box = $("#prPaperBox", body); const maxW = box.clientWidth - 16, maxH = box.clientHeight - 16; const k = Math.min(maxW / pw, maxH / ph);
    const c = $("#prCanvas", body); c.width = Math.round(pw * k * 2); c.height = Math.round(ph * k * 2); c.style.width = Math.round(pw * k) + "px"; c.style.height = Math.round(ph * k) + "px";
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    const pg = d.pages[preview - 1]; const vp1 = pg.base.page.getViewport({ scale: 1, rotation: (pg.base.page.rotate + d.rotation) % 360 });
    const pageWmm = vp1.width / 72 * 25.4, pageHmm = vp1.height / 72 * 25.4; const margin = 6; // mm
    let scale = v.sizing === "fit" ? Math.min((pw - 2 * margin) / pageWmm, (ph - 2 * margin) / pageHmm) : v.sizing === "actual" ? 1 : v.scale / 100;
    const cells = v.perSheet; const cols = cells === 1 ? 1 : cells === 2 ? (land ? 2 : 1) : cells === 4 ? 2 : cells === 6 ? (land ? 3 : 2) : 3; const rows = Math.ceil(cells / cols);
    const cellW = pw / cols, cellH = ph / rows; if (cells > 1) scale = Math.min((cellW - 2 * margin) / pageWmm, (cellH - 2 * margin) / pageHmm);
    const px = (mm) => mm * k * 2;
    const idx = list.indexOf(preview); const first = idx - (idx % cells);
    for (let i = 0; i < cells; i++) {
      const n = list[first + i]; if (!n) break; const p = d.pages[n - 1]; const vp = p.base.page.getViewport({ scale: px(scale * 25.4 / 72), rotation: (p.base.page.rotate + d.rotation) % 360 });
      const col = i % cols, row = Math.floor(i / cols); const cx = px(col * cellW + cellW / 2), cy = px(row * cellH + cellH / 2);
      const tmp = document.createElement("canvas"); tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
      try { await p.base.page.render({ canvasContext: tmp.getContext("2d", { alpha: false }), viewport: vp }).promise; } catch { continue; }
      ctx.save(); if (v.gray) ctx.filter = "grayscale(1)"; ctx.drawImage(tmp, Math.round(cx - vp.width / 2), Math.round(cy - vp.height / 2)); ctx.restore();
      if (cells > 1) { ctx.strokeStyle = "#ddd"; ctx.strokeRect(px(col * cellW), px(row * cellH), px(cellW), px(cellH)); }
    }
  }
  const refresh = () => { drawPreview().catch(() => {}); };
  $$("input,select", body).forEach((x) => { x.addEventListener("change", refresh); x.addEventListener("input", refresh); });
  $("#prRange", body).addEventListener("focus", () => { body.querySelector("input[name=prPages][value=range]").checked = true; refresh(); });
  $("#prScale", body).addEventListener("focus", () => { body.querySelector("input[name=prSizing][value=scale]").checked = true; refresh(); });
  $("#prPrev", body).onclick = () => { const l = pageList(val()); const i = l.indexOf(preview); preview = l[Math.max(0, i - val().perSheet)]; refresh(); };
  $("#prNext", body).onclick = () => { const l = pageList(val()); const i = l.indexOf(preview); preview = l[Math.min(l.length - 1, i + val().perSheet)]; refresh(); };
  $("#prCancel", body).onclick = closeModal;
  const remember = (v) => app.saveSettings({ printPrefs: { printer: v.printer, paper: v.paper, sizing: v.sizing, scale: v.scale, perSheet: v.perSheet, orient: v.orient, gray: v.gray, duplex: v.duplex, copies: 1, pages: "all" } });
  $("#prGo", body).onclick = async () => { const v = val(); remember(v); closeModal(); await doPrint(app, d, v, pageList(v), landscapeFor(v, pageList(v)[0] || 1), false); };
  $("#prPdf", body).onclick = async () => { const v = val(); remember(v); closeModal(); await doPrint(app, d, v, pageList(v), landscapeFor(v, pageList(v)[0] || 1), true); };
  setTimeout(refresh, 30);
}

/** Render the chosen pages into #printArea (sized to the paper) and print silently to the selected printer, or save as PDF. */
async function doPrint(app, d, v, list, landscape, toPdf) {
  const b = bridge(); const area = $("#printArea"); area.innerHTML = ""; status(t("print") + "…");
  if (!list.length) { toast(t("print_.noPages")); return; }
  try {
    const bytes = app.editor.hasEdits(d) ? await app.editor.flatten(d) : null; if (bytes) await d.replace(bytes);
    const [pw0, ph0] = PAPER[v.paper] || PAPER.a4; const pw = landscape ? ph0 : pw0, ph = landscape ? pw0 : ph0; const margin = 6;
    for (const n of list) {
      const p = d.pages[n - 1]; const rot = (p.base.page.rotate + d.rotation) % 360; const vp1 = p.base.page.getViewport({ scale: 1, rotation: rot });
      const pageWmm = vp1.width / 72 * 25.4, pageHmm = vp1.height / 72 * 25.4;
      const scale = v.sizing === "fit" ? Math.min((pw - 2 * margin) / pageWmm, (ph - 2 * margin) / pageHmm) : v.sizing === "actual" ? 1 : v.scale / 100;
      const vp = p.base.page.getViewport({ scale: 3, rotation: rot }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp }).promise;
      const sheet = document.createElement("div"); sheet.className = "sheet"; sheet.style.width = pw + "mm"; sheet.style.height = ph + "mm";
      const img = new Image(); img.src = c.toDataURL("image/jpeg", 0.93); img.style.width = (pageWmm * scale) + "mm"; img.style.height = (pageHmm * scale) + "mm"; if (v.gray) img.style.filter = "grayscale(1)";
      sheet.appendChild(img); area.appendChild(sheet); status(t("rendering", { n }));
    }
    let st = $("#printPageStyle"); if (!st) { st = document.createElement("style"); st.id = "printPageStyle"; document.head.appendChild(st); }
    st.textContent = `@page{size:${pw}mm ${ph}mm;margin:0}`;
    await new Promise((r) => setTimeout(r, 200));
    if (toPdf) {
      const data = await b.printToPdf({ landscape, pageSize: v.paper === "a4" ? "A4" : v.paper === "letter" ? "Letter" : v.paper === "legal" ? "Legal" : v.paper === "a3" ? "A3" : "A5", margins: { marginType: "none" }, printBackground: true });
      if (data) { const name = d.name.replace(/\.pdf$/i, "") + "-print.pdf"; const path = await app.saveBytesAs(new Uint8Array(data), name, "pdf"); if (path) toast(t("savedTo", { path })); }
    } else {
      const opts = { silent: !!v.printer, printBackground: true, landscape, color: !v.gray, copies: v.copies, margins: { marginType: "none" } };
      if (v.printer) opts.deviceName = v.printer; if (v.duplex !== "none") opts.duplexMode = v.duplex; if (v.perSheet > 1) opts.pagesPerSheet = v.perSheet;
      const r = b && b.print ? await b.print(opts) : (window.print(), true);
      if (r === true) toast(t("print_.sent", { printer: v.printer || "" })); else if (r && r !== "cancelled") toast(t("print_.failed") + ": " + r, 5000);
    }
  } catch (e) { toast(t("print_.failed") + ": " + (e.message || e), 5000); }
  finally { area.innerHTML = ""; status(""); }
}
