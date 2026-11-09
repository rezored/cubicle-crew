// Портфейл с токени: смята се на сървъра (печели и когато прозорецът е скрит), пази се в ~/.pixel-office/save.json.
// Един портфейл на потребител – общ за браузъра и desktop приложението. Ако вървят два сървъра наведнъж
// (`npm start` + приложението), брои само този, който държи save.lock; другият само чете файла.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Earner, dayKey } from './public/rules.js';
import { buyItem, equipItem, setAvatar, grantAchievements, setupOffice, setPetName, giveTreat, setCrew, seeCrew, crewKey, setOffice } from './public/catalog.js';
import { Stats } from './stats.js';

const DIR = process.env.PIXEL_OFFICE_HOME || path.join(os.homedir(), '.pixel-office');
const FILE = path.join(DIR, 'save.json');
const LOCK = path.join(DIR, 'save.lock');
const STEP_MS = 5000;        // натрупване
const SAVE_MS = 10000;       // най-много един запис за толкова
const LOCK_STALE_MS = 30000; // заключване без опресняване толкова -> поемаме го

// setup: null = нов потребител, началната настройка още не е минала (catalog.js setupOffice)
const fresh = () => ({
  version: 1, tokens: 0, lifetimeTokens: 0, lifetimeActiveSec: 0, tasksDone: 0,
  owned: [], equipped: {}, lastDaily: null, daysActive: 0, achievements: {}, setup: null,
});
// записи отпреди началната настройка: не я показваме (котката им си остава)
const load = (s) => ({ ...fresh(), setup: 'legacy', ...s });
// полетата, които клиентът получава при промяна на обзавеждането
const DECOR_KEYS = ['owned', 'equipped', 'achievements', 'avatar', 'petNames', 'starter', 'setup', 'crew', 'crewSeen', 'crewMe', 'officeName', 'pictures', 'officeSign'];

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export class Wallet {
  constructor(broadcast, log = () => {}) {
    this.broadcast = broadcast; this.log = log;
    const f = readJson(FILE) || readJson(FILE + '.bak');
    this.save = f ? load(f) : fresh();
    this.earner = new Earner({ lastDaily: this.save.lastDaily });
    this.owner = false; this.dirty = false; this.lastWrite = 0; this.mtime = 0;
    this.activeMs = 0;
    this.port = 0;           // за препращане на покупки към процеса, който брои
    this.stats = new Stats(DIR); // лична статистика по дни (пише само собственикът на save.lock)
    this.info = new Map();   // агент -> { label, sub } (за статистиката)
    this.waiting = new Set(); // живи сесии, които чакат теб (въпрос за разрешение)
  }

  start() {
    try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* */ }
    this.claim();
    this.timers = [
      setInterval(() => this.tick(), STEP_MS),
      setInterval(() => this.claim(), LOCK_STALE_MS / 3),
    ];
    for (const t of this.timers) t.unref?.();
    this.log(`save: ${FILE} (${this.owner ? 'counting' : 'read-only – another Cubicle Crew is counting'})`);
  }

  /** Заключване: само един процес брои и пише. */
  claim() {
    const l = readJson(LOCK);
    const mine = l && l.pid === process.pid;
    const free = !l || mine || Date.now() - (l.ts || 0) > LOCK_STALE_MS || !alive(l.pid);
    if (free) {
      if (!this.owner && !mine) this.reload(); // поемаме от друг процес – вземаме неговите числа
      try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, ts: Date.now(), port: this.port })); this.owner = true; } catch { this.owner = false; }
    } else this.owner = false;
  }

  reload() {
    const s = readJson(FILE);
    if (!s) return false;
    const before = this.save.tokens;
    this.save = load(s);
    this.earner.lastDaily = this.save.lastDaily;
    return this.save.tokens !== before;
  }

  /** Живите сесии на Claude Code (id-та) – почиващите също печелят по малко; waiting = чакат теб (за статистиката). */
  setLive(ids, busy, waiting = [], labels = {}) {
    this.earner.setLive(ids, busy);
    this.waiting = new Set(waiting);
    for (const id of ids) if (labels[id] && !this.info.has(id)) this.info.set(id, { label: labels[id], sub: false });
    while (this.info.size > 500) this.info.delete(this.info.keys().next().value);
  }

  /** message.usage от ред на асистента – истинските токени (само за статистиката). */
  usage(agent, label, sub, msg) { if (this.owner) this.stats.usage(agent, label, sub, msg); }

  /** За GET /api/stats – друг процес брои -> четем неговия файл. */
  statsView() { if (!this.owner) this.stats.reload(); return this.stats; }

  /** Всяко събитие от транскриптите. */
  ingest(evt) {
    if (evt?.agent) {
      this.info.set(evt.agent, { label: evt.label, sub: !!evt.subagent });
      while (this.info.size > 500) this.info.delete(this.info.keys().next().value);
    }
    if (this.owner) this.stats.event(evt);
    // екипът: кой колега е идвал (проект / тип под-агент) – за раздел „Екип“
    if (this.owner && (evt?.type === 'tool_start' || evt?.type === 'user_prompt')) {
      const k = crewKey(evt), ch = k ? seeCrew(this.save, k, evt.subagent ? evt.atype || evt.provider || '' : evt.label) : 0;
      if (ch) this.dirty = true;
      if (ch === 2) this.broadcast(this.msg(0, 'crew', null, null, true));
    }
    for (const b of this.earner.ingest(evt)) this.add(b.amount, b.reason, b.src);
  }

  tick() {
    const r = this.earner.step();
    for (const b of r.bonuses) this.add(b.amount, b.reason, b.src);
    if (!this.owner) {
      // другият сървър брои – показваме неговите числа
      let m = 0;
      try { m = fs.statSync(FILE).mtimeMs; } catch { /* */ }
      if (m !== this.mtime) { this.mtime = m; if (this.reload()) this.broadcast(this.msg(0, 'sync', null, null, true)); }
      return;
    }
    // статистика: колко време всеки агент е в кое състояние (чакащите теб – по файла на сесията)
    const now = Date.now();
    this.stats.step([...this.earner.agents.values()].map((a) => {
      const i = this.info.get(a.id) || {};
      return [a.id, this.waiting.has(a.id) ? 'waiting' : this.earner.stateOf(a, now), i.label, a.sub || i.sub];
    }), now);
    this.stats.flush();
    this.activeMs += r.activeMs;
    if (this.activeMs >= 1000) { const s = Math.floor(this.activeMs / 1000); this.save.lifetimeActiveSec += s; this.activeMs -= s * 1000; this.dirty = true; this.achievements(); }
    if (r.total > 0) this.add(r.total, 'work', null, r.by);
    if (this.dirty && Date.now() - this.lastWrite >= SAVE_MS) this.flush();
  }

  add(amount, reason, src, by) {
    if (!this.owner || amount <= 0) return;
    this.save.tokens += amount;
    this.save.lifetimeTokens += amount;
    if (reason === 'task') this.save.tasksDone++;
    if (reason === 'daily') this.save.daysActive = (this.save.daysActive || 0) + 1;
    this.save.lastDaily = this.earner.lastDaily;
    this.dirty = true;
    this.broadcast(this.msg(amount, reason, src, by));
    this.achievements();
  }

  /** Нови постижения -> награда + известие (по едно съобщение на постижение). */
  achievements() {
    for (const a of grantAchievements(this.save, dayKey())) {
      this.dirty = true;
      this.broadcast({ ...this.msg(a.reward, 'achievement', null, null, true), achievement: a.id });
    }
  }

  /** Покупка / слагане. Ако брои друг процес – препращаме към него (иначе двата записа се презаписват). */
  async act(kind, body) {
    if (!this.owner) {
      const l = readJson(LOCK);
      if (l?.port) {
        try {
          const r = await fetch(`http://127.0.0.1:${l.port}/api/${kind}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(3000),
          }).then((x) => x.json());
          if (r.save) { this.save = load(r.save); delete this.save.owner; delete this.save.catalog; this.broadcast(this.msg(0, kind, null, null, true)); }
          return r;
        } catch {
          this.claim();
        }
      } else {
        this.claim();
      }
      if (!this.owner) return { ok: false, error: 'busy' };
    }
    const r = kind === 'buy' ? buyItem(this.save, String(body.item), body.slot ? String(body.slot) : null)
      : kind === 'avatar' ? setAvatar(this.save, body)
      : kind === 'setup' ? setupOffice(this.save, body)
      : kind === 'pet' ? setPetName(this.save, String(body.slot), body.name)
      : kind === 'treat' ? giveTreat(this.save) // лакомство за любимец (фиксирана цена)
      : kind === 'crew' ? setCrew(this.save, body) // колега от раздел „Екип“: име / външен вид
      : kind === 'office' ? setOffice(this.save, body) // табелата и твоите картини на стената
      : equipItem(this.save, String(body.slot), body.item == null ? null : String(body.item));
    if (r.ok) {
      this.dirty = true;
      this.broadcast(this.msg(0, kind, null, null, true));
      this.achievements();
      this.flush(); // покупките се пишат веднага
    }
    return { ...r, save: this.publicSave() };
  }

  /** WebSocket съобщение без поле `agent` – Model.ingest го пропуска, старите клиенти не се чупят. */
  msg(delta, reason, src, by, full = false) {
    const m = { type: 'wallet', tokens: this.save.tokens, lifetime: this.save.lifetimeTokens, delta, reason };
    if (src) m.src = src;
    if (by) m.by = by;
    if (full) for (const k of DECOR_KEYS) m[k] = this.save[k];
    if (full) m.stats = { tasksDone: this.save.tasksDone, lifetimeActiveSec: this.save.lifetimeActiveSec, daysActive: this.save.daysActive };
    return m;
  }

  /** Атомарен запис: .tmp -> rename, предишната версия остава в .bak. */
  flush() {
    if (!this.owner || !this.dirty) return;
    try {
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.save, null, 2));
      if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
      fs.renameSync(tmp, FILE);
      this.dirty = false; this.lastWrite = Date.now();
      try { this.mtime = fs.statSync(FILE).mtimeMs; } catch { /* */ }
    } catch (e) { this.log('портфейл: грешка при запис ' + e.message); }
  }

  /** При изход: запис и освобождаване на заключването. */
  close() {
    this.flush();
    if (this.owner) this.stats.flush(true);
    if (this.owner) { try { if (readJson(LOCK)?.pid === process.pid) fs.unlinkSync(LOCK); } catch { /* */ } }
    this.owner = false;
  }

  /** За GET /api/save. Каталогът е в public/catalog.js (общ модул). */
  publicSave() { return { ...this.save, owner: this.owner }; }
}
