// LovePDF Reader and Editor — UI shell: tabs, open/save/print, toolbar, home screen, settings, account.
import { $, $$, el, esc, toast, status, modal, closeModal, prompt, confirm, bridge, baseName, stripExt, debounce, fmtBytes } from "./util.js";
import { t, setLang, langs } from "./i18n.js";
import { Doc } from "./viewer.js";
import { Editor } from "./editor.js";
import { Tools } from "./tools.js";

const API = "https://app.lovepdf.me";
class App {
  constructor() {
    this.docs = []; this.cur = null; this.settings = { theme: "system", lang: "en", zoom: "width", reopen: true }; this.account = null; this.token = null; this.version = "1.0.0";
    this.viewport = $("#viewport"); this.pagesWrap = $("#pagesWrap"); this.$ = $;
  }
  async init() {
    const b = bridge();
    if (b) { try { Object.assign(this.settings, await b.getSettings()); } catch {} try { const info = await b.info(); this.version = info.version; } catch {} }
    else { try { Object.assign(this.settings, JSON.parse(localStorage.getItem("lp_settings") || "{}")); } catch {} }
    this.token = this.settings.token || null; this.account = this.settings.account || null;
    this.applyTheme(); setLang(this.settings.lang || "en"); this.applyStrings();
    this.editor = new Editor(this); this.tools = new Tools(this);
    this.wire(); await this.renderHome();
    if (b) { b.on("open-files", (paths) => paths.forEach((p) => this.openPath(p))); b.on("menu", ({ cmd }) => this.menuCmd(cmd)); b.on("update", (u) => this.onUpdate(u)); }
    if (b && this.settings.reopen && this.settings.lastOpen && this.settings.lastOpen.length) { for (const p of this.settings.lastOpen.slice(0, 5)) { if (await b.exists(p)) this.openPath(p); } }
    status(t("appName"), "v" + this.version);
  }
  applyTheme() { const th = this.settings.theme || "system"; const dark = th === "dark" || (th === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; }
  applyStrings() { $$("[data-t]").forEach((e) => { e.textContent = t(e.dataset.t); }); $("#findInput").placeholder = t("findPlaceholder"); $("#zoomSel").options[0].text = t("fitWidth"); $("#zoomSel").options[1].text = t("fitPage"); }
  saveSettings(obj) { Object.assign(this.settings, obj); const b = bridge(); if (b) b.setSettings(obj).catch(() => {}); else { try { localStorage.setItem("lp_settings", JSON.stringify(this.settings)); } catch {} } }
  current() { return this.cur; }

  // ---------- home ----------
  async renderHome() {
    const b = bridge(); const list = $("#recentList"); const rec = b ? await b.recent() : [];
    list.innerHTML = rec.length ? rec.map((r) => `<div class="ri" data-p="${esc(r.path)}"><span class="ic">📄</span><div style="min-width:0"><div class="nm">${esc(r.name)}</div><div class="pt">${esc(r.path)}</div></div></div>`).join("") : `<p class="muted">${esc(t("noRecent"))}</p>`;
    $$(".ri", list).forEach((x) => (x.onclick = () => this.openPath(x.dataset.p)));
    const tools = [["open", "📂", t("openPdf"), ""], ["merge", "➕", t("merge"), ""], ["organize", "▦", t("organize"), ""], ["split", "✂", t("split"), ""], ["edit", "✎", t("editMode"), ""], ["sign", "✒", t("sign"), ""], ["compress", "🗜", t("compress"), "☁"], ["pdf-to-word", "W", "PDF → Word", "☁"], ["ocr-pdf", "🔍", t("ocr"), "☁"]];
    $("#homeTools").innerHTML = tools.map(([id, ic, l, tag]) => `<button class="qt" data-qt="${id}"><span class="ic">${ic}</span><b>${esc(l)}</b>${tag ? `<small>${tag} LovePDF.me</small>` : ""}</button>`).join("");
    $$("[data-qt]", $("#homeTools")).forEach((x) => (x.onclick = async () => { const id = x.dataset.qt; if (id === "open") return this.openDialog(); if (id === "merge") return this.tools.merge(null); const files = await this.pickFiles(false); if (!files.length) return; const d = await this.openBytes(files[0].bytes, files[0].name, files[0].path); if (!d) return; if (id === "edit") return this.setMode("edit"); this.tools.run(id); }));
  }
  showHome() { $("#home").hidden = false; $("#docArea").hidden = true; $$(".doc-only").forEach((e) => (e.hidden = true)); $("#btnSave").disabled = true; $("#btnPrint").disabled = true; $("#editbar").hidden = true; $("#findbar").hidden = true; this.cur = null; this.renderTabs(); this.renderHome(); const b = bridge(); if (b) b.setTitle(""); }

  // ---------- files ----------
  async pickFiles(multi = true) {
    const b = bridge(); const out = [];
    if (b && b.openDialog) { const paths = await b.openDialog(multi); for (const p of paths) out.push({ name: baseName(p), path: p, bytes: new Uint8Array(await b.readFile(p)) }); return out; }
    return new Promise((resolve) => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".pdf,application/pdf"; inp.multiple = multi; inp.onchange = async () => { for (const f of inp.files) out.push({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) }); resolve(out); }; inp.click(); });
  }
  async openDialog() { const files = await this.pickFiles(true); for (const f of files) await this.openBytes(f.bytes, f.name, f.path); }
  async openPath(p) { const b = bridge(); if (!b) return; const existing = this.docs.find((d) => d.path === p); if (existing) return this.activate(existing); try { status(t("loading")); const bytes = new Uint8Array(await b.readFile(p)); return await this.openBytes(bytes, baseName(p), p); } catch (e) { toast(t("openError", { name: baseName(p) }) + " — " + (e.message || ""), 4000); } }
  async openBytes(bytes, name, path = null, dirty = false) {
    const d = new Doc(this, { name, path, bytes }); let password = null;
    for (let tries = 0; tries < 4; tries++) {
      try { await d.load(password); break; }
      catch (e) { if (e && (e.name === "PasswordException" || /password/i.test(String(e.message)))) { const v = await prompt(t("passwordTitle"), { label: tries ? t("wrongPassword") : t("passwordAsk", { name }), type: "password" }); if (v == null) return null; password = v; continue; } toast(t("openError", { name }) + " — " + (e.message || e), 5000); return null; }
    }
    if (!d.pdf) return null; d.dirty = dirty; this.docs.push(d); this.activate(d); this.rememberOpen(); return d;
  }
  rememberOpen() { this.saveSettings({ lastOpen: this.docs.filter((d) => d.path).map((d) => d.path) }); }
  activate(d) {
    if (this.cur && this.cur !== d) { this.cur.scrollTop = this.viewport.scrollTop; this.editor.commitText(); this.cur.unmount(); }
    this.cur = d; $("#home").hidden = true; $("#docArea").hidden = false; $$(".doc-only").forEach((e) => (e.hidden = false)); $("#btnSave").disabled = false; $("#btnPrint").disabled = false;
    d.mount(); this.viewport.scrollTop = d.scrollTop || 0; this.renderTabs(); this.updatePageUi(); this.updateZoomUi(); this.refreshSidebar(); const b = bridge(); if (b) b.setTitle(d.name);
    const editing = d.edits && d.edits.active; $("#modeEdit").classList.toggle("on", !!editing); $("#modeView").classList.toggle("on", !editing); $("#editbar").hidden = !editing; this.viewport.classList.toggle("editing", !!editing);
    if (d.find.q) { $("#findbar").hidden = false; $("#findInput").value = d.find.q; } else $("#findbar").hidden = true;
    this.viewport.focus();
  }
  renderTabs() { const tabs = $("#tabs"); tabs.hidden = this.docs.length === 0; tabs.innerHTML = this.docs.map((d) => `<div class="tab ${d === this.cur ? "on" : ""}" data-id="${d.id}" title="${esc(d.path || d.name)}"><span class="tn">${d.dirty ? '<span class="dirty">●</span> ' : ""}${esc(d.name)}</span><button class="tx" data-x="${d.id}" title="${esc(t("close"))}">✕</button></div>`).join(""); $$(".tab", tabs).forEach((x) => (x.onclick = (e) => { if (e.target.closest(".tx")) return this.closeDoc(this.docs.find((d) => d.id === e.target.closest(".tx").dataset.x)); this.activate(this.docs.find((d) => d.id === x.dataset.id)); })); const b = bridge(); if (b) b.setEdited(!!(this.cur && this.cur.dirty)); }
  async closeDoc(d) {
    if (!d) return; if (d.dirty || this.editor.hasEdits(d)) { const r = await confirm(t("unsaved"), t("unsavedAsk", { name: d.name }), [t("save"), t("dontSave"), t("cancel")]); if (r === 2) return; if (r === 0) { const ok = await this.save(d); if (!ok) return; } }
    const i = this.docs.indexOf(d); this.docs.splice(i, 1); if (this.cur === d) { this.editor.leave(d); this.cur = null; await d.destroy(); const next = this.docs[Math.min(i, this.docs.length - 1)]; if (next) this.activate(next); else this.showHome(); } else await d.destroy();
    this.renderTabs(); this.rememberOpen();
  }
  async save(d = this.cur, forceAs = false) {
    if (!d) return false; const b = bridge(); status(t("saving"));
    try {
      const bytes = this.editor.hasEdits(d) ? await this.editor.flatten(d) : d.bytes; let path = d.path;
      if (!path || forceAs || !b) { if (b) { path = await b.saveAsDialog(d.name.replace(/\.pdf$/i, "") + (forceAs || !d.path ? ".pdf" : ".pdf")); if (!path) { status(""); return false; } } else { download(bytes, d.name); d.dirty = false; this.renderTabs(); status(t("saved")); return true; } }
      await b.writeFile(path, bytes); const changed = bytes !== d.bytes; d.path = path; d.name = baseName(path); if (changed) await d.replace(bytes, { keepDirty: false }); d.dirty = false; this.renderTabs(); this.rememberOpen(); b.setTitle(d.name); status(t("savedTo", { path })); toast(t("saved")); return true;
    } catch (e) { console.error(e); toast(t("error") + ": " + (e.message || e), 5000); status(""); return false; }
  }
  async saveBytesAs(bytes, name, ext = "pdf") { const b = bridge(); if (!b) { download(bytes, name); return name; } const path = await b.saveAsDialog(name, [{ name: ext.toUpperCase(), extensions: [ext] }]); if (!path) return null; await b.writeFile(path, bytes); toast(t("savedTo", { path }), 3500); return path; }
  async ask(title, placeholder, label) { return prompt(title, { label, value: placeholder }); }

  // ---------- print ----------
  async print() {
    const d = this.cur; if (!d) return; const area = $("#printArea"); area.innerHTML = ""; status(t("print") + "…");
    const bytes = this.editor.hasEdits(d) ? await this.editor.flatten(d) : null; if (bytes) await d.replace(bytes);
    for (const p of d.pages) { const vp = p.base.page.getViewport({ scale: 2, rotation: d.rotation }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await p.base.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport: vp }).promise; const img = new Image(); img.src = c.toDataURL("image/jpeg", 0.92); area.appendChild(img); status(t("rendering", { n: p.n })); }
    await new Promise((r) => setTimeout(r, 150)); const b = bridge(); if (b && b.print) await b.print({}); else window.print(); area.innerHTML = ""; status("");
  }

  // ---------- modes ----------
  async setMode(m) { const d = this.cur; if (!d) { toast(t("toast.needPdf")); return; } if (m === "edit") { await this.editor.enter(d); } else { this.editor.leave(d); } $("#modeEdit").classList.toggle("on", m === "edit"); $("#modeView").classList.toggle("on", m !== "edit"); }
  updatePageUi() { const d = this.cur; if (!d) return; $("#pgNum").value = d.current; $("#pgTotal").textContent = d.numPages; d.markThumb(); status(null, `${t("page")} ${d.current} ${t("of")} ${d.numPages} · ${fmtBytes(d.bytes.length)}`); }
  updateZoomUi() { const d = this.cur; if (!d) return; const sel = $("#zoomSel"); const z = typeof d.zoom === "number" ? String(d.zoom) : d.zoom; if ([...sel.options].some((o) => o.value === z)) sel.value = z; else { let o = sel.querySelector("option[data-custom]"); if (!o) { o = document.createElement("option"); o.dataset.custom = "1"; sel.appendChild(o); } o.value = z; o.text = Math.round(d.effectiveZoom() * 100) + "%"; sel.value = z; } }
  refreshSidebar() { const d = this.cur; if (!d || $("#sidebar").hidden) return; d.thumbnails($("#sbThumbs")); d.outline($("#sbOutline")); }
  toggleSidebar(force) { const sb = $("#sidebar"); sb.hidden = force != null ? !force : !sb.hidden; this.saveSettings({ sidebar: !sb.hidden }); if (!sb.hidden) this.refreshSidebar(); if (this.cur) this.cur.relayout(); }

  // ---------- wiring ----------
  wire() {
    const me = this;
    $("#btnHome").onclick = () => { if (this.cur) { this.cur.scrollTop = this.viewport.scrollTop; this.editor.commitText(); this.cur.unmount(); } this.showHome(); };
    $("#btnOpen").onclick = () => this.openDialog(); $("#homeOpen").onclick = () => this.openDialog(); $("#btnSave").onclick = () => this.save(); $("#btnPrint").onclick = () => this.print();
    $("#recentClear").onclick = async () => { const b = bridge(); if (b) await b.clearRecent(); this.renderHome(); };
    $("#btnSidebar").onclick = () => this.toggleSidebar(); if (this.settings.sidebar) $("#sidebar").hidden = false;
    $$(".sb-tabs button").forEach((b) => (b.onclick = () => { $$(".sb-tabs button").forEach((x) => x.classList.toggle("on", x === b)); $("#sbThumbs").hidden = b.dataset.sb !== "thumbs"; $("#sbOutline").hidden = b.dataset.sb !== "outline"; }));
    $("#pgPrev").onclick = () => this.cur && this.cur.goTo(this.cur.current - 1); $("#pgNext").onclick = () => this.cur && this.cur.goTo(this.cur.current + 1);
    $("#pgNum").onchange = (e) => this.cur && this.cur.goTo(+e.target.value); $("#pgNum").onkeydown = (e) => { if (e.key === "Enter") { this.cur && this.cur.goTo(+e.target.value); this.viewport.focus(); } };
    $("#zoomIn").onclick = () => this.cur && this.cur.zoomStep(1); $("#zoomOut").onclick = () => this.cur && this.cur.zoomStep(-1); $("#zoomSel").onchange = (e) => { const v = e.target.value; this.cur && this.cur.setZoom(v === "width" || v === "page" ? v : +v); this.saveSettings({ zoom: v === "width" || v === "page" ? v : +v }); };
    $("#btnRotate").onclick = () => this.cur && this.cur.rotate(90);
    $("#btnFind").onclick = () => this.showFind(); $("#findClose").onclick = () => { $("#findbar").hidden = true; if (this.cur) this.cur.search(""); $("#findCount").textContent = ""; this.viewport.focus(); };
    const doFind = debounce(async () => { const d = this.cur; if (!d) return; const r = await d.search($("#findInput").value); $("#findCount").textContent = r.hits.length ? t("matches", { n: r.hits.length }) : (r.q ? t("noMatches") : ""); if (r.hits.length) d.findStep(1); }, 250);
    $("#findInput").oninput = doFind; $("#findInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); this.cur && this.cur.findStep(e.shiftKey ? -1 : 1); } if (e.key === "Escape") $("#findClose").click(); };
    $("#findPrev").onclick = () => this.cur && this.cur.findStep(-1); $("#findNext").onclick = () => this.cur && this.cur.findStep(1);
    $("#modeView").onclick = () => this.setMode("view"); $("#modeEdit").onclick = () => this.setMode("edit");
    $("#btnPages").onclick = () => this.tools.run("organize"); $("#btnTools").onclick = () => this.tools.menu(); $("#btnSettings").onclick = () => this.settingsDialog();
    // scroll → current page
    this.viewport.addEventListener("scroll", debounce(() => { const d = this.cur; if (!d) return; const n = d.pageFromScroll(); if (n !== d.current) { d.current = n; this.updatePageUi(); } }, 60));
    this.viewport.addEventListener("wheel", (e) => { if (!e.ctrlKey || !this.cur) return; e.preventDefault(); this.cur.zoomStep(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    window.addEventListener("resize", debounce(() => this.cur && this.cur.relayout(), 120));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    // keyboard
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase(); const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (e.ctrlKey || e.metaKey) { const k = e.key.toLowerCase(); if (k === "o") { e.preventDefault(); this.openDialog(); } else if (k === "s") { e.preventDefault(); this.save(this.cur, e.shiftKey); } else if (k === "p") { e.preventDefault(); this.print(); } else if (k === "f") { e.preventDefault(); this.showFind(); } else if (k === "w") { e.preventDefault(); this.closeDoc(this.cur); } else if (k === "=" || k === "+") { e.preventDefault(); this.cur && this.cur.zoomStep(1); } else if (k === "-") { e.preventDefault(); this.cur && this.cur.zoomStep(-1); } else if (k === "0") { e.preventDefault(); this.cur && this.cur.setZoom("width"); } else if (k === "1") { e.preventDefault(); this.cur && this.cur.setZoom("page"); } else if (k === "r") { e.preventDefault(); this.cur && this.cur.rotate(90); } else if (k === "tab") { e.preventDefault(); this.nextTab(e.shiftKey ? -1 : 1); } else if (k === "z" && !typing) { e.preventDefault(); this.editor.undo(); } else if (k === "y" && !typing) { e.preventDefault(); this.editor.redo(); } return; }
      if (typing || !this.cur) return;
      if (e.key === "PageDown") { e.preventDefault(); this.cur.goTo(this.cur.current + 1); } else if (e.key === "PageUp") { e.preventDefault(); this.cur.goTo(this.cur.current - 1); } else if (e.key === "Home" && !e.shiftKey) { this.cur.goTo(1); } else if (e.key === "End" && !e.shiftKey) { this.cur.goTo(this.cur.numPages); } else if (e.key === "F4") { this.toggleSidebar(); } else if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if (!$("#findbar").hidden) $("#findClose").click(); }
    });
    // drag & drop
    let dragDepth = 0; const ov = $("#dropOverlay");
    document.addEventListener("dragenter", (e) => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return; dragDepth++; ov.hidden = false; }); document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ov.hidden = true; }); document.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    document.addEventListener("drop", async (e) => { e.preventDefault(); dragDepth = 0; ov.hidden = true; const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.pdf$/i.test(f.name)); const b = bridge(); for (const f of files) { const p = b && b.pathOf ? b.pathOf(f) : null; if (p) await this.openPath(p); else await this.openBytes(new Uint8Array(await f.arrayBuffer()), f.name); } });
    document.addEventListener("click", (e) => { const a = e.target.closest("[data-ext]"); if (a) { e.preventDefault(); const b = bridge(); if (b) b.openExternal(a.dataset.ext); else window.open(a.dataset.ext); } });
  }
  showFind() { if (!this.cur) return; $("#findbar").hidden = false; const i = $("#findInput"); i.focus(); i.select(); }
  nextTab(dir) { if (this.docs.length < 2) return; const i = this.docs.indexOf(this.cur); this.activate(this.docs[(i + dir + this.docs.length) % this.docs.length]); }
  menuCmd(cmd) { const d = this.cur; const map = { open: () => this.openDialog(), save: () => this.save(d), saveAs: () => this.save(d, true), print: () => this.print(), closeTab: () => this.closeDoc(d), undo: () => this.editor.undo(), redo: () => this.editor.redo(), find: () => this.showFind(), zoomIn: () => d && d.zoomStep(1), zoomOut: () => d && d.zoomStep(-1), fitWidth: () => d && d.setZoom("width"), fitPage: () => d && d.setZoom("page"), rotate: () => d && d.rotate(90), sidebar: () => this.toggleSidebar(), nextTab: () => this.nextTab(1), about: () => this.settingsDialog() }; if (map[cmd]) map[cmd](); }

  // ---------- settings / about / updates ----------
  settingsDialog() {
    const s = this.settings; const b = bridge();
    const body = modal(t("set.title"), `<div class="set-row"><span>${esc(t("set.theme"))}</span><select id="stTheme"><option value="system">${esc(t("set.system"))}</option><option value="light">${esc(t("set.light"))}</option><option value="dark">${esc(t("set.dark"))}</option></select></div>
      <div class="set-row"><span>${esc(t("set.lang"))}</span><select id="stLang">${langs.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></div>
      <div class="set-row"><span>${esc(t("set.zoom"))}</span><select id="stZoom"><option value="width">${esc(t("set.auto"))}</option><option value="page">${esc(t("fitPage"))}</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></div>
      <div class="set-row"><span>${esc(t("set.reopen"))}</span><input type="checkbox" id="stReopen" ${s.reopen !== false ? "checked" : ""}></div>
      ${b ? `<div class="set-row"><div><div>${esc(t("set.defaultApp"))}</div><small class="muted">${esc(t("set.defaultHint"))}</small></div><button class="btn btn-sm" id="stDefault">⭐ ${esc(t("set.defaultApp"))}</button></div>
      <div class="set-row"><div><div>${esc(t("set.updates"))}</div><small class="muted" id="stUpdMsg">${esc(t("set.version", { v: this.version }))}</small></div><button class="btn btn-sm" id="stUpd">🔄 ${esc(t("set.updates"))}</button></div>` : ""}
      <div class="set-row"><div><div>${esc(this.account ? t("online.loggedIn", { name: this.account.name }) : "LovePDF.me " + t("online.login"))}</div><small class="muted">${esc(t("online.loginHint"))}</small></div><button class="btn btn-sm" id="stLogin">${esc(this.account ? t("online.logout") : t("online.login"))}</button></div>
      <p class="hint" style="margin-top:12px">${esc(t("set.about1"))}<br>📱 ${esc(t("set.scanner"))}<br><a href="#" data-ext="https://www.lovepdf.me/?utm_source=windows-app">${esc(t("set.website"))}</a> · ${esc(t("set.version", { v: this.version }))}</p>`, { size: "sm" });
    $("#stTheme", body).value = s.theme || "system"; $("#stLang", body).value = s.lang || "en"; $("#stZoom", body).value = String(s.zoom || "width");
    $("#stTheme", body).onchange = (e) => { this.saveSettings({ theme: e.target.value }); this.applyTheme(); };
    $("#stLang", body).onchange = (e) => { this.saveSettings({ lang: e.target.value }); setLang(e.target.value); this.applyStrings(); this.editor.rebuildBar(); closeModal(); this.settingsDialog(); this.renderHome(); };
    $("#stZoom", body).onchange = (e) => { const v = e.target.value; this.saveSettings({ zoom: v === "width" || v === "page" ? v : +v }); };
    $("#stReopen", body).onchange = (e) => this.saveSettings({ reopen: e.target.checked });
    const sd = $("#stDefault", body); if (sd) sd.onclick = () => b.setDefault();
    const su = $("#stUpd", body); if (su) su.onclick = () => { $("#stUpdMsg", body).textContent = t("set.checking"); b.checkUpdates(); };
    $("#stLogin", body).onclick = () => { closeModal(); if (this.account) { this.logout(); toast(t("online.logout")); } else this.loginDialog(); };
  }
  onUpdate(u) {
    const msg = $("#stUpdMsg"); const set = (s) => { if (msg) msg.textContent = s; };
    if (u.state === "none") { if (u.manual) { set(t("set.upToDate")); toast(t("set.upToDate")); } }
    else if (u.state === "available") { set(t("set.available", { v: u.version })); const body = modal(t("set.updates"), `<p>${esc(t("set.available", { v: u.version }))}</p><div class="prog" id="updProg" hidden><i style="width:0"></i></div><div class="row end"><button class="btn" id="updLater">${esc(t("cancel"))}</button><button class="btn btn-primary" id="updDl">⬇ ${esc(t("set.download"))}</button></div>`, { size: "sm" }); $("#updLater", body).onclick = closeModal; $("#updDl", body).onclick = () => { $("#updProg", body).hidden = false; $("#updDl", body).disabled = true; bridge().downloadUpdate(); }; }
    else if (u.state === "downloading") { const p = $("#updProg"); if (p) { p.hidden = false; p.querySelector("i").style.width = u.percent + "%"; } set(t("set.downloading", { p: u.percent })); }
    else if (u.state === "ready") { set(t("set.ready")); const body = modal(t("set.updates"), `<p>${esc(t("set.ready"))}</p><div class="row end"><button class="btn" id="updLater2">${esc(t("cancel"))}</button><button class="btn btn-primary" id="updGo">${esc(t("set.restart"))}</button></div>`, { size: "sm" }); $("#updLater2", body).onclick = closeModal; $("#updGo", body).onclick = () => bridge().installUpdate(); }
    else if (u.state === "error") { if (u.manual) { set(t("set.updateErr")); toast(t("set.updateErr") + ": " + (u.error || ""), 4000); } }
  }

  // ---------- network / account (all requests go through the main process: no CORS, no cookies) ----------
  async net(url, o = {}) { const b = bridge(); if (b && b.fetch) return b.fetch(url, o); const r = await fetch(url, { method: o.method || "GET", headers: o.headers || {}, body: o.body }); return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers.entries()), body: await r.arrayBuffer() }; }
  async api(path, body, method = "POST") { const h = { "Content-Type": "application/json", Accept: "application/json", "X-LovePDF-Client": "windows/" + this.version }; if (this.token) h.Authorization = "Bearer " + this.token; const r = await this.net(API + path, { method, headers: h, body: body ? new TextEncoder().encode(JSON.stringify(body)) : undefined }); let j = {}; try { j = JSON.parse(new TextDecoder().decode(r.body)); } catch {} if (!r.ok) { const err = new Error(j.error || "Error " + r.status); err.extra = j; throw err; } return j; }
  loginDialog(after) {
    const body = modal("LovePDF.me — " + t("online.login"), `<div class="form"><label>${esc(t("online.email"))}<input type="text" id="lgId" autocomplete="username"></label><label>${esc(t("online.password"))}<input type="password" id="lgPw" autocomplete="current-password"></label><p class="hint" id="lgMsg"></p><div class="row end"><a href="#" data-ext="https://www.lovepdf.me/signup?utm_source=windows-app" class="link">Sign up free</a><span class="sp"></span><button class="btn btn-primary" id="lgGo">${esc(t("online.loginBtn"))}</button></div></div>`, { size: "sm" });
    $("#lgGo", body).onclick = async () => { const id = $("#lgId", body).value.trim(), pw = $("#lgPw", body).value; if (!id || !pw) return; $("#lgGo", body).disabled = true; try { const r = await this.api("/auth/login", { identifier: id, password: pw, platform: "windows", device_name: "Windows PC" }); this.token = r.token; this.account = { id: r.user.id, name: r.user.name, plan: r.user.plan }; this.saveSettings({ token: this.token, account: this.account }); closeModal(); toast(t("online.loggedIn", { name: r.user.name })); if (after) after(); } catch (e) { $("#lgMsg", body).textContent = t("online.loginFail") + ": " + (e.message || ""); $("#lgGo", body).disabled = false; } };
    setTimeout(() => $("#lgId", body).focus(), 30);
  }
  logout() { const tok = this.token; this.token = null; this.account = null; this.saveSettings({ token: null, account: null }); if (tok) this.net(API + "/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + tok, "X-LovePDF-Client": "windows" } }).catch(() => {}); }
}
function download(bytes, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }

window.app = new App(); window.app.init().catch((e) => { console.error(e); status("Init error: " + e.message); });
