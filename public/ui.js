// Целият текст е DOM (остър при всякакъв мащаб и с кирилица): етикети, балончета,
// подсказки при посочване, HUD, легенда и ?debug панел.
import { CFG, STATES, STATE_ORDER, T, PARAMS } from './config.js';
import { shortDetail, fmtDuration } from './util.js';
import { coinUrl } from './tokens.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(office, model, canvas) {
    this.office = office; this.model = model; this.canvas = canvas;
    this.overlay = document.getElementById('overlay');
    this.hud = document.getElementById('hud');
    this.tip = document.getElementById('tooltip');
    this.card = document.getElementById('card');
    this.legend = document.getElementById('legend');
    this.empty = document.getElementById('empty');
    this.debugEl = document.getElementById('debug');
    this.items = new Map();        // id -> { label, bubble, cache }
    this.cssScale = 1; this.dpr = 1;
    this.conn = 'connecting';
    this.hover = null; this.mouse = null;
    this.fps = { frames: 0, last: performance.now(), value: 0 };
    this.lastHud = 0;
    this.buildLegend();
    this.bindMouse();
    // монетата в HUD отваря магазина (onShop се задава в main.js)
    this.hud.addEventListener('click', (e) => { if (e.target.closest('.tok')) this.onShop?.(); });
    if (PARAMS.debug) this.debugEl.hidden = false;
    if (PARAMS.desktop) this.initDesktop();
  }

  // ------------------------------------------------------------------ Electron
  initDesktop() {
    document.body.classList.add('desktop');
    const bridge = window.pixelOffice;
    let stored = null;
    try { stored = localStorage.getItem('po.legend'); } catch { /* */ }
    if (stored == null) this.legend.hidden = true; // в малкия прозорец легендата е скрита по подразбиране (L я показва)
    const bar = document.getElementById('winbar');
    bar.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act && bridge) bridge.action(act);
    });
    bridge?.onState?.((st) => { bar.querySelector('[data-act="pin"]').classList.toggle('on', !!st.onTop); });
    this.bridge = bridge;
  }

  sendDesktopStats(s) {
    if (!this.bridge) return;
    const waiting = [...this.office.actors.values()].filter((a) => a.vstate === 'waiting').map((a) => a.agent.desc || this.displayName(a.agent));
    const key = `${s.agents}|${s.subs}|${s.tools}|${waiting.join(',')}`;
    if (key === this._lastStats) return;
    this._lastStats = key;
    this.bridge.stats({ agents: s.agents - s.subs, subs: s.subs, tools: s.tools, waiting });
  }

  setScale(scale, dpr, W, H) {
    this.cssScale = scale / dpr; this.dpr = dpr;
    this.overlay.style.width = `${(W * scale) / dpr}px`;
    this.overlay.style.height = `${(H * scale) / dpr}px`;
    const podCss = CFG.POD_W * this.cssScale;
    document.documentElement.style.setProperty('--pod', `${Math.round(podCss)}px`);
    document.documentElement.style.setProperty('--bubble-max', `${Math.round(Math.max(120, Math.min(280, podCss * 1.3)))}px`);
    document.documentElement.style.setProperty('--label-max', `${Math.round(Math.max(56, podCss - 6))}px`);
    // дребен мащаб: компактен текст, балончетата – само при "чака" или при посочване/фокус
    document.body.classList.toggle('tiny', this.cssScale < 1.5 || PARAMS.desktop);
  }

  setConnection(s) { this.conn = s; this.lastHud = 0; }

  /** Известие за постижение (по едно, на опашка) + конфети. */
  achievement(id, reward) {
    (this.toasts ||= []).push([id, reward]);
    if (!this.toastBusy) this.nextToast();
  }
  nextToast() {
    const next = this.toasts.shift();
    const box = document.getElementById('toast');
    if (!next) { this.toastBusy = false; box.hidden = true; return; }
    this.toastBusy = true;
    const [id, reward] = next;
    const [name, desc] = T.achievements[id] || [id, ''];
    box.innerHTML = `<small>🏆 ${T.shop.achievement}</small><b>${esc(name)}</b><span>${esc(desc)} · ${T.shop.reward(reward)}</span>`;
    box.hidden = false;
    const L = this.office.L;
    this.office.fx.confetti(L.W / 2, CFG.WALL_H + 10, 60);
    setTimeout(() => this.nextToast(), 4200);
  }

  /** Брояч на токените; reason = бонус (за кратко подсветяване). */
  setTokens(n, reason, now) {
    this.tokens = n;
    if (reason) this.tokenFlash = now;
    this.lastHud = 0;
  }

  /** Логически -> CSS пиксели, закръглени до физически пиксел. */
  px(v) { return Math.round(v * this.cssScale * this.dpr) / this.dpr; }

  buildLegend() {
    this.legend.innerHTML = STATE_ORDER.map((s) => `<span><i style="background:${STATES[s].color}"></i>${T.states[s]}</span>`).join('') + `<em>${T.legendHint}</em>`;
    try { if (localStorage.getItem('po.legend') === '0') this.legend.hidden = true; } catch { /* няма storage */ }
    addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L' || e.key === 'л' || e.key === 'Л') {
        this.legend.hidden = !this.legend.hidden;
        try { localStorage.setItem('po.legend', this.legend.hidden ? '0' : '1'); } catch { /* */ }
      }
      if (e.key === 'Escape') this.focus(null);
    });
  }

  bindMouse() {
    const toLogical = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / this.cssScale, y: (e.clientY - r.top) / this.cssScale, cx: e.clientX, cy: e.clientY };
    };
    this.canvas.addEventListener('mousemove', (e) => { this.mouse = toLogical(e); });
    this.canvas.addEventListener('mouseleave', () => { this.mouse = null; });
    this.canvas.addEventListener('click', (e) => {
      const m = toLogical(e);
      const a = this.office.hitTest(m.x, m.y);
      this.focus(a && a.id !== this.office.focusId ? a.id : null);
    });
  }

  focus(id) { this.office.focusId = id; this.card.hidden = !id; }

  // ------------------------------------------------------------------ всеки кадър
  sync(now) {
    const office = this.office;
    const seen = new Set();
    for (const a of office.actors.values()) {
      seen.add(a.id);
      let it = this.items.get(a.id);
      if (!it) {
        it = { label: el('div', 'tag', this.overlay), bubble: el('div', 'bubble', this.overlay), c: {} };
        it.label.innerHTML = '<i></i><span class="n"></span><span class="s"></span>';
        it.bubble.innerHTML = '<b></b><span></span>';
        this.items.set(a.id, it);
      }
      const ag = a.agent;
      const st = a.vstate;
      const anc = office.anchors(a);
      const hidden = a.alpha < 0.05;
      // етикет
      const name = (ag.subagent ? '↳ ' : '★ ') + (ag.desc || this.displayName(ag));
      this.set(it, 'name', name, () => { it.label.children[1].textContent = name; it.lw = 0; });
      this.set(it, 'st', st, () => {
        it.label.children[0].style.background = STATES[st].color;
        it.label.children[2].textContent = T.states[st]; it.lw = 0;
        it.label.dataset.state = st;
        it.bubble.dataset.state = st;
      });
      const lx = this.clampX(anc.label.x, it, 'lw', it.label);
      // на дивана и при кафето/водата двама стоят близо – етикетът на втория е ред по-долу, за да не се застъпват
      const ly = this.px(anc.label.y) + (a.mode !== 'walk' && (a.loc.type === 'sofa' || a.loc.type === 'cooler') ? (a.loc.type === 'sofa' ? a.loc.i : 1) * (it.lh ||= (it.label.offsetHeight || 14) + 2) : 0);
      this.set(it, 'lpos', `${lx},${ly},${Math.round(a.alpha * 10)}`, () => {
        it.label.style.transform = `translate(${lx}px, ${ly}px) translateX(-50%)`;
        it.label.style.opacity = hidden ? 0 : Math.min(1, a.alpha * 1.2);
        it.bubble.style.visibility = hidden ? 'hidden' : '';
      });
      // балонче: инструмент + детайл (само за "работни" състояния)
      const tool = this.model.currentTool(ag);
      let btxt = null;
      if (tool && (st === 'typing' || st === 'reading' || st === 'running' || st === 'delegating')) btxt = [tool.tool, shortDetail(tool.detail, 38)];
      else if (st === 'waiting') btxt = [T.needsYou, tool ? tool.tool : ''];
      const bkey = btxt ? btxt.join('|') : '';
      this.set(it, 'btxt', bkey, () => {
        if (btxt) { it.bubble.children[0].textContent = btxt[0]; it.bubble.children[1].textContent = btxt[1]; it.bw = 0; }
        it.bubble.classList.toggle('show', !!btxt);
      });
      const by = anc.bubble.y - (st === 'waiting' ? 18 : 0);
      const bx = this.clampX(anc.bubble.x, it, 'bw', it.bubble);
      this.set(it, 'bpos', `${bx},${this.px(by)}`, () => {
        it.bubble.style.transform = `translate(${bx}px, ${this.px(by)}px) translate(-50%, -100%)`;
      });
      it.label.classList.toggle('focus', office.focusId === a.id);
      it.bubble.classList.toggle('hl', office.focusId === a.id || this.hoverId === a.id);
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { it.label.remove(); it.bubble.remove(); this.items.delete(id); }

    this.updateTooltip(now);
    if (office.focusId) this.updateCard(now);
    this.fps.frames++;
    if (now - this.lastHud > 250) { this.lastHud = now; this.updateHud(now); }
  }

  /** Центрирано по x, но без да излиза извън стаята. */
  clampX(x, it, key, elm) {
    if (!it[key]) it[key] = elm.offsetWidth || 0;
    const half = it[key] / 2 + 2, W = this.overlay.clientWidth;
    return Math.round(Math.max(half, Math.min(W - half, this.px(x))) * this.dpr) / this.dpr;
  }

  set(it, key, val, fn) { if (it.c[key] !== val) { it.c[key] = val; fn(); } }

  displayName(ag) {
    // ако няколко сесии са в един проект – добавяме кратко id
    let dup = 0;
    for (const o of this.model.agents.values()) if (o.label === ag.label && !o.subagent) dup++;
    return dup > 1 && !ag.subagent ? `${ag.label} #${ag.id.slice(0, 4)}` : ag.label;
  }

  describe(a, now) {
    const ag = a.agent, st = a.vstate;
    const tool = this.model.currentTool(ag) || ag.lastTool;
    const rows = [
      [T.project, esc(ag.label) + ` <span class="dim">#${esc(ag.id.slice(0, 8))}</span>`],
      [T.state, `<i class="dot" style="background:${STATES[st].color}"></i>${T.states[st]}`],
    ];
    if (tool) rows.push([T.tool, `<b>${esc(tool.tool)}</b> ${esc(shortDetail(tool.detail, 46))}`]);
    rows.push([T.toolCalls, String(ag.toolCalls)]);
    rows.push([T.uptime, fmtDuration(now - ag.firstSeen, T)]);
    if (ag.parent) { const p = this.model.agents.get(ag.parent); rows.push([T.childOf, esc(p ? this.displayName(p) : ag.parent.slice(0, 8))]); }
    if (ag.children.size) rows.push([T.parentOf, String(this.model.liveChildren(ag)) + ' / ' + ag.children.size]);
    const title = ag.desc ? `<div class="title">${esc(ag.desc)}</div>` : '';
    return title + '<table>' + rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('') + '</table>';
  }

  updateTooltip(now) {
    const m = this.mouse;
    if (!m) { this.tip.hidden = true; this.canvas.style.cursor = ''; this.hoverId = null; return; }
    const a = this.office.hitTest(m.x, m.y);
    this.hoverId = a ? a.id : null;
    let html = null;
    if (a) html = this.describe(a, now);
    else {
      const b = this.office.room?.board;
      if (b && m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h) {
        const s = this.model.stats();
        html = `<table><tr><th>${T.board.agents}</th><td>${s.agents}</td></tr><tr><th>${T.board.tools}</th><td>${s.tools}</td></tr><tr><th>${T.board.subs}</th><td>${s.subs}</td></tr>` +
          (this.tokens != null ? `<tr><th>${T.tokens}</th><td>${this.fmtTokens()}</td></tr>` : '') + '</table>' +
          (this.tokens != null ? `<div class="dim">${T.tokensHint}</div>` : '');
      }
    }
    this.canvas.style.cursor = a ? 'pointer' : '';
    if (!html) { this.tip.hidden = true; return; }
    if (this.tip._html !== html) { this.tip.innerHTML = html; this.tip._html = html; }
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let x = m.cx + 14, y = m.cy + 14;
    if (x + tw > innerWidth - 6) x = m.cx - tw - 10;
    if (y + th > innerHeight - 6) y = m.cy - th - 10;
    this.tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }

  updateCard(now) {
    const a = this.office.actors.get(this.office.focusId);
    if (!a) { this.focus(null); return; }
    const html = this.describe(a, now);
    if (this.card._html !== html) { this.card.innerHTML = html; this.card._html = html; }
  }

  updateHud(now) {
    const s = this.model.stats();
    const fpsDt = now - this.fps.last;
    if (fpsDt >= 1000) { this.fps.value = Math.round((this.fps.frames * 1000) / fpsDt); this.fps.frames = 0; this.fps.last = now; }
    const connTxt = { connecting: T.connecting, connected: T.connected, down: T.reconnecting, demo: T.demo }[this.conn];
    // токените са първи – в малкия прозорец остават сами в ъгъла, когато останалото се скрие
    const html =
      (this.tokens != null ? `<span class="tok${now - (this.tokenFlash ?? -1e9) < 1500 ? ' gain' : ''}" title="${T.shop.open}"><i style="background-image:url(${this.coin ||= coinUrl()})"></i><b>${this.fmtTokens()}</b></span>` : '') +
      `<span class="conn ${this.conn}"><i></i>${connTxt}</span>` +
      `<span>${T.agents} <b>${s.agents - s.subs}</b></span>` +
      `<span>${T.subagents} <b>${s.subs}</b></span>` +
      `<span>${T.toolCalls} <b>${s.tools}</b></span>` +
      (s.waiting ? `<span class="alert">${T.waitingYou} <b>${s.waiting}</b></span>` : '');
    if (this.hud._html !== html) { this.hud.innerHTML = html; this.hud._html = html; }
    const title = s.waiting ? `(${s.waiting}) ${T.needsYou} · ${T.title}` : T.title;
    if (document.title !== title) document.title = title;
    this.empty.hidden = !(s.agents === 0 && this.conn !== 'demo');
    if (this.empty.textContent !== T.waitingActivity) this.empty.textContent = T.waitingActivity;
    if (PARAMS.debug) this.updateDebug(now);
    this.sendDesktopStats(s);
  }

  fmtTokens() { return this.tokens.toLocaleString('bg-BG'); }

  updateDebug(now) {
    const L = this.office.L;
    const lines = this.model.log.slice(-24).reverse().map(({ t, e }) => {
      const ago = ((now - t) / 1000).toFixed(1).padStart(5);
      return `${ago}s ${esc(e.agent.slice(0, 8))} ${esc(e.type)} ${esc(e.tool || '')} ${esc(shortDetail(e.detail || '', 28))}${e.parent ? ' ↑' + esc(e.parent.slice(0, 6)) : ''}`;
    });
    this.debugEl.innerHTML =
      `<b>FPS ${this.fps.value}</b> · scale ${L.scale} · ${L.W}×${L.H} · ${L.cols}×${L.rows} (cap ${L.cap}) · actors ${this.office.actors.size} · particles ${this.office.fx.list.length}` +
      `<pre>${lines.join('\n')}</pre>`;
  }
}
