// Popup menus (menubar dropdowns, toolbar dropdowns, right-click context menus) rendered in a fixed body-level layer,
// so they are never clipped by the toolbar's overflow and always stay inside the window. Keyboard: ↑ ↓ Enter Esc.
import { esc } from "./util.js";
import { icon } from "./icons.js";

let layer = null;
let open = []; // stack of open menu elements (root + submenus)
function ensureLayer() { if (layer) return layer; layer = document.createElement("div"); layer.id = "popups"; document.body.appendChild(layer); document.addEventListener("pointerdown", (e) => { if (!layer.contains(e.target)) closePopups(); }, true); window.addEventListener("blur", closePopups); window.addEventListener("resize", closePopups); document.addEventListener("keydown", onKey, true); return layer; }
export function closePopups() { if (!open.length) return; for (const m of open) m.remove(); open = []; document.querySelectorAll(".mb-item.open").forEach((b) => b.classList.remove("open")); }
export function isPopupOpen() { return open.length > 0; }

/** items: [{ label, icon, shortcut, action(), disabled, checked, sub: [items], hint }] or { sep: true } or { title } */
export function popup(items, { x = 0, y = 0, anchor = null, align = "start", parent = null, minWidth = 220, onClose = null } = {}) {
  ensureLayer(); if (!parent) closePopups();
  const m = document.createElement("div"); m.className = "pm"; m.style.minWidth = minWidth + "px"; m.tabIndex = -1;
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.appendChild(Object.assign(document.createElement("div"), { className: "pm-sep" })); continue; }
    if (it.title) { const h = document.createElement("div"); h.className = "pm-title"; h.textContent = it.title; m.appendChild(h); continue; }
    const b = document.createElement("button"); b.type = "button"; b.className = "pm-item" + (it.disabled ? " dis" : "") + (it.danger ? " danger" : ""); b.disabled = !!it.disabled;
    b.innerHTML = `<span class="pm-ic">${it.checked ? icon("check", 16) : it.icon ? icon(it.icon, 16) : ""}</span><span class="pm-l">${esc(it.label)}</span>${it.hint ? `<small class="pm-hint">${esc(it.hint)}</small>` : ""}${it.shortcut ? `<span class="pm-sc">${esc(it.shortcut)}</span>` : ""}${it.sub ? `<span class="pm-arrow">${icon("right", 14)}</span>` : ""}`;
    if (it.sub) {
      let t0 = null; const openSub = () => { if (b.classList.contains("open")) return; closeSubsOf(m); b.classList.add("open"); const r = b.getBoundingClientRect(); const rtl = document.documentElement.dir === "rtl"; popup(it.sub, { x: rtl ? r.left : r.right - 2, y: r.top - 6, parent: m, align: rtl ? "end" : "start" }); };
      b.onmouseenter = () => { clearTimeout(t0); t0 = setTimeout(openSub, 120); }; b.onmouseleave = () => clearTimeout(t0); b.onclick = (e) => { e.stopPropagation(); openSub(); };
    } else {
      b.onmouseenter = () => closeSubsOf(m);
      b.onclick = (e) => { e.stopPropagation(); if (it.disabled) return; closePopups(); try { it.action && it.action(e); } catch (err) { console.error(err); } };
    }
    m.appendChild(b);
  }
  layer.appendChild(m); open.push(m); m.dataset.parent = parent ? "1" : "";
  // position
  const W = window.innerWidth, H = window.innerHeight; const r = m.getBoundingClientRect(); let px = x, py = y;
  if (anchor) { const a = anchor.getBoundingClientRect(); py = a.bottom + 4; px = align === "end" ? a.right - r.width : a.left; if (document.documentElement.dir === "rtl" && align === "start") px = a.right - r.width; }
  if (align === "end" && !anchor) px = x - r.width;
  if (px + r.width > W - 6) px = parent ? Math.max(6, x - r.width - (anchor ? 0 : 0) - (parent ? parent.getBoundingClientRect().width : 0)) : W - r.width - 6; if (px < 6) px = 6;
  if (py + r.height > H - 6) py = Math.max(6, H - r.height - 6);
  m.style.left = px + "px"; m.style.top = py + "px"; m._onClose = onClose;
  if (!parent) setTimeout(() => m.focus(), 0);
  return m;
}
function closeSubsOf(m) { const i = open.indexOf(m); if (i < 0) return; for (const s of open.splice(i + 1)) s.remove(); m.querySelectorAll(".pm-item.open").forEach((b) => b.classList.remove("open")); }
function onKey(e) {
  if (!open.length) return; const m = open[open.length - 1]; const items = [...m.querySelectorAll(".pm-item:not(:disabled)")]; if (!items.length) return;
  const cur = items.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (open.length > 1) { closeSubsOf(open[open.length - 2]); open[open.length - 1].focus(); } else closePopups(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); items[(cur + 1) % items.length].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[(cur - 1 + items.length) % items.length].focus(); }
  else if (e.key === "ArrowRight" && cur >= 0 && items[cur].querySelector(".pm-arrow")) { e.preventDefault(); items[cur].click(); setTimeout(() => { const s = open[open.length - 1]; const f = s && s.querySelector(".pm-item:not(:disabled)"); if (f) f.focus(); }, 0); }
  else if (e.key === "ArrowLeft" && open.length > 1) { e.preventDefault(); closeSubsOf(open[open.length - 2]); }
  else if ((e.key === "Enter" || e.key === " ") && cur >= 0) { e.preventDefault(); items[cur].click(); }
}

/** Menubar: buttons with data-menu="id"; `build(id)` returns the items. Hovering between open menus switches them like a native bar. */
export function menubar(bar, build) {
  const buttons = [...bar.querySelectorAll("[data-menu]")];
  const show = (b) => { closePopups(); b.classList.add("open"); popup(build(b.dataset.menu), { anchor: b, minWidth: 250 }); };
  for (const b of buttons) {
    b.onclick = (e) => { e.stopPropagation(); if (b.classList.contains("open")) closePopups(); else show(b); };
    b.onmouseenter = () => { if (open.length && buttons.some((x) => x.classList.contains("open")) && !b.classList.contains("open")) show(b); };
  }
}
