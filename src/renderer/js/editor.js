// Edit mode: per-page overlay canvases with vector objects (text, draw, highlight, shapes, whiteout, images, signature,
// notes, "edit text" = cover + retype) and a visual Crop tool. Objects live in PDF user space (origin bottom-left);
// the overlay canvas uses the pdf.js viewport transform, so rotated pages and any zoom work the same way.
import { $, $$, el, esc, hexToRgb, hexA, modal, closeModal, toast, loadDoc, PDFLib, embedImage, bridge, loadPdfJs } from "./util.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";

export const MODES = ["select", "edittext", "cutout", "text", "draw", "highlight", "rect", "ellipse", "arrow", "whiteout", "image", "signature", "note"];
const ICON = { select: "pointer", edittext: "edittext", cutout: "scissors", text: "type", draw: "pen", highlight: "highlight", rect: "square", ellipse: "circle", arrow: "arrow", whiteout: "eraser", image: "image", signature: "sign", note: "note" };
const FONT = (o, s = 1) => `${o.bold ? "bold " : ""}${o.size * s}px Helvetica, Arial, "Noto Nastaliq Urdu", sans-serif`;
const BOXES = new Set(["rect", "ellipse", "highlight", "whiteout", "image"]);
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export class Editor {
  constructor(app) {
    this.app = app; this.mode = "select"; this.pendingImage = null; this.textBox = null; this.crop = null;
    this.rebuildBar();
    $("#edSize").oninput = (e) => { $("#edSizeV").textContent = e.target.value; const d = this.doc(); if (!d) return; const sel = d.edits.sel; if (sel && sel.type === "text") { this.snapPage(d, sel.n); sel.size = +e.target.value; this.draw(d, sel.n); } else if (sel && sel.width != null) { this.snapPage(d, sel.n); sel.width = Math.max(1, +e.target.value / 4); this.draw(d, sel.n); } };
    $("#edColor").oninput = (e) => { const d = this.doc(); if (!d) return; const sel = d.edits.sel; if (sel && sel.color !== undefined && sel.type !== "whiteout") { this.snapPage(d, sel.n); sel.color = e.target.value; this.draw(d, sel.n); } };
    $("#edBold").onchange = (e) => { const d = this.doc(); if (!d) return; const sel = d.edits.sel; if (sel && sel.type === "text") { this.snapPage(d, sel.n); sel.bold = e.target.checked; this.draw(d, sel.n); } };
    $("#edUndo").onclick = () => this.undo(); $("#edRedo").onclick = () => this.redo(); $("#edDel").onclick = () => this.deleteSel();
    $("#ocrPage").onclick = () => { const d = this.doc(); if (d) this.app.tools.ocrEditable(d, "page"); }; $("#ocrAll").onclick = () => { const d = this.doc(); if (d) this.app.tools.ocrEditable(d, "all"); }; $("#ocrClose").onclick = () => { this.ocrDismissed = true; this.hideOcrBar(); $("#edHint").textContent = t("edit.hint.overImage"); };
    $("#edImgInput").onchange = async () => { const f = $("#edImgInput").files[0]; $("#edImgInput").value = ""; if (f) await this.useImageFile(f); };
    document.addEventListener("keydown", (e) => {
      const d = this.doc(); if (!d || this.textBox) return; const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return;
      const sel = d.edits.sel;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); this.deleteSel(); }
      else if (e.key === "Escape") { if (this.crop) this.cancelCrop(); else { d.edits.sel = null; this.draw(d); } }
      else if (sel && /^Arrow/.test(e.key)) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; const dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? st : e.key === "ArrowDown" ? -st : 0; this.snapPage(d, sel.n); this.moveObj(sel, dx, dy); this.draw(d, sel.n); }
    });
  }
  rebuildBar() {
    const bar = $("#edModes"); bar.innerHTML = MODES.map((m) => `<button data-m="${m}" class="${m === this.mode ? "on" : ""}" title="${esc(t("edit." + m))}">${icon(ICON[m])}<span>${esc(t("edit." + m))}</span></button>`).join("");
    $$("button", bar).forEach((b) => (b.onclick = () => this.setMode(b.dataset.m))); $("#edHint").textContent = t("edit.hint." + this.mode);
  }
  doc() { const d = this.app.current(); return d && d.edits && d.edits.active ? d : null; }
  color() { return $("#edColor").value; } size() { return +$("#edSize").value; } bold() { return $("#edBold").checked; }

  // ---------- enter / leave ----------
  async enter(d) {
    if (!d.edits) d.edits = { active: false, objs: {}, textItems: {}, imageItems: {}, undo: [], redo: [], sel: null, drag: null, hover: null }; if (!d.edits.imageItems) d.edits.imageItems = {};
    d.edits.active = true; if (d.rotation) { d.rotation = 0; d.relayout(); }
    $("#editbar").hidden = false; this.app.viewport.classList.add("editing"); this.setMode(this.mode); this.attachAll(d);
  }
  leave(d) { this.commitText(); this.hideOcrBar(); if (this.crop) this.cancelCrop(); if (d && d.edits) { d.edits.active = false; d.edits.sel = null; for (const p of d.pages) if (p.ov) { p.ov.remove(); p.ov = null; p.octx = null; } } $("#editbar").hidden = true; this.app.viewport.classList.remove("editing"); }
  attachAll(d) { for (const p of d.pages) this.ensureOverlay(d, p); }
  ensureOverlay(d, p) {
    if (!d.edits || !d.edits.active || !p.el || !p.vp) return;
    if (!p.ov) { const ov = document.createElement("canvas"); ov.className = "ov"; p.el.appendChild(ov); p.ov = ov; p.octx = ov.getContext("2d"); this.bind(d, p); }
    this.resize(d, p); this.loadTextItems(d, p); this.loadImageItems(d, p);
  }
  resize(d, p) { if (!p.ov || !p.vp) return; const dpr = Math.min(3, window.devicePixelRatio || 1); p.ov.width = Math.round(p.vp.width * dpr); p.ov.height = Math.round(p.vp.height * dpr); p.ov.style.width = p.vp.width + "px"; p.ov.style.height = p.vp.height + "px"; p.octx = p.ov.getContext("2d"); p.dpr = dpr; this.draw(d, p.n); }
  async loadTextItems(d, p) {
    if (d.edits.textItems[p.n]) return; d.edits.textItems[p.n] = [];
    try { const tc = await p.base.page.getTextContent(); d.edits.textItems[p.n] = tc.items.filter((it) => it.str && it.str.trim()).map((it) => { const [a, b, c, dd, e, f] = it.transform; const h = Math.hypot(b, dd) || it.height || 10; return { x: e, y: f, w: it.width || it.str.length * h * 0.5, h, str: it.str }; }); } catch {}
    if (this.mode === "edittext") { this.draw(d, p.n); if (p.n === d.current) this.checkOcr(d); }
  }
  /** Scanned page in "Edit text" mode → offer OCR (bar under the toolbar) instead of a dead end. */
  checkOcr(d) { if (!d || !d.edits || !d.edits.active || this.mode !== "edittext") return this.hideOcrBar(); const items = d.edits.textItems[d.current]; if (!items) return; const scanned = items.length === 0; if (scanned && !this.ocrDismissed) { $("#ocrbar").hidden = false; $("#edHint").textContent = t("edit.hint.noText"); } else this.hideOcrBar(); }
  hideOcrBar() { $("#ocrbar").hidden = true; }
  vpRect(p, x, y, w, h) { const a = p.vp.convertToViewportPoint(x, y), b = p.vp.convertToViewportPoint(x + w, y + h); return [a[0], a[1], b[0], b[1]]; }
  /** Dominant colour of the rendered page just outside a PDF-space rect (so covers blend with coloured cells / headers). */
  sampleBg(p, x, y, w, h) {
    try {
      const c = p.canvas; if (!c || !p.vp) return "#ffffff"; const dpr = c.width / p.vp.width;
      const r = this.vpRect(p, x, y, w, h); const x0 = Math.max(0, Math.floor(Math.min(r[0], r[2]) * dpr) - 2), y0 = Math.max(0, Math.floor(Math.min(r[1], r[3]) * dpr) - 2), x1 = Math.min(c.width - 1, Math.ceil(Math.max(r[0], r[2]) * dpr) + 2), y1 = Math.min(c.height - 1, Math.ceil(Math.max(r[1], r[3]) * dpr) + 2);
      if (x1 <= x0 || y1 <= y0) return "#ffffff"; const ctx = c.getContext("2d", { willReadFrequently: true }); const counts = new Map(); let best = null, bestN = 0;
      const add = (px) => { for (let i = 0; i < px.length; i += 4) { const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3); const n = (counts.get(k) || 0) + 1; counts.set(k, n); if (n > bestN) { bestN = n; best = [px[i], px[i + 1], px[i + 2]]; } } };
      add(ctx.getImageData(x0, y0, x1 - x0, 2).data); add(ctx.getImageData(x0, y1 - 2, x1 - x0, 2).data); add(ctx.getImageData(x0, y0, 2, y1 - y0).data); add(ctx.getImageData(x1 - 2, y0, 2, y1 - y0).data);
      if (!best) return "#ffffff"; return "#" + best.map((v) => v.toString(16).padStart(2, "0")).join("");
    } catch { return "#ffffff"; }
  }
  /** Images (logos, pictures, scanned backgrounds) drawn on the page, as PDF-space rects — from the pdf.js operator list. */
  async loadImageItems(d, p) {
    if (d.edits.imageItems[p.n]) return; d.edits.imageItems[p.n] = [];
    try {
      const lib = await loadPdfJs(); const OPS = lib.OPS; const ol = await p.base.page.getOperatorList(); const out = [];
      let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i], a = ol.argsArray[i];
        if (fn === OPS.save) stack.push(ctm); else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; else if (fn === OPS.transform) ctm = mul(ctm, a);
        else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
          const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]); const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y; const pw = p.base.w, ph = p.base.h;
          if (w > 4 && h > 4 && !(w >= pw * 0.98 && h >= ph * 0.98)) out.push({ x, y, w, h }); // skip full-page scan backgrounds
        }
      }
      d.edits.imageItems[p.n] = out.slice(0, 200);
    } catch (e) { console.warn("image items", e); }
    if (this.mode === "edittext") this.draw(d, p.n);
  }
  sampleInk(p, ti) { try { const c = p.canvas; if (!c) return null; const dpr = c.width / p.vp.width; const r = this.vpRect(p, ti.x, ti.y - ti.h * 0.25, ti.w, ti.h * 1.25); const x0 = Math.max(0, Math.floor(Math.min(r[0], r[2]) * dpr)), y0 = Math.max(0, Math.floor(Math.min(r[1], r[3]) * dpr)), w = Math.min(c.width - x0, Math.ceil(Math.abs(r[2] - r[0]) * dpr)), h = Math.min(c.height - y0, Math.ceil(Math.abs(r[3] - r[1]) * dpr)); if (w < 1 || h < 1) return null; const px = c.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, w, h).data; const bg = this.sampleBg(p, ti.x, ti.y - ti.h * 0.25, ti.w, ti.h * 1.25); const b = [parseInt(bg.slice(1, 3), 16), parseInt(bg.slice(3, 5), 16), parseInt(bg.slice(5, 7), 16)]; const counts = new Map(); let best = null, bestN = 0; for (let i = 0; i < px.length; i += 4) { const dist = Math.abs(px[i] - b[0]) + Math.abs(px[i + 1] - b[1]) + Math.abs(px[i + 2] - b[2]); if (dist < 120) continue; const k = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4); const n = (counts.get(k) || 0) + 1; counts.set(k, n); if (n > bestN) { bestN = n; best = [px[i], px[i + 1], px[i + 2]]; } } if (!best || bestN < 4) return null; return "#" + best.map((v) => v.toString(16).padStart(2, "0")).join(""); } catch { return null; } }
  imageHit(d, p, px, py) { const arr = d.edits.imageItems[p.n] || []; let best = null; for (const it of arr) if (px >= it.x && px <= it.x + it.w && py >= it.y && py <= it.y + it.h && (!best || it.w * it.h < best.w * best.h)) best = it; return best; }
  /** Turn a rectangle of the rendered page into a movable image object and cover the original (move / resize / delete any element). */
  async cutout(d, p, x, y, w, h, fromItem = null) {
    const c = p.canvas; if (!c) return; const dpr = c.width / p.vp.width; const r = this.vpRect(p, x, y, w, h);
    const sx = Math.max(0, Math.floor(Math.min(r[0], r[2]) * dpr)), sy = Math.max(0, Math.floor(Math.min(r[1], r[3]) * dpr)), sw = Math.min(c.width - sx, Math.ceil(Math.abs(r[2] - r[0]) * dpr)), sh = Math.min(c.height - sy, Math.ceil(Math.abs(r[3] - r[1]) * dpr)); if (sw < 2 || sh < 2) return;
    const scale = Math.max(1, Math.min(3, 1600 / Math.max(sw, sh) * (p.vp.scale > 2 ? 1 : 1))); const oc = document.createElement("canvas"); oc.width = Math.round(sw * scale); oc.height = Math.round(sh * scale); oc.getContext("2d").drawImage(c, sx, sy, sw, sh, 0, 0, oc.width, oc.height);
    const blob = await new Promise((res) => oc.toBlob(res, "image/png")); const bytes = new Uint8Array(await blob.arrayBuffer()); const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    this.snapPage(d, p.n); const bg = this.sampleBg(p, x, y, w, h);
    const cover = { type: "whiteout", n: p.n, x: x - 0.5, y: y - 0.5, w: w + 1, h: h + 1, color: bg, auto: true }; const o = { type: "image", n: p.n, x, y, w, h, img, bytes, mime: "image/png", cut: true };
    this.list(d, p.n).push(cover, o); if (fromItem) d.edits.imageItems[p.n] = (d.edits.imageItems[p.n] || []).filter((i) => i !== fromItem);
    this.mode = "select"; $$("#edModes button").forEach((b) => b.classList.toggle("on", b.dataset.m === "select")); $("#edHint").textContent = t("edit.hint.cut"); this.selectObj(d, o); this.draw(d, p.n);
  }
  setMode(m) {
    if (this.crop) this.cancelCrop(); this.mode = m; const d = this.doc(); if (d) { d.edits.sel = null; this.commitText(); }
    $$("#edModes button").forEach((b) => b.classList.toggle("on", b.dataset.m === m)); $("#edHint").textContent = t("edit.hint." + m);
    if (m === "image") this.pickImage(); if (m === "signature") this.signatureDialog(); if (d) this.draw(d);
    if (m === "edittext" && d) { this.ocrDismissed = false; const p = d.pages[d.current - 1]; if (p) this.loadTextItems(d, p); this.checkOcr(d); } else this.hideOcrBar();
  }
  list(d, n) { return (d.edits.objs[n] ||= []); }
  clone(o) { return JSON.parse(JSON.stringify(o, (k, v) => (k === "img" ? undefined : v))); }
  snapPage(d, n) { d.edits.undo.push({ n, data: this.list(d, n).map((o) => ({ ...this.clone(o), img: o.img })) }); if (d.edits.undo.length > 80) d.edits.undo.shift(); d.edits.redo = []; this.markDirty(d); }
  markDirty(d) { if (!d.dirty) { d.dirty = true; this.app.renderTabs(); } }
  undo() { const d = this.doc(); if (!d) return; const h = d.edits.undo.pop(); if (!h) return; d.edits.redo.push({ n: h.n, data: this.list(d, h.n).map((o) => ({ ...this.clone(o), img: o.img })) }); d.edits.objs[h.n] = h.data; d.edits.sel = null; this.draw(d, h.n); }
  redo() { const d = this.doc(); if (!d) return; const h = d.edits.redo.pop(); if (!h) return; d.edits.undo.push({ n: h.n, data: this.list(d, h.n).map((o) => ({ ...this.clone(o), img: o.img })) }); d.edits.objs[h.n] = h.data; d.edits.sel = null; this.draw(d, h.n); }
  deleteSel() { const d = this.doc(); if (!d || !d.edits.sel) return; const o = d.edits.sel; this.snapPage(d, o.n); d.edits.objs[o.n] = this.list(d, o.n).filter((x) => x !== o); d.edits.sel = null; this.draw(d, o.n); }
  duplicateSel() { const d = this.doc(); if (!d || !d.edits.sel) return; const o = d.edits.sel; this.snapPage(d, o.n); const c = { ...this.clone(o), img: o.img }; this.moveObj(c, 12, -12); this.list(d, o.n).push(c); this.selectObj(d, c); this.draw(d, o.n); }
  bringToFront() { const d = this.doc(); if (!d || !d.edits.sel) return; const o = d.edits.sel; this.snapPage(d, o.n); const a = this.list(d, o.n); a.splice(a.indexOf(o), 1); a.push(o); this.draw(d, o.n); }
  sendToBack() { const d = this.doc(); if (!d || !d.edits.sel) return; const o = d.edits.sel; this.snapPage(d, o.n); const a = this.list(d, o.n); a.splice(a.indexOf(o), 1); a.unshift(o); this.draw(d, o.n); }
  hasEdits(d) { return !!(d && d.edits && Object.values(d.edits.objs).some((a) => a.length)); }
  selectObj(d, o) { d.edits.sel = o; if (o) { if (o.type === "text") { $("#edSize").value = o.size; $("#edSizeV").textContent = o.size; $("#edBold").checked = !!o.bold; } if (o.color && o.type !== "highlight") $("#edColor").value = o.color; } }

  // ---------- geometry (PDF user space) ----------
  scaleOf(p) { return p.vp.scale; }
  toPdf(p, e) { const r = p.ov.getBoundingClientRect(); const [x, y] = p.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top); return [x, y]; }
  measure(p, line, o) { const c = p.octx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.font = FONT(o); const w = c.measureText(line).width; c.restore(); return w; }
  bbox(p, o) {
    if (o.type === "text") { const lines = String(o.text).split("\n"); const w = Math.max(...lines.map((l) => this.measure(p, l, o))); const h = o.size * 1.2 * lines.length; return { x: o.x, y: o.y - h + o.size, w, h }; }
    if (o.type === "path") { const xs = o.pts.map((q) => q[0]), ys = o.pts.map((q) => q[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
    if (o.type === "arrow") return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    if (o.type === "note") return { x: o.x, y: o.y - 18, w: 18, h: 18 };
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
  hit(d, p, px, py) { const arr = this.list(d, p.n); const tol = 4 / this.scaleOf(p); for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].auto) continue; const b = this.bbox(p, arr[i]); if (px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol) return arr[i]; } return null; }
  textHit(d, p, px, py) { return (d.edits.textItems[p.n] || []).find((ti) => px >= ti.x && px <= ti.x + ti.w && py >= ti.y - ti.h * 0.25 && py <= ti.y + ti.h); }
  handlesOf(p, o) {
    if (o.type === "arrow") return [{ id: "a", x: o.x1, y: o.y1 }, { id: "b", x: o.x2, y: o.y2 }];
    if (o.type === "note") return [];
    const b = this.bbox(p, o); const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const pts = { nw: [b.x, b.y + b.h], n: [cx, b.y + b.h], ne: [b.x + b.w, b.y + b.h], e: [b.x + b.w, cy], se: [b.x + b.w, b.y], s: [cx, b.y], sw: [b.x, b.y], w: [b.x, cy] };
    const ids = o.type === "text" || o.type === "path" ? ["nw", "ne", "se", "sw"] : HANDLES; return ids.map((id) => ({ id, x: pts[id][0], y: pts[id][1] }));
  }
  handleAt(p, o, px, py) { const tol = 9 / this.scaleOf(p); return this.handlesOf(p, o).find((h) => Math.abs(h.x - px) <= tol && Math.abs(h.y - py) <= tol) || null; }
  moveObj(o, dx, dy) { if (o.type === "path") o.pts = o.pts.map((q) => [q[0] + dx, q[1] + dy]); else if (o.type === "arrow") { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; } else { o.x += dx; o.y += dy; } }
  /** Resize `o` so that handle `id` moves to (px,py); `start` = snapshot of the object + bbox at drag start. */
  resizeObj(p, o, id, px, py, start, keepAspect) {
    if (o.type === "arrow") { if (id === "a") { o.x1 = px; o.y1 = py; } else { o.x2 = px; o.y2 = py; } return; }
    const b = start.b; let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    if (id.includes("w")) x0 = Math.min(px, x1 - 4); if (id.includes("e")) x1 = Math.max(px, x0 + 4); if (id.includes("s")) y0 = Math.min(py, y1 - 4); if (id.includes("n")) y1 = Math.max(py, y0 + 4);
    let nw = x1 - x0, nh = y1 - y0;
    if (keepAspect && b.w > 0 && b.h > 0 && id.length === 2) { const r = b.w / b.h; if (nw / nh > r) nw = nh * r; else nh = nw / r; if (id.includes("w")) x0 = x1 - nw; else x1 = x0 + nw; if (id.includes("s")) y0 = y1 - nh; else y1 = y0 + nh; }
    if (o.type === "text") { const k = Math.max(0.1, nw / Math.max(1, b.w)); o.size = Math.max(4, Math.round(start.o.size * k * 10) / 10); const nb = this.bbox(p, o); o.x = id.includes("w") ? x1 - nb.w : x0; o.y = (id.includes("s") ? y0 : y1 - nb.h) + nb.h - o.size; return; }
    if (o.type === "path") { const sx = nw / Math.max(1, b.w), sy = nh / Math.max(1, b.h); o.pts = start.o.pts.map((q) => [x0 + (q[0] - b.x) * sx, y0 + (q[1] - b.y) * sy]); return; }
    o.x = x0; o.y = y0; o.w = nw; o.h = nh;
  }

  // ---------- drawing ----------
  draw(d, onlyN = null) { for (const p of d.pages) { if (onlyN && p.n !== onlyN) continue; if (!p.ov || !p.octx) continue; this.drawPage(d, p); } }
  drawPage(d, p) {
    const ctx = p.octx, s = this.scaleOf(p), dpr = p.dpr || 1; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, p.ov.width, p.ov.height);
    const T = p.vp.transform; ctx.setTransform(T[0] * dpr, T[1] * dpr, T[2] * dpr, T[3] * dpr, T[4] * dpr, T[5] * dpr);
    if (this.crop && this.crop.n === p.n) return this.drawCrop(p);
    if (this.mode === "edittext") { ctx.setLineDash([4 / s, 3 / s]); ctx.strokeStyle = "rgba(150,60,220,.55)"; ctx.lineWidth = 1 / s; for (const it of d.edits.imageItems[p.n] || []) { if (it === d.edits.hover) { ctx.fillStyle = "rgba(150,60,220,.10)"; ctx.fillRect(it.x, it.y, it.w, it.h); } ctx.strokeRect(it.x, it.y, it.w, it.h); } ctx.setLineDash([]); ctx.strokeStyle = "rgba(0,140,255,.5)"; ctx.lineWidth = 1 / s; for (const ti of d.edits.textItems[p.n] || []) { if (ti === d.edits.hover) { ctx.fillStyle = "rgba(0,140,255,.12)"; ctx.fillRect(ti.x, ti.y - ti.h * 0.25, ti.w, ti.h * 1.25); } ctx.strokeRect(ti.x, ti.y - ti.h * 0.25, ti.w, ti.h * 1.25); } }
    for (const o of this.list(d, p.n)) if (!o.hidden) this.drawObj(ctx, o, true);
    const sel = d.edits.sel; if (sel && sel.n === p.n) { const b = this.bbox(p, sel); ctx.save(); ctx.setLineDash([5 / s, 4 / s]); ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 1.5 / s; ctx.strokeRect(b.x - 4 / s, b.y - 4 / s, b.w + 8 / s, b.h + 8 / s); ctx.setLineDash([]); const hs = 8 / s; for (const h of this.handlesOf(p, sel)) { ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 1.5 / s; ctx.beginPath(); if (sel.type === "arrow") ctx.arc(h.x, h.y, hs * 0.65, 0, Math.PI * 2); else ctx.rect(h.x - hs / 2, h.y - hs / 2, hs, hs); ctx.fill(); ctx.stroke(); } ctx.restore(); }
  }
  drawObj(ctx, o, screen) {
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (o.type === "whiteout") { ctx.fillStyle = o.color || "#ffffff"; ctx.fillRect(o.x, o.y, o.w, o.h); if (screen && !o.auto) { ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 0.5; ctx.strokeRect(o.x, o.y, o.w, o.h); } }
    else if (o.type === "highlight") { ctx.fillStyle = hexA(o.color || "#ffe600", 0.4); ctx.fillRect(o.x, o.y, o.w, o.h); }
    else if (o.type === "rect") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.strokeRect(o.x, o.y, o.w, o.h); }
    else if (o.type === "ellipse") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.max(0.5, o.w / 2), Math.max(0.5, o.h / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (o.type === "arrow") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1); const hl = Math.max(8, o.width * 4); ctx.beginPath(); ctx.moveTo(o.x2, o.y2); ctx.lineTo(o.x2 - hl * Math.cos(a - 0.5), o.y2 - hl * Math.sin(a - 0.5)); ctx.moveTo(o.x2, o.y2); ctx.lineTo(o.x2 - hl * Math.cos(a + 0.5), o.y2 - hl * Math.sin(a + 0.5)); ctx.stroke(); }
    else if (o.type === "path") { ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.beginPath(); o.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); }
    else if (o.type === "text") { ctx.translate(o.x, o.y); ctx.scale(1, -1); ctx.fillStyle = o.color; ctx.font = FONT(o); ctx.textBaseline = "alphabetic"; String(o.text).split("\n").forEach((line, i) => ctx.fillText(line, 0, i * o.size * 1.2)); }
    else if (o.type === "image" && o.img) { ctx.translate(o.x, o.y + o.h); ctx.scale(1, -1); ctx.drawImage(o.img, 0, 0, o.w, o.h); }
    else if (o.type === "note") { ctx.translate(o.x, o.y); ctx.scale(1, -1); ctx.fillStyle = "#fbbf24"; ctx.strokeStyle = "#92400e"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.roundRect(0, 0, 18, 18, 3); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#000"; ctx.font = "11px sans-serif"; ctx.fillText("✎", 4, 13); }
    ctx.restore();
  }

  // ---------- inline text box ----------
  openText(d, p, o) {
    this.commitText(); const s = this.scaleOf(p); const b = this.bbox(p, o); const [cx, cy] = p.vp.convertToViewportPoint(o.x, o.y + o.size);
    const ta = document.createElement("textarea"); ta.className = "ed-textbox"; ta.value = o.text; ta.dir = "auto";
    ta.style.left = (cx - 2) + "px"; ta.style.top = (cy - 1) + "px"; ta.style.font = FONT(o, s); ta.style.color = o.color; ta.style.width = Math.max(120, b.w * s + 40) + "px"; ta.rows = Math.max(1, o.text.split("\n").length);
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
      const [x, y] = this.toPdf(p, e); const E = d.edits; const n = p.n; const mode = this.mode;
      if (this.crop) return this.cropDown(p, x, y, e);
      ov.setPointerCapture(e.pointerId);
      // grab a handle / the selected object in any mode
      const sel = E.sel; if (sel && sel.n === n) { const h = this.handleAt(p, sel, x, y); if (h) { this.snapPage(d, n); E.drag = { kind: "resize", o: sel, h: h.id, start: { o: this.clone(sel), b: this.bbox(p, sel) }, p }; return; } if (mode === "select" || ["image", "text", "note", "rect", "ellipse"].includes(sel.type)) { const hb = this.bbox(p, sel); const tol = 4 / this.scaleOf(p); if (x >= hb.x - tol && x <= hb.x + hb.w + tol && y >= hb.y - tol && y <= hb.y + hb.h + tol) { this.snapPage(d, n); E.drag = { kind: "move", o: sel, x, y, p }; return; } } }
      if (mode === "select") { const o = this.hit(d, p, x, y); this.selectObj(d, o); if (o) { this.snapPage(d, n); E.drag = { kind: "move", o, x, y, p }; } this.draw(d); return; }
      if (mode === "edittext") {
        const ti = this.textHit(d, p, x, y);
        if (!ti) { const o = this.hit(d, p, x, y); if (o && o.type === "text") { this.selectObj(d, o); this.openText(d, p, o); return; } if (o) { this.selectObj(d, o); this.snapPage(d, n); E.drag = { kind: "move", o, x, y, p }; this.draw(d); return; } const im = this.imageHit(d, p, x, y); if (im) { ov.releasePointerCapture(e.pointerId); this.cutout(d, p, im.x, im.y, im.w, im.h, im); return; } if (!(E.textItems[n] || []).length) { this.ocrDismissed = false; this.checkOcr(d); } return; }
        this.snapPage(d, n); const cx = ti.x - 1, cy = ti.y - ti.h * 0.3, cw = ti.w + 2, ch = ti.h * 1.45; const bg = this.sampleBg(p, cx, cy, cw, ch); const tc = this.sampleInk(p, ti) || "#000000";
        const wo = { type: "whiteout", n, x: cx, y: cy, w: cw, h: ch, color: bg, auto: true }; const tx = { type: "text", n, x: ti.x, y: ti.y, size: Math.max(6, Math.round(ti.h * 10) / 10), color: tc, text: ti.str, bold: false }; this.list(d, n).push(wo, tx); E.textItems[n] = E.textItems[n].filter((i) => i !== ti); this.selectObj(d, tx); this.openText(d, p, tx); return; }
      if (mode === "cutout") { E.drag = { kind: "cut", sx: x, sy: y, x, y, p }; this.draw(d, n); return; }
      if (mode === "text") { this.snapPage(d, n); const o = { type: "text", n, x, y, size: this.size(), color: this.color(), text: "", bold: this.bold() }; this.list(d, n).push(o); this.selectObj(d, o); this.openText(d, p, o); return; }
      if (mode === "note") { const text = await this.notePrompt(""); if (text == null || !text.trim()) return; this.snapPage(d, n); const o = { type: "note", n, x, y, text }; this.list(d, n).push(o); this.selectObj(d, o); this.draw(d, n); return; }
      if (mode === "image" || mode === "signature") { const pi = this.pendingImage; if (pi) { this.placeImage(d, p, pi, x, y); } else if (mode === "image") this.pickImage(); else this.signatureDialog(); return; }
      this.snapPage(d, n);
      if (mode === "draw") { const o = { type: "path", n, pts: [[x, y]], color: this.color(), width: Math.max(1, this.size() / 4) }; this.list(d, n).push(o); E.drag = { kind: "path", o, p }; }
      else if (mode === "arrow") { const o = { type: "arrow", n, x1: x, y1: y, x2: x, y2: y, color: this.color(), width: Math.max(1, this.size() / 4) }; this.list(d, n).push(o); E.drag = { kind: "line", o, p }; }
      else { const o = { type: mode, n, x, y, w: 0, h: 0, color: mode === "highlight" ? "#ffe600" : this.color(), width: Math.max(1, this.size() / 4) }; this.list(d, n).push(o); E.drag = { kind: "box", o, sx: x, sy: y, p }; }
    };
    ov.onpointermove = (e) => {
      if (!d.edits.active) return; const [x, y] = this.toPdf(p, e); const E = d.edits;
      if (this.crop) return this.cropMove(p, x, y, e);
      if (!E.drag) { const sel = E.sel; let cur = "default"; if (sel && sel.n === p.n) { const h = this.handleAt(p, sel, x, y); if (h) cur = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", a: "move", b: "move" }[h.id]; else { const hb = this.bbox(p, sel); if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) cur = "move"; } }
        if (cur === "default") { if (this.mode === "edittext") { const ti = this.textHit(d, p, x, y); const hv = ti || this.imageHit(d, p, x, y) || null; if (hv !== E.hover) { E.hover = hv; this.draw(d, p.n); } cur = ti ? "text" : hv ? "move" : (this.hit(d, p, x, y) ? "move" : "default"); } else if (this.mode === "cutout") cur = "crosshair"; else if (this.mode === "select") cur = this.hit(d, p, x, y) ? "move" : "default"; else cur = "crosshair"; }
        ov.style.cursor = cur; return; }
      const dr = E.drag; if (dr.p !== p) return;
      if (dr.kind === "cut") { dr.x = x; dr.y = y; this.draw(d, p.n); const c = p.octx, s2 = this.scaleOf(p); c.save(); c.setLineDash([5 / s2, 4 / s2]); c.strokeStyle = "#9333ea"; c.lineWidth = 1.5 / s2; c.fillStyle = "rgba(147,51,234,.08)"; const rx = Math.min(dr.sx, x), ry = Math.min(dr.sy, y), rw = Math.abs(x - dr.sx), rh = Math.abs(y - dr.sy); c.fillRect(rx, ry, rw, rh); c.strokeRect(rx, ry, rw, rh); c.restore(); return; }
      if (dr.kind === "path") dr.o.pts.push([x, y]); else if (dr.kind === "line") { dr.o.x2 = x; dr.o.y2 = y; } else if (dr.kind === "box") { dr.o.x = Math.min(dr.sx, x); dr.o.y = Math.min(dr.sy, y); dr.o.w = Math.abs(x - dr.sx); dr.o.h = Math.abs(y - dr.sy); }
      else if (dr.kind === "resize") this.resizeObj(p, dr.o, dr.h, x, y, dr.start, dr.o.type === "image" ? !e.shiftKey : e.shiftKey);
      else { this.moveObj(dr.o, x - dr.x, y - dr.y); dr.x = x; dr.y = y; }
      this.draw(d, p.n);
    };
    ov.onpointerup = (e) => { if (this.crop) return this.cropUp(); const E = d.edits; if (E.drag && E.drag.kind === "cut") { const dr = E.drag; E.drag = null; const rx = Math.min(dr.sx, dr.x), ry = Math.min(dr.sy, dr.y), rw = Math.abs(dr.x - dr.sx), rh = Math.abs(dr.y - dr.sy); if (rw > 3 && rh > 3) this.cutout(d, p, rx, ry, rw, rh); else this.draw(d, p.n); return; } if (E.drag && E.drag.kind === "box" && (E.drag.o.w < 2 || E.drag.o.h < 2)) { d.edits.objs[p.n] = this.list(d, p.n).filter((o) => o !== E.drag.o); E.undo.pop(); } if (E.drag && ["box", "line", "path"].includes(E.drag.kind)) this.selectObj(d, this.mode === "draw" ? null : E.drag.o); E.drag = null; this.draw(d, p.n); };
    ov.oncontextmenu = (e) => { e.preventDefault(); const [x, y] = this.toPdf(p, e); const o = this.hit(d, p, x, y); if (o) { this.selectObj(d, o); this.draw(d, p.n); this.app.objectMenu(d, p, o, { x: e.clientX, y: e.clientY }); } else this.app.pageMenu([p.n], { x: e.clientX, y: e.clientY }, { viewer: true }); };
    ov.ondblclick = (e) => { const [x, y] = this.toPdf(p, e); const o = this.hit(d, p, x, y); if (o && o.type === "text") { this.selectObj(d, o); this.openText(d, p, o); } else if (o && o.type === "note") this.notePrompt(o.text).then((v) => { if (v != null) { this.snapPage(d, p.n); o.text = v; } }); };
  }
  notePrompt(value) { return new Promise((resolve) => { const body = modal(t("edit.note"), `<div class="form"><textarea id="noteTa" rows="5" dir="auto">${esc(value)}</textarea><div class="row end"><button class="btn" id="noteCancel">${esc(t("cancel"))}</button><button class="btn btn-primary" id="noteOk">${esc(t("ok"))}</button></div></div>`, { size: "sm", onClose: () => resolve(null) }); const ta = $("#noteTa", body); setTimeout(() => ta.focus(), 30); $("#noteOk", body).onclick = () => { const v = ta.value; closeModal(); resolve(v); }; $("#noteCancel", body).onclick = () => closeModal(); }); }

  // ---------- images & signature ----------
  placeImage(d, p, pi, x, y) { this.snapPage(d, p.n); const w = Math.min(p.base.w * 0.4, pi.img.width * 0.5), h = w * pi.img.height / pi.img.width; const o = { type: "image", n: p.n, x: x - w / 2, y: y - h / 2, w, h, img: pi.img, bytes: pi.bytes, mime: pi.mime }; this.list(d, p.n).push(o); this.pendingImage = null; this.mode = "select"; $$("#edModes button").forEach((b) => b.classList.toggle("on", b.dataset.m === "select")); $("#edHint").textContent = t("edit.hint.placed"); this.selectObj(d, o); this.draw(d, p.n); }
  async pickImage() { const b = bridge(); if (b && b.openImageDialog) { const paths = await b.openImageDialog(); if (!paths || !paths.length) return; const bytes = new Uint8Array(await b.readFile(paths[0])); const mime = /\.png$/i.test(paths[0]) ? "image/png" : /\.jpe?g$/i.test(paths[0]) ? "image/jpeg" : /\.webp$/i.test(paths[0]) ? "image/webp" : "image/png"; await this.useImageBytes(bytes, mime); } else $("#edImgInput").click(); }
  async useImageFile(f) { await this.useImageBytes(new Uint8Array(await f.arrayBuffer()), f.type || "image/png"); }
  async useImageBytes(bytes, mime) {
    const img = new Image(); img.src = URL.createObjectURL(new Blob([bytes], { type: mime })); await img.decode(); this.pendingImage = { img, bytes, mime }; const d = this.doc(); if (!d) return;
    // place at the centre of what the user currently sees
    const vr = this.app.viewport.getBoundingClientRect(); const cx = vr.left + vr.width / 2, cy = vr.top + vr.height / 2;
    let p = d.pages.find((q) => q.ov && (() => { const r = q.ov.getBoundingClientRect(); return cy >= r.top && cy <= r.bottom; })()) || d.pages[d.current - 1]; if (!p || !p.ov) return;
    const r = p.ov.getBoundingClientRect(); const [x, y] = p.vp.convertToPdfPoint(Math.min(Math.max(cx - r.left, 0), r.width), Math.min(Math.max(cy - r.top, 0), r.height)); this.placeImage(d, p, this.pendingImage, x, y);
  }
  signatureDialog() {
    const body = modal(t("sig.title"), `<div class="form"><div class="row"><div class="seg"><button class="on" id="sigDraw">${esc(t("sig.draw"))}</button><button id="sigType">${esc(t("sig.type"))}</button></div><span class="sp"></span><label class="ed-opt">${esc(t("edit.color"))} <input type="color" id="sigColor" value="#102a6b"></label></div>
      <canvas class="sigpad" id="sigPad" width="900" height="300"></canvas><div id="sigTypeBox" hidden><input type="text" id="sigName" placeholder="${esc(t("sig.typePlaceholder"))}" style="height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;width:100%;margin-bottom:8px"><div class="sigtype" id="sigPreview"></div></div>
      <p class="hint">${esc(t("sig.hint"))}</p><div class="row end"><button class="btn" id="sigClear">${esc(t("sig.clear"))}</button><button class="btn btn-primary" id="sigUse">${esc(t("sig.use"))}</button></div></div>`, { size: "sm" });
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

  // ---------- visual crop ----------
  startCrop(d, pages = null) {
    if (!d) return; this.commitText(); d.edits.sel = null; this.cropPages = pages; const p = d.pages[d.current - 1]; if (!p || !p.ov) return;
    const one = $("#cropApply span"); if (one) one.textContent = pages && pages.length > 1 ? t("cropUi.applySel", { n: pages.length }) : t("cropUi.applyOne");
    this.cropPrevZoom = d.zoom; if (d.zoom !== "page") { d.setZoom("page"); } setTimeout(() => d.goTo(p.n), 50); // whole page visible while cropping
    const mb = p.base.page.view; // [x0, y0, x1, y1] in PDF units (crop box or media box)
    this.crop = { n: p.n, x0: mb[0], y0: mb[1], x1: mb[2], y1: mb[3], drag: null }; $("#cropbar").hidden = false; $("#edModes").classList.add("dim"); $("#edHint").textContent = t("cropUi.hint2"); this.draw(d, p.n);
  }
  cancelCrop() { const d = this.doc(); const n = this.crop && this.crop.n; this.crop = null; if (d && this.cropPrevZoom != null && this.cropPrevZoom !== d.zoom) { d.setZoom(this.cropPrevZoom); } this.cropPrevZoom = null; $("#cropbar").hidden = true; $("#edModes").classList.remove("dim"); $("#edHint").textContent = t("edit.hint." + this.mode); if (d && n) this.draw(d, n); }
  drawCrop(p) {
    const ctx = p.octx, s = this.scaleOf(p), c = this.crop; const v = p.base.page.view; ctx.fillStyle = "rgba(15,23,42,.45)"; ctx.beginPath(); ctx.rect(v[0] - 5, v[1] - 5, v[2] - v[0] + 10, v[3] - v[1] + 10); ctx.rect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0); ctx.fill("evenodd");
    ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 2 / s; ctx.strokeRect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0); ctx.setLineDash([4 / s, 4 / s]); ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1 / s; for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(c.x0 + (c.x1 - c.x0) * i / 3, c.y0); ctx.lineTo(c.x0 + (c.x1 - c.x0) * i / 3, c.y1); ctx.moveTo(c.x0, c.y0 + (c.y1 - c.y0) * i / 3); ctx.lineTo(c.x1, c.y0 + (c.y1 - c.y0) * i / 3); ctx.stroke(); } ctx.setLineDash([]);
    const hs = 10 / s; for (const h of this.cropHandles()) { ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 1.5 / s; ctx.beginPath(); ctx.rect(h.x - hs / 2, h.y - hs / 2, hs, hs); ctx.fill(); ctx.stroke(); }
    const mm = (v2) => (v2 / 72 * 25.4).toFixed(0); const info = $("#cropInfo"); if (info) info.textContent = `${mm(c.x1 - c.x0)} × ${mm(c.y1 - c.y0)} mm  ·  L ${mm(c.x0 - v[0])}  R ${mm(v[2] - c.x1)}  T ${mm(v[3] - c.y1)}  B ${mm(c.y0 - v[1])} mm`;
  }
  cropHandles() { const c = this.crop, cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2; return [{ id: "nw", x: c.x0, y: c.y1 }, { id: "n", x: cx, y: c.y1 }, { id: "ne", x: c.x1, y: c.y1 }, { id: "e", x: c.x1, y: cy }, { id: "se", x: c.x1, y: c.y0 }, { id: "s", x: cx, y: c.y0 }, { id: "sw", x: c.x0, y: c.y0 }, { id: "w", x: c.x0, y: cy }]; }
  cropDown(p, x, y, e) { if (this.crop.n !== p.n) return; p.ov.setPointerCapture(e.pointerId); const tol = 10 / this.scaleOf(p); const h = this.cropHandles().find((q) => Math.abs(q.x - x) <= tol && Math.abs(q.y - y) <= tol); const c = this.crop; const v = p.base.page.view; const full = (c.x1 - c.x0) >= (v[2] - v[0]) - 1 && (c.y1 - c.y0) >= (v[3] - v[1]) - 1; if (h) c.drag = { h: h.id }; else if (!full && x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) c.drag = { h: "move", x, y }; else c.drag = { h: "new", sx: x, sy: y }; }
  cropMove(p, x, y, e) {
    const c = this.crop; if (c.n !== p.n) return; const v = p.base.page.view; const cl = (val, a, b) => Math.max(a, Math.min(b, val));
    if (!c.drag) { const tol = 10 / this.scaleOf(p); const h = this.cropHandles().find((q) => Math.abs(q.x - x) <= tol && Math.abs(q.y - y) <= tol); p.ov.style.cursor = h ? ({ nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" })[h.id] : (x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1 ? "move" : "crosshair"); return; }
    const d = c.drag; const min = 20;
    if (d.h === "move") { const dx = cl(x - d.x, v[0] - c.x0, v[2] - c.x1), dy = cl(y - d.y, v[1] - c.y0, v[3] - c.y1); c.x0 += dx; c.x1 += dx; c.y0 += dy; c.y1 += dy; d.x += dx; d.y += dy; }
    else if (d.h === "new") { c.x0 = cl(Math.min(d.sx, x), v[0], v[2]); c.x1 = cl(Math.max(d.sx, x), v[0], v[2]); c.y0 = cl(Math.min(d.sy, y), v[1], v[3]); c.y1 = cl(Math.max(d.sy, y), v[1], v[3]); }
    else { if (d.h.includes("w")) c.x0 = cl(x, v[0], c.x1 - min); if (d.h.includes("e")) c.x1 = cl(x, c.x0 + min, v[2]); if (d.h.includes("s")) c.y0 = cl(y, v[1], c.y1 - min); if (d.h.includes("n")) c.y1 = cl(y, c.y0 + min, v[3]); }
    this.draw(this.doc(), p.n);
  }
  cropUp() { if (this.crop) { const c = this.crop; if (c.drag && c.drag.h === "new" && (c.x1 - c.x0 < 20 || c.y1 - c.y0 < 20)) { const d = this.doc(); const p = d.pages[c.n - 1]; const v = p.base.page.view; Object.assign(c, { x0: v[0], y0: v[1], x1: v[2], y1: v[3] }); this.draw(d, c.n); } c.drag = null; } }
  async applyCrop(all) {
    const d = this.doc(); const c = this.crop; if (!d || !c) return; const p = d.pages[c.n - 1]; const v = p.base.page.view; const ml = c.x0 - v[0], mr = v[2] - c.x1, mt = v[3] - c.y1, mb = c.y0 - v[1]; const sel = this.cropPages; this.cancelCrop();
    const bytes = this.hasEdits(d) ? await this.flatten(d) : d.bytes; const doc = await loadDoc(bytes);
    const pages = all === true ? doc.getPages() : Array.isArray(sel) && sel.length > 1 ? sel.map((n) => doc.getPage(n - 1)) : [doc.getPage(c.n - 1)];
    for (const pg of pages) { const box = pg.getCropBox(); const x0 = box.x + ml, y0 = box.y + mb, x1 = box.x + box.width - mr, y1 = box.y + box.height - mt; if (x1 - x0 < 20 || y1 - y0 < 20) continue; pg.setCropBox(x0, y0, x1 - x0, y1 - y0); }
    await d.replace(await doc.save({ useObjectStreams: false })); this.app.renderTabs(); toast(t("toast.applied"));
  }
  async autoCrop() { const d = this.doc(); const c = this.crop; if (!d || !c) return; const p = d.pages[c.n - 1]; const page = p.base.page; const vp = page.getViewport({ scale: 0.5 }); const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; const ctx = cv.getContext("2d"); await page.render({ canvasContext: ctx, viewport: vp }).promise; const im = ctx.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0; for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const i = (y * cv.width + x) * 4; if (im[i] < 235 || im[i + 1] < 235 || im[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } if (x1 <= x0) return; const pad = 6; const a = vp.convertToPdfPoint(Math.max(0, x0 - pad), Math.max(0, y0 - pad)), b = vp.convertToPdfPoint(Math.min(cv.width, x1 + pad), Math.min(cv.height, y1 + pad)); c.x0 = Math.min(a[0], b[0]); c.x1 = Math.max(a[0], b[0]); c.y0 = Math.min(a[1], b[1]); c.y1 = Math.max(a[1], b[1]); this.draw(d, c.n); }

  // ---------- save: write objects into the PDF with pdf-lib ----------
  async flatten(d) {
    this.commitText(); if (!this.hasEdits(d)) return d.bytes;
    const L = PDFLib(); const doc = await loadDoc(d.bytes); const helv = await doc.embedFont(L.StandardFonts.Helvetica), helvB = await doc.embedFont(L.StandardFonts.HelveticaBold);
    const rgbOf = (hex) => { const c = hexToRgb(hex || "#000000"); return L.rgb(c.r, c.g, c.b); };
    for (const [n, arr] of Object.entries(d.edits.objs)) {
      if (!arr.length) continue; const page = doc.getPage(+n - 1);
      for (const o of arr) {
        if (o.type === "whiteout") page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: rgbOf(o.color || "#ffffff") });
        else if (o.type === "highlight") page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: rgbOf(o.color || "#ffe600"), opacity: 0.4, blendMode: "Multiply" });
        else if (o.type === "rect") page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, borderColor: rgbOf(o.color), borderWidth: o.width });
        else if (o.type === "ellipse") page.drawEllipse({ x: o.x + o.w / 2, y: o.y + o.h / 2, xScale: o.w / 2, yScale: o.h / 2, borderColor: rgbOf(o.color), borderWidth: o.width });
        else if (o.type === "arrow") { page.drawLine({ start: { x: o.x1, y: o.y1 }, end: { x: o.x2, y: o.y2 }, thickness: o.width, color: rgbOf(o.color) }); const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1); const hl = Math.max(8, o.width * 4); for (const s of [-0.5, 0.5]) page.drawLine({ start: { x: o.x2, y: o.y2 }, end: { x: o.x2 - hl * Math.cos(a + s), y: o.y2 - hl * Math.sin(a + s) }, thickness: o.width, color: rgbOf(o.color) }); }
        else if (o.type === "path" && o.pts.length > 1) { const { height: ph } = page.getSize(); page.drawSvgPath(o.pts.map((q, i) => `${i ? "L" : "M"} ${q[0].toFixed(2)} ${(ph - q[1]).toFixed(2)}`).join(" "), { x: 0, y: ph, borderColor: rgbOf(o.color), borderWidth: o.width, borderLineCap: L.LineCapStyle.Round }); }
        else if (o.type === "image" && o.bytes) { const img = await embedImage(doc, o.bytes, o.mime); page.drawImage(img, { x: o.x, y: o.y, width: o.w, height: o.h }); }
        else if (o.type === "note") { const annot = doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [o.x, o.y - 18, o.x + 18, o.y], Contents: L.PDFHexString.fromText(o.text), T: L.PDFHexString.fromText("LovePDF"), Name: "Comment", C: [1, 0.75, 0.14], F: 4, Open: false }); const annots = page.node.lookup(L.PDFName.of("Annots")); const ref = doc.context.register(annot); if (annots) annots.push(ref); else page.node.set(L.PDFName.of("Annots"), doc.context.obj([ref])); }
        else if (o.type === "text" && String(o.text).trim()) {
          const font = o.bold ? helvB : helv; const lines = String(o.text).split("\n"); let ok = true; try { font.encodeText(o.text.replace(/\n/g, " ")); } catch { ok = false; }
          if (ok) lines.forEach((line, i) => page.drawText(line, { x: o.x, y: o.y - i * o.size * 1.2, size: o.size, font, color: rgbOf(o.color) }));
          else { const S = 3; const c = document.createElement("canvas"); const ctx = c.getContext("2d"); ctx.font = FONT(o, S); const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 4 * S, h = o.size * 1.2 * lines.length * S + 2 * S; c.width = Math.ceil(w); c.height = Math.ceil(h); const c2 = c.getContext("2d"); c2.font = FONT(o, S); c2.fillStyle = o.color; c2.textBaseline = "alphabetic"; lines.forEach((l, i) => c2.fillText(l, 2 * S, o.size * S + i * o.size * 1.2 * S)); const png = await doc.embedPng(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer()); page.drawImage(png, { x: o.x - 2, y: o.y - (o.size * 1.2 * (lines.length - 1)) - o.size * 0.25, width: c.width / S, height: c.height / S }); }
        }
      }
    }
    const bytes = await doc.save({ useObjectStreams: false }); d.edits.objs = {}; d.edits.undo = []; d.edits.redo = []; d.edits.sel = null; d.edits.textItems = {}; d.edits.imageItems = {}; return bytes;
  }
}
function trimCanvas(c) { const ctx = c.getContext("2d"); const d = ctx.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (x1 <= x0) return c; const o = document.createElement("canvas"); o.width = x1 - x0 + 20; o.height = y1 - y0 + 20; o.getContext("2d").drawImage(c, x0 - 10, y0 - 10, o.width, o.height, 0, 0, o.width, o.height); return o; }
