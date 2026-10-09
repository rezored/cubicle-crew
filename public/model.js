// Модел на агентите: събития от сървъра -> състояние. Без рисуване.
// Логиката за състоянията е същата като в оригинала (висящи tool извиквания + 8 сек. idle),
// с едно разширение: родител, чийто Task/Agent още работи чрез жив под-агент, остава 'delegating'.
import { CFG, TOOL_STATE, DELEGATE_TOOLS } from './config.js';

export class Model {
  constructor() {
    this.agents = new Map();
    this.totalTools = 0;
    this.handlers = {};
    this.log = [];           // последни събития (за ?debug)
    this.pendingLinks = new Map(); // parentId -> Set(childId), ако детето дойде преди родителя
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  emit(name, ...args) { for (const fn of this.handlers[name] || []) fn(...args); }

  /** Всяко събитие от WebSocket (или от демото). */
  ingest(e, now = performance.now()) {
    if (!e || !e.agent) return;
    this.log.push({ t: now, e });
    if (this.log.length > 60) this.log.shift();

    let a = this.agents.get(e.agent);
    if (!a) {
      a = {
        id: e.agent, label: e.label || e.agent.slice(0, 8), subagent: !!e.subagent,
        parent: null, parentToolUseId: null, background: false, desc: null,
        pending: new Map(), lastEvent: now, firstSeen: now, toolCalls: 0,
        children: new Set(), state: 'thinking', stateSince: now, busySince: now,
        done: false, doneAt: 0, leaving: false, lastTool: null,
      };
      if (e.type === 'presence') { // жива сесия без скорошни събития -> идва и направо почива
        a.lastEvent = now - CFG.IDLE_MS - 1; a.state = 'idle'; a.stateSince = now - CFG.WANDER_AFTER_MS; a.busySince = 0;
      }
      this.agents.set(e.agent, a);
      if (e.desc) a.desc = e.desc;
      if (e.background) a.background = true;
      if (e.parent_tool_use_id) a.parentToolUseId = e.parent_tool_use_id;
      if (e.parent && e.parent !== a.id) { a.parent = e.parent; a.subagent = true; }
      this.emit('join', a);
      if (a.parent) { const pid = a.parent; a.parent = null; this.link(a.id, pid); }
      // дете, което е дошло преди родителя си
      const waiting = this.pendingLinks.get(a.id);
      if (waiting) { for (const cid of waiting) this.link(cid, a.id); this.pendingLinks.delete(a.id); }
    }
    if (e.subagent) a.subagent = true;
    if (e.desc && !a.desc) a.desc = e.desc;
    if (e.background) a.background = true;
    if (e.parent_tool_use_id && !a.parentToolUseId) a.parentToolUseId = e.parent_tool_use_id;
    if (e.parent && e.parent !== a.parent && e.parent !== a.id) this.link(a.id, e.parent);
    if (e.type === 'presence') return;

    a.lastEvent = now;
    a.lastType = e.type;
    if (a.done && e.type !== 'tool_end') { a.done = false; } // пак работи

    switch (e.type) {
      case 'tool_start': {
        a.pending.set(e.id, { tool: e.tool, detail: e.detail || '', start: now });
        a.toolCalls++; this.totalTools++;
        a.lastTool = { tool: e.tool, detail: e.detail || '' };
        this.emit('tool_start', a, e);
        break;
      }
      case 'tool_end': {
        const p = a.pending.get(e.tool_use_id);
        a.pending.delete(e.tool_use_id);
        this.emit('tool_end', a, e, p);
        // Task/Agent на родителя приключи -> детето е готово
        for (const cid of a.children) {
          const c = this.agents.get(cid);
          if (c && c.parentToolUseId && c.parentToolUseId === e.tool_use_id && !c.background) {
            c.done = true; c.doneAt = now;
          }
        }
        break;
      }
      case 'user_prompt':
        a.lastTool = null;
        break;
      default: break;
    }
  }

  /** Списък на живите сесии от сървъра: липсващите идват (почиват), затворените си тръгват. */
  sessions(list, now = performance.now()) {
    const ids = new Set();
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s.agent !== 'string') continue;
      ids.add(s.agent);
      if (!this.agents.has(s.agent)) this.ingest({ agent: s.agent, label: s.label, type: 'presence' }, now);
      const a = this.agents.get(s.agent);
      a.live = true; a.ended = false;
      a.busy = s.status === 'busy';   // Claude Code: "busy" докато мисли/работи (в транскрипта може да няма редове), "idle" – чака промпт
    }
    for (const a of this.agents.values()) if (a.live && !ids.has(a.id)) { a.live = false; a.ended = true; a.busy = false; }
  }

  link(childId, parentId) {
    const c = this.agents.get(childId);
    if (!c) return;
    const p = this.agents.get(parentId);
    if (!p) { // родителят още не е видян – ще го свържем, като се появи
      if (!this.pendingLinks.has(parentId)) this.pendingLinks.set(parentId, new Set());
      this.pendingLinks.get(parentId).add(childId);
      c.parent = parentId;
      return;
    }
    if (c.parent && c.parent !== parentId) this.agents.get(c.parent)?.children.delete(childId);
    c.parent = parentId;
    c.subagent = true;
    p.children.add(childId);
    this.emit('link', p, c);
  }

  liveChildren(a) {
    let n = 0;
    for (const cid of a.children) { const c = this.agents.get(cid); if (c && !c.done && !c.leaving) n++; }
    return n;
  }

  stateOf(a, now) {
    const tools = [...a.pending.values()];
    const delegatingPending = tools.some((p) => DELEGATE_TOOLS.has(p.tool));
    if (now - a.lastEvent > CFG.IDLE_MS && !a.busy) {
      if (delegatingPending && this.liveChildren(a) > 0) return 'delegating';
      a.pending.clear();
      return 'idle';
    }
    const last = tools[tools.length - 1];
    if (last) return TOOL_STATE[last.tool] || 'running';
    return 'thinking';
  }

  /** Текущият инструмент (за балончето). */
  currentTool(a) {
    const tools = [...a.pending.values()];
    return tools[tools.length - 1] || null;
  }

  /** Вика се всеки кадър: обновява състоянията и решава кой си тръгва. */
  tick(now) {
    for (const a of this.agents.values()) {
      if (a.leaving) continue;
      const s = this.stateOf(a, now);
      if (s !== a.state) {
        const old = a.state;
        if (old === 'idle') a.busySince = now;
        if (s === 'idle' && a.busySince && now - CFG.IDLE_MS - a.busySince > CFG.CONFETTI_MIN_RUN_MS) this.emit('celebrate', a);
        a.state = s; a.stateSince = now;
        this.emit('state', a, old, s);
      }
      // кой си тръгва
      const quiet = now - a.lastEvent;
      let leave = false;
      if (a.subagent) {
        if (a.done && now - a.doneAt > CFG.CHILD_EXIT_DELAY_MS && quiet > CFG.CHILD_EXIT_DELAY_MS) leave = true;
        // дълъг tool (напр. Bash) без нови редове – чакаме повече, преди да приемем, че е приключил
        else if (quiet > (a.lastType === 'tool_start' ? CFG.CHILD_DONE_IDLE_MS * 6 : CFG.CHILD_DONE_IDLE_MS)) leave = true;
      } else if (a.ended ? quiet > CFG.IDLE_MS : !a.live && quiet > CFG.GONE_AFTER_MS) leave = true; // жива сесия не си тръгва
      if (leave) this.leave(a.id);
    }
  }

  leave(id) {
    const a = this.agents.get(id);
    if (!a || a.leaving) return;
    a.leaving = true;
    this.emit('leave', a);
  }

  /** Окончателно махане (след като героят е излязъл през вратата). */
  remove(id) {
    const a = this.agents.get(id);
    if (!a) return;
    if (a.parent) this.agents.get(a.parent)?.children.delete(id);
    for (const cid of a.children) { const c = this.agents.get(cid); if (c) c.parent = null; }
    this.agents.delete(id);
  }

  stats() {
    let agents = 0, subs = 0, waiting = 0;
    const colors = [];
    for (const a of this.agents.values()) {
      if (a.leaving) continue;
      agents++;
      if (a.subagent) subs++;
      if (a.state === 'waiting') waiting++;
      colors.push(a.state);
    }
    return { agents, subs, waiting, tools: this.totalTools, states: colors };
  }
}
