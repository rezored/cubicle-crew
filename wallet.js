// Портфейл с токени: смята се на сървъра (печели и когато прозорецът е скрит), пази се в ~/.pixel-office/save.json.
// Един портфейл на потребител – общ за браузъра и desktop приложението. Ако вървят два сървъра наведнъж
// (`npm start` + приложението), брои само този, който държи save.lock; другият само чете файла.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Earner, dayKey } from './public/rules.js';
import { buyItem, equipItem, setAvatar, grantAchievements } from './public/catalog.js';

const DIR = process.env.PIXEL_OFFICE_HOME || path.join(os.homedir(), '.pixel-office');
const FILE = path.join(DIR, 'save.json');
const LOCK = path.join(DIR, 'save.lock');
const STEP_MS = 5000;        // натрупване
const SAVE_MS = 10000;       // най-много един запис за толкова
const LOCK_STALE_MS = 30000; // заключване без опресняване толкова -> поемаме го

const fresh = () => ({
  version: 1, tokens: 0, lifetimeTokens: 0, lifetimeActiveSec: 0, tasksDone: 0,
  owned: [], equipped: {}, lastDaily: null, daysActive: 0, achievements: {},
});
// полетата, които клиентът получава при промяна на обзавеждането
const DECOR_KEYS = ['owned', 'equipped', 'achievements', 'avatar'];

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export class Wallet {
  constructor(broadcast, log = () => {}) {
    this.broadcast = broadcast; this.log = log;
    this.save = { ...fresh(), ...(readJson(FILE) || readJson(FILE + '.bak') || {}) };
    this.earner = new Earner({ lastDaily: this.save.lastDaily });
    this.owner = false; this.dirty = false; this.lastWrite = 0; this.mtime = 0;
    this.activeMs = 0;
    this.port = 0;           // за препращане на покупки към процеса, който брои
  }

  start() {
    try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* */ }
    this.claim();
    this.timers = [
      setInterval(() => this.tick(), STEP_MS),
      setInterval(() => this.claim(), LOCK_STALE_MS / 3),
    ];
    for (const t of this.timers) t.unref?.();
    this.log(`портфейл: ${FILE} (${this.owner ? 'броя' : 'само чета – брои друг Pixel Office'})`);
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
    this.save = { ...fresh(), ...s };
    this.earner.lastDaily = this.save.lastDaily;
    return this.save.tokens !== before;
  }

  /** Живите сесии на Claude Code (id-та) – почиващите също печелят по малко. */
  setLive(ids, busy) { this.earner.setLive(ids, busy); }

  /** Всяко събитие от транскриптите. */
  ingest(evt) {
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
      if (!l?.port) return { ok: false, error: 'busy' };
      try {
        const r = await fetch(`http://localhost:${l.port}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
        if (r.save) { this.save = { ...fresh(), ...r.save }; delete this.save.owner; delete this.save.catalog; this.broadcast(this.msg(0, kind, null, null, true)); }
        return r;
      } catch { return { ok: false, error: 'busy' }; }
    }
    const r = kind === 'buy' ? buyItem(this.save, String(body.item))
      : kind === 'avatar' ? setAvatar(this.save, body)
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
    if (this.owner) { try { if (readJson(LOCK)?.pid === process.pid) fs.unlinkSync(LOCK); } catch { /* */ } }
    this.owner = false;
  }

  /** За GET /api/save. Каталогът е в public/catalog.js (общ модул). */
  publicSave() { return { ...this.save, owner: this.owner }; }
}
