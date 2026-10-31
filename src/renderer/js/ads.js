// In-app promotion / ads / limits — everything here is driven by adminweb.lovepdf.me → "Windows app"
// (GET https://app.lovepdf.me/app/windows-config). Sources: own promo cards, banners from Ads & Banners (win_* positions),
// and (optional) AdSense units loaded from a LovePDF.me page in an iframe. Nothing is shown until the config arrives;
// the last config is cached so the app behaves the same offline. Impressions/clicks are reported back for the admin stats.
import { $, $$, esc, modal, closeModal, bridge, toast } from "./util.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";

const DAY = () => new Date().toISOString().slice(0, 10);
const SIZES = { top: [728, 60], home: [336, 280], side: [200, 200], bottom: [728, 90], inter: [336, 280] };

export class Ads {
  constructor(app) {
    this.app = app; this.cfg = null; this.startAt = Date.now(); this.closed = {}; this.rot = {}; this.queue = []; this.timer = null; this.busy = false;
    const st = app.settings.adStats || {}; this.stats = st.day === DAY() ? st : { day: DAY(), actions: 0, inters: 0, lastInter: 0, edits: 0, saves: 0, after: 0, videos: 0 };
  }
  // ---------- config ----------
  async init() {
    try { if (this.app.settings.winConfig && this.app.settings.winConfig.cfg) this.cfg = this.app.settings.winConfig.cfg; } catch {}
    this.refresh().catch(() => {});
    setInterval(() => this.refresh().catch(() => {}), 30 * 60 * 1000);
    this.registerDevice().catch(() => {});
  }
  async refresh() {
    const q = `?version=${encodeURIComponent(this.app.version)}&lang=${encodeURIComponent(this.app.settings.lang || "en")}&plan=${this.plan()}`;
    const cfg = await this.app.api("/app/windows-config" + q, null, "GET");
    if (!cfg || typeof cfg !== "object") return; this.cfg = cfg; this.app.saveSettings({ winConfig: { at: Date.now(), cfg } }); this.render(); this.notice();
    if (!this.startupDone) { this.startupDone = true; const delay = Math.max(2, this.freq("startupDelaySec", 20)); setTimeout(() => { if ($("#modal").hidden) this.video("start"); }, delay * 1000); }
  }
  async registerDevice() {
    const b = bridge(); if (!b) return; let id = this.app.settings.deviceId; if (!id) { id = "win-" + crypto.randomUUID().replace(/-/g, "").slice(0, 28); this.app.saveSettings({ deviceId: id }); }
    const info = await b.info().catch(() => ({})); const last = this.app.settings.deviceAt || 0; if (Date.now() - last < 12 * 3600 * 1000) return;
    await this.app.api("/app/device", { device_id: id, platform: "windows", app_version: this.app.version, os_version: info.os || "", model: "Windows PC", locale: info.locale || this.app.settings.lang || "en" }); this.app.saveSettings({ deviceAt: Date.now() });
  }
  plan() { const a = this.app.account; if (!a) return "guest"; const p = String(a.plan || "free").toLowerCase(); return !p || p === "free" || p === "guest" ? "free" : "paid"; }
  on() { const c = this.cfg; if (!c || !c.enabled || !c.ads || !c.ads.enabled) return false; const aud = c.ads.audiences || {}; return aud[this.plan()] !== false; }
  freq(k, dflt) { const f = (this.cfg && this.cfg.ads && this.cfg.ads.freq) || {}; const v = Number(f[k]); return Number.isFinite(v) ? v : dflt; }
  afterFirstDelay() { return Date.now() - this.startAt >= this.freq("firstDelaySec", 0) * 1000; }
  slotOn(slot) { const s = (this.cfg && this.cfg.ads && this.cfg.ads.slots) || {}; return s[slot] !== false && s[slot] !== 0; }

  // ---------- what to show ----------
  sources(slot) {
    const c = this.cfg; const out = []; const w = (c.ads && c.ads.weights) || { promo: 40, banner: 60 };
    const bl = (c.banners && c.banners["win_" + slot]) || [];
    if (bl.length && (w.banner || 0) > 0) out.push({ kind: "banner", w: +w.banner });
    if (bl.length && c.ads && c.ads.bannerFirst !== false) return out; // banners first: promos only where no banner exists
    if (Array.isArray(c.promo) && c.promo.length && (w.promo || 0) > 0 || (!bl.length && Array.isArray(c.promo) && c.promo.length)) out.push({ kind: "promo", w: Math.max(1, +w.promo || 1) });
    return out;
  }
  pick(slot) {
    const src = this.sources(slot); if (!src.length) return null; const total = src.reduce((a, s) => a + s.w, 0); const i = (this.rot[slot] = (this.rot[slot] || 0) + 1);
    let r = ((i * 37) % Math.max(1, total)); let kind = src[0].kind; for (const s of src) { if (r < s.w) { kind = s.kind; break; } r -= s.w; }
    if (kind === "promo") { const list = this.cfg.promo; return { kind, item: list[i % list.length] }; }
    const list = this.cfg.banners["win_" + slot]; return { kind: "banner", item: list[i % list.length] };
  }
  render() {
    const slots = { top: $("#adTop"), home: $("#homeAd"), side: $("#sbAd"), bottom: $("#adBottom") };
    for (const [slot, el] of Object.entries(slots)) {
      if (!el) continue; const show = this.on() && this.slotOn(slot) && this.afterFirstDelay() && !this.closed[slot] && (slot !== "side" || !$("#sidebar").hidden) && (slot !== "home" || !$("#home").hidden) && (slot !== "bottom" || !!this.app.cur || this.slotOn("bottomOnHome")) && (slot !== "top" || !!this.app.cur);
      if (!show) { el.hidden = true; el.innerHTML = ""; continue; }
      const pick = this.pick(slot); if (!pick) { el.hidden = true; el.innerHTML = ""; continue; }
      this.fill(el, slot, pick); el.hidden = false;
    }
    if (!this.afterFirstDelay() && this.on()) { clearTimeout(this.delayT); this.delayT = setTimeout(() => this.render(), this.freq("firstDelaySec", 0) * 1000 - (Date.now() - this.startAt) + 50); }
    const every = this.freq("refreshSec", 90); clearTimeout(this.refreshT); if (this.on() && every >= 15) this.refreshT = setTimeout(() => this.render(), every * 1000);
  }
  fill(el, slot, pick) {
    const [w, h] = SIZES[slot]; el.innerHTML = ""; const label = document.createElement("span"); label.className = "ad-label"; label.textContent = pick.kind === "promo" ? "LovePDF" : t("ads.sponsored"); el.appendChild(label);
    if ((slot === "bottom" || slot === "top") && (!this.cfg.ads || this.cfg.ads.bottomClosable !== false)) { const x = document.createElement("button"); x.className = "ad-close"; x.title = t("close"); x.textContent = "✕"; x.onclick = () => { this.closed[slot] = true; el.hidden = true; el.innerHTML = ""; this.event("close", { slot, source: pick.kind }); }; el.appendChild(x); }
    el.appendChild(this.node(slot, pick, w, h)); this.event("impression", { slot, source: pick.kind, ref: pick.item && (pick.item.id || pick.item.title) });
  }
  node(slot, pick, w, h) {
    const site = (this.cfg.site || "https://www.lovepdf.me").replace(/\/$/, "");
    if (pick.kind === "promo") {
      const p = pick.item; const b = document.createElement("button"); b.className = "promo"; b.type = "button";
      b.innerHTML = `<span class="promo-ic">${p.image ? `<img src="${esc(p.image)}" alt="">` : icon(p.icon || "heart", 24)}</span><span style="min-width:0"><b>${esc(p.title || "LovePDF.me")}</b><small>${esc(p.text || "")}</small></span>${p.cta ? `<span class="btn btn-sm btn-primary cta">${esc(p.cta)}</span>` : ""}`;
      b.onclick = () => this.open(p.url || site, { slot, source: "promo", ref: p.id || p.title }); return b;
    }
    if (pick.kind === "banner") {
      const bn = pick.item; const img = document.createElement("img"); img.className = "ad-img"; img.src = bn.image; img.alt = bn.alt || ""; img.style.maxHeight = (slot === "bottom" || slot === "top" ? 60 : h) + "px"; img.title = bn.alt || ""; img.onclick = () => this.open(bn.link || `${site}/click/b/${bn.id}`, { slot, source: "banner", ref: bn.id }); return img;
    }
    return document.createElement("span");
  }
  open(url, meta) { this.event("click", meta); const u = url.includes("utm_") ? url : url + (url.includes("?") ? "&" : "?") + "utm_source=windows-app&utm_medium=" + encodeURIComponent(meta.slot || "app"); const b = bridge(); if (b) b.openExternal(u); else window.open(u); }
  notice() {
    const n = this.cfg && this.cfg.notice; const h = $("#homeNotice"), m = $("#mbNotice"); const txt = n && n.text ? String(n.text) : "";
    for (const el of [h, m]) { if (!el) continue; if (!txt) { el.hidden = true; continue; } el.hidden = false; el.innerHTML = (el === h ? icon("megaphone", 18) + " " : "") + esc(txt); el.onclick = () => { if (n.url) this.open(n.url, { slot: "notice", source: "notice" }); }; }
    const v = this.cfg && this.cfg.version; if (v && v.latest && semverGt(v.latest, this.app.version) && !this.app.settings.ignoreVersion) { const s = $("#statusRight"); if (s) s.textContent = `v${this.app.version} → ${t("set.available", { v: v.latest })}`; }
  }

  // ---------- actions, interstitials, limits ----------
  /** Count an action (edit applied / tool run / save). May show an interstitial afterwards. */
  action(kind, meta = {}) {
    this.rollDay(); this.stats.actions++; if (kind === "edit") this.stats.edits++; if (kind === "save") this.stats.saves++; if (kind === "tool") this.stats.tools = (this.stats.tools || 0) + 1; this.persist(); this.event(kind, meta);
    if (!this.on() || !this.slotOn("inter") || !this.afterFirstDelay()) return;
    const every = Math.max(1, this.freq("interEvery", 3)), minMin = this.freq("interMinMinutes", 10), maxDay = this.freq("interMaxDay", 8);
    if (this.stats.actions % every !== 0) return; if (this.stats.inters >= maxDay) return; if (Date.now() - this.stats.lastInter < minMin * 60000) return;
    setTimeout(() => this.interstitial("auto"), 600);
  }
  /** Daily edit limit (adminweb → Windows app → Limits). Returns true when the action may proceed. */
  async gate(kind) {
    this.rollDay(); const c = this.cfg; if (!c || !c.limits) return true;
    const table = kind === "tool" ? (c.limits.toolsPerDay || {}) : (c.limits.editsPerDay || {}); const lim = Number(table[this.plan()] || 0); if (!lim || lim <= 0) return true;
    const used = kind === "tool" ? (this.stats.tools || 0) : this.stats.saves; if (used < lim) return true;
    const act = c.limits.action || "ad"; const msg = c.limits.message || t("limit.body", { n: lim });
    if (act === "ad" && this.sources("inter").length) { const ok = await this.interstitial("limit", msg); if (ok) { if (kind === "tool") this.stats.tools = Math.max(0, (this.stats.tools || 0) - Math.ceil(lim / 2)); else this.stats.saves = Math.max(0, this.stats.saves - Math.ceil(lim / 2)); this.persist(); } return ok; }
    return new Promise((resolve) => {
      const body = modal(t("limit.title"), `<div class="form"><p>${esc(msg)}</p><div class="row end"><button class="btn" id="lmClose">${esc(t("cancel"))}</button>${act === "login" ? `<button class="btn btn-primary" id="lmLogin">${icon("login")} ${esc(t("online.login"))}</button>` : `<button class="btn btn-primary" id="lmUp">${icon("star")} ${esc(t("limit.upgrade"))}</button>`}</div></div>`, { size: "sm", onClose: () => resolve(false) });
      $("#lmClose", body).onclick = closeModal; const lg = $("#lmLogin", body); if (lg) lg.onclick = () => { closeModal(); this.app.loginDialog(); }; const up = $("#lmUp", body); if (up) up.onclick = () => { closeModal(); this.open((c.site || "https://www.lovepdf.me") + "/pricing", { slot: "limit", source: "upgrade" }); };
    });
  }
  interstitial(reason = "auto", message = "") {
    return new Promise((resolve) => {
      const pick = this.pick("inter"); if (!pick) return resolve(true); this.rollDay(); this.stats.inters++; this.stats.lastInter = Date.now(); this.persist();
      const skip = Math.max(0, this.freq("skipSec", 5)); let left = skip;
      const body = modal(message ? t("limit.title") : t("ads.interTitle"), `<div class="interstitial">${message ? `<p>${esc(message)}</p>` : `<p class="muted" style="margin:0 0 6px">${esc(t("ads.interBody"))}</p>`}<div class="ad-slot" id="interSlot"></div><div class="row end"><span class="cd" id="interCd"></span><span class="sp"></span><button class="btn btn-primary" id="interClose" ${skip ? "disabled" : ""}>${esc(t("ads.continue"))}</button></div></div>`, { size: "sm", onClose: () => { clearInterval(iv); resolve(true); } });
      const slot = $("#interSlot", body); const [w, h] = SIZES.inter; slot.appendChild(this.node("inter", pick, w, h)); this.event("impression", { slot: "inter", source: pick.kind, ref: pick.item && (pick.item.id || pick.item.title), reason });
      const btn = $("#interClose", body), cd = $("#interCd", body); const tick = () => { if (left <= 0) { btn.disabled = false; cd.textContent = ""; clearInterval(iv); return; } cd.textContent = t("ads.skipIn", { s: left }); left--; }; tick(); const iv = setInterval(tick, 1000);
      btn.onclick = () => closeModal();
    });
  }
  /** After an edited PDF was saved: open the website (adminweb → Windows app → After save). */
  afterSave() {
    this.rollDay(); const a = this.cfg && this.cfg.afterSave; if (!a || !a.enabled || !this.on()) return; const every = Math.max(1, a.every || 1), maxDay = a.maxDay || 0;
    if (this.stats.saves % every !== 0) return; if (maxDay && (this.stats.after || 0) >= maxDay) return; this.stats.after = (this.stats.after || 0) + 1; this.persist();
    setTimeout(() => this.open(a.url, { slot: "aftersave", source: "site" }), 700); this.event("aftersave", { slot: "aftersave" });
  }
  /** Promo video at start / close. Resolves when the user skips or the video ends. */
  video(when) {
    return new Promise((resolve) => {
      const v = this.cfg && this.cfg.video; this.rollDay(); if (!v || !this.on() || !(v.when === "both" || v.when === when) || (v.maxDay && (this.stats.videos || 0) >= v.maxDay)) return resolve(false);
      this.stats.videos = (this.stats.videos || 0) + 1; this.persist(); this.event("video", { slot: when, source: v.kind });
      const skip = Math.max(0, v.skipSec || 0); let left = skip; const player = v.kind === "youtube" ? `<iframe class="vid" src="${esc(v.embed)}" allow="autoplay; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : `<video class="vid" src="${esc(v.src)}" autoplay playsinline controls></video>`;
      const body = modal(v.title || t("ads.videoTitle"), `<div class="interstitial"><div class="vidbox">${player}</div><div class="row end" style="margin-top:10px">${v.clickUrl ? `<button class="btn btn-primary" id="vidGo">${esc(v.cta || t("ads.learnMore"))}</button>` : ""}<span class="cd" id="vidCd"></span><span class="sp"></span><button class="btn" id="vidSkip" ${skip ? "disabled" : ""}>${esc(when === "close" ? t("file.exit") : t("ads.skip"))}</button></div></div>`, { size: "", onClose: () => { clearInterval(iv); resolve(true); } });
      const btn = $("#vidSkip", body), cd = $("#vidCd", body); const tick = () => { if (left <= 0) { btn.disabled = false; cd.textContent = ""; clearInterval(iv); return; } cd.textContent = t("ads.skipIn", { s: left }); left--; }; tick(); const iv = setInterval(tick, 1000);
      btn.onclick = () => closeModal(); const go = $("#vidGo", body); if (go) go.onclick = () => this.open(v.clickUrl, { slot: when, source: "video" });
      const vd = body.querySelector("video"); if (vd) vd.onended = () => { left = 0; tick(); };
    });
  }
  rollDay() { if (this.stats.day !== DAY()) this.stats = { day: DAY(), actions: 0, inters: 0, lastInter: 0, edits: 0, saves: 0, after: 0, videos: 0 }; }
  persist() { this.app.saveSettings({ adStats: this.stats }); }

  // ---------- events → adminweb stats ----------
  event(type, meta = {}) { this.queue.push({ t: type, slot: meta.slot || "", source: meta.source || "", ref: meta.ref != null ? String(meta.ref).slice(0, 60) : "", at: Date.now() }); if (this.queue.length >= 25) this.flush(); else { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 15000); } }
  async flush() { if (this.busy || !this.queue.length) return; const batch = this.queue.splice(0, 50); this.busy = true; try { await this.app.api("/app/windows/event", { device_id: this.app.settings.deviceId || "", version: this.app.version, plan: this.plan(), events: batch }); } catch { /* offline — drop silently */ } this.busy = false; }
}
function semverGt(a, b) { const pa = String(a || "0").split(".").map(Number), pb = String(b || "0").split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; } return false; }
