// ?demo          – симулация: всички състояния, делегиране родител/дете, идват и си тръгват агенти
// ?demo=showcase – всеки агент стои в едно състояние (за преглед/скрийншоти)
// ?agents=N      – колко оркестратора (главни сесии) в началото; по подразбиране 2 (+ понякога трети, който чака в зоната за почивка)
import { CFG, PARAMS, T } from './config.js';

const PROJECTS = ['pixel-office', 'api-gateway', 'landing-page', 'data-pipeline', 'mobile-app', 'infra', 'docs-site',
  'ml-train', 'auth-service', 'design-system', 'billing', 'search', 'analytics', 'cli-tools', 'chat-bot', 'web-shop'];
const FILES = ['src/app.ts', 'src/components/Header.tsx', 'server/routes/users.js', 'README.md', 'package.json',
  'src/lib/parser.rs', 'tests/api.spec.ts', 'docs/architecture.md', 'src/styles/main.css', 'config/deploy.yml'];
const CMDS = ['npm test', 'npm run build', 'git status', 'cargo check', 'pytest -q', 'docker compose up -d', 'eslint src --fix'];
const SEARCH = ['TODO', 'useEffect', 'class .*Service', 'export default', 'fetch\\('];
const TASKS = ['Explore auth flow', 'Write unit tests', 'Review CSS', 'Find dead code', 'Migrate API v2'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let uid = 0;
const tid = () => `toolu_demo_${++uid}`;

function toolFor(kind) {
  switch (kind) {
    case 'typing': return [pick(['Edit', 'Write', 'MultiEdit']), pick(FILES)];
    case 'reading': return [pick(['Read', 'Grep', 'Glob', 'WebFetch']), Math.random() < 0.6 ? pick(FILES) : pick(SEARCH)];
    case 'running': return ['Bash', pick(CMDS)];
    default: return ['Read', pick(FILES)];
  }
}

export function startDemo(ingest, model) {
  if (PARAMS.demo === 'showcase') return showcase(ingest);
  CFG.WANDER_AFTER_MS = PARAMS.wander ?? 16000;
  const n = PARAMS.agents ?? 2;
  const alive = new Map();
  let projIdx = 0;

  const emit = (a, e) => ingest({ agent: a.id, label: a.label, subagent: !!a.sub, parent: a.parent, parent_tool_use_id: a.parentTool, desc: a.desc, ts: Date.now(), ...e });
  const tool = async (a, name, detail, ms) => {
    const id = tid();
    emit(a, { type: 'tool_start', id, tool: name, detail });
    await sleep(ms);
    if (!a.stop) emit(a, { type: 'tool_end', tool_use_id: id });
  };
  const think = async (a, ms) => { emit(a, { type: 'say' }); await sleep(ms); };

  async function child(parent, toolId, desc) {
    const c = { id: `${parent.id}-sub-${++uid}`, label: parent.label, sub: true, parent: parent.id, parentTool: toolId, desc };
    await think(c, 900);
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < steps && !parent.stop; i++) {
      const k = pick(['reading', 'reading', 'typing', 'running']);
      const [t, d] = toolFor(k);
      await tool(c, t, d, rand(1800, 4200));
      await think(c, rand(500, 1400));
    }
  }

  async function delegate(a) {
    const id = tid();
    const desc = pick(TASKS);
    emit(a, { type: 'tool_start', id, tool: pick(['Agent', 'Task']), detail: desc });
    await sleep(1200);
    const kids = 1 + Math.floor(Math.random() * 3);
    await Promise.all(Array.from({ length: kids }, (_, i) => sleep(i * 1500).then(() => child(a, id, kids > 1 ? `${desc} (${i + 1})` : desc))));
    await sleep(800);
    if (!a.stop) emit(a, { type: 'tool_end', tool_use_id: id });
  }

  async function life(a, first) {
    // първо действие – така че всички състояния да се видят веднага
    if (first === 'typing' || first === 'reading' || first === 'running') { const [t, d] = toolFor(first); await tool(a, t, d, rand(4000, 6000)); }
    else if (first === 'waiting') await tool(a, 'AskUserQuestion', T.demo2.which, rand(7000, 9000));
    else if (first === 'delegating') await delegate(a);
    else if (first === 'thinking') await think(a, 5000);
    else if (first === 'idle') { emit(a, { type: 'say' }); await sleep(rand(CFG.IDLE_MS + CFG.WANDER_AFTER_MS + 8000, CFG.IDLE_MS + CFG.WANDER_AFTER_MS + 16000)); }
    while (!a.stop) {
      await think(a, rand(600, 2400));
      if (a.stop) break;
      const r = Math.random();
      if (r < 0.07) await sleep(rand(CFG.IDLE_MS + 2000, CFG.IDLE_MS + CFG.WANDER_AFTER_MS + 12000)); // пауза -> почивка
      else if (r < 0.14) await tool(a, 'AskUserQuestion', T.demo2.cont, rand(5000, 9000));
      else if (r < 0.40) await delegate(a);
      else if (r < 0.45) await think(a, rand(6500, 9000)); // дълго мислене -> разхожда се
      else {
        const k = pick(['typing', 'typing', 'reading', 'reading', 'running']);
        const [t, d] = toolFor(k);
        await tool(a, t, d, rand(1500, 5500));
      }
    }
  }

  const FIRST = ['delegating', 'delegating', 'idle', 'waiting', 'typing', 'reading', 'running', 'thinking'];
  function spawn(i) {
    const label = PROJECTS[projIdx++ % PROJECTS.length];
    const a = { id: `demo-${label}-${uid++}`, label };
    alive.set(a.id, a);
    life(a, FIRST[i % FIRST.length]);
    return a;
  }
  for (let i = 0; i < n; i++) setTimeout(() => spawn(i), i * 350);

  // идват и си отиват
  setInterval(() => {
    const mains = [...alive.values()].filter((a) => !a.stop);
    if (mains.length < n + 1 && Math.random() < 0.6) spawn(Math.floor(Math.random() * 7));
    else if (mains.length > Math.max(1, n - 1)) {
      const a = pick(mains);
      a.stop = true; alive.delete(a.id);
      model.leave(a.id);
    }
  }, 45000);
}

/** Статична витрина: два екипа (оркестратор + под-агенти) и две чакащи сесии – всички 7 състояния наведнъж. */
function showcase(ingest) {
  CFG.WANDER_AFTER_MS = PARAMS.wander ?? 1e12;
  const keep = (emit) => setInterval(() => emit({ type: 'say' }), 2500);  // поддържа състоянието живо
  const agent = (id, label, extra = {}) => (e) => ingest({ agent: id, label, ts: Date.now(), ...extra, ...e });
  const start = (emit, tool, detail, id) => (tool ? emit({ type: 'tool_start', id, tool, detail }) : emit({ type: 'say' }));
  const teams = [
    { id: 'show-lead-a', label: 'web-shop', tool: 'Edit', detail: 'src/components/Cart.tsx',
      kids: [['Read', 'docs/architecture.md', T.demo2.arch], ['Bash', 'npm test -- --coverage', T.demo2.tests], [null, null, T.demo2.cache]] },
    { id: 'show-lead-b', label: 'api-gateway', tool: 'Agent', detail: 'Explore auth flow',
      kids: [['Write', 'src/auth/session.ts', 'Explore auth flow (1)'], ['Grep', 'auth|session', 'Explore auth flow (2)']] },
  ];
  let delay = 0;
  for (const t of teams) {
    const emit = agent(t.id, t.label);
    setTimeout(() => { start(emit, t.tool, t.detail, `t-${t.id}`); keep(emit); }, delay);
    delay += 150;
    t.kids.forEach(([tool, detail, desc], k) => {
      const cid = `${t.id}-sub-${k}`;
      const cemit = agent(cid, t.label, { subagent: true, parent: t.id, parent_tool_use_id: `t-${t.id}`, desc });
      setTimeout(() => { start(cemit, tool, detail, `t-${cid}`); keep(cemit); }, 600 + k * 900);
    });
  }
  // трета сесия, която чака теб, и четвърта, която почива – и двете в зоната за почивка
  const w = agent('show-waiting', 'billing');
  setTimeout(() => { w({ type: 'tool_start', id: 't-w', tool: 'AskUserQuestion', detail: T.demo2.whichShort }); keep(w); }, 400);
  const idle = agent('show-idle', 'infra');
  setTimeout(() => idle({ type: 'say' }), 500);
}
