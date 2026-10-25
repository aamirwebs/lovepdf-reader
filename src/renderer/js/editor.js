// Edit mode: per-page overlay canvases with vector objects (text, draw, highlight, shapes, whiteout, images, signature,
// notes, "edit text" = cover + retype). Objects live in PDF points (origin bottom-left) and are written with pdf-lib on save.
import { $, $$, el, esc, hexToRgb, hexA, modal, closeModal, toast, loadDoc, PDFLib, embedImage, bridge } from "./util.js";
import { t } from "./i18n.js";

const MODES = ["select", "edittext", "text", "draw", "highlight", "rect", "ellipse", "arrow", "whiteout", "image", "signature", "note"];
const ICONS = { select: "↖", edittext: "✎", text: "T", draw: "✍", highlight: "▮", rect: "▭", ellipse: "◯", arrow: "→", whiteout: "⬜", image: "🖼", signature: "✒", note: "📝" };
const FONT = (o, s) => `${o.bold ? "bold " : ""}${o.size * s}px Helvetica, Arial, "Noto Nastaliq Urdu", sans-serif`;

export class Editor {
  constructor(app) {
    this.app = app; this.mode = "edittext"; this.pendingImage = null; this.textBox = null;
    this.rebuildBar();
    $("#edSize").oninput = (e) => { $("#edSizeV").textContent = e.target.value; const d = this.doc(); if (!d) return; const sel = d.edits.sel; if (sel && sel.type === "text") { this.snap(d); sel.size = +e.target.value; this.draw(d, sel.n); } else if (sel && sel.width != null) { this.snap(d); sel.width = Math.max(1, +e.target.value / 4); this.draw(d, sel.n); } };
    $("#edColor").oninput = (e) => { const d = this.doc(); if (!d) return; const sel = d.edits.sel; if (sel && sel.color !== undefined && sel.type !== "whiteout" && sel.type !== "highlight") { this.snap(d); sel.color = e.target.value; this.draw(d, sel.n); } };
    $("#edBold").onchange = (e) => { const d = this.doc(); if (!d) return; const sel = d.edits.sel; if (sel && sel.type === "text") { this.snap(d); sel.bold = e.target.checked; this.draw(d, sel.n); } };
    $("#edUndo").onclick = () => this.undo(); $("#edRedo").onclick = () => this.redo(); $("#edDel").onclick = () => this.deleteSel();
    $("#edImgInput").onchange = async () => { const f = $("#edImgInput").files[0]; $("#edImgInput").value = ""; if (f) await this.useImageFile(f); };
    document.addEventListener("keydown", (e) => { const d = this.doc(); if (!d || !d.edits || !d.edits.active || this.textBox) return; const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return; if (e.key === "Delete" || e.key === "Backspace") { if (d.edits.sel) { e.preventDefault(); this.deleteSel(); } } else if (e.key === "Escape") { d.edits.sel = null; this.draw(d); } });
  }
  rebuildBar() { const bar = $("#edModes"); bar.innerHTML = MODES.map((m) => `<button data-m="${m}" class="${m === this.mode ? "on" : ""}" title="${esc(t("edit." + m))}">${ICONS[m]} <span>${esc(t("edit." + m))}</span></button>`).join(""); $$("button", bar).forEach((b) => (b.onclick = () => this.setMode(b.dataset.m))); $("#edHint").textContent = t("edit.hint." + this.mode); }
  doc() { const d = this.app.current(); return d && d.edits && d.edits.active ? d : null; }
  color() { return $("#edColor").value; } size() { return +$("#edSize").value; } bold() { return $("#edBold").checked; }

  // ---------- enter / leave ----------
  async enter(d) {
    if (!d.edits) d.edits = { active: false, objs: {}, textItems: {}, undo: [], redo: [], sel: null, drag: null, hover: null };
    d.edits.active = true; if (d.rotation) { d.rotation = 0; d.relayout(); }
    $("#editbar").hidden = false; this.app.viewport.classList.add("editing"); this.setMode(this.mode); this.attachAll(d);
  }
  leave(d) { this.commitText(); if (d && d.edits) { d.edits.active = false; d.edits.sel = null; for (const p of d.pages) if (p.ov) { p.ov.remove(); p.ov = null; p.octx = null; } } $("#editbar").hidden = true; this.app.viewport.classList.remove("editing"); }
  attachAll(d) { for (const p of d.pages) this.ensureOverlay(d, p); }
  ensureOverlay(d, p) {
    if (!d.edits || !d.edits.active || !p.el || !p.vp) return; if (!p.ov) { const ov = document.createElement("canvas"); ov.className = "ov"; p.el.appendChild(ov); p.ov = ov; p.octx = ov.getContext("2d"); this.bind(d, p); }
    this.resize(d, p); this.loadTextItems(d, p); this.draw(d, p.n);
  }
  resize(d, p) { if (!p.ov || !p.vp) return; const dpr = Math.min(3, window.devicePixelRatio || 1); p.ov.width = Math.round(p.vp.width * dpr); p.ov.height = Math.round(p.vp.height * dpr); p.ov.style.width = p.vp.width + "px"; p.ov.style.height = p.vp.height + "px"; p.octx = p.ov.getContext("2d"); p.octx.setTransform(dpr, 0, 0, dpr, 0, 0); this.draw(d, p.n); }
  async loadTextItems(d, p) { if (d.edits.textItems[p.n]) return; d.edits.textItems[p.n] = []; try { const tc = await p.base.page.getTextContent(); d.edits.textItems[p.n] = tc.items.filter((it) => it.str && it.str.trim()).map((it) => { const [a, b, c, dd, e, f] = it.transform; const h = Math.hypot(b, dd) || it.height || 10; return { x: e, y: f, w: it.width || it.str.length * h * 0.5, h, str: it.str }; }); } catch {} if (this.mode === "edittext") this.draw(d, p.n); }
  setMode(m) { this.mode = m; const d = this.doc(); if (d) { d.edits.sel = null; this.commitText(); } $$("#edModes button").forEach((b) => b.classList.toggle("on", b.dataset.m === m)); $("#edHint").textContent = t("edit.hint." + m); if (m === "image") this.pickImage(); if (m === "signature") this.signatureDialog(); if (d) this.draw(d); }
  list(d, n) { return (d.edits.objs[n] ||= []); }
  clone(o) { return JSON.parse(JSON.stringify(o, (k, v) => (k === "img" ? undefined : v))); }
  snap(d) { const n = d.edits.sel ? d.edits.sel.n : d.current; d.edits.undo.push({ n, data: this.list(d, n).map((o) => ({ ...this.clone(o), img: o.img })) }); if (d.edits.undo.length > 80) d.edits.undo.shift(); d.edits.redo = []; this.markDirty(d); }
  snapPage(d, n) { d.edits.undo.push({ n, data: this.list(d, n).map((o) => ({ ...this.clone(o), img: o.img })) }); if (d.edits.undo.length > 80) d.edits.undo.shift(); d.edits.redo = []; this.markDirty(d); }
  markDirty(d) { if (!d.dirty) { d.dirty = true; this.app.renderTabs(); } }
  undo() { const d = this.doc(); if (!d) return; const h = d.edits.undo.pop(); if (!h) return; d.edits.redo.push({ n: h.n, data: this.list(d, h.n).map((o) => ({ ...this.clone(o), img: o.img })) }); d.edits.objs[h.n] = h.data; d.edits.sel = null; this.draw(d, h.n); }
  redo() { const d = this.doc(); if (!d) return; const h = d.edits.redo.pop(); if (!h) return; d.edits.undo.push({ n: h.n, data: this.list(d, h.n).map((o) => ({ ...this.clone(o), img: o.img })) }); d.edits.objs[h.n] = h.data; d.edits.sel = null; this.draw(d, h.n); }
  deleteSel() { const d = this.doc(); if (!d || !d.edits.sel) return; const o = d.edits.sel; this.snapPage(d, o.n); d.edits.objs[o.n] = this.list(d, o.n).filter((x) => x !== o); d.edits.sel = null; this.draw(d, o.n); }
  hasEdits(d) { return !!(d && d.edits && Object.values(d.edits.objs).some((a) => a.length)); }

  // ---------- geometry ----------
  scaleOf(p) { return p.vp.width / p.base.w; }
  toPdf(p, e) { const r = p.ov.getBoundingClientRect(); const s = this.scaleOf(p); return [(e.clientX - r.left) / s, p.base.h - (e.clientY - r.top) / s]; }
  measure(p, line, o) { p.octx.font = FONT(o, this.scaleOf(p)); return p.octx.measureText(line).width / this.scaleOf(p); }
  bbox(p, o) {
    if (o.type === "text") { const lines = String(o.text).split("\n"); const w = Math.max(...lines.map((l) => this.measure(p, l, o))); const h = o.size * 1.2 * lines.length; return { x: o.x, y: o.y - h + o.size, w, h }; }
    if (o.type === "path") { const xs = o.pts.map((q) => q[0]), ys = o.pts.map((q) => q[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
    if (o.type === "arrow") return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    if (o.type === "note") return { x: o.x, y: o.y - 18, w: 18, h: 18 };
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
  hit(d, p, px, py) { const arr = this.list(d, p.n); for (let i = arr.length - 1; i >= 0; i--) { const b = this.bbox(p, arr[i]); if (px >= b.x - 3 && px <= b.x + b.w + 3 && py >= b.y - 3 && py <= b.y + b.h + 3) return arr[i]; } return null; }
  textHit(d, p, px, py) { return (d.edits.textItems[p.n] || []).find((ti) => px >= ti.x && px <= ti.x + ti.w && py >= ti.y - ti.h * 0.25 && py <= ti.y + ti.h); }

  // ---------- drawing ----------
  draw(d, onlyN = null) { for (const p of d.pages) { if (onlyN && p.n !== onlyN) continue; if (!p.ov || !p.octx) continue; this.drawPage(d, p); } }
  drawPage(d, p) {
    const ctx = p.octx, s = this.scaleOf(p), ph = p.base.h; ctx.clearRect(0, 0, p.vp.width, p.vp.height);
    if (this.mode === "edittext") { ctx.strokeStyle = "rgba(0,140,255,.5)"; ctx.lineWidth = 1; for (const ti of d.edits.textItems[p.n] || []) { if (ti === d.edits.hover) { ctx.fillStyle = "rgba(0,140,255,.12)"; ctx.fillRect(ti.x * s, (ph - ti.y - ti.h) * s, ti.w * s, ti.h * 1.25 * s); } ctx.strokeRect(ti.x * s, (ph - ti.y - ti.h) * s, ti.w * s, ti.h * 1.25 * s); } }
    for (const o of this.list(d, p.n)) if (!o.hidden) this.drawObj(ctx, o, s, ph, true);
    const sel = d.edits.sel; if (sel && sel.n === p.n) { const b = this.bbox(p, sel); ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 1.5; ctx.strokeRect(b.x * s - 4, (ph - b.y - b.h) * s - 4, b.w * s + 8, b.h * s + 8); ctx.restore(); }
  }
  drawObj(ctx, o, s, ph, screen) {
    const X = (x) => x * s, Y = (y) => (ph - y) * s; ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (o.type === "whiteout") { ctx.fillStyle = "#fff"; ctx.fillRect(X(o.x), Y(o.y + o.h), o.w * s, o.h * s); if (screen) { ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.strokeRect(X(o.x), Y(o.y + o.h), o.w * s, o.h * s); } }
    else if (o.type === "highlight") { ctx.fillStyle = hexA(o.color || "#ffe600", 0.4); ctx.fillRect(X(o.x), Y(o.y + o.h), o.w * s, o.h * s); }
    else if (o.type === "rect") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width * s; ctx.strokeRect(X(o.x), Y(o.y + o.h), o.w * s, o.h * s); }
    else if (o.type === "ellipse") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width * s; ctx.beginPath(); ctx.ellipse(X(o.x + o.w / 2), Y(o.y + o.h / 2), Math.max(1, o.w * s / 2), Math.max(1, o.h * s / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (o.type === "arrow") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width * s; ctx.beginPath(); ctx.moveTo(X(o.x1), Y(o.y1)); ctx.lineTo(X(o.x2), Y(o.y2)); ctx.stroke(); const a = Math.atan2(Y(o.y2) - Y(o.y1), X(o.x2) - X(o.x1)); const hl = Math.max(8, o.width * 4) * s; ctx.beginPath(); ctx.moveTo(X(o.x2), Y(o.y2)); ctx.lineTo(X(o.x2) - hl * Math.cos(a - 0.5), Y(o.y2) - hl * Math.sin(a - 0.5)); ctx.moveTo(X(o.x2), Y(o.y2)); ctx.lineTo(X(o.x2) - hl * Math.cos(a + 0.5), Y(o.y2) - hl * Math.sin(a + 0.5)); ctx.stroke(); }
    else if (o.type === "path") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width * s; ctx.beginPath(); o.pts.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])))); ctx.stroke(); }
    else if (o.type === "text") { ctx.fillStyle = o.color; ctx.font = FONT(o, s); ctx.textBaseline = "alphabetic"; String(o.text).split("\n").forEach((line, i) => ctx.fillText(line, X(o.x), Y(o.y) + i * o.size * 1.2 * s)); }
    else if (o.type === "image" && o.img) { ctx.drawImage(o.img, X(o.x), Y(o.y + o.h), o.w * s, o.h * s); }
    else if (o.type === "note") { ctx.fillStyle = "#fbbf24"; ctx.strokeStyle = "#92400e"; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(X(o.x), Y(o.y), 18 * s, 18 * s, 3 * s); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#000"; ctx.font = `${11 * s}px sans-serif`; ctx.fillText("✎", X(o.x) + 4 * s, Y(o.y) + 13 * s); }
    ctx.restore();
  }

  // ---------- inline text box ----------
  openText(d, p, o) {
    this.commitText(); const s = this.scaleOf(p); const b = this.bbox(p, o);
    const ta = document.createElement("textarea"); ta.className = "ed-textbox"; ta.value = o.text; ta.dir = "auto";
    ta.style.left = (o.x * s - 2) + "px"; ta.style.top = ((p.base.h - o.y - o.size) * s - 1) + "px"; ta.style.font = FONT(o, s); ta.style.color = o.color; ta.style.width = Math.max(120, b.w * s + 40) + "px"; ta.rows = Math.max(1, o.text.split("\n").length);
    p.el.appendChild(ta); this.textBox = { ta, o, d, p }; o.hidden = true; this.draw(d, p.n); setTimeout(() => { ta.focus(); ta.select(); }, 0);
    ta.oninput = () => { ta.rows = Math.max(1, ta.value.split("\n").length); ta.style.width = Math.max(120, Math.max(...ta.value.split("\n").map((l) => this.measure(p, l, o))) * s + 40) + "px"; };
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") { ta.value = o.text; this.commitText(); } if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.commitText(); } };
    ta.onblur = () => setTimeout(() => this.commitText(), 60);
  }
  commitText() { if (!this.textBox) return; const { ta, o, d, p } = this.textBox; this.textBox = null; const v = ta.value; ta.remove(); delete o.hidden; if (!v.trim()) { d.edits.objs[p.n] = this.list(d, p.n).filter((x) => x !== o); if (d.edits.sel === o) d.edits.sel = null; } else o.text = v; this.draw(d, p.n); }

  // ---------- pointer handling ----------
  bind(d, p) {
    const ov = p.ov;
    ov.onpointerdown = async (e) => {
      if (!d.edits.active) return; if (this.textBox) { this.commitText(); return; } if (e.button !== 0) return;
      const [x, y] = this.toPdf(p, e); ov.setPointerCapture(e.pointerId); const E = d.edits; const n = p.n; const mode = this.mode;
      if (mode === "select") { const o = this.hit(d, p, x, y); E.sel = o; if (o) { this.snapPage(d, n); E.drag = { o, x, y, p }; } this.draw(d); return; }
      if (mode === "edittext") { const ti = this.textHit(d, p, x, y); if (!ti) { const o = this.hit(d, p, x, y); if (o && o.type === "text") { E.sel = o; this.openText(d, p, o); } return; } this.snapPage(d, n); const wo = { type: "whiteout", n, x: ti.x - 1, y: ti.y - ti.h * 0.3, w: ti.w + 2, h: ti.h * 1.45 }; const tx = { type: "text", n, x: ti.x, y: ti.y, size: Math.max(6, Math.round(ti.h * 10) / 10), color: "#000000", text: ti.str, bold: false }; this.list(d, n).push(wo, tx); E.textItems[n] = E.textItems[n].filter((i) => i !== ti); E.sel = tx; this.openText(d, p, tx); return; }
      if (mode === "text") { this.snapPage(d, n); const o = { type: "text", n, x, y, size: this.size(), color: this.color(), text: "", bold: this.bold() }; this.list(d, n).push(o); E.sel = o; this.openText(d, p, o); return; }
      if (mode === "note") { const text = await this.notePrompt(""); if (text == null || !text.trim()) return; this.snapPage(d, n); const o = { type: "note", n, x, y, text }; this.list(d, n).push(o); E.sel = o; this.draw(d, n); return; }
      if (mode === "image" || mode === "signature") { const pi = this.pendingImage; if (pi) { this.snapPage(d, n); const w = Math.min(p.base.w * 0.4, pi.img.width * 0.5), h = w * pi.img.height / pi.img.width; const o = { type: "image", n, x: x - w / 2, y: y - h / 2, w, h, img: pi.img, bytes: pi.bytes, mime: pi.mime }; this.list(d, n).push(o); E.sel = o; this.pendingImage = null; this.setMode("select"); E.sel = o; this.draw(d, n); } else if (mode === "image") this.pickImage(); else this.signatureDialog(); return; }
      this.snapPage(d, n);
      if (mode === "draw") { const o = { type: "path", n, pts: [[x, y]], color: this.color(), width: Math.max(1, this.size() / 4) }; this.list(d, n).push(o); E.drag = { o, kind: "path", p }; }
      else if (mode === "arrow") { const o = { type: "arrow", n, x1: x, y1: y, x2: x, y2: y, color: this.color(), width: Math.max(1, this.size() / 4) }; this.list(d, n).push(o); E.drag = { o, kind: "line", p }; }
      else { const o = { type: mode, n, x, y, w: 0, h: 0, color: mode === "highlight" ? "#ffe600" : this.color(), width: Math.max(1, this.size() / 4) }; this.list(d, n).push(o); E.drag = { o, kind: "box", sx: x, sy: y, p }; }
    };
    ov.onpointermove = (e) => {
      if (!d.edits.active) return; const [x, y] = this.toPdf(p, e); const E = d.edits;
      if (!E.drag) { if (this.mode === "edittext") { const ti = this.textHit(d, p, x, y); if (ti !== E.hover) { E.hover = ti; this.draw(d, p.n); } ov.style.cursor = ti ? "text" : "default"; } else if (this.mode === "select") ov.style.cursor = this.hit(d, p, x, y) ? "move" : "default"; else ov.style.cursor = "crosshair"; return; }
      const dr = E.drag; if (dr.p !== p) return;
      if (dr.kind === "path") dr.o.pts.push([x, y]); else if (dr.kind === "line") { dr.o.x2 = x; dr.o.y2 = y; } else if (dr.kind === "box") { dr.o.x = Math.min(dr.sx, x); dr.o.y = Math.min(dr.sy, y); dr.o.w = Math.abs(x - dr.sx); dr.o.h = Math.abs(y - dr.sy); }
      else { const dx = x - dr.x, dy = y - dr.y; const o = dr.o; if (o.type === "path") o.pts = o.pts.map((q) => [q[0] + dx, q[1] + dy]); else if (o.type === "arrow") { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; } else { o.x += dx; o.y += dy; } dr.x = x; dr.y = y; }
      this.draw(d, p.n);
    };
    ov.onpointerup = () => { const E = d.edits; if (E.drag && E.drag.kind === "box" && (E.drag.o.w < 2 || E.drag.o.h < 2)) { d.edits.objs[p.n] = this.list(d, p.n).filter((o) => o !== E.drag.o); E.undo.pop(); } if (E.drag && E.drag.kind) E.sel = this.mode === "draw" ? null : E.drag.o; E.drag = null; this.draw(d, p.n); };
    ov.ondblclick = (e) => { const [x, y] = this.toPdf(p, e); const o = this.hit(d, p, x, y); if (o && o.type === "text") { d.edits.sel = o; this.openText(d, p, o); } else if (o && o.type === "note") this.notePrompt(o.text).then((v) => { if (v != null) { this.snapPage(d, p.n); o.text = v; } }); };
  }
  notePrompt(value) { return new Promise((resolve) => { const body = modal(t("edit.note"), `<div class="form"><textarea id="noteTa" rows="5" dir="auto">${esc(value)}</textarea><div class="row end"><button class="btn" id="noteCancel">${esc(t("cancel"))}</button><button class="btn btn-primary" id="noteOk">${esc(t("ok"))}</button></div></div>`, { size: "sm", onClose: () => resolve(null) }); const ta = $("#noteTa", body); setTimeout(() => ta.focus(), 30); $("#noteOk", body).onclick = () => { const v = ta.value; closeModal(); resolve(v); }; $("#noteCancel", body).onclick = () => closeModal(); }); }

  // ---------- images & signature ----------
  async pickImage() { const b = bridge(); if (b && b.openImageDialog) { const paths = await b.openImageDialog(); if (!paths || !paths.length) return; const bytes = new Uint8Array(await b.readFile(paths[0])); const mime = /\.png$/i.test(paths[0]) ? "image/png" : /\.jpe?g$/i.test(paths[0]) ? "image/jpeg" : /\.webp$/i.test(paths[0]) ? "image/webp" : "image/png"; await this.useImageBytes(bytes, mime); } else $("#edImgInput").click(); }
  async useImageFile(f) { await this.useImageBytes(new Uint8Array(await f.arrayBuffer()), f.type || "image/png"); }
  async useImageBytes(bytes, mime) { const img = new Image(); img.src = URL.createObjectURL(new Blob([bytes], { type: mime })); await img.decode(); this.pendingImage = { img, bytes, mime }; $("#edHint").textContent = t("edit.hint.image"); const d = this.doc(); if (d) { const p = d.pages[d.current - 1]; if (p && p.ov) { this.snapPage(d, p.n); const w = Math.min(p.base.w * 0.4, img.width * 0.5), h = w * img.height / img.width; const o = { type: "image", n: p.n, x: (p.base.w - w) / 2, y: (p.base.h - h) / 2, w, h, img, bytes, mime }; this.list(d, p.n).push(o); d.edits.sel = o; this.pendingImage = null; this.setMode("select"); d.edits.sel = o; this.draw(d, p.n); } } }
  signatureDialog() {
    const body = modal(t("sig.title"), `<div class="form"><div class="row"><div class="seg"><button class="on" id="sigDraw">${esc(t("sig.draw"))}</button><button id="sigType">${esc(t("sig.type"))}</button></div><span class="sp"></span><label class="ed-opt">${esc(t("edit.color"))} <input type="color" id="sigColor" value="#102a6b"></label></div>
      <canvas class="sigpad" id="sigPad" width="900" height="300"></canvas><div id="sigTypeBox" hidden><input type="text" id="sigName" placeholder="${esc(t("sig.typePlaceholder"))}" style="height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;width:100%;margin-bottom:8px"><div class="sigtype" id="sigPreview"></div></div>
      <div class="row end"><button class="btn" id="sigClear">${esc(t("sig.clear"))}</button><button class="btn btn-primary" id="sigUse">${esc(t("sig.use"))}</button></div></div>`, { size: "sm" });
    const pad = $("#sigPad", body), ctx = pad.getContext("2d"); let drawing = false, drew = false, typed = false; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const pt = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    pad.onpointerdown = (e) => { drawing = true; drew = true; pad.setPointerCapture(e.pointerId); ctx.strokeStyle = $("#sigColor", body).value; ctx.beginPath(); const [x, y] = pt(e); ctx.moveTo(x, y); };
    pad.onpointermove = (e) => { if (!drawing) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); }; pad.onpointerup = () => { drawing = false; };
    $("#sigDraw", body).onclick = () => { typed = false; $("#sigDraw", body).classList.add("on"); $("#sigType", body).classList.remove("on"); pad.hidden = false; $("#sigTypeBox", body).hidden = true; };
    $("#sigType", body).onclick = () => { typed = true; $("#sigType", body).classList.add("on"); $("#sigDraw", body).classList.remove("on"); pad.hidden = true; $("#sigTypeBox", body).hidden = false; $("#sigName", body).focus(); };
    $("#sigName", body).oninput = (e) => { $("#sigPreview", body).textContent = e.target.value; $("#sigPreview", body).style.color = $("#sigColor", body).value; };
    $("#sigClear", body).onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); drew = false; $("#sigName", body).value = ""; $("#sigPreview", body).textContent = ""; };
    $("#sigUse", body).onclick = async () => {
      let src = pad; if (typed) { const name = $("#sigName", body).value.trim(); if (!name) return; const c = document.createElement("canvas"); c.width = 900; c.height = 260; const x = c.getContext("2d"); x.font = "110px 'Brush Script MT','Segoe Script',cursive"; x.fillStyle = $("#sigColor", body).value; x.textBaseline = "middle"; x.fillText(name, 30, 130); src = c; } else if (!drew) return;
      const trimmed = trimCanvas(src); const blob = await new Promise((r) => trimmed.toBlob(r, "image/png")); const bytes = new Uint8Array(await blob.arrayBuffer()); closeModal(); await this.useImageBytes(bytes, "image/png");
    };
  }

  // ---------- save: write objects into the PDF with pdf-lib ----------
  async flatten(d) {
    this.commitText(); if (!this.hasEdits(d)) return d.bytes;
    const L = PDFLib(); const doc = await loadDoc(d.bytes); const helv = await doc.embedFont(L.StandardFonts.Helvetica), helvB = await doc.embedFont(L.StandardFonts.HelveticaBold);
    const rgbOf = (hex) => { const c = hexToRgb(hex || "#000000"); return L.rgb(c.r, c.g, c.b); };
    for (const [n, arr] of Object.entries(d.edits.objs)) {
      if (!arr.length) continue; const page = doc.getPage(+n - 1); const { height: ph } = page.getSize();
      for (const o of arr) {
        if (o.type === "whiteout") page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: L.rgb(1, 1, 1) });
        else if (o.type === "highlight") page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: rgbOf(o.color || "#ffe600"), opacity: 0.4, blendMode: "Multiply" });
        else if (o.type === "rect") page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, borderColor: rgbOf(o.color), borderWidth: o.width });
        else if (o.type === "ellipse") page.drawEllipse({ x: o.x + o.w / 2, y: o.y + o.h / 2, xScale: o.w / 2, yScale: o.h / 2, borderColor: rgbOf(o.color), borderWidth: o.width });
        else if (o.type === "arrow") { page.drawLine({ start: { x: o.x1, y: o.y1 }, end: { x: o.x2, y: o.y2 }, thickness: o.width, color: rgbOf(o.color) }); const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1); const hl = Math.max(8, o.width * 4); for (const s of [-0.5, 0.5]) page.drawLine({ start: { x: o.x2, y: o.y2 }, end: { x: o.x2 - hl * Math.cos(a + s), y: o.y2 - hl * Math.sin(a + s) }, thickness: o.width, color: rgbOf(o.color) }); }
        else if (o.type === "path" && o.pts.length > 1) page.drawSvgPath(o.pts.map((q, i) => `${i ? "L" : "M"} ${q[0].toFixed(2)} ${(ph - q[1]).toFixed(2)}`).join(" "), { x: 0, y: ph, borderColor: rgbOf(o.color), borderWidth: o.width, borderLineCap: L.LineCapStyle.Round });
        else if (o.type === "image" && o.bytes) { const img = await embedImage(doc, o.bytes, o.mime); page.drawImage(img, { x: o.x, y: o.y, width: o.w, height: o.h }); }
        else if (o.type === "note") { const annot = doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [o.x, o.y - 18, o.x + 18, o.y], Contents: L.PDFHexString.fromText(o.text), T: L.PDFHexString.fromText("LovePDF"), Name: "Comment", C: [1, 0.75, 0.14], F: 4, Open: false }); const annots = page.node.lookup(L.PDFName.of("Annots")); const ref = doc.context.register(annot); if (annots) annots.push(ref); else page.node.set(L.PDFName.of("Annots"), doc.context.obj([ref])); }
        else if (o.type === "text" && String(o.text).trim()) {
          const font = o.bold ? helvB : helv; const lines = String(o.text).split("\n"); let ok = true; try { font.encodeText(o.text.replace(/\n/g, " ")); } catch { ok = false; }
          if (ok) lines.forEach((line, i) => page.drawText(line, { x: o.x, y: o.y - i * o.size * 1.2, size: o.size, font, color: rgbOf(o.color) }));
          else { const S = 3; const c = document.createElement("canvas"); const ctx = c.getContext("2d"); ctx.font = FONT(o, S); const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 4 * S, h = o.size * 1.2 * lines.length * S + 2 * S; c.width = Math.ceil(w); c.height = Math.ceil(h); const c2 = c.getContext("2d"); c2.font = FONT(o, S); c2.fillStyle = o.color; c2.textBaseline = "alphabetic"; lines.forEach((l, i) => c2.fillText(l, 2 * S, o.size * S + i * o.size * 1.2 * S)); const png = await doc.embedPng(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer()); page.drawImage(png, { x: o.x - 2, y: o.y - (o.size * 1.2 * (lines.length - 1)) - o.size * 0.25, width: c.width / S, height: c.height / S }); }
        }
      }
    }
    const bytes = await doc.save({ useObjectStreams: false }); d.edits.objs = {}; d.edits.undo = []; d.edits.redo = []; d.edits.sel = null; d.edits.textItems = {}; return bytes;
  }
}
function trimCanvas(c) { const ctx = c.getContext("2d"); const d = ctx.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (x1 <= x0) return c; const o = document.createElement("canvas"); o.width = x1 - x0 + 20; o.height = y1 - y0 + 20; o.getContext("2d").drawImage(c, x0 - 10, y0 - 10, o.width, o.height, 0, 0, o.width, o.height); return o; }
