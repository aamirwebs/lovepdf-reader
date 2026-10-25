// Shared helpers: DOM, modal, toast, pdf.js loader, byte helpers.
import { t } from "./i18n.js";
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; };
export const fmtBytes = (n) => (n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB");
export const baseName = (p) => String(p || "").split(/[\\/]/).pop();
export const stripExt = (n) => String(n || "").replace(/\.[^.]+$/, "");
export const dirOf = (p) => { const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return i > 0 ? p.slice(0, i) : ""; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const debounce = (fn, ms) => { let t0; return (...a) => { clearTimeout(t0); t0 = setTimeout(() => fn(...a), ms); }; };
export const hexToRgb = (hex) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "") || ["", "00", "00", "00"]; return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 }; };
export const hexA = (hex, a) => { const c = hexToRgb(hex); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`; };

// ---- bridge (Electron preload, or the dev shim in a browser)
export const bridge = () => window.lovepdf;

// ---- pdf.js
let pdfjs = null;
export async function loadPdfJs() { if (pdfjs) return pdfjs; const m = await import("/vendor/pdf.min.mjs"); m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; pdfjs = m; return m; }
export async function openPdf(bytes, password) {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes), cMapUrl: "/vendor/cmaps/", cMapPacked: true, standardFontDataUrl: "/vendor/standard_fonts/", wasmUrl: "/vendor/wasm/", iccUrl: "/vendor/iccs/", password: password || undefined, enableXfa: true, isEvalSupported: false });
  return task.promise;
}
export const PDFLib = () => window.PDFLib;
export async function loadDoc(bytes, opts = {}) { const L = PDFLib(); try { return await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, ...opts }); } catch (e) { throw new Error("This PDF could not be edited (" + (e.message || e) + ")"); } }

// ---- toast / status / modal
let toastT = 0;
export function toast(msg, ms = 2200) { const el0 = $("#toast"); el0.textContent = msg; el0.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el0.hidden = true), ms); }
export function status(msg, right) { if (msg != null) $("#statusMsg").textContent = msg; if (right != null) $("#statusRight").textContent = right; }
let modalOnClose = null;
export function modal(title, bodyHtml, { size = "", onClose = null } = {}) {
  const m = $("#modal"); $("#modalTitle").textContent = title; const body = $("#modalBody"); body.innerHTML = typeof bodyHtml === "string" ? bodyHtml : ""; if (bodyHtml && typeof bodyHtml !== "string") body.appendChild(bodyHtml);
  m.querySelector(".modal-box").className = "modal-box " + size; m.hidden = false; modalOnClose = onClose; return body;
}
export function closeModal() { const m = $("#modal"); if (m.hidden) return; m.hidden = true; $("#modalBody").innerHTML = ""; const f = modalOnClose; modalOnClose = null; if (f) f(); }
$("#modalClose").addEventListener("click", closeModal); $("#modal").addEventListener("mousedown", (e) => { if (e.target === $("#modal")) closeModal(); });
export function prompt(title, { label = "", value = "", type = "text", okText = null } = {}) {
  return new Promise((resolve) => {
    const body = modal(title, `<div class="form"><label>${esc(label)}<input type="${type}" id="pmIn" value="${esc(value)}"></label><div class="row end"><button class="btn" id="pmCancel">${esc(t("cancel"))}</button><button class="btn btn-primary" id="pmOk">${esc(okText || t("ok"))}</button></div></div>`, { size: "sm", onClose: () => resolve(null) });
    const inp = $("#pmIn", body); setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = () => { const v = inp.value; modalOnClose = null; closeModal(); resolve(v); };
    $("#pmOk", body).onclick = done; $("#pmCancel", body).onclick = closeModal; inp.onkeydown = (e) => { if (e.key === "Enter") done(); };
  });
}
export async function confirm(message, detail = "", buttons = [t("ok"), t("cancel")]) { const b = bridge(); if (b && b.confirm) return b.confirm(message, detail, buttons); return window.confirm(message + (detail ? "\n" + detail : "")) ? 0 : buttons.length - 1; }

// ---- page ranges "1-3, 5, 8-"
export function parsePages(spec, total) { spec = String(spec || "").trim().toLowerCase(); if (!spec || spec === "all") return Array.from({ length: total }, (_, i) => i + 1); const out = new Set(); for (const part of spec.split(/[,\s]+/).filter(Boolean)) { const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(part); if (m) { const a = Math.max(1, +(m[1] || 1)), b = Math.min(total, +(m[2] || total)); for (let i = a; i <= b; i++) out.add(i); } else if (/^\d+$/.test(part)) { const n = +part; if (n >= 1 && n <= total) out.add(n); } } return [...out].sort((a, b) => a - b); }
export function parseRanges(spec, total) { const groups = []; for (const part of String(spec || "").split(",").map((s) => s.trim()).filter(Boolean)) { const pages = parsePages(part, total); if (pages.length) groups.push(pages); } return groups; }

// ---- image helpers
export async function imageToPng(bytes, mime) { const blob = new Blob([bytes], { type: mime }); const bmp = await createImageBitmap(blob); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; c.getContext("2d").drawImage(bmp, 0, 0); return new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer()); }
export async function embedImage(doc, bytes, mime) { if (/png/i.test(mime)) return doc.embedPng(bytes); if (/jpe?g/i.test(mime)) return doc.embedJpg(bytes); return doc.embedPng(await imageToPng(bytes, mime)); }
