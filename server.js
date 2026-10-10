// Следи JSONL транскриптите на Claude Code и праща събития към браузъра.
// ВНИМАНИЕ: форматът на транскриптите не е официален API и може да се промени.
// Пусни с DEBUG=1 (или `npm run debug`), за да видиш какво се парсва.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Wallet } from './wallet.js';

const PORT = Number(process.env.PORT) || 4317;
const ROOT = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // следим файлове, пипани в последния час
const POLL_MS = 400;
const SCAN_MS = 2000;                    // пълно обхождане на папката (стари/възобновени файлове)
const SESSIONS = process.env.CLAUDE_SESSIONS_DIR || path.join(path.dirname(ROOT), 'sessions'); // <pid>.json на всяка жива сесия
const SESSIONS_MS = 3000;
const LINK_WINDOW_MS = 15000;            // евристика: под-агент, появил се до толкова след Task/Agent
const DEBUG = !!process.env.DEBUG || process.argv.includes('--debug');
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const SPRITES = path.join(PUBLIC, 'sprites');
const HOST = '127.0.0.1';                 // само локално – никой от мрежата (Wi-Fi в офиса/кафенето) не вижда сесиите
const STARTED = Date.now();
// DNS rebinding: заявка, чийто Host не е локален, идва от чужд домейн, насочен към 127.0.0.1
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const localReq = (req) => LOCAL_HOST.test(req.headers.host || '') && (!req.headers.origin || LOCAL_ORIGIN.test(req.headers.origin));

// ---------- статичен сървър ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
const server = http.createServer((req, res) => {
  if (!localReq(req)) { res.writeHead(403).end(); return; }
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; } // лош %-код не срива сървъра
  // списък на override спрайтовете – клиентът не прави заявки към липсващи файлове
  if (urlPath === '/api/sprites') {
    let files = [];
    try { files = fs.readdirSync(SPRITES).filter((f) => /\.(png|json|webp)$/i.test(f)); } catch { /* няма папка */ }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(files));
    return;
  }
  // портфейл с токени и магазин
  if (urlPath === '/api/save') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(wallet.publicSave()));
    return;
  }
  if (urlPath === '/api/buy' || urlPath === '/api/equip' || urlPath === '/api/avatar') {
    // само POST с JSON от localhost: чужда страница не може да харчи токените (JSON от друг произход изисква preflight, който не позволяваме)
    const origin = req.headers.origin;
    if (req.method !== 'POST' || !/^application\/json/.test(req.headers['content-type'] || '') || (origin && !LOCAL_ORIGIN.test(origin))) { res.writeHead(403).end(); return; }
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch { /* празно */ }
      const r = await wallet.act(urlPath.slice(5), data);
      res.writeHead(r.ok ? 200 : 400, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(r));
    });
    return;
  }
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, verifyClient: ({ req }) => localReq(req) });
wss.on('error', () => { /* грешките при listen се обработват в startServer */ });
const broadcast = (evt) => {
  const msg = JSON.stringify(evt);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
};
const wallet = new Wallet(broadcast, (m) => console.log(m));
// нов клиент веднага вижда портфейла и живите сесии
wss.on('connection', (ws) => {
  ws.send(JSON.stringify(wallet.msg(0, 'sync', null, null, true)));
  ws.send(JSON.stringify({ type: 'sessions', list: live }));
});

// ---------- живи сесии ----------
// Claude Code пише ~/.claude/sessions/<pid>.json, докато сесията е отворена. Така почиващ оркестратор
// остава в офиса (на дивана), дори да няма нови редове в транскрипта или сървърът да е пуснат след него.
// Съобщението {type:'sessions', list:[{agent, label, status}]} няма поле `agent` – старите клиенти го пропускат.
let live = [], liveKey = '';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function scanSessions() {
  let names = [];
  try { names = fs.readdirSync(SESSIONS); } catch { /* няма папка (стар Claude Code) */ }
  const list = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SESSIONS, n), 'utf8')); } catch { continue; }
    if (!s || typeof s.sessionId !== 'string' || !Number.isInteger(s.pid) || !alive(s.pid)) continue;
    if (list.some((x) => x.agent === s.sessionId)) continue;
    list.push({ agent: s.sessionId, label: s.cwd ? path.basename(s.cwd) : s.sessionId.slice(0, 8), status: s.status || null });
  }
  list.sort((x, y) => (x.agent < y.agent ? -1 : 1));
  const key = JSON.stringify(list);
  if (key === liveKey) return;
  liveKey = key; live = list;
  if (DEBUG) console.log('живи сесии:', list.map((x) => `${x.label}/${x.agent.slice(0, 8)} ${x.status}`).join(', ') || '—');
  wallet.setLive(list.map((x) => x.agent), list.filter((x) => x.status === 'busy').map((x) => x.agent));
  broadcast({ type: 'sessions', list });
}

// ---------- следене на файлове ----------
const tracked = new Map(); // file -> { pos, rest: Buffer, mtime }
// стари/заспали файлове -> { mtime, size, st? }; проверяват се само при пълното обхождане,
// за да не викаме statSync за стотици стари транскрипти 2.5 пъти в секунда
const dormant = new Map();
let firstScan = true, lastFull = 0;

function listJsonl(dir, out = [], depth = 0) {
  if (depth > 5) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(p, out, depth + 1);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const brief = (input = {}) =>
  String(input.file_path || input.command || input.pattern || input.description || input.url || input.query || '')
    .replace(/\s+/g, ' ').slice(0, 60);

// ---------- връзка под-агент -> родител ----------
// Ред на източниците (от най-сигурен към най-несигурен):
//  1. <agent>.meta.json до файла на под-агента: { toolUseId, requestShape, description } – точен tool_use id
//  2. sessionId в редовете на под-агента / името на папката <sessionId>/subagents/ – кой е родителят
//  3. евристика: последният Task/Agent tool_start в същия проект до LINK_WINDOW_MS преди появата
const links = new Map();        // file -> { parent, parent_tool_use_id, background, desc, source, metaTried }
const delegations = [];         // { parent, projectDir, tool_use_id, ts, claimed }
const DELEGATE = new Set(['Task', 'Agent']);

const isSubFile = (file) => file.includes(`${path.sep}subagents${path.sep}`);
// проектната папка (там, където са главните сесии)
function projectDirOf(file) {
  if (isSubFile(file)) return path.dirname(path.dirname(path.dirname(file)));
  return path.dirname(file);
}

function linkFor(file, obj, agent) {
  let L = links.get(file);
  if (!L) { L = { parent: null, parent_tool_use_id: null, background: false, desc: null, source: null, metaTried: 0 }; links.set(file, L); }
  const now = Date.now();
  // 1) meta.json (може да се появи малко след jsonl файла – пробваме пак до 1 път в секунда)
  if (!L.parent_tool_use_id && now - L.metaTried > 1000) {
    L.metaTried = now;
    try {
      const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      if (meta.toolUseId) { L.parent_tool_use_id = meta.toolUseId; L.source = 'meta'; }
      if (meta.requestShape === 'background') L.background = true;
      if (meta.description) L.desc = String(meta.description).slice(0, 80);
    } catch { /* няма meta */ }
  }
  // 2) sessionId / папка
  if (!L.parent) {
    if (obj.isSidechain && obj.sessionId && obj.sessionId !== agent) { L.parent = obj.sessionId; L.source ||= 'session'; }
    else if (isSubFile(file)) { L.parent = path.basename(path.dirname(path.dirname(file))); L.source ||= 'path'; }
  }
  // 3) евристика – ако все още не знаем кой tool_use е създал този под-агент
  if (!L.parent_tool_use_id) {
    const pdir = projectDirOf(file);
    let best = null;
    for (let i = delegations.length - 1; i >= 0; i--) {
      const d = delegations[i];
      if (d.claimed || d.projectDir !== pdir || now - d.ts > LINK_WINDOW_MS) continue;
      if (L.parent && d.parent !== L.parent) continue;
      best = d; break;
    }
    if (best) {
      best.claimed = true;
      L.parent_tool_use_id = best.tool_use_id;
      if (!L.parent) { L.parent = best.parent; L.source = 'heuristic'; }
    }
  }
  // tool_use, който meta.json вече е посочил – да не го "вземе" друг под-агент
  if (L.parent_tool_use_id) for (const d of delegations) if (d.tool_use_id === L.parent_tool_use_id) d.claimed = true;
  return L;
}

function handleLine(file, line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  const agent = path.basename(file, '.jsonl');
  const subagent = isSubFile(file) || obj.isSidechain === true;
  const base = {
    agent,
    label: obj.cwd ? path.basename(obj.cwd) : path.basename(path.dirname(file)),
    subagent,
    ts: Date.now(),
  };
  if (subagent) {
    const L = linkFor(file, obj, agent);
    // допълнителни полета – само ако ги знаем (старите клиенти просто ги игнорират)
    if (L.parent) base.parent = L.parent;
    if (L.parent_tool_use_id) base.parent_tool_use_id = L.parent_tool_use_id;
    if (L.background) base.background = true;
    if (L.desc) base.desc = L.desc;
    if (DEBUG && L.source) base.link = L.source;
  }
  const content = obj.message?.content;
  const out = [];

  if (typeof content === 'string') {
    out.push({ type: obj.type === 'user' ? 'user_prompt' : 'say' });
  } else if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'tool_use') out.push({ type: 'tool_start', id: b.id, tool: b.name, detail: brief(b.input) });
      else if (b.type === 'tool_result') out.push({ type: 'tool_end', tool_use_id: b.tool_use_id });
      else if (b.type === 'text') out.push({ type: obj.type === 'user' ? 'user_prompt' : 'say' });
      else if (b.type === 'thinking') out.push({ type: 'say' });
    }
  }
  for (const e of out) {
    const evt = { ...base, ...e };
    if (e.type === 'tool_start' && DELEGATE.has(e.tool)) {
      delegations.push({ parent: agent, projectDir: projectDirOf(file), tool_use_id: e.id, ts: Date.now(), claimed: false });
      while (delegations.length > 200) delegations.shift();
    }
    if (DEBUG) console.log(evt.agent.slice(0, 14).padEnd(14), evt.type.padEnd(11), evt.tool || '', evt.detail || '', evt.parent ? `↑${evt.parent.slice(0, 8)} (${evt.link})` : '');
    broadcast(evt);
    wallet.ingest(evt);
  }
}

function readNew(file, st) {
  let size;
  try { const stat = fs.statSync(file); size = stat.size; st.mtime = stat.mtimeMs; } catch { tracked.delete(file); return; }
  if (size < st.pos) { st.pos = 0; st.rest = Buffer.alloc(0); } // файлът е пренаписан
  if (size === st.pos) return;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - st.pos);
  fs.readSync(fd, buf, 0, buf.length, st.pos);
  fs.closeSync(fd);
  st.pos = size;
  const all = Buffer.concat([st.rest, buf]);
  const lastNl = all.lastIndexOf(0x0a);
  if (lastNl === -1) { st.rest = all; return; }
  st.rest = all.subarray(lastNl + 1);
  for (const line of all.subarray(0, lastNl).toString('utf8').split('\n')) {
    if (line.trim()) handleLine(file, line);
  }
}

function listDir(dir) {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(dir, n)); } catch { return []; }
}

// нов или събуден файл -> tracked; стар (непипан от час) -> dormant
function consider(file, now) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  const d = dormant.get(file);
  if (d && d.mtime === stat.mtimeMs) return;
  if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) { dormant.set(file, { mtime: stat.mtimeMs, size: stat.size, st: d?.st }); return; }
  dormant.delete(file);
  let st = d?.st;
  if (!st) {
    // при старт не пускаме историята отново; възобновен стар файл – от размера, с който заспа
    // (нищо от новото не се губи); нови файлове четем от началото
    const old = firstScan || (stat.birthtimeMs || stat.ctimeMs) < STARTED - 5000;
    st = { pos: d ? d.size : old ? stat.size : 0, rest: Buffer.alloc(0) };
    if (DEBUG) console.log('следя', file);
  }
  tracked.set(file, st);
}

function poll() {
  const now = Date.now();
  if (now - lastFull >= SCAN_MS) {
    lastFull = now;
    for (const file of listJsonl(ROOT)) if (!tracked.has(file)) consider(file, now);
    firstScan = false;
  } else {
    // между пълните обхождания – само папките на проектите (нова сесия) и на активните сесии (нов под-агент);
    // readdir без statSync на старите файлове
    const dirs = new Set();
    try { for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) if (e.isDirectory()) dirs.add(path.join(ROOT, e.name)); } catch { /* няма папка */ }
    for (const f of tracked.keys()) {
      const dir = path.dirname(f);
      dirs.add(dir);
      if (path.basename(dir) !== 'subagents') dirs.add(path.join(dir, path.basename(f, '.jsonl'), 'subagents'));
    }
    for (const dir of dirs) for (const file of listDir(dir)) if (!tracked.has(file) && !dormant.has(file)) consider(file, now);
  }
  for (const [file, st] of tracked) {
    readNew(file, st);
    if (st.mtime && now - st.mtime > ACTIVE_WINDOW_MS) { tracked.delete(file); dormant.set(file, { mtime: st.mtime, size: st.pos, st }); }
  }
}

/** Пуска сървъра. Зает порт: с reuse – ползва вече работещия Cubicle Crew; иначе (и при чуждо приложение) – случаен свободен порт. */
export async function startServer(port = PORT, { reuse = true } = {}) {
  // свободен ли е портът? (проверка с отделен сокет – иначе ws хвърля грешката като необработена)
  const free = (p) => new Promise((res) => {
    const probe = net.createServer();
    probe.once('error', () => res(false));
    probe.once('listening', () => probe.close(() => res(true)));
    probe.listen(p, HOST);
  });
  const listen = (p) => new Promise((res, rej) => { server.once('error', rej); server.listen(p, HOST, () => res(server.address().port)); });
  let actual;
  if (await free(port)) actual = await listen(port);
  else if (!reuse) {
    // фиксиран резервен порт – запазва настройките в localStorage между стартиранията
    let alt = 0;
    for (const p of [port + 1, port + 2, port + 3]) if (await free(p)) { alt = p; break; }
    actual = await listen(alt);
  }
  else {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/sprites`);
      if (r.ok && Array.isArray(await r.json())) return { port, external: true }; // вече върви Cubicle Crew
    } catch { /* портът е зает от друго приложение */ }
    actual = await listen(0);
  }
  setInterval(poll, POLL_MS);
  poll();
  setInterval(scanSessions, SESSIONS_MS);
  scanSessions();
  wallet.port = actual;
  wallet.start();
  process.once('exit', () => wallet.close());
  console.log(`Cubicle Crew: http://localhost:${actual}   (демо без Claude: /?demo   витрина: /?demo=showcase)`);
  console.log(`Следя: ${ROOT}`);
  return { port: actual, external: false };
}

// `node server.js` – пуска се веднага; при import (от Electron) – само при извикване на startServer()
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Ctrl+C не вика 'exit' сам – така портфейлът се записва преди изход
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));
  startServer().catch((e) => { console.error(e.message); process.exit(1); });
}

/** За Electron: запис на портфейла преди изход. */
export function flushWallet() { wallet.close(); }
