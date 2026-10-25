// Page tools (organize, merge, split, watermark, page numbers, crop, rotate, blank page, extract) — all local with pdf-lib —
// plus online tools (convert, compress, OCR, protect/unlock, translate) that use the LovePDF.me API.
import { $, $$, el, esc, modal, closeModal, toast, status, loadDoc, PDFLib, openPdf, hexToRgb, parsePages, parseRanges, baseName, stripExt, dirOf, bridge, fmtBytes, confirm } from "./util.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";

const API = "https://app.lovepdf.me";
const MM = 72 / 25.4;

export class Tools {
  constructor(app) { this.app = app; }
  async bytesOf(d) { return this.app.editor.hasEdits(d) ? await this.app.editor.flatten(d) : d.bytes; }
  async apply(d, bytes, msg = t("toast.applied")) { await d.replace(bytes); this.app.renderTabs(); toast(msg); }

  menu() {
    const items = [
      ["organize", "grid", t("organize"), "local"], ["merge", "merge", t("merge"), "local"], ["split", "split", t("split"), "local"], ["extract", "extract", t("extract"), "local"],
      ["rotateAll", "rotcw", t("rotateAll"), "local"], ["blank", "plusfile", t("blankPage"), "local"], ["watermark", "drop", t("watermark"), "local"], ["pageNumbers", "hash", t("pageNumbers"), "local"], ["crop", "crop", t("crop"), "local"],
      ["sign", "sign", t("sign"), "local"], ["image", "image", t("images"), "local"],
      ["compress", "zap", t("compress"), "online"], ["pdf-to-word", "word", "PDF → Word", "online"], ["pdf-to-excel", "excel", "PDF → Excel", "online"], ["pdf-to-powerpoint", "filetext", "PDF → PowerPoint", "online"], ["pdf-to-jpg", "image", "PDF → JPG", "online"],
      ["ocr-pdf", "search", t("ocr"), "online"], ["protect-pdf", "lock", t("protect"), "online"], ["translate-pdf", "globe", t("translate"), "online"],
    ];
    const body = modal(t("tools"), `<div class="tools-grid">${items.map(([id, ic, label, kind]) => `<button class="qt" data-tool="${id}">${icon(ic, 24)}<b>${esc(label)}</b><small>${kind === "online" ? "☁ LovePDF.me" : "⚡ offline"}</small></button>`).join("")}</div>`, { size: "lg" });
    $$("[data-tool]", body).forEach((b) => (b.onclick = () => { closeModal(); this.run(b.dataset.tool); }));
  }
  async run(id) {
    const d = this.app.current();
    const needDoc = !["merge"].includes(id); if (needDoc && !d) { toast(t("toast.needPdf")); return; }
    try {
      if (id === "organize") return this.organize(d); if (id === "merge") return this.merge(d); if (id === "split") return this.split(d); if (id === "extract") return this.extract(d);
      if (id === "rotateAll") return this.rotatePages(d, "all", 90); if (id === "crop") { await this.app.setMode("edit"); this.app.editor.startCrop(d); return; } if (id === "blank") return this.blank(d); if (id === "watermark") return this.watermark(d); if (id === "pageNumbers") return this.pageNumbers(d); if (id === "crop") return this.crop(d);
      if (id === "sign") { await this.app.setMode("edit"); this.app.editor.setMode("signature"); return; } if (id === "image") { await this.app.setMode("edit"); this.app.editor.setMode("image"); return; }
      return this.online(d, id);
    } catch (e) { console.error(e); toast((e && e.message) || t("error"), 4000); }
  }

  // ---------- organize ----------
  async organize(d) {
    const bytes = await this.bytesOf(d); const src = await openPdf(bytes); const items = []; // {n, rot, src:'main'|insertIdx, deleted, sel}
    const body = modal(t("org.title"), `<p class="hint">${esc(t("org.hint"))}</p><div class="row" style="margin:8px 0"><button class="btn btn-sm" id="ogAll">${esc(t("org.selectAll"))}</button><button class="btn btn-sm" id="ogNone">${esc(t("org.none"))}</button><span class="sep"></span><button class="btn btn-sm" id="ogRot">↻ ${esc(t("rotate"))}</button><button class="btn btn-sm" id="ogDel">✕ ${esc(t("org.deleteSel"))}</button><button class="btn btn-sm" id="ogExtract">${esc(t("org.extractSel"))}</button><button class="btn btn-sm" id="ogBlank">${esc(t("org.blankAfter"))}</button><button class="btn btn-sm" id="ogInsert">${esc(t("org.insert"))}</button><span class="sp"></span><button class="btn btn-primary" id="ogApply">${esc(t("org.applyChanges"))}</button></div><div class="og" id="ogGrid"></div>`, { size: "lg" });
    const grid = $("#ogGrid", body); const docs = [{ pdf: src, bytes }];
    const addThumb = async (pdf, n, srcIdx, after = null) => { const page = await pdf.getPage(n); const vp = page.getViewport({ scale: 150 / page.getViewport({ scale: 1 }).width }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; const it = { n, rot: 0, src: srcIdx, deleted: false, sel: false, blank: false, el: null, c }; it.el = el(`<div class="pg" draggable="true"><div class="pgb"><button data-rot title="rotate">↻</button><button data-del title="delete">✕</button></div><div class="pn"></div></div>`); it.el.prepend(c); it.el.querySelector(".pn").textContent = srcIdx ? `+${n}` : n; it.el.onclick = (e) => { if (e.target.closest("button")) return; it.sel = !it.sel; it.el.classList.toggle("sel", it.sel); }; it.el.querySelector("[data-rot]").onclick = () => { it.rot = (it.rot + 90) % 360; c.style.transform = `rotate(${it.rot}deg)`; }; it.el.querySelector("[data-del]").onclick = () => { it.deleted = true; it.el.remove(); }; if (after) after.el.after(it.el); else grid.appendChild(it.el); items.push(it); drag(it.el); return it; };
    let dragEl = null; const drag = (x) => { x.addEventListener("dragstart", () => { dragEl = x; x.classList.add("dragging"); }); x.addEventListener("dragend", () => { x.classList.remove("dragging"); dragEl = null; }); x.addEventListener("dragover", (e) => { e.preventDefault(); if (!dragEl || dragEl === x) return; const r = x.getBoundingClientRect(); const before = (e.clientX - r.left) < r.width / 2; grid.insertBefore(dragEl, before ? x : x.nextSibling); }); };
    for (let n = 1; n <= src.numPages; n++) await addThumb(src, n, 0);
    const live = () => Array.from(grid.children).map((e) => items.find((i) => i.el === e)).filter((i) => i && !i.deleted);
    $("#ogAll", body).onclick = () => live().forEach((i) => { i.sel = true; i.el.classList.add("sel"); }); $("#ogNone", body).onclick = () => live().forEach((i) => { i.sel = false; i.el.classList.remove("sel"); });
    $("#ogRot", body).onclick = () => live().filter((i) => i.sel).forEach((i) => { i.rot = (i.rot + 90) % 360; i.c.style.transform = `rotate(${i.rot}deg)`; });
    $("#ogDel", body).onclick = () => live().filter((i) => i.sel).forEach((i) => { i.deleted = true; i.el.remove(); });
    $("#ogBlank", body).onclick = async () => { const sel = live().filter((i) => i.sel); const anchor = sel.length ? sel[sel.length - 1] : live()[live().length - 1]; const it = { n: 0, rot: 0, src: 0, deleted: false, sel: false, blank: true, c: document.createElement("canvas") }; it.c.width = 150; it.c.height = 212; it.c.getContext("2d").fillStyle = "#fff"; it.c.getContext("2d").fillRect(0, 0, 150, 212); it.el = el(`<div class="pg" draggable="true"><div class="pgb"><button data-del>✕</button></div><div class="pn">blank</div></div>`); it.el.prepend(it.c); it.el.querySelector("[data-del]").onclick = () => { it.deleted = true; it.el.remove(); }; if (anchor) anchor.el.after(it.el); else grid.appendChild(it.el); items.push(it); drag(it.el); };
    $("#ogInsert", body).onclick = async () => { const files = await this.app.pickFiles(); for (const f of files) { const pdf = await openPdf(f.bytes); docs.push({ pdf, bytes: f.bytes }); const idx = docs.length - 1; for (let n = 1; n <= pdf.numPages; n++) await addThumb(pdf, n, idx); } };
    $("#ogExtract", body).onclick = async () => { const sel = live().filter((i) => i.sel); if (!sel.length) return; const out = await this.build(docs, sel); await this.app.saveBytesAs(out, stripExt(d.name) + "-pages.pdf"); };
    $("#ogApply", body).onclick = async () => { const order = live(); if (!order.length) return; const out = await this.build(docs, order); closeModal(); await this.apply(d, out); };
  }
  async build(docs, order) {
    const L = PDFLib(); const out = await L.PDFDocument.create(); const loaded = []; for (const s of docs) loaded.push(await loadDoc(s.bytes));
    for (const it of order) { if (it.blank) { const ref = order.find((o) => !o.blank); const sz = ref ? loaded[ref.src].getPage(ref.n - 1).getSize() : { width: 595.28, height: 841.89 }; out.addPage([sz.width, sz.height]); continue; } const [pg] = await out.copyPages(loaded[it.src], [it.n - 1]); if (it.rot) pg.setRotation(L.degrees((pg.getRotation().angle + it.rot) % 360)); out.addPage(pg); }
    return out.save({ useObjectStreams: false });
  }
  // ---------- merge ----------
  async merge(d) {
    const files = d ? [{ name: d.name, bytes: await this.bytesOf(d) }] : [];
    const body = modal(t("mergeUi.title"), `<p class="hint">${esc(t("mergeUi.hint"))}</p><div class="flist" id="mgList"></div><div class="row" style="margin-top:10px"><button class="btn" id="mgAdd">➕ ${esc(t("mergeUi.add"))}</button><span class="sp"></span><button class="btn btn-primary" id="mgGo">${esc(t("mergeUi.go"))}</button></div>`);
    const list = $("#mgList", body); const render = () => { list.innerHTML = ""; files.forEach((f, i) => { const row = el(`<div class="fi" draggable="true"><span>📄</span><span class="nm">${esc(f.name)}</span><small class="muted">${fmtBytes(f.bytes.length)}</small><button data-rm>✕</button></div>`); row.querySelector("[data-rm]").onclick = () => { files.splice(i, 1); render(); }; row.addEventListener("dragstart", () => { row.dataset.drag = "1"; row.classList.add("dragging"); }); row.addEventListener("dragend", () => { row.classList.remove("dragging"); const order = Array.from(list.children).map((x) => +x.dataset.i); const nf = order.map((k) => files[k]); files.splice(0, files.length, ...nf); render(); }); row.addEventListener("dragover", (e) => { e.preventDefault(); const dr = list.querySelector(".dragging"); if (!dr || dr === row) return; const r = row.getBoundingClientRect(); list.insertBefore(dr, (e.clientY - r.top) < r.height / 2 ? row : row.nextSibling); }); row.dataset.i = i; list.appendChild(row); }); };
    render(); $("#mgAdd", body).onclick = async () => { for (const f of await this.app.pickFiles()) files.push(f); render(); };
    $("#mgGo", body).onclick = async () => { if (files.length < 1) return; const L = PDFLib(); const out = await L.PDFDocument.create(); for (const f of files) { const s = await loadDoc(f.bytes); const pages = await out.copyPages(s, s.getPageIndices()); pages.forEach((p) => out.addPage(p)); } const bytes = await out.save({ useObjectStreams: false }); closeModal(); await this.app.openBytes(bytes, (files[0] ? stripExt(files[0].name) : "merged") + "-merged.pdf", null, true); };
  }
  // ---------- split ----------
  async split(d) {
    const body = modal(t("splitUi.title"), `<div class="form"><label>${esc(t("splitUi.mode"))}<select id="spMode"><option value="every">${esc(t("splitUi.every"))}</option><option value="ranges">${esc(t("splitUi.ranges"))}</option><option value="n">${esc(t("splitUi.every_n"))}</option></select></label><label id="spRangesL" hidden>${esc(t("splitUi.ranges"))}<input type="text" id="spRanges" placeholder="${esc(t("splitUi.rangesPh"))}"></label><label id="spNL" hidden>${esc(t("splitUi.n"))}<input type="number" id="spN" value="2" min="1"></label><div class="row end"><button class="btn btn-primary" id="spGo">${esc(t("splitUi.go"))}</button></div></div>`, { size: "sm" });
    const mode = $("#spMode", body); mode.onchange = () => { $("#spRangesL", body).hidden = mode.value !== "ranges"; $("#spNL", body).hidden = mode.value !== "n"; };
    $("#spGo", body).onclick = async () => {
      const bytes = await this.bytesOf(d); const src = await loadDoc(bytes); const total = src.getPageCount(); let groups = [];
      if (mode.value === "every") groups = Array.from({ length: total }, (_, i) => [i + 1]); else if (mode.value === "ranges") groups = parseRanges($("#spRanges", body).value, total); else { const n = Math.max(1, +$("#spN", body).value || 1); for (let i = 1; i <= total; i += n) groups.push(Array.from({ length: Math.min(n, total - i + 1) }, (_, k) => i + k)); }
      if (!groups.length) return; const b = bridge(); const folder = b && b.folderDialog ? await b.folderDialog() : null; if (b && b.folderDialog && !folder) return;
      const L = PDFLib(); let k = 0; for (const g of groups) { const out = await L.PDFDocument.create(); const pages = await out.copyPages(src, g.map((n) => n - 1)); pages.forEach((p) => out.addPage(p)); const ob = await out.save({ useObjectStreams: false }); k++; const name = `${stripExt(d.name)}-part${String(k).padStart(2, "0")}.pdf`; if (folder) await b.writeFile(folder + (folder.includes("\\") ? "\\" : "/") + name, ob); else await this.app.saveBytesAs(ob, name); status(`${k} / ${groups.length}`); }
      closeModal(); toast(t("splitUi.done", { n: k })); if (folder && b.showInFolder) b.openPath(folder);
    };
  }
  async extract(d) { const spec = await this.app.ask(t("extract"), "1-3, 5", "pages"); if (spec == null) return; const bytes = await this.bytesOf(d); const src = await loadDoc(bytes); const pages = parsePages(spec, src.getPageCount()); if (!pages.length) return; const L = PDFLib(); const out = await L.PDFDocument.create(); const cp = await out.copyPages(src, pages.map((n) => n - 1)); cp.forEach((p) => out.addPage(p)); await this.app.openBytes(await out.save({ useObjectStreams: false }), stripExt(d.name) + "-extracted.pdf", null, true); }
  async rotatePages(d, which, deg = 90) { const bytes = await this.bytesOf(d); const L = PDFLib(); const doc = await loadDoc(bytes); const pages = which === "all" ? doc.getPages() : [doc.getPage(Math.max(0, d.current - 1))]; for (const p of pages) p.setRotation(L.degrees(((p.getRotation().angle + deg) % 360 + 360) % 360)); await this.apply(d, await doc.save({ useObjectStreams: false })); }
  async blank(d) { const bytes = await this.bytesOf(d); const doc = await loadDoc(bytes); const idx = Math.min(doc.getPageCount(), d.current); const sz = doc.getPage(Math.max(0, idx - 1)).getSize(); doc.insertPage(idx, [sz.width, sz.height]); await this.apply(d, await doc.save({ useObjectStreams: false })); }
  // ---------- watermark ----------
  async watermark(d) {
    const body = modal(t("wm.title"), `<div class="form"><label>${esc(t("wm.text"))}<input type="text" id="wmText" placeholder="${esc(t("wm.textPh"))}" value="CONFIDENTIAL"></label><div class="grid3"><label>${esc(t("wm.size"))}<input type="number" id="wmSize" value="48"></label><label>${esc(t("wm.opacity"))}<input type="number" id="wmOp" value="25" min="5" max="100"></label><label>${esc(t("wm.color"))}<input type="color" id="wmColor" value="#d00000" style="height:36px"></label></div><label>${esc(t("wm.pos"))}<select id="wmPos"><option value="diagonal">${esc(t("wm.diagonal"))}</option><option value="center">${esc(t("wm.center"))}</option><option value="bottom">${esc(t("wm.bottom"))}</option></select></label><div class="row end"><button class="btn btn-primary" id="wmGo">${esc(t("wm.apply"))}</button></div></div>`, { size: "sm" });
    $("#wmGo", body).onclick = async () => { const text = $("#wmText", body).value.trim(); if (!text) return; const size = +$("#wmSize", body).value || 48, op = Math.max(0.05, Math.min(1, (+$("#wmOp", body).value || 25) / 100)), pos = $("#wmPos", body).value, c = hexToRgb($("#wmColor", body).value); const bytes = await this.bytesOf(d); const L = PDFLib(); const doc = await loadDoc(bytes); const font = await doc.embedFont(L.StandardFonts.HelveticaBold); for (const p of doc.getPages()) { const { width: w, height: h } = p.getSize(); const tw = font.widthOfTextAtSize(text, size); if (pos === "diagonal") p.drawText(text, { x: w / 2 - tw / 2 * Math.cos(Math.PI / 4) + size * 0.35, y: h / 2 - tw / 2 * Math.sin(Math.PI / 4) - size * 0.35, size, font, color: L.rgb(c.r, c.g, c.b), opacity: op, rotate: L.degrees(45) }); else p.drawText(text, { x: (w - tw) / 2, y: pos === "center" ? h / 2 - size / 3 : 30, size, font, color: L.rgb(c.r, c.g, c.b), opacity: op }); } closeModal(); await this.apply(d, await doc.save({ useObjectStreams: false })); };
  }
  async pageNumbers(d) {
    const body = modal(t("pn.title"), `<div class="form"><div class="grid2"><label>${esc(t("pn.pos"))}<select id="pnPos"><option value="bc">${esc(t("pn.bc"))}</option><option value="br">${esc(t("pn.br"))}</option><option value="bl">${esc(t("pn.bl"))}</option><option value="tc">${esc(t("pn.tc"))}</option></select></label><label>${esc(t("pn.fmt"))}<select id="pnFmt"><option value="1">${esc(t("pn.fmt1"))}</option><option value="2">${esc(t("pn.fmt2"))}</option></select></label><label>${esc(t("pn.start"))}<input type="number" id="pnStart" value="1"></label><label>${esc(t("pn.size"))}<input type="number" id="pnSize" value="11"></label></div><div class="row end"><button class="btn btn-primary" id="pnGo">${esc(t("pn.apply"))}</button></div></div>`, { size: "sm" });
    $("#pnGo", body).onclick = async () => { const pos = $("#pnPos", body).value, fmt = $("#pnFmt", body).value, start = +$("#pnStart", body).value || 1, size = +$("#pnSize", body).value || 11; const bytes = await this.bytesOf(d); const L = PDFLib(); const doc = await loadDoc(bytes); const font = await doc.embedFont(L.StandardFonts.Helvetica); const total = doc.getPageCount(); doc.getPages().forEach((p, i) => { const { width: w, height: h } = p.getSize(); const label = fmt === "2" ? `Page ${start + i} of ${total + start - 1}` : String(start + i); const tw = font.widthOfTextAtSize(label, size); const x = pos === "bl" ? 36 : pos === "br" ? w - 36 - tw : (w - tw) / 2; const y = pos === "tc" ? h - 30 : 24; p.drawText(label, { x, y, size, font, color: L.rgb(0.2, 0.2, 0.2) }); }); closeModal(); await this.apply(d, await doc.save({ useObjectStreams: false })); };
  }
  // ---------- online tools via LovePDF.me API ----------
  async online(d, tool) {
    const OPTS = { compress: { slug: "compress-pdf", options: {}, out: "pdf" }, "ocr-pdf": { slug: "ocr-pdf", options: { lang: "eng" }, out: "pdf" }, "protect-pdf": { slug: "protect-pdf", options: {}, out: "pdf" }, "translate-pdf": { slug: "translate-pdf", options: { to: "ur", format: "pdf" }, out: "pdf" }, "pdf-to-word": { slug: "pdf-to-word", out: "docx" }, "pdf-to-excel": { slug: "pdf-to-excel", out: "xlsx" }, "pdf-to-powerpoint": { slug: "pdf-to-powerpoint", out: "pptx" }, "pdf-to-jpg": { slug: "pdf-to-jpg", out: "zip" } };
    const cfg = OPTS[tool]; if (!cfg) return; const options = { ...(cfg.options || {}) };
    let extra = "";
    if (tool === "protect-pdf") extra = `<label>${esc(t("online.password"))}<input type="password" id="olPw"></label>`;
    if (tool === "ocr-pdf") extra = `<label>OCR language<select id="olLang"><option value="eng">English</option><option value="urd">Urdu</option><option value="ara">Arabic</option><option value="eng+urd">English + Urdu</option><option value="hin">Hindi</option></select></label>`;
    if (tool === "translate-pdf") extra = `<label>Translate to<select id="olTo">${["en:English", "ur:Urdu", "ar:Arabic", "hi:Hindi", "es:Spanish", "fr:French", "de:German", "zh-cn:Chinese", "tr:Turkish", "id:Indonesian", "pt:Portuguese", "ru:Russian"].map((x) => { const [v, l] = x.split(":"); return `<option value="${v}" ${v === "ur" ? "selected" : ""}>${l}</option>`; }).join("")}</select></label>`;
    if (tool === "compress") extra = `<label>Level<select id="olLevel"><option value="medium">Recommended</option><option value="high">Maximum compression</option><option value="low">Best quality</option></select></label>`;
    const user = this.app.account; const body = modal(t("online.title"), `<div class="form"><p class="hint">☁ ${esc(t("online.needNet"))}<br>🔒 ${esc(t("online.privacy"))}</p>${extra}<div class="prog" id="olProg" hidden><i style="width:0"></i></div><p class="hint" id="olMsg"></p><div class="row"><small class="muted" id="olAcct">${user ? esc(t("online.loggedIn", { name: user.name })) + ` · <a href="#" id="olLogout">${esc(t("online.logout"))}</a>` : `<a href="#" id="olLogin">${esc(t("online.login"))}</a> — ${esc(t("online.loginHint"))}`}</small><span class="sp"></span><button class="btn btn-primary" id="olGo">${esc(t("online.go"))}</button></div></div>`, { size: "sm" });
    const lg = $("#olLogin", body); if (lg) lg.onclick = (e) => { e.preventDefault(); closeModal(); this.app.loginDialog(() => this.online(d, tool)); }; const lo = $("#olLogout", body); if (lo) lo.onclick = (e) => { e.preventDefault(); this.app.logout(); closeModal(); this.online(d, tool); };
    $("#olGo", body).onclick = async () => {
      if (tool === "protect-pdf") { options.password = $("#olPw", body).value; if (options.password.length < 4) return; } if (tool === "ocr-pdf") options.lang = $("#olLang", body).value; if (tool === "translate-pdf") options.to = $("#olTo", body).value; if (tool === "compress") options.level = $("#olLevel", body).value;
      const btn = $("#olGo", body); btn.disabled = true; const prog = $("#olProg", body), bar = prog.querySelector("i"), msg = $("#olMsg", body); prog.hidden = false;
      try {
        const bytes = await this.bytesOf(d); const name = d.name.replace(/\.pdf$/i, "") + ".pdf";
        const r = await this.apiJob(cfg.slug, bytes, name, options, (pct, m) => { bar.style.width = pct + "%"; msg.textContent = m; });
        const outName = (r.output_name || stripExt(name) + "." + cfg.out); closeModal();
        if (cfg.out === "pdf") await this.app.openBytes(r.bytes, outName, null, true); else { const path = await this.app.saveBytesAs(r.bytes, outName, cfg.out); if (path) toast(t("online.saved", { path })); }
      } catch (e) { msg.textContent = e.message || t("error"); btn.disabled = false; if (e.extra && e.extra.upgrade && !this.app.account) msg.textContent = t("online.limit"); }
    };
  }
  async api(path, body, method = "POST") { return this.app.api(path, body, method); }
  async apiJob(slug, bytes, name, options, progress) {
    progress(3, t("online.uploading")); const job = await this.api("/jobs", { tool: slug, files: [{ name, size: bytes.length, type: "application/pdf" }], options });
    const up = job.uploads[0]; const hu = { ...(up.headers || {}) }; if (up.driver === "local") hu["X-LovePDF-Client"] = "windows"; const put = await this.app.net(up.url, { method: up.method || "PUT", headers: hu, body: bytes }); if (!put.ok) throw new Error("Upload failed (" + put.status + ")");
    progress(40, t("online.processing")); await this.api(`/jobs/${job.id}/start`, {});
    for (let i = 0; i < 400; i++) { await new Promise((r) => setTimeout(r, 2000)); const j = await this.api(`/jobs/${job.id}`, null, "GET"); progress(45 + Math.min(50, (j.progress || 0) * 0.5), t("online.processing")); if (j.status === "done") { const h = {}; if (this.app.token) h.Authorization = "Bearer " + this.app.token; h["X-LovePDF-Client"] = "windows"; const dl = await this.app.net(API + `/jobs/${job.id}/download`, { headers: h }); if (!dl.ok) throw new Error("Download failed"); progress(100, t("done")); return { bytes: new Uint8Array(dl.body), output_name: j.output_name }; } if (j.status === "error") throw new Error(j.error || t("error")); }
    throw new Error("Timeout");
  }
}
