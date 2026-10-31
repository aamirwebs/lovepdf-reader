// Page tools (organize, merge, split, watermark, page numbers, crop, rotate, blank page, extract) — all local with pdf-lib —
// plus online tools (convert, compress, OCR, protect/unlock, translate) that use the LovePDF.me API.
import { $, $$, el, esc, modal, closeModal, toast, status, loadDoc, PDFLib, openPdf, hexToRgb, parsePages, parseRanges, baseName, stripExt, dirOf, bridge, fmtBytes, confirm, prompt, embedImage } from "./util.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";

const API = "https://app.lovepdf.me";
const MM = 72 / 25.4;
const uniq = (a) => [...new Set((a || []).map(Number).filter((n) => n >= 1))].sort((x, y) => x - y);

const OPTS_ONLINE = new Set(["compress", "ocr-pdf", "protect-pdf", "translate-pdf", "pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint", "pdf-to-jpg"]);
export class Tools {
  constructor(app) { this.app = app; }
  async bytesOf(d) { return this.app.editor.hasEdits(d) ? await this.app.editor.flatten(d) : d.bytes; }
  async apply(d, bytes, msg = t("toast.applied")) { await d.replace(bytes); this.app.renderTabs(); toast(msg); if (this.app.ads) this.app.ads.action("edit"); }
  countTool(id) { if (this.app.ads) this.app.ads.action("tool", { slot: id }); }

  menu() {
    const items = [
      ["organize", "grid", t("organize"), "local"], ["merge", "merge", t("merge"), "local"], ["split", "split", t("split"), "local"], ["extract", "extract", t("extract"), "local"],
      ["rotateAll", "rotcw", t("rotateAll"), "local"], ["blank", "plusfile", t("blankPage"), "local"], ["watermark", "drop", t("watermark"), "local"], ["pageNumbers", "hash", t("pageNumbers"), "local"], ["crop", "crop", t("crop"), "local"],
      ["sign", "sign", t("sign"), "local"], ["image", "image", t("images"), "local"],
      ["compress", "zap", t("compress"), "online"], ["pdf-to-word", "word", "PDF → Word", "online"], ["pdf-to-excel", "excel", "PDF → Excel", "online"], ["pdf-to-powerpoint", "filetext", "PDF → PowerPoint", "online"], ["pdf-to-jpg", "image", "PDF → JPG", "online"],
      ["ocr-pdf", "search", t("ocr"), "online"], ["ocr-edit", "edittext", t("ocrUi.menu"), "online"], ["protect-pdf", "lock", t("protect"), "online"], ["translate-pdf", "globe", t("translate"), "online"],
    ];
    const body = modal(t("tools"), `<div class="tools-grid">${items.map(([id, ic, label, kind]) => `<button class="qt" data-tool="${id}">${icon(ic, 24)}<b>${esc(label)}</b><small>${kind === "online" ? "☁ LovePDF.me" : "⚡ offline"}</small></button>`).join("")}</div>`, { size: "lg" });
    $$("[data-tool]", body).forEach((b) => (b.onclick = () => { closeModal(); this.run(b.dataset.tool); }));
  }
  async run(id) {
    const d = this.app.current();
    const needDoc = !["merge"].includes(id); if (needDoc && !d) { toast(t("toast.needPdf")); return; }
    if (!["crop", "sign", "image"].includes(id) && this.app.ads && !(await this.app.ads.gate("tool"))) return; // daily tools limit (adminweb → Apps)
    try {
      if (!["crop", "sign", "image"].includes(id) && !OPTS_ONLINE.has(id)) this.countTool(id);
      if (id === "organize") return this.organize(d); if (id === "merge") return this.merge(d); if (id === "split") return this.split(d); if (id === "extract") return this.extract(d);
      if (id === "rotateAll") return this.rotatePages(d, "all", 90); if (id === "crop") { await this.app.setMode("edit"); this.app.editor.startCrop(d); return; } if (id === "blank") return this.blank(d); if (id === "watermark") return this.watermark(d); if (id === "pageNumbers") return this.pageNumbers(d); if (id === "crop") return this.crop(d);
      if (id === "sign") { await this.app.setMode("edit"); this.app.editor.setMode("signature"); return; } if (id === "image") { await this.app.setMode("edit"); this.app.editor.setMode("image"); return; }
      if (id === "ocr-edit") return this.ocrEditable(d, "all");
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
  // ---------- page operations (sidebar right-click menu, Page menu) — all local with pdf-lib ----------
  /** Load the current bytes (with pending edits flattened), run fn(doc, L), save + replace. */
  async pageOp(d, fn, msg) { const bytes = await this.bytesOf(d); const L = PDFLib(); const doc = await loadDoc(bytes); const r = await fn(doc, L); if (r === false) return; await this.apply(d, await doc.save({ useObjectStreams: false }), msg); }
  /** ns = 1-based page numbers (array). */
  async deletePages(d, ns) {
    ns = uniq(ns); if (!ns.length) return; if (ns.length >= d.numPages) { toast(t("pg.cantDeleteAll")); return; }
    if (ns.length > 1) { const r = await confirm(t("pg.deleteAsk", { n: ns.length }), "", [t("pg.delete"), t("cancel")]); if (r !== 0) return; }
    await this.pageOp(d, (doc) => { for (const n of [...ns].sort((a, b) => b - a)) doc.removePage(n - 1); }, t("pg.deleted", { n: ns.length }));
    d.current = Math.min(d.current, d.numPages); d.goTo(Math.min(ns[0], d.numPages));
  }
  async duplicatePages(d, ns) { ns = uniq(ns); if (!ns.length) return; await this.pageOp(d, async (doc) => { const copies = await doc.copyPages(doc, ns.map((n) => n - 1)); const last = ns[ns.length - 1]; copies.forEach((pg, i) => doc.insertPage(last + i, pg)); }); }
  async rotateSel(d, ns, deg) { ns = uniq(ns); if (!ns.length) return; await this.pageOp(d, (doc, L) => { for (const n of ns) { const p = doc.getPage(n - 1); p.setRotation(L.degrees(((p.getRotation().angle + deg) % 360 + 360) % 360)); } }); }
  /** Move pages `ns` so that they start at 1-based position `to` (position counted in the document without them). */
  async movePages(d, ns, to) {
    ns = uniq(ns); if (!ns.length) return; const total = d.numPages; const rest = []; for (let i = 1; i <= total; i++) if (!ns.includes(i)) rest.push(i);
    const at = Math.max(0, Math.min(rest.length, to - 1)); const order = [...rest.slice(0, at), ...ns, ...rest.slice(at)]; if (order.every((n, i) => n === i + 1)) return;
    const bytes = await this.bytesOf(d); const out = await this.build([{ bytes }], order.map((n) => ({ n, rot: 0, src: 0 }))); await this.apply(d, out, t("pg.moved"));
  }
  async insertBlankAt(d, idx) { await this.pageOp(d, (doc) => { const ref = doc.getPage(Math.max(0, Math.min(doc.getPageCount() - 1, idx - (idx >= doc.getPageCount() ? 1 : 0)))); const sz = ref.getSize(); doc.insertPage(Math.max(0, Math.min(doc.getPageCount(), idx)), [sz.width, sz.height]); }, t("pg.inserted")); }
  async insertPdfAt(d, idx) { const files = await this.app.pickFiles(true); if (!files.length) return; await this.pageOp(d, async (doc) => { let at = Math.max(0, Math.min(doc.getPageCount(), idx)); for (const f of files) { const src = await loadDoc(f.bytes); const pages = await doc.copyPages(src, src.getPageIndices()); for (const pg of pages) doc.insertPage(at++, pg); } }, t("pg.inserted")); }
  async insertImagesAt(d, idx) {
    const b = bridge(); let items = [];
    if (b && b.openImageDialog) { const paths = await b.openImageDialog(true); for (const p of paths || []) items.push({ bytes: new Uint8Array(await b.readFile(p)), mime: /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : /\.jpe?g$/i.test(p) ? "image/jpeg" : "image/png" }); }
    else { items = await new Promise((resolve) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.onchange = async () => { const out = []; for (const f of inp.files) out.push({ bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }); resolve(out); }; inp.click(); }); }
    if (!items.length) return;
    await this.pageOp(d, async (doc) => { let at = Math.max(0, Math.min(doc.getPageCount(), idx)); const ref = doc.getPage(0).getSize(); for (const it of items) { const img = await embedImage(doc, it.bytes, it.mime); const pg = doc.insertPage(at++, [ref.width, ref.height]); const s = Math.min((ref.width - 40) / img.width, (ref.height - 40) / img.height); const w = img.width * s, h = img.height * s; pg.drawImage(img, { x: (ref.width - w) / 2, y: (ref.height - h) / 2, width: w, height: h }); } }, t("pg.inserted"));
  }
  async replacePage(d, n) {
    const files = await this.app.pickFiles(false); if (!files.length) return; const src = await loadDoc(files[0].bytes); let which = 1;
    if (src.getPageCount() > 1) { const v = await prompt(t("pg.replace"), { label: t("pg.replaceWhich", { name: files[0].name, n: src.getPageCount() }), value: "1" }); if (v == null) return; which = Math.max(1, Math.min(src.getPageCount(), parseInt(v, 10) || 1)); }
    await this.pageOp(d, async (doc) => { const [pg] = await doc.copyPages(src, [which - 1]); doc.removePage(n - 1); doc.insertPage(n - 1, pg); }, t("pg.replaced"));
  }
  async extractSel(d, ns, mode = "tab") {
    ns = uniq(ns); if (!ns.length) return; const bytes = await this.bytesOf(d); const src = await loadDoc(bytes); const L = PDFLib(); const out = await L.PDFDocument.create(); const cp = await out.copyPages(src, ns.map((n) => n - 1)); cp.forEach((p) => out.addPage(p)); const ob = await out.save({ useObjectStreams: false });
    const name = stripExt(d.name) + (ns.length === 1 ? `-page${ns[0]}.pdf` : "-pages.pdf");
    if (mode === "file") return this.app.saveBytesAs(ob, name); return this.app.openBytes(ob, name, null, true);
  }
  async copyPageImage(d, n) { const p = d.pages[n - 1]; if (!p) return; const vp = p.base.page.getViewport({ scale: 2, rotation: p.base.page.rotate }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp }).promise; const blob = await new Promise((r) => c.toBlob(r, "image/png")); try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast(t("toast.copied")); } catch { const path = await this.app.saveBytesAs(new Uint8Array(await blob.arrayBuffer()), stripExt(d.name) + `-page${n}.png`, "png"); if (path) toast(t("savedTo", { path })); } }
  async savePageImage(d, n) { const p = d.pages[n - 1]; if (!p) return; const vp = p.base.page.getViewport({ scale: 2, rotation: p.base.page.rotate }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp }).promise; const blob = await new Promise((r) => c.toBlob(r, "image/png")); await this.app.saveBytesAs(new Uint8Array(await blob.arrayBuffer()), stripExt(d.name) + `-page${n}.png`, "png"); }
  async pageSizeDialog(d, n) { const p = d.pages[n - 1]; const mm = (v) => (v / 72 * 25.4).toFixed(1); const w = p.base.w, h = p.base.h; const names = [["A4", 595.28, 841.89], ["Letter", 612, 792], ["Legal", 612, 1008], ["A3", 841.89, 1190.55], ["A5", 419.53, 595.28]]; const nm = names.find(([, a, b]) => (Math.abs(a - w) < 2 && Math.abs(b - h) < 2) || (Math.abs(b - w) < 2 && Math.abs(a - h) < 2)); modal(t("pg.props"), `<div class="form"><p>${esc(t("page"))} ${n} / ${d.numPages}</p><p>${esc(t("pg.size"))}: <b>${mm(w)} × ${mm(h)} mm</b> (${(w / 72).toFixed(2)} × ${(h / 72).toFixed(2)} in)${nm ? ` · ${nm[0]}${w > h ? " landscape" : ""}` : ""}</p><p>${esc(t("rotate"))}: ${p.base.page.rotate}°</p><p>${esc(t("file"))}: ${esc(d.name)} · ${fmtBytes(d.bytes.length)}</p></div>`, { size: "sm" }); }
  /** OCR the current page (or the whole file) on LovePDF.me and put the recognised text back into THIS document, then re-enter Edit text. */
  async ocrEditable(d, scope = "page") {
    const n = d.current; const pageOnly = scope === "page" && d.numPages > 1;
    const src = await this.bytesOf(d); let inBytes = src;
    if (pageOnly) { const doc = await loadDoc(src); const L = PDFLib(); const out = await L.PDFDocument.create(); const [pg] = await out.copyPages(doc, [n - 1]); out.addPage(pg); inBytes = await out.save({ useObjectStreams: false }); }
    const body = modal(t("ocrUi.title2"), `<div class="form"><p class="hint">☁ ${esc(t("online.needNet"))}<br>🔒 ${esc(t("online.privacy"))}</p><label>OCR language<select id="olLang"><option value="eng">English</option><option value="urd">Urdu</option><option value="ara">Arabic</option><option value="eng+urd">English + Urdu</option><option value="eng+ara">English + Arabic</option><option value="hin">Hindi</option></select></label><div class="prog" id="olProg" hidden><i style="width:0"></i></div><p class="hint" id="olMsg">${pageOnly ? esc(t("ocrUi.scopePage", { n })) : esc(t("ocrUi.scopeAll", { n: d.numPages }))}</p><div class="row end"><button class="btn" id="olCancel">${esc(t("cancel"))}</button><button class="btn btn-primary" id="olGo">${esc(t("ocrUi.go"))}</button></div></div>`, { size: "sm" });
    $("#olLang", body).value = this.app.settings.ocrLang || (this.app.settings.lang === "ur" ? "eng+urd" : "eng"); $("#olCancel", body).onclick = closeModal;
    $("#olGo", body).onclick = async () => {
      const lang = $("#olLang", body).value; this.app.saveSettings({ ocrLang: lang }); const btn = $("#olGo", body); btn.disabled = true; const prog = $("#olProg", body), bar = prog.querySelector("i"), msg = $("#olMsg", body); prog.hidden = false;
      try {
        const r = await this.apiJob("ocr-pdf", inBytes, stripExt(d.name) + ".pdf", { lang }, (pct, m) => { bar.style.width = pct + "%"; msg.textContent = m; });
        let outBytes = r.bytes;
        if (pageOnly) { const doc = await loadDoc(src); const ocrDoc = await loadDoc(r.bytes); const [pg] = await doc.copyPages(ocrDoc, [0]); doc.removePage(n - 1); doc.insertPage(n - 1, pg); outBytes = await doc.save({ useObjectStreams: false }); }
        closeModal(); await d.replace(outBytes); this.app.renderTabs(); d.goTo(n); toast(t("ocrUi.done")); this.app.ads && this.app.ads.event("tool", { slot: "ocr" });
        await this.app.setMode("edit"); this.app.editor.setMode("edittext"); this.app.editor.hideOcrBar();
      } catch (e) { msg.textContent = (e.message || t("error")); btn.disabled = false; if (e.extra && e.extra.upgrade && !this.app.account) msg.textContent = t("online.limit"); }
    };
  }
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
        const outName = (r.output_name || stripExt(name) + "." + cfg.out); closeModal(); if (this.app.ads) this.app.ads.action("tool", { slot: cfg.slug });
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
