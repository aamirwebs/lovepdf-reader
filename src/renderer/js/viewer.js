// Document viewer: continuous scrolling, lazy rendering, zoom/rotate, thumbnails, bookmarks, find.
import { $, $$, el, esc, loadPdfJs, openPdf, debounce, status } from "./util.js";
import { t } from "./i18n.js";

const CSS_PER_PT = 96 / 72;
let seq = 0;

export class Doc {
  constructor(app, { name, path = null, bytes }) {
    this.app = app; this.id = "d" + (++seq); this.name = name; this.path = path; this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.pdf = null; this.numPages = 0; this.pages = []; this.zoom = app.settings.zoom || "width"; this.rotation = 0; this.dirty = false; this.current = 1; this.scrollTop = 0;
    this.edits = null; this.find = { q: "", hits: [], i: -1 }; this.textCache = {}; this.mounted = false; this.password = null;
  }
  async load(password) { this.pdf = await openPdf(this.bytes, password); this.password = password || null; this.numPages = this.pdf.numPages; this.pages = Array.from({ length: this.numPages }, (_, i) => ({ n: i + 1, el: null, canvas: null, renderedKey: "", task: null, textLayer: null, textTask: null, vp: null, base: null })); for (const p of this.pages) p.base = await this.pdf.getPage(p.n).then((pg) => { const v = pg.getViewport({ scale: 1 }); return { w: v.width, h: v.height, page: pg }; }); return this; }
  /** Replace the underlying PDF bytes (after an edit) and re-render, keeping the scroll position. */
  async replace(bytes, { keepDirty = true } = {}) { const top = this.app.viewport.scrollTop; this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); try { if (this.pdf) await this.pdf.destroy(); } catch {} this.textCache = {}; this.sel = new Set(); this.find = { q: "", hits: [], i: -1 }; if (this.edits) { this.edits.textItems = {}; this.edits.imageItems = {}; this.edits.sel = null; } await this.load(this.password); if (keepDirty) this.dirty = true; this.current = Math.min(this.current, this.numPages); if (this.mounted) { this.unmount(); this.mount(); requestAnimationFrame(() => { this.app.viewport.scrollTop = top; }); } this.app.updatePageUi(); this.app.refreshSidebar(); }

  // ---------- layout ----------
  scaleFor(p) { const vpEl = this.app.viewport; const availW = Math.max(200, vpEl.clientWidth - 48), availH = Math.max(200, vpEl.clientHeight - 32); const rot = (this.rotation % 180) !== 0; const w = rot ? p.base.h : p.base.w, h = rot ? p.base.w : p.base.h; if (this.zoom === "width") return availW / w; if (this.zoom === "page") return Math.min(availW / w, availH / h); return Number(this.zoom) * CSS_PER_PT; }
  mount() {
    const wrap = this.app.pagesWrap; wrap.innerHTML = ""; this.mounted = true;
    for (const p of this.pages) { const s = this.scaleFor(p); const vp = p.base.page.getViewport({ scale: s, rotation: (p.base.page.rotate + this.rotation) % 360 }); p.vp = vp; p.el = el(`<div class="page" data-n="${p.n}" style="width:${vp.width}px;height:${vp.height}px"><div class="loading">${p.n}</div></div>`); p.canvas = null; p.renderedKey = ""; p.textLayer = null; wrap.appendChild(p.el); }
    this.io = new IntersectionObserver((entries) => { for (const e of entries) { const p = this.pages[+e.target.dataset.n - 1]; if (e.isIntersecting) this.render(p); } }, { root: this.app.viewport, rootMargin: "600px 0px" });
    for (const p of this.pages) this.io.observe(p.el);
    this.app.viewport.classList.toggle("editing", !!(this.edits && this.edits.active));
    if (this.edits && this.edits.active) this.app.editor.attachAll(this);
  }
  unmount() { if (this.io) this.io.disconnect(); for (const p of this.pages) { if (p.task) { try { p.task.cancel(); } catch {} p.task = null; } p.el = null; p.canvas = null; p.renderedKey = ""; } this.mounted = false; }
  relayout() { if (!this.mounted) return; const vpEl = this.app.viewport; const ratio = vpEl.scrollHeight ? vpEl.scrollTop / vpEl.scrollHeight : 0; for (const p of this.pages) { const s = this.scaleFor(p); const vp = p.base.page.getViewport({ scale: s, rotation: (p.base.page.rotate + this.rotation) % 360 }); p.vp = vp; p.el.style.width = vp.width + "px"; p.el.style.height = vp.height + "px"; if (p.canvas) { p.canvas.style.width = vp.width + "px"; p.canvas.style.height = vp.height + "px"; } if (p.textLayer) { p.textLayer.remove(); p.textLayer = null; } p.renderedKey = ""; if (this.edits) this.app.editor.resize(this, p); } vpEl.scrollTop = ratio * vpEl.scrollHeight; this.renderVisible(); }
  renderVisible() { const r = this.app.viewport.getBoundingClientRect(); for (const p of this.pages) { if (!p.el) continue; const b = p.el.getBoundingClientRect(); if (b.bottom > r.top - 600 && b.top < r.bottom + 600) this.render(p); } }
  async render(p) {
    if (!p.el || !p.vp) return; const dpr = Math.min(3, window.devicePixelRatio || 1); const key = `${p.vp.width}x${p.vp.height}r${this.rotation}d${dpr}`; if (p.renderedKey === key || p.task) return;
    if (p.task) { try { p.task.cancel(); } catch {} }
    const c = document.createElement("canvas"); c.className = "pc"; c.width = Math.round(p.vp.width * dpr); c.height = Math.round(p.vp.height * dpr); c.style.width = p.vp.width + "px"; c.style.height = p.vp.height + "px";
    const task = p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: p.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, annotationMode: 2 }); p.task = task;
    try { await task.promise; } catch (e) { p.task = null; if (e && e.name === "RenderingCancelledException") return; console.warn(e); return; }
    p.task = null; if (!p.el) return; const old = p.el.querySelector("canvas.pc"); if (old) old.replaceWith(c); else p.el.prepend(c); const ld = p.el.querySelector(".loading"); if (ld) ld.remove(); p.canvas = c; p.renderedKey = key;
    this.renderText(p);
  }
  async renderText(p) {
    if (!p.el) return; const lib = await loadPdfJs(); if (p.textLayer) p.textLayer.remove();
    const div = document.createElement("div"); div.className = "textLayer"; div.style.width = p.vp.width + "px"; div.style.height = p.vp.height + "px"; p.el.appendChild(div); p.textLayer = div;
    try { const tl = new lib.TextLayer({ textContentSource: p.base.page.streamTextContent({ includeMarkedContent: true }), container: div, viewport: p.vp }); p.textTask = tl; await tl.render(); const end = document.createElement("div"); end.className = "endOfContent"; div.appendChild(end); } catch (e) { if (!/cancel/i.test(String(e))) console.warn("text layer", e); }
    if (this.find.q) this.paintFind(p);
    if (this.edits) this.app.editor.ensureOverlay(this, p);
  }
  // ---------- navigation ----------
  pageFromScroll() { const vpEl = this.app.viewport; const mid = vpEl.scrollTop + vpEl.clientHeight * 0.4; let best = 1; for (const p of this.pages) { if (!p.el) break; if (p.el.offsetTop <= mid) best = p.n; else break; } return best; }
  goTo(n, offsetY = 0) { n = Math.max(1, Math.min(this.numPages, Math.round(n) || 1)); const p = this.pages[n - 1]; if (!p || !p.el) return; this.app.viewport.scrollTop = p.el.offsetTop - 16 + offsetY; this.current = n; this.app.updatePageUi(); }
  setZoom(z) { this.zoom = z; this.relayout(); this.app.updateZoomUi(); }
  zoomStep(dir) { const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]; const cur = this.effectiveZoom(); let z; if (dir > 0) z = steps.find((s) => s > cur + 0.01) || 4; else z = [...steps].reverse().find((s) => s < cur - 0.01) || 0.25; this.setZoom(z); }
  effectiveZoom() { const p = this.pages[Math.max(0, this.current - 1)]; if (!p) return 1; return typeof this.zoom === "number" ? this.zoom : this.scaleFor(p) / CSS_PER_PT; }
  rotate(d = 90) { this.rotation = (this.rotation + d + 360) % 360; this.relayout(); }

  // ---------- sidebar (thumbnails: click = go to page, Ctrl/Shift = multi-select, right-click = page menu, drag = reorder) ----------
  selectedPages() { const a = [...(this.sel || [])].filter((n) => n >= 1 && n <= this.numPages).sort((x, y) => x - y); return a.length ? a : [this.current]; }
  setSelection(ns) { this.sel = new Set(ns); const c = this.app.$("#sbThumbs"); if (c) $$(".sb-th", c).forEach((x) => x.classList.toggle("sel", this.sel.has(+x.dataset.n))); }
  async thumbnails(container) {
    container.innerHTML = ""; const items = []; this.sel = this.sel || new Set(); this.selAnchor = this.selAnchor || this.current;
    for (const p of this.pages) {
      const th = el(`<div class="sb-th ${this.sel.has(p.n) ? "sel" : ""}" data-n="${p.n}" draggable="true"><div class="th-box" style="aspect-ratio:${p.base.w}/${p.base.h};background:#fff"></div><div class="n">${p.n}</div></div>`);
      th.onclick = (e) => { if (e.ctrlKey || e.metaKey) { if (this.sel.has(p.n)) this.sel.delete(p.n); else this.sel.add(p.n); this.selAnchor = p.n; } else if (e.shiftKey) { const a = Math.min(this.selAnchor, p.n), b = Math.max(this.selAnchor, p.n); for (let i = a; i <= b; i++) this.sel.add(i); } else { this.sel = new Set([p.n]); this.selAnchor = p.n; this.goTo(p.n); } this.setSelection(this.sel); };
      th.oncontextmenu = (e) => { e.preventDefault(); if (!this.sel.has(p.n)) { this.sel = new Set([p.n]); this.selAnchor = p.n; this.setSelection(this.sel); if (!e.ctrlKey) this.goTo(p.n); } this.app.pageMenu(this.selectedPages(), { x: e.clientX, y: e.clientY }); };
      th.addEventListener("dragstart", (e) => { if (!this.sel.has(p.n)) { this.sel = new Set([p.n]); this.setSelection(this.sel); } th.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "pages"); this.dragPages = this.selectedPages(); });
      th.addEventListener("dragend", () => { th.classList.remove("dragging"); $$(".sb-th", container).forEach((x) => x.classList.remove("drop-before", "drop-after")); });
      th.addEventListener("dragover", (e) => { if (!this.dragPages) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = th.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2; $$(".sb-th", container).forEach((x) => x.classList.remove("drop-before", "drop-after")); th.classList.add(before ? "drop-before" : "drop-after"); });
      th.addEventListener("drop", async (e) => { if (!this.dragPages) return; e.preventDefault(); const r = th.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2; const moving = this.dragPages; this.dragPages = null; let target = p.n + (before ? 0 : 1); target -= moving.filter((n) => n < target).length; await this.app.tools.movePages(this, moving, target); this.sel = new Set(); });
      container.appendChild(th); items.push({ p, th });
    }
    container.onkeydown = (e) => { if (e.key === "Delete") { e.preventDefault(); this.app.tools.deletePages(this, this.selectedPages()); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); this.setSelection(this.pages.map((p) => p.n)); } else if (e.key === "Escape") this.setSelection([]); };
    container.oncontextmenu = (e) => { if (e.target === container) { e.preventDefault(); this.app.pageMenu(this.selectedPages(), { x: e.clientX, y: e.clientY }); } };
    const obs = new IntersectionObserver(async (entries) => { for (const e of entries) { if (!e.isIntersecting) continue; const n = +e.target.dataset.n; const it = items[n - 1]; if (it.done) continue; it.done = true; obs.unobserve(e.target); try { const vp = it.p.base.page.getViewport({ scale: 160 / it.p.base.w, rotation: (it.p.base.page.rotate + this.rotation) % 360 }); const c = document.createElement("canvas"); c.width = Math.round(vp.width * 1.5); c.height = Math.round(vp.height * 1.5); await it.p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp, transform: [1.5, 0, 0, 1.5, 0, 0] }).promise; const box = it.th.querySelector(".th-box"); box.replaceWith(c); } catch {} } }, { root: container, rootMargin: "300px 0px" });
    for (const it of items) obs.observe(it.th); this.thumbObs = obs; this.markThumb();
  }
  markThumb() { const c = this.app.$("#sbThumbs"); if (!c) return; $$(".sb-th", c).forEach((x) => x.classList.toggle("on", +x.dataset.n === this.current)); const on = c.querySelector(".sb-th.on"); if (on) { const r = on.getBoundingClientRect(), cr = c.getBoundingClientRect(); if (r.top < cr.top || r.bottom > cr.bottom) on.scrollIntoView({ block: "nearest" }); } }
  async outline(container) {
    container.innerHTML = ""; let ol = null; try { ol = await this.pdf.getOutline(); } catch {}
    if (!ol || !ol.length) { container.innerHTML = `<p class="muted" style="padding:6px">${esc(t("noOutline"))}</p>`; return; }
    const build = (items) => { const d = document.createElement("div"); d.className = "ol"; for (const it of items) { const a = el(`<a href="#" title="${esc(it.title)}">${esc(it.title || "—")}</a>`); a.onclick = async (e) => { e.preventDefault(); try { let dest = it.dest; if (typeof dest === "string") dest = await this.pdf.getDestination(dest); if (Array.isArray(dest) && dest[0]) { const idx = await this.pdf.getPageIndex(dest[0]); this.goTo(idx + 1); } } catch {} }; d.appendChild(a); if (it.items && it.items.length) d.appendChild(build(it.items)); } return d; };
    container.appendChild(build(ol));
  }
  // ---------- find ----------
  async pageText(n) { if (this.textCache[n] != null) return this.textCache[n]; const tc = await this.pages[n - 1].base.page.getTextContent(); const s = tc.items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join(""); this.textCache[n] = s; return s; }
  async search(q) {
    q = String(q || "").trim(); this.find.q = q; this.find.hits = []; this.find.i = -1; for (const p of this.pages) this.paintFind(p);
    if (!q) return this.find; const lq = q.toLowerCase();
    for (const p of this.pages) { const s = (await this.pageText(p.n)).toLowerCase(); let i = -1, k = 0; while ((i = s.indexOf(lq, i + 1)) >= 0 && k < 500) { this.find.hits.push({ n: p.n, k }); k++; } }
    for (const p of this.pages) this.paintFind(p); return this.find;
  }
  paintFind(p) {
    if (!p.textLayer) return; const spans = $$("span[data-t], span:not([data-t])", p.textLayer).filter((s) => !s.closest(".endOfContent") && !s.parentElement.closest("span"));
    for (const s of spans) { if (s.dataset.t != null) { s.textContent = s.dataset.t; delete s.dataset.t; } }
    const lq = this.find.q.toLowerCase(); if (!lq) return; let k = 0; const cur = this.find.hits[this.find.i];
    for (const s of spans) { const txt = s.textContent; const low = txt.toLowerCase(); if (!low.includes(lq)) continue; s.dataset.t = txt; const frag = document.createDocumentFragment(); let i = 0, j; while ((j = low.indexOf(lq, i)) >= 0) { if (j > i) frag.appendChild(document.createTextNode(txt.slice(i, j))); const m = document.createElement("span"); m.className = "fh" + (cur && cur.n === p.n && k === cur.k ? " cur" : ""); m.textContent = txt.slice(j, j + lq.length); frag.appendChild(m); k++; i = j + lq.length; } if (i < txt.length) frag.appendChild(document.createTextNode(txt.slice(i))); s.textContent = ""; s.appendChild(frag); }
  }
  findStep(dir) { const h = this.find.hits; if (!h.length) return null; this.find.i = (this.find.i + dir + h.length) % h.length; const hit = h[this.find.i]; const p = this.pages[hit.n - 1]; this.goTo(hit.n); for (const pp of this.pages) this.paintFind(pp); setTimeout(() => { const c = p.textLayer && p.textLayer.querySelector(".fh.cur"); if (c) c.scrollIntoView({ block: "center" }); }, 80); return hit; }
  async destroy() { this.unmount(); try { if (this.pdf) await this.pdf.destroy(); } catch {} }
}
