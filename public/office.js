// Сцената: подредба, мебели, герои, маршрути, рисуване по слоеве.
import { CFG, STATES } from './config.js';
import { computeLayout, POD } from './layout.js';
import { buildRoom, buildPod, drawSky, drawShafts, drawWallDynamic, drawTint, glow, drawAquariumFish, drawArcadeScreen } from './environment.js';
import { resolveDecor, AVATAR } from './catalog.js';
import { drawScreen } from './screens.js';
import { Actor, Cat, DART_CYCLE, DART_RELEASE } from './characters.js';
import { avatarLook } from './sprites.js';
import { rgba } from './palette.js';
import { R, pixLine, hashStr, clamp } from './util.js';

const LOUNGE = new Set(['sofa', 'coffee', 'cooler', 'lounge', 'darts']);

export class Office {
  constructor(model, particles) {
    this.model = model;
    this.fx = particles;
    this.actors = new Map();
    this.L = null; this.room = null; this.podImgs = [];
    this.dev = { w: 0, h: 0 };
    this.spec = { teams: 1, rows: 1 };
    this.teams = new Array(CFG.MAX_TEAMS).fill(null); // id на оркестратора за всеки екип
    this.decor = resolveDecor({});   // обзавеждането (catalog.js); setDecor() го сменя
    this.cats = [new Cat(this.decor.cat)];
    this.avatar = AVATAR.def;        // външният вид на потребителя (портфейлът го сменя)
    this.avatarId = null;            // кой оркестратор го носи: първият дошъл; щом излезе – следващият по ред
    this.joinSeq = 0;
    this.focusId = null;
    this.seed = 1;
    this.layoutVersion = 0;
    this.darts = { stuck: [], flying: [] }; // дартс: забитите в дъската и летящите стрелички
  }

  // ================================================================ подредба
  resize(devW, devH) {
    if (devW === this.dev.w && devH === this.dev.h && this.L) return false;
    this.dev = { w: devW, h: devH };
    this.relayout();
    return true;
  }

  // ---------------------------------------------------------------- екипи и места
  // Място = { team, role: 'lead'|'sub', slot }. Без място (seat = null) = чака в зоната за почивка.
  live() { return [...this.actors.values()].filter((a) => a.mode !== 'gone'); }

  wantedSpec() {
    const teams = this.teams[1] ? 2 : 1;
    let rows = 1;
    for (let t = 0; t < teams; t++) {
      const subs = this.live().filter((a) => a.seat && a.seat.team === t && a.seat.role === 'sub');
      const maxSlot = subs.reduce((m, a) => Math.max(m, a.seat.slot + 1), 0);
      rows = Math.max(rows, Math.ceil(Math.max(CFG.SUB_PER_ROW, subs.length, maxSlot) / CFG.SUB_PER_ROW));
    }
    return { teams, rows };
  }

  podIndexOf(seat) {
    if (!seat || !this.L) return -1;
    const p = this.L.pods.find((q) => q.team === seat.team && q.role === seat.role && q.slot === seat.slot);
    return p ? p.i : -1;
  }

  relayout() {
    this.L = computeLayout(this.dev.w, this.dev.h, this.spec);
    this.room = buildRoom(this.L, this.seed, this.decor);
    this.podImgs = this.L.pods.map((p) => buildPod(hashStr(`pod${p.team}${p.role}${p.slot}`) ^ this.seed, p.role === 'lead', this.decor, p.team));
    this.layoutVersion++;
    if (this.darts) this.darts.stuck.length = 0; // дъската може да се е преместила
    // героите: седналите – на новите места, вървящите – направо на целта
    for (const a of this.actors.values()) {
      a.pod = this.podIndexOf(a.seat);
      const end = this.locPoint(a.loc, a);
      if (end) { a.x = end.x; a.y = end.y; }
      a.path = [];
      if (a.mode === 'walk') a.onArrive();
      if (a.loc.type === 'pace') { a.loc.x0 = a.x; }
    }
  }

  /** Нов аватар: пребоядисва всички оркестратори (под-агентите не се пипат). */
  setAvatar(av) {
    if (JSON.stringify(av) === JSON.stringify(this.avatar)) return;
    this.avatar = av;
    const a = this.actors.get(this.avatarId);
    if (a) a.setLook(avatarLook(av, a.id));
  }

  /** Ново обзавеждане (от портфейла или прегледа в магазина): котките + прерисуване на стаята. */
  setDecor(decor) {
    this.decor = decor;
    this.cats[0].look = decor.cat;
    if (decor.cat2 && !this.cats[1]) this.cats.push(new Cat(decor.cat2, 0.2));
    else if (!decor.cat2 && this.cats[1]) this.cats.length = 1;
    if (this.cats[1]) this.cats[1].look = decor.cat2;
    if (this.L) this.relayout();
  }

  /** Расте веднага; смалява се само когато никой не върви (иначе героите "прескачат"). */
  ensureLayout() {
    const walking = this.live().some((a) => a.mode === 'walk');
    // екип 0 е празен, а екип 1 – не: местим екип 1 наляво (само когато всички стоят)
    if (!this.teams[0] && this.teams[1] && !walking) {
      this.teams = [this.teams[1], null];
      for (const a of this.actors.values()) if (a.seat && a.seat.team === 1) a.seat = { ...a.seat, team: 0 };
    }
    const want = this.wantedSpec();
    const next = walking
      ? { teams: Math.max(want.teams, this.spec.teams), rows: Math.max(want.rows, this.spec.rows) }
      : want;
    if (next.teams !== this.spec.teams || next.rows !== this.spec.rows) { this.spec = next; this.relayout(); }
    else for (const a of this.actors.values()) a.pod = this.podIndexOf(a.seat);
  }

  teamOf(id) {
    const a = id && this.actors.get(id);
    return a && a.seat ? a.seat.team : null;
  }

  freeSubSlot(team, except) {
    const used = new Set(this.live().filter((a) => a !== except && a.seat && a.seat.team === team && a.seat.role === 'sub').map((a) => a.seat.slot));
    let k = 0; while (used.has(k)) k++;
    return k;
  }

  /** Сяда на място (и пренарежда стаята, ако трябва). */
  assignSeat(a, seat) {
    a.seat = seat;
    if (seat && seat.role === 'lead') this.teams[seat.team] = a.id;
    this.ensureLayout();
    a.pod = this.podIndexOf(seat);
  }

  freeTeam() {
    for (let t = 0; t < CFG.MAX_TEAMS; t++) if (!this.teams[t] || !this.actors.has(this.teams[t])) return t;
    return -1;
  }

  /** Чакащи сесии заемат освободен екип или сменят оркестратор, който отдавна почива. */
  manageTeams(now) {
    for (let t = 0; t < CFG.MAX_TEAMS; t++) {
      const id = this.teams[t];
      const a = id && this.actors.get(id);
      if (id && (!a || a.agent.leaving || a.leavingNow)) { this.teams[t] = null; continue; }
      // почиващ оркестратор, вече в зоната за почивка, без живи под-агенти -> освобождава бюрото
      // (в покой стаята е с едно работно място; второто се появява, когато работят и двамата)
      if (a && a.agent.state === 'idle' && a.mode !== 'walk' && LOUNGE.has(a.loc.type) && this.model.liveChildren(a.agent) === 0 &&
        !this.live().some((x) => x.seat && x.seat.team === t && x.seat.role === 'sub')) {
        a.seat = null; a.pod = -1; this.teams[t] = null;
      }
    }
    const queued = this.live().filter((a) => !a.seat && !a.agent.subagent && !a.agent.leaving && !a.leavingNow)
      .sort((x, y) => (x.agent.state === 'idle') - (y.agent.state === 'idle') || y.agent.lastEvent - x.agent.lastEvent);
    for (const q of queued) {
      if (q.agent.state === 'idle') continue; // почиващите не заемат бюро и не изместват никого
      let t = this.freeTeam();
      if (t < 0) {
        // оркестратор, който почива достатъчно дълго и няма живи под-агенти
        let best = -1, bestQuiet = 0;
        for (let k = 0; k < CFG.MAX_TEAMS; k++) {
          const lead = this.actors.get(this.teams[k]);
          const quiet = now - lead.agent.lastEvent;
          if (lead.agent.state === 'idle' && quiet > CFG.SWAP_IDLE_MS && this.model.liveChildren(lead.agent) === 0 && quiet > bestQuiet) { best = k; bestQuiet = quiet; }
        }
        if (best < 0) continue;
        t = best;
        const old = this.actors.get(this.teams[t]);
        old.seat = null; old.pod = -1;
        this.leaveDesk(old, this.freeLoungeSpot(old));
      }
      this.assignSeat(q, { team: t, role: 'lead', slot: 0 });
      this.route(q, { type: 'seat' });
      // под-агентите му, дошли докато е бил без бюро – при него
      for (const c of this.live()) {
        if (c.agent.parent !== q.id || c.seatedOnce || c.agent.leaving || c.leavingNow) continue;
        this.assignSeat(c, { team: t, role: 'sub', slot: this.freeSubSlot(t, c) });
        this.route(c, { type: 'seat' });
      }
    }
  }

  /** Става от бюро, което вече не е негово (екипът е даден на друг) и отива в зоната за почивка. */
  leaveDesk(a, to) {
    const L = this.L;
    if (a.mode === 'walk') { this.route(a, to); return; }
    const near = L.pods.reduce((b, p) => (Math.hypot(p.cx - a.x, p.seatY - a.y) < Math.hypot(b.cx - a.x, b.seatY - a.y) ? p : b), L.pods[0]);
    a.goTo({ type: 'transit' }, [{ x: Math.round(a.x), y: near.aisleY }]);
    a.pendingLoc = to;
  }

  // ================================================================ маршрути
  lanes() {
    const L = this.L;
    // вертикални пътеки: до вратата, вляво от всеки екип и в зоната за почивка
    // + между колоните бюра във всеки екип (оркестраторът слиза направо при под-агентите си)
    const teamX = L.teams.flatMap((t) => [t.x - 4, Math.round(t.x + t.gw + 2), Math.round(t.x + 2 * t.gw + 2)]);
    const vs = [...new Set([L.leftLaneX, ...teamX, L.lounge.x + 9])];
    return { leftX: L.leftLaneX, loungeX: L.lounge.x + 9, topY: CFG.WALL_H + 9, vs };
  }

  /** Крайна точка на дадено място. */
  locPoint(loc, a) {
    const L = this.L, lo = L.lounge;
    switch (loc.type) {
      case 'seat': { const p = L.pods[a.pod]; return p && { x: p.cx, y: p.seatY }; }
      case 'coffee': return lo.spots.coffee;
      case 'cooler': return lo.spots.cooler;
      case 'darts': return lo.spots.darts;
      case 'sofa': return lo.spots.sofa[loc.i];
      case 'lounge': return lo.spots.extra[loc.i % lo.spots.extra.length];
      case 'door': return { x: L.door.cx, y: L.door.floorY };
      case 'pace': { const p = L.pods[a.pod]; return p && { x: p.cx, y: p.aisleY }; }
      case 'visit': { const t = this.actors.get(loc.target); const p = t && L.pods[t.pod]; return p ? { x: p.cx - 15, y: p.aisleY } : this.locPoint({ type: 'seat' }, a); }
      default: return null;
    }
  }

  /** Път от мястото до "котва" върху мрежата от пътеки: [точки], котва = последната. */
  exitPoints(loc, a) {
    const L = this.L, ln = this.lanes(), lo = L.lounge;
    switch (loc.type) {
      case 'seat': case 'pace': { const p = L.pods[a.pod]; if (!p) return { pts: [], lane: 'row', y: a.y }; return { pts: [{ x: p.cx, y: p.aisleY }], lane: 'row', y: p.aisleY }; }
      case 'transit': return { pts: [], lane: 'row', y: a.y };
      case 'lounge': { const s = lo.spots.extra[loc.i % lo.spots.extra.length]; return { pts: [{ x: ln.loungeX, y: s.y }], lane: 'v', x: ln.loungeX }; }
      case 'door': return { pts: [{ x: L.door.cx, y: L.door.floorY }], lane: 'v', x: ln.leftX };
      case 'visit': { const pt = this.locPoint(loc, a); return { pts: [pt], lane: 'row', y: pt.y }; }
      case 'coffee': case 'cooler': { const s = lo.spots[loc.type]; return { pts: [{ x: ln.loungeX, y: s.y }], lane: 'v', x: ln.loungeX }; }
      case 'darts': { const s = lo.spots.darts; return { pts: [{ x: s.x, y: ln.topY }], lane: 'row', y: ln.topY }; }
      case 'sofa': { const s = lo.spots.sofa[loc.i]; const ay = lo.sofa.base + 4; return { pts: [{ x: s.x, y: ay }, { x: ln.loungeX, y: ay }], lane: 'v', x: ln.loungeX }; }
      default: return { pts: [], lane: 'row', y: a.y };
    }
  }

  connect(A, B, from, to) {
    const ln = this.lanes();
    const pts = [];
    if (A.lane === 'row' && B.lane === 'row') {
      if (A.y !== B.y) {
        // най-късата вертикална пътека между двата реда
        const tx = to ? to.x : from.x;
        const X = ln.vs.reduce((b, x) => (Math.abs(x - from.x) + Math.abs(x - tx) < Math.abs(b - from.x) + Math.abs(b - tx) ? x : b), ln.vs[0]);
        pts.push({ x: X, y: A.y }, { x: X, y: B.y });
      }
    } else if (A.lane === 'row' && B.lane === 'v') pts.push({ x: B.x, y: A.y });
    else if (A.lane === 'v' && B.lane === 'row') pts.push({ x: A.x, y: B.y });
    else if (A.x !== B.x) pts.push({ x: A.x, y: ln.topY }, { x: B.x, y: ln.topY });
    return pts;
  }

  /** Ако героят е в движение по пътека – откъде да продължи. null = първо да стигне целта си. */
  currentAnchor(a) {
    const ln = this.lanes();
    const near = (u, v) => Math.abs(u - v) < 0.6;
    for (const x of ln.vs) if (near(a.x, x)) return { pts: [], lane: 'v', x };
    if (near(a.y, ln.topY)) return { pts: [], lane: 'row', y: ln.topY };
    for (const p of this.L.pods) if (near(a.y, p.aisleY)) return { pts: [], lane: 'row', y: p.aisleY };
    return null;
  }

  route(a, to) {
    let A;
    if (a.mode === 'walk') {
      A = this.currentAnchor(a);
      if (!A) { a.pendingLoc = to; return; }
      a.y = Math.round(a.y); a.x = Math.round(a.x);
    } else A = this.exitPoints(a.loc, a);
    a.pendingLoc = null;
    const B = this.exitPoints(to, a);
    const from = A.pts.length ? A.pts[A.pts.length - 1] : { x: a.x, y: a.y };
    const mid = this.connect(A, B, from, B.pts.length ? B.pts[0] : this.locPoint(to, a));
    const back = [...B.pts].reverse();
    const end = this.locPoint(to, a);
    const pts = [...A.pts, ...mid, ...back, end];
    // махаме повтарящи се точки
    const out = [];
    let px = a.x, py = a.y;
    for (const p of pts) { if (!p) continue; if (Math.abs(p.x - px) < 0.5 && Math.abs(p.y - py) < 0.5) continue; out.push(p); px = p.x; py = p.y; }
    a.goTo(to, out);
  }

  // ================================================================ събития от модела
  join(agent, now) {
    if (this.actors.has(agent.id)) return;
    const a = new Actor(agent, this);
    a.seat = null;
    a.joinSeq = ++this.joinSeq;
    this.actors.set(agent.id, a);
    this.syncAvatar();
    if (agent.subagent) {
      // под-агент: в екипа на родителя (неизвестен родител – екипът със същия проект или първият;
      // родител без бюро – детето чака в зоната за почивка, manageTeams го премества, щом родителят седне)
      let team = this.teamOf(agent.parent);
      if (team == null && !this.actors.has(agent.parent)) {
        const same = [...this.actors.values()].find((x) => x.seat && x.seat.role === 'lead' && x.agent.label === agent.label);
        team = same ? same.seat.team : (this.teams[0] ? 0 : null);
      }
      if (team != null) this.assignSeat(a, { team, role: 'sub', slot: this.freeSubSlot(team, a) });
      // влиза през вратата
      a.loc = { type: 'door' };
      const d = this.locPoint({ type: 'door' }, a);
      a.x = d.x; a.y = d.y - 4; a.alpha = 0; a.fadeTo = 1;
      a.mode = 'idleSpot';
      this.route(a, a.seat ? { type: 'seat' } : this.freeLoungeSpot(a));
      return;
    }
    const t = agent.state === 'idle' ? -1 : this.freeTeam();
    if (agent.state === 'idle') {
      // жива, но почиваща сесия (напр. след рестарт): влиза през вратата и сяда на дивана, без да заема бюро
      a.loc = { type: 'door' };
      const d = this.locPoint({ type: 'door' }, a);
      a.x = d.x; a.y = d.y - 4; a.alpha = 0; a.fadeTo = 1;
      a.mode = 'idleSpot';
      this.route(a, this.freeSofa(a) || this.freeLoungeSpot(a));
      return;
    }
    if (t >= 0) {
      this.assignSeat(a, { team: t, role: 'lead', slot: 0 });
      const p = this.L.pods[a.pod];
      a.x = p.cx; a.y = p.seatY; a.mode = 'seated'; a.loc = { type: 'seat' };
      a.seatedOnce = true;
    } else {
      // всички екипи са заети – чака в зоната за почивка
      const spot = this.freeLoungeSpot(a);
      const pt = this.locPoint(spot, a);
      a.loc = spot; a.mode = 'idleSpot'; a.x = pt.x; a.y = pt.y; a.spotSince = now;
    }
    a.alpha = 0; a.fadeTo = 1;
    this.fx.sparkle(a.x, a.y - 18, STATES[agent.state].color, 18);
  }

  /** Аватарът на потребителя е само на един оркестратор – първия дошъл, който още е в офиса; другите са случайни. */
  syncAvatar() {
    if (this.actors.has(this.avatarId)) return;
    let best = null;
    for (const a of this.actors.values()) if (!a.agent.subagent && (!best || a.joinSeq < best.joinSeq)) best = a;
    this.avatarId = best ? best.id : null;
    if (best) best.setLook(avatarLook(this.avatar, best.id));
  }

  link(parent, child) {
    const c = this.actors.get(child.id), p = this.actors.get(parent.id);
    if (!c || !p || !p.seat) return;
    // детето още не е седнало и е в чужд екип (или без място) – местим го при родителя
    if (!c.seatedOnce && (!c.seat || c.seat.team !== p.seat.team)) {
      this.assignSeat(c, { team: p.seat.team, role: 'sub', slot: this.freeSubSlot(p.seat.team, c) });
      this.route(c, { type: 'seat' });
    }
  }

  onSeated(a) {
    // родителят "подава" бележка на детето
    const parent = a.agent.parent && this.actors.get(a.agent.parent);
    if (!parent) return;
    // родителят става, занася листа до бюрото на детето и се връща; ако е зает – самолетче
    const now = performance.now();
    if (parent.isAtDesk(this.L) && parent.vstate !== 'waiting' && !parent.agent.leaving && now - (parent.lastVisit || -1e9) > 10000) {
      parent.lastVisit = now;
      this.route(parent, { type: 'visit', target: a.id, carry: true });
    } else this.throwPlane(parent, a);
  }

  throwPlane(from, to) {
    const L = this.L;
    const pf = L.pods[from.pod];
    const x0 = from.x + 8, y0 = from.y - 30;
    let x1, y1;
    if (to) { const pt = L.pods[to.pod]; x1 = to.isAtDesk(L) ? pt.cx : to.x; y1 = to.isAtDesk(L) ? pt.y + 22 : to.y - 16; }
    else { x1 = L.door.cx; y1 = L.door.floorY - 6; }
    this.fx.plane(x0, y0, x1, y1, () => { if (to && this.actors.has(to.id)) to.receivedAt = performance.now(); });
    void pf;
  }

  leave(agent) {
    const a = this.actors.get(agent.id);
    if (!a) { this.model.remove(agent.id); return; }
    if (agent.subagent && agent.done) this.fx.confetti(a.x, a.y - 30, 26);
    a.leavingNow = true;
    this.route(a, { type: 'door', exit: true });
  }

  celebrate(agent) {
    const a = this.actors.get(agent.id);
    if (a) this.fx.confetti(a.x, a.y - 30, 46);
  }

  /** "+N" токени над агента (няма го – над дъската). */
  tokenFx(id, n, big) {
    const a = id && this.actors.get(id);
    if (a && a.alpha > 0.3) { const b = this.anchors(a).bubble; this.fx.token(b.x, b.y - 6, n, big); return; }
    const bd = this.room?.board;
    if (bd) this.fx.token(bd.x + bd.w / 2, bd.y + bd.h + 2, n, big);
    else this.fx.token(this.L.W / 2, 40, n, big);
  }

  // ================================================================ поведение
  decide(a, now) {
    const ag = a.agent;
    if (ag.leaving || a.leavingNow) return;
    if (a.mode === 'walk') {
      // ако е тръгнал към почивка, а вече има работа – връща се
      if (a.seat && ag.state !== 'idle' && !['seat', 'pace', 'visit', 'transit', 'door'].includes(a.loc.type)) this.route(a, { type: 'seat' });
      if (a.loc.type === 'visit' && !this.actors.has(a.loc.target)) this.route(a, { type: 'seat' });
      return;
    }
    if (a.loc.type === 'visit') {
      const kid = this.actors.get(a.loc.target);
      if (!a.handed && kid) { a.handed = true; kid.receivedAt = now; }
      if (now - a.spotSince > 1500 || !kid || ag.state === 'waiting') { a.handed = false; this.route(a, { type: 'seat' }); }
      return;
    }
    const st = ag.state;
    const lt = now - ag.stateSince;
    if (!a.seat) {
      // без място: стои в зоната за почивка (чака свободен екип)
      if (['seat', 'pace', 'transit', 'visit'].includes(a.loc.type)) this.route(a, this.freeLoungeSpot(a));
      else if (st === 'idle') this.leisure(a, now);
      return;
    }
    if (a.loc.type === 'seat') {
      if (st === 'idle' && lt > CFG.WANDER_AFTER_MS && a.mode === 'seated') {
        const spot = this.freeLoungeSpot(a);
        if (spot) this.route(a, spot);
      } else if (st === 'thinking' && lt > 6000 && a.mode === 'seated') {
        a.paceDir = Math.random() < 0.5 ? 1 : -1;
        this.route(a, { type: 'pace' });
        a.loc.x0 = this.L.pods[a.pod].cx;
      }
      return;
    }
    if (a.loc.type === 'pace') {
      if (st !== 'thinking') this.route(a, { type: 'seat' });
      return;
    }
    // в зоната за почивка
    if (st !== 'idle') { this.route(a, { type: 'seat' }); return; }
    this.leisure(a, now);
  }

  /** Почивка: кафе/вода -> диван (конзолка или дрямка) -> от време на време дартс -> обратно на дивана. */
  leisure(a, now) {
    const here = now - a.spotSince, t = a.loc.type;
    if (t === 'coffee' || t === 'cooler') {
      if (here > 7000) { const sofa = this.freeSofa(a); if (sofa) this.route(a, sofa); }
    } else if (t === 'sofa') {
      a.sofaFor ||= 20000 + Math.random() * 25000;
      if (here > a.sofaFor && !this.live().some((x) => x !== a && x.loc.type === 'darts')) {
        a.sofaFor = 0; a.dartsFor = 12000 + Math.random() * 12000;
        this.route(a, { type: 'darts' });
      }
    } else if (t === 'darts') {
      if (here > a.dartsFor) this.route(a, this.freeSofa(a) || this.freeLoungeSpot(a));
    }
  }

  /** Пуска стреличка, когато героят до дъската стигне момента на хвърляне. */
  throwDart(a, now) {
    const st = now - a.spotSince;
    if (st < DART_RELEASE) { a.fx.dartK = -1; return; }
    const k = Math.floor((st - DART_RELEASE) / DART_CYCLE);
    if (k <= (a.fx.dartK ?? -1)) return;
    a.fx.dartK = k;
    const b = this.L.lounge.darts, cx = b.x + 7, cy = b.y + 7;
    const ang = Math.random() * Math.PI * 2, r = Math.random() < 0.15 ? 0 : 1 + Math.random() * 5;
    // 3 стрелички в дъската -> прибира ги и започва отначало
    if (this.darts.stuck.length >= 3) this.darts.stuck.length = 0;
    this.darts.flying.push({ x0: a.x + 7, y0: a.y - 26, x1: Math.round(cx + Math.cos(ang) * r), y1: Math.round(cy + Math.sin(ang) * r), t0: now, dur: 280 });
  }

  drawDarts(ctx, now, layer) {
    const D = this.darts;
    const dart = (x, y) => { R(ctx, '#e8e4dc', x, y, 1, 1); R(ctx, '#3a3440', x, y + 1, 1, 1); R(ctx, '#e05a5a', x - 1, y + 2, 3, 1); };
    if (layer === 'wall') { for (const d of D.stuck) dart(d.x, d.y); return; }
    D.flying = D.flying.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) { D.stuck.push({ x: f.x1, y: f.y1 }); return false; }
      const x = Math.round(f.x0 + (f.x1 - f.x0) * k), y = Math.round(f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 6);
      dart(x, y);
      return true;
    });
  }

  freeSofa(self) {
    const taken = new Set([...this.actors.values()].filter((x) => x !== self && x.loc.type === 'sofa').map((x) => x.loc.i));
    for (let i = 0; i < this.L.lounge.spots.sofa.length; i++) if (!taken.has(i)) return { type: 'sofa', i };
    return null;
  }
  freeLoungeSpot(self) {
    const others = [...this.actors.values()].filter((x) => x !== self);
    const takenType = (t) => others.some((x) => x.loc.type === t);
    const pref = hashStr(self.id) % 2 ? ['coffee', 'cooler'] : ['cooler', 'coffee'];
    for (const t of pref) if (!takenType(t)) return { type: t };
    const sofa = this.freeSofa(self);
    if (sofa) return sofa;
    const takenExtra = new Set(others.filter((x) => x.loc.type === 'lounge').map((x) => x.loc.i));
    let i = 0; while (takenExtra.has(i) && i < 40) i++;
    return { type: 'lounge', i };
  }

  // ================================================================ кадър
  update(dt, now) {
    const L = this.L;
    for (const a of [...this.actors.values()]) {
      this.decide(a, now);
      a.update(dt, now);
      if (a.mode === 'gone') { this.actors.delete(a.id); this.model.remove(a.id); this.syncAvatar(); continue; }
      this.emitParticles(a, now, dt);
    }
    // вратата се отваря, ако някой е до нея
    const nearDoor = [...this.actors.values()].some((a) => Math.abs(a.x - L.door.cx) < 10 && a.y < L.door.floorY + 14 && a.mode !== 'seated');
    this.room.doorOpen = clamp(this.room.doorOpen + (nearDoor ? dt * 4 : -dt * 2.5), 0, 1);
    for (const c of this.cats) c.update(dt, now, L);
    // прашинки в слънчевите снопове
    if (this.tod && this.tod.daylight > 0.4 && Math.random() < dt * 3 * this.room.windows.length) {
      const w = this.room.windows[Math.floor(Math.random() * this.room.windows.length)];
      this.fx.dust(w.x + Math.random() * w.w, CFG.WALL_H + Math.random() * 40);
    }
    if (!this._lastTeams || now - this._lastTeams > 1000) { this._lastTeams = now; this.manageTeams(now); this.ensureLayout(); }
  }

  emitParticles(a, now, dt) {
    const L = this.L;
    const fx = a.fx;
    const p = L.pods[a.pod] || { x: -999, y: -999 };
    const atDesk = a.pod >= 0 && a.isAtDesk(L);
    const st = a.vstate;
    const col = STATES[st].color;
    if (atDesk && (st === 'typing' || st === 'running')) {
      fx.spark -= dt;
      if (fx.spark <= 0) { fx.spark = st === 'running' ? 0.08 : 0.13; this.fx.spark(p.x + POD.keyboard.x + 2 + Math.random() * 12, p.y + POD.keyboard.y, Math.random() < 0.5 ? '#ffffff' : col); }
      fx.glyph -= dt;
      if (fx.glyph <= 0) { fx.glyph = 0.9 + Math.random() * 0.8; this.fx.glyph(p.x + POD.screen.x + 4 + Math.random() * 10, p.y + POD.screen.y - 4, col); }
    }
    if (a.loc.type === 'darts' && a.mode === 'idleSpot') this.throwDart(a, now);
    const raw = a.pose(now);
    const pose = raw.startsWith('couch') ? raw[5].toLowerCase() + raw.slice(6) : raw; // couchSip -> sip (ефектите са същите)
    if (pose === 'doze') {
      fx.zzz -= dt;
      if (fx.zzz <= 0) { fx.zzz = 1.1; this.fx.zzz(a.x + 5, a.y - 33); }
    }
    if (pose === 'sip' || pose === 'standSip' || pose === 'standMug') {
      fx.steam -= dt;
      if (fx.steam <= 0) { fx.steam = 0.25; this.fx.steam(a.x + (a.flip ? -2 : 2), a.y - (pose === 'sip' ? 22 : 15)); }
    }
    if (pose === 'standBackUse' && a.loc.type === 'coffee') {
      fx.steam -= dt;
      if (fx.steam <= 0) { fx.steam = 0.18; const c = L.lounge.counter; this.fx.steam(c.x + 10, c.base - 32); }
    }
    if (pose === 'standBackUse' && a.loc.type === 'cooler') {
      fx.steam -= dt;
      if (fx.steam <= 0) { fx.steam = 0.3; const c = L.lounge.cooler; this.fx.bubble(c.x + 5 + Math.random() * 4, c.base - 24); }
    }
    // делегиране: хвърля самолетче на детето (или към вратата) в края на "писането"
    if (st === 'delegating' && atDesk) {
      const lt = now - a.vstateAt;
      const cycle = Math.floor(lt / 4200), c = lt % 4200;
      if (c > 2750 && fx.throwCycle !== cycle) {
        fx.throwCycle = cycle;
        const kids = [...a.agent.children].map((id) => this.actors.get(id)).filter((k) => k && k.isAtDesk(L));
        this.throwPlane(a, kids.length ? kids[cycle % kids.length] : null);
      }
    }
  }

  // ================================================================ рисуване
  render(ctx, now, tod, date) {
    const L = this.L, room = this.room;
    this.tod = tod;
    ctx.imageSmoothingEnabled = false;
    // 1) небе (под прозрачните стъкла) 2) фон
    drawSky(ctx, room, tod, now);
    ctx.drawImage(room.bg, 0, 0);
    const st = this.model.stats();
    drawWallDynamic(ctx, room, date, { agents: st.agents, tools: st.tools, subs: st.subs, agentColors: st.states.map((s) => STATES[s].color), tokens: this.tokens ?? null }, now);
    // 3) по пода: светлина, връзки, сенки, пулсиращ кръг "чака"
    this.drawDarts(ctx, now, 'wall');
    drawShafts(ctx, room, tod, now);
    this.drawLinks(ctx, now);
    for (const a of this.actors.values()) {
      if (a.vstate === 'waiting' && a.isAtDesk(L)) {
        const p = L.pods[a.pod];
        const k = (now % 1100) / 1100;
        ctx.strokeStyle = rgba(STATES.waiting.color, 0.75 * (1 - k));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(p.x + 36, p.y + 46, 30 + k * 10, 10 + k * 4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      a.drawShadow(ctx);
    }
    this.fx.draw(ctx, 'mid');

    // 4) обекти, сортирани по дълбочина
    const items = [];
    const occupant = new Map();
    for (const a of this.actors.values()) if (a.isAtDesk(L)) occupant.set(a.pod, a);
    L.pods.forEach((p, i) => {
      const img = this.podImgs[i];
      items.push({ key: p.y + POD.depthChair, fn: () => ctx.drawImage(img.back, p.x, p.y) });
      items.push({ key: p.y + POD.depthDesk, fn: () => this.drawPodFront(ctx, p, img, occupant.get(i), now) });
    });
    for (const o of room.objects) items.push({ key: o.key, fn: () => ctx.drawImage(o.img, o.x, o.y) });
    for (const a of this.actors.values()) {
      const k = a.depth(L);
      items.push({ key: k, fn: () => { a.draw(ctx, now, 'body'); if (!occupant.has(a.pod) || occupant.get(a.pod) !== a) a.draw(ctx, now, 'front'); } });
    }
    for (const c of this.cats) items.push({ key: c.y, fn: () => c.draw(ctx, now) });
    if (room.aquarium) items.push({ key: room.aquarium.key + 0.5, fn: () => drawAquariumFish(ctx, room.aquarium, now) });
    if (room.arcade) items.push({ key: room.arcade.key + 0.5, fn: () => drawArcadeScreen(ctx, room.arcade, now) });
    items.forEach((it, i) => { it.i = i; });
    items.sort((a, b) => a.key - b.key || a.i - b.i);
    for (const it of items) it.fn();

    this.drawDarts(ctx, now, 'air');
    // 5) нощен/вечерен оттенък
    drawTint(ctx, room, tod);
    // 6) светлини
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlows(ctx, now, tod, occupant);
    ctx.restore();
    // 7) частици и икони отгоре
    this.fx.draw(ctx, 'top');
    for (const a of this.actors.values()) a.drawOverlay(ctx, now);
    if (this.focusId && this.actors.has(this.focusId)) this.drawFocus(ctx, this.actors.get(this.focusId), now);
  }

  drawPodFront(ctx, p, img, a, now) {
    ctx.drawImage(img.front, p.x, p.y);
    const s = POD.screen;
    if (a) {
      const fade = clamp((now - a.vstateAt) / CFG.CROSSFADE_MS, 0, 1);
      drawScreen(ctx, p.x + s.x, p.y + s.y, s.w, s.h, a.vstate, now + a.phase, hashStr(a.id) % 997, a.prevVState, fade);
      a.draw(ctx, now, 'front');
    } else {
      // празно бюро – монитор в покой
      const owner = [...this.actors.values()].find((x) => x.pod === p.i);
      drawScreen(ctx, p.x + s.x, p.y + s.y, s.w, s.h, owner ? 'idle' : 'off', now, p.i, null, 1);
    }
    // звънче (при "чака" подскача)
    const b = POD.bell;
    const ring = a && a.vstate === 'waiting';
    const sh = ring ? (Math.floor(now / 70) % 2 ? 1 : -1) : 0;
    const bx = p.x + 13 + sh, by = p.y + 31;
    R(ctx, '#8a6a20', bx, by + 3, 5, 1); R(ctx, '#e0b84a', bx + 1, by, 3, 3); R(ctx, '#f8e090', bx + 1, by, 1, 1); R(ctx, '#e0b84a', bx + 2, by - 1, 1, 1);
    if (ring && Math.floor(now / 200) % 2) { R(ctx, '#ffffff', bx - 2, by - 1, 1, 1); R(ctx, '#ffffff', bx + 6, by - 1, 1, 1); R(ctx, '#ffffff', bx - 3, by + 1, 1, 1); R(ctx, '#ffffff', bx + 7, by + 1, 1, 1); }
    void b;
  }

  drawGlows(ctx, now, tod, occupant) {
    const L = this.L, room = this.room;
    const night = tod.night;
    // конзолките на дивана светят в лицата
    for (const a of this.actors.values()) {
      if (a.loc.type === 'sofa' && a.mode === 'idleSpot' && a.sofaAct === 'game') glow(ctx, a.x, a.y - 16, 9, '#6ae08a', (0.06 + 0.3 * night) * (0.85 + 0.15 * Math.sin(now / 70)));
    }
    for (const p of L.pods) {
      const a = occupant.get(p.i);
      const owner = a || [...this.actors.values()].find((x) => x.pod === p.i);
      if (!owner) continue;
      const st = a ? a.vstate : 'idle';
      const color = STATES[st].color;
      const flick = 0.92 + 0.08 * Math.sin(now / 90 + p.i);
      const sx = p.x + POD.screen.x + POD.screen.w / 2, sy = p.y + POD.screen.y + POD.screen.h / 2;
      glow(ctx, sx, sy + 4, 30, color, (0.10 + 0.22 * night) * flick * (st === 'idle' ? 0.5 : 1));
      // настолна лампа
      const bx = p.x + POD.bulb.x, by = p.y + POD.bulb.y;
      if (st === 'waiting') {
        const on = Math.floor(now / 320) % 2 === 0;
        glow(ctx, bx, by + 4, 30, STATES.waiting.color, on ? 0.55 : 0.18);
      } else if (a) glow(ctx, bx, by + 6, 20, '#ffcf7a', 0.06 + 0.34 * night);
    }
    const lo = L.lounge;
    glow(ctx, room.lampGlow.x, room.lampGlow.y, 34, '#ffd890', 0.05 + 0.38 * night);
    if (room.neon) glow(ctx, room.neon.x, room.neon.y, 18, room.neon.c, (0.25 + 0.35 * night) * (0.9 + 0.1 * Math.sin(now / 130)));
    if (room.aquarium) glow(ctx, room.aquarium.x + 14, room.aquarium.y + 12, 22, '#4ab8f0', 0.08 + 0.3 * night);
    if (room.arcade) glow(ctx, room.arcade.x + 9, room.arcade.y + 12, 16, '#a06ae0', 0.1 + 0.3 * night);
    glow(ctx, lo.counter.x + 14, lo.counter.base - 36, 6, '#6ae0ff', 0.3);
    // зелената табела над вратата
    glow(ctx, L.door.x + 12, L.door.y - 6, 10, '#4ac26b', 0.15 + 0.35 * night);
  }

  drawLinks(ctx, now) {
    const L = this.L;
    for (const c of this.actors.values()) {
      const pid = c.agent.parent;
      if (!pid || c.agent.leaving) continue;
      const p = this.actors.get(pid);
      if (!p) continue;
      const A = L.pods[p.pod], B = L.pods[c.pod];
      if (!B) continue;
      const pAt = A && p.isAtDesk(L);
      const x0 = pAt ? A.x + 36 : p.x, y0 = pAt ? A.y + 56 : p.y + 2, x1 = c.isAtDesk(L) ? B.x + 36 : c.x, y1 = c.isAtDesk(L) ? B.y + 56 : c.y + 2;
      const color = STATES.delegating.color;
      pixLine(ctx, rgba(color, 0.85), x0, y0, x1, y1, 2, Math.floor(-now / 120));
      // пакетче хартия, което пътува по линията
      const k = ((now / 1800) + (hashStr(c.id) % 100) / 100) % 1;
      const px = Math.round(x0 + (x1 - x0) * k), py = Math.round(y0 + (y1 - y0) * k);
      R(ctx, '#f6f3ea', px - 1, py - 1, 3, 2); R(ctx, '#c9c2b0', px - 1, py + 1, 3, 1);
      R(ctx, color, x0 - 1, y0 - 1, 3, 3); R(ctx, color, x1 - 1, y1 - 1, 3, 3);
    }
  }

  drawFocus(ctx, a, now) {
    const L = this.L;
    const p = L.pods[a.pod];
    const cx = a.isAtDesk(L) ? p.x + 36 : a.x, cy = a.isAtDesk(L) ? p.y + 32 : a.y - 16;
    const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 90);
    g.addColorStop(0, 'rgba(8,6,14,0)'); g.addColorStop(1, 'rgba(8,6,14,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, L.W, L.H);
    const bob = Math.round(Math.sin(now / 180) * 2);
    const ax = Math.round(a.x), ay = Math.round(a.y) - 50 + bob - (a.vstate === 'waiting' || a.vstate === 'thinking' ? 8 : 0);
    R(ctx, '#ffffff', ax - 3, ay, 7, 1); R(ctx, '#ffffff', ax - 2, ay + 1, 5, 1); R(ctx, '#ffffff', ax - 1, ay + 2, 3, 1); R(ctx, '#ffffff', ax, ay + 3, 1, 1);
  }

  /** Кой агент е под точката (логически координати). */
  hitTest(x, y) {
    const L = this.L;
    let best = null;
    for (const a of this.actors.values()) {
      if (a.alpha < 0.3) continue;
      let hit;
      if (a.isAtDesk(L)) { const p = L.pods[a.pod]; hit = x >= p.x + 4 && x < p.x + 68 && y >= p.y + 6 && y < p.y + 60; }
      else hit = x >= a.x - 9 && x <= a.x + 9 && y >= a.y - 30 && y <= a.y + 2;
      if (hit && (!best || a.y > best.y)) best = a;
    }
    return best;
  }

  /** Точки за DOM надписите. */
  anchors(a) {
    const L = this.L;
    const p = L.pods[a.pod];
    if (a.isAtDesk(L)) return { label: { x: p.x + POD.label.x, y: p.y + POD.label.y }, bubble: { x: p.cx, y: p.y + 8 }, seated: true };
    // до собственото бюро (става/сяда/разхожда се) – етикетът остава под бюрото
    if (p && (a.loc.type === 'pace' || a.loc.type === 'seat') && Math.abs(a.x - p.cx) < 20 && a.y >= p.aisleY - 1 && a.y <= p.seatY + 1)
      return { label: { x: p.x + POD.label.x, y: p.y + POD.label.y }, bubble: { x: a.x, y: a.y - 32 }, seated: false };
    return { label: { x: a.x, y: a.y + 3 }, bubble: { x: a.x, y: a.y - 32 }, seated: false };
  }
}
