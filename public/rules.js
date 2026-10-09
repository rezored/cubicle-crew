// Общи правила за сървъра и клиента (без DOM, без `location`): инструмент -> състояние и печеленето на токени.
// Сървърът (wallet.js) смята истинския портфейл; демото ползва същия Earner в паметта.

// Кой инструмент към кое състояние води. Непознатите -> 'running'.
export const TOOL_STATE = {
  Write: 'typing', Edit: 'typing', MultiEdit: 'typing', NotebookEdit: 'typing',
  Read: 'reading', Grep: 'reading', Glob: 'reading', WebSearch: 'reading', WebFetch: 'reading',
  Bash: 'running', BashOutput: 'running',
  Task: 'delegating', Agent: 'delegating',
  AskUserQuestion: 'waiting',
};
export const DELEGATE_TOOLS = new Set(['Task', 'Agent']);

export const EARN = {
  PER_MIN: 1,                 // токени за претеглена активна минута на оркестратор
  SUB_FACTOR: 0.5,            // под-агент печели наполовина…
  MAX_SUBS: 6,                // …и се броят най-много толкова наведнъж
  IDLE_MS: 8000,              // както CFG.IDLE_MS – без събития толкова -> почива
  PENDING_MAX_MS: 10 * 60e3,  // висящ инструмент държи агента "активен" най-много толкова (заседнал Bash не печата пари)
  RUN_MIN_MS: 60000,          // както CFG.CONFETTI_MIN_RUN_MS – "дълга работа"
  FORGET_MS: 30 * 60e3,       // агент без събития толкова се забравя
  WEIGHT: { typing: 1, reading: 1, running: 1, delegating: 1, thinking: 0.5, waiting: 0.25, idle: 0 },
  LIVE_IDLE: 0.025,           // жива, но почиваща сесия (на дивана): 0.25 токена за 10 мин (не е "активно време")
  BONUS: { task: 5, run: 10, daily: 20 },
};

/** Местна дата 'YYYY-MM-DD' (за дневния бонус). */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Броене на токени от събитията. Чисто: без файлове и таймери.
 * ingest(evt) -> бонуси [{reason, amount, src}]; step(now) -> { by: {agent: цели токени}, total, activeMs, bonuses }.
 */
export class Earner {
  constructor({ rate = 1, lastDaily = null } = {}) {
    this.rate = rate;              // множител (демото върви по-бързо)
    this.lastDaily = lastDaily;
    this.agents = new Map();
    this.live = new Set();         // живи главни сесии (~/.claude/sessions) – печелят малко и докато почиват
    this.last = null;
  }

  setLive(ids) { this.live = new Set(ids); }

  agent(id, now) {
    let a = this.agents.get(id);
    if (!a) {
      a = { id, sub: false, parentToolUseId: null, background: false, pending: new Map(), lastEvent: now, busySince: 0, active: false, acc: 0, paid: false };
      this.agents.set(id, a);
    }
    return a;
  }

  ingest(e, now = Date.now()) {
    const bonuses = [];
    if (!e || !e.agent) return bonuses;
    const a = this.agent(e.agent, now);
    if (e.subagent || e.parent) a.sub = true;
    if (e.parent_tool_use_id) a.parentToolUseId = e.parent_tool_use_id;
    if (e.background) a.background = true;
    a.lastEvent = now;
    if (e.type === 'tool_start') a.pending.set(e.id, { tool: e.tool, start: now });
    else if (e.type === 'tool_end') {
      a.pending.delete(e.tool_use_id);
      // Task/Agent на родителя приключи -> под-агентите му са свършили задачата
      for (const c of this.agents.values()) {
        if (c.paid || c.background || !c.parentToolUseId || c.parentToolUseId !== e.tool_use_id) continue;
        c.paid = true;
        bonuses.push({ reason: 'task', amount: EARN.BONUS.task, src: c.id });
      }
    }
    const today = dayKey();
    if (this.lastDaily !== today) {
      this.lastDaily = today;
      bonuses.push({ reason: 'daily', amount: EARN.BONUS.daily, src: e.agent });
    }
    return bonuses;
  }

  stateOf(a, now) {
    const pend = [...a.pending.values()].filter((p) => now - p.start < EARN.PENDING_MAX_MS);
    if (now - a.lastEvent > EARN.IDLE_MS && !pend.length) return 'idle';
    const last = pend[pend.length - 1];
    return last ? TOOL_STATE[last.tool] || 'running' : 'thinking';
  }

  step(now = Date.now()) {
    const dt = this.last == null ? 0 : Math.min(60000, Math.max(0, now - this.last));
    this.last = now;
    const out = { by: {}, total: 0, activeMs: 0, bonuses: [] };
    const subs = [];
    let any = false;
    for (const id of this.live) if (!this.agents.has(id)) this.agent(id, now).lastEvent = 0; // без скорошни събития
    for (const a of [...this.agents.values()]) {
      if (now - a.lastEvent > EARN.FORGET_MS && !this.live.has(a.id)) { this.agents.delete(a.id); continue; }
      const w = EARN.WEIGHT[this.stateOf(a, now)] || 0;
      // дълга работа приключи (същото правило като конфетите в model.js)
      if (w > 0 && !a.active) { a.active = true; a.busySince = now; }
      else if (w === 0 && a.active) {
        a.active = false;
        if (!a.sub && now - EARN.IDLE_MS - a.busySince > EARN.RUN_MIN_MS) out.bonuses.push({ reason: 'run', amount: EARN.BONUS.run, src: a.id });
      }
      if (w > 0) any = true;
      if (a.sub) subs.push([a, w]);
      else a.acc += (w || (this.live.has(a.id) ? EARN.LIVE_IDLE : 0)) * dt;
    }
    subs.sort((x, y) => y[1] - x[1]);
    subs.forEach(([a, w], i) => { if (i < EARN.MAX_SUBS) a.acc += w * EARN.SUB_FACTOR * dt; });
    for (const a of this.agents.values()) {
      const n = Math.floor((a.acc * this.rate * EARN.PER_MIN) / 60000);
      if (n > 0) { a.acc -= (n * 60000) / (this.rate * EARN.PER_MIN); out.by[a.id] = n; out.total += n; }
    }
    if (any) out.activeMs = dt;
    return out;
  }
}
