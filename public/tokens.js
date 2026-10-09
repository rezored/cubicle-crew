// Токени в клиента: брояч (HUD + дъската), "+N" над работещите агенти, обзавеждане, демо портфейл.
// Истинският портфейл е на сървъра (wallet.js) – тук само показваме съобщенията { type: 'wallet', … }
// и пращаме покупките (POST /api/buy, /api/equip). В демото същите правила работят в паметта.
import { PARAMS } from './config.js';
import { Earner, dayKey } from './rules.js';
import { resolveDecor, buyItem, equipItem, setAvatar, avatarOf, grantAchievements } from './catalog.js';

const SHOW_EVERY_MS = 20000; // най-много едно "+N" на агент за толкова (натрупва се)

// монета 5x5 – за частиците, дъската и иконата в HUD
export const COIN = ['.ooo.', 'ohggo', 'ogggd', 'oggdd', '.odd.'];
export const COIN_COLORS = { o: '#7a5410', h: '#fff4b0', g: '#f0c840', d: '#c8902a' };
export function drawCoin(ctx, x, y) {
  COIN.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = COIN_COLORS[row[i]];
      if (c) { ctx.fillStyle = c; ctx.fillRect(x + i, y + j, 1, 1); }
    }
  });
}
/** Иконата като data URL (за DOM) – рисува се тук, без външни файлове. */
export function coinUrl() {
  const c = document.createElement('canvas');
  c.width = 5; c.height = 5;
  drawCoin(c.getContext('2d'), 0, 0);
  return c.toDataURL();
}

export class Tokens {
  constructor(office, ui) {
    this.office = office; this.ui = ui;
    this.tokens = null;          // null = сървърът още не е казал (или е стара версия)
    this.save = { owned: [], equipped: {}, achievements: {}, stats: {} };
    this.pending = new Map();    // agent -> натрупани, още непоказани токени
    this.shown = new Map();      // agent -> кога е показано последното "+N"
    this.listeners = [];         // магазинът се обновява при промяна
    this.preview = null;         // временно обзавеждане (магазинът)
    this.decorKey = '';
    this.backend = serverBackend(this);
  }

  onChange(fn) { this.listeners.push(fn); }

  /** Съобщение от сървъра (или от демото). */
  onWallet(m, now = performance.now()) {
    if (typeof m.tokens !== 'number') return;
    this.tokens = m.tokens;
    this.save.lifetime = m.lifetime;
    this.office.tokens = m.tokens;
    if (m.equipped) {
      this.save.owned = m.owned || []; this.save.equipped = m.equipped; this.save.achievements = m.achievements || {};
      this.save.avatar = m.avatar || null;
      this.office.setAvatar(avatarOf(this.save));
    }
    if (m.stats) this.save.stats = m.stats;
    if (m.reason === 'work' && m.by) {
      for (const [id, n] of Object.entries(m.by)) this.pending.set(id, (this.pending.get(id) || 0) + n);
    } else if (m.delta > 0 && m.reason !== 'sync') {
      // бонус – веднага и по-видимо
      this.office.tokenFx(m.src, m.delta, true);
    }
    if (m.reason === 'achievement' && m.achievement) this.ui.achievement(m.achievement, m.delta);
    this.ui.setTokens(this.tokens, m.delta > 0 && m.reason !== 'work' ? m.reason : null, now);
    this.applyDecor();
    for (const fn of this.listeners) fn(m);
  }

  /** Обзавеждането от портфейла (или прегледът в магазина) -> стаята; прерисува само при промяна. */
  applyDecor() {
    const eq = this.preview || this.save.equipped || {};
    const key = JSON.stringify(eq);
    if (key === this.decorKey) return;
    this.decorKey = key;
    this.office.setDecor(resolveDecor(eq));
  }
  setPreview(eq) { this.preview = eq; this.applyDecor(); }

  update(now) {
    for (const [id, n] of this.pending) {
      if (now - (this.shown.get(id) ?? -Infinity) < SHOW_EVERY_MS) continue;
      if (!this.office.actors.has(id)) { this.pending.delete(id); continue; } // агентът вече го няма
      this.office.tokenFx(id, n, false);
      this.shown.set(id, now);
      this.pending.delete(id);
    }
  }
}

/** Покупки към сървъра. Отговорът идва и по WebSocket (за всички прозорци), тук само грешката. */
function serverBackend() {
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'offline' }));
  return { buy: (item) => post('api/buy', { item }), equip: (slot, item) => post('api/equip', { slot, item }), avatar: (a) => post('api/avatar', a) };
}

/** ?demo: същите правила, но в паметта (истинският save.json не се пипа) и 10 пъти по-бързо, за да се вижда. */
export function demoWallet(tokens) {
  const earner = new Earner({ rate: 10 });
  const start = PARAMS.demo === 'showcase' ? 1240 : 600; // демото започва с малко токени, за да се пробва магазинът
  const save = { tokens: start, lifetimeTokens: start, tasksDone: 0, lifetimeActiveSec: 0, daysActive: 0, owned: [], equipped: {}, achievements: {} };
  const push = (delta, reason, src, by, extra) => tokens.onWallet({
    type: 'wallet', tokens: save.tokens, lifetime: save.lifetimeTokens, delta, reason, src, by,
    owned: save.owned, equipped: save.equipped, achievements: save.achievements, avatar: save.avatar,
    stats: { tasksDone: save.tasksDone, lifetimeActiveSec: save.lifetimeActiveSec, daysActive: save.daysActive }, ...extra,
  });
  const achievements = () => { for (const a of grantAchievements(save, dayKey())) push(a.reward, 'achievement', null, null, { achievement: a.id }); };
  const add = (n, reason, src, by) => {
    save.tokens += n; save.lifetimeTokens += n;
    if (reason === 'task') save.tasksDone++;
    if (reason === 'daily') save.daysActive++;
    push(n, reason, src, by);
    achievements();
  };
  push(0, 'sync');
  setInterval(() => {
    const r = earner.step(Date.now());
    save.lifetimeActiveSec += Math.round((r.activeMs / 1000) * 10);
    for (const b of r.bonuses) add(b.amount, b.reason, b.src);
    if (r.total > 0) add(r.total, 'work', null, r.by);
  }, 1000);
  const act = (r, kind) => { if (r.ok) { push(0, kind); achievements(); } return Promise.resolve(r); };
  tokens.backend = {
    buy: (item) => act(buyItem(save, item), 'buy'),
    equip: (slot, item) => act(equipItem(save, slot, item), 'equip'),
    avatar: (a) => act(setAvatar(save, a), 'avatar'),
  };
  return (e) => { for (const b of earner.ingest(e, Date.now())) add(b.amount, b.reason, b.src); };
}
