// Входна точка: връзка към сървъра (или демо), цикъл на рисуване, мащабиране.
import { PARAMS, T } from './config.js';
import { Model } from './model.js';
import { Particles } from './particles.js';
import { Office } from './office.js';
import { UI } from './ui.js';
import { timeOfDay, parseFakeTime, TILES } from './environment.js';
import { setCharacterSheet, buildAtlas, lookFor } from './sprites.js';
import { startDemo } from './demo.js';
import { Tokens, demoWallet } from './tokens.js';
import { Shop } from './shop.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });
const model = new Model();
const fx = new Particles();
const office = new Office(model, fx);
if (PARAMS.debug) { window.__office = office; window.__model = model; }
const ui = new UI(office, model, canvas);
if (PARAMS.seed != null) office.seed = PARAMS.seed;
const tokens = new Tokens(office, ui);
const shop = new Shop(tokens, ui);
ui.onShop = () => shop.open();
if (PARAMS.debug) window.__shop = shop;

model.on('join', (a) => office.join(a, performance.now()));
model.on('leave', (a) => office.leave(a));
model.on('link', (p, c) => office.link(p, c));
model.on('celebrate', (a) => office.celebrate(a));

// ---------------------------------------------------------------- мащаб
let appliedVersion = -1;
let lastSpecKey = '';
function applyCanvas() {
  const L = office.L, dpr = window.devicePixelRatio || 1;
  canvas.width = L.W; canvas.height = L.H;
  canvas.style.width = `${(L.W * L.scale) / dpr}px`;
  canvas.style.height = `${(L.H * L.scale) / dpr}px`;
  ui.setScale(L.scale, dpr, L.W, L.H);
  appliedVersion = office.layoutVersion;
  if (PARAMS.desktop && window.pixelOffice?.preferSize) {
    const key = `${L.spec.teams}x${L.spec.rows}`;
    if (key !== lastSpecKey) {
      lastSpecKey = key;
      window.pixelOffice.preferSize({ w: Math.ceil((L.need.w * 2) / dpr), h: Math.ceil((L.need.h * 2) / dpr) });
    }
  }
}
function resize() {
  const dpr = window.devicePixelRatio || 1;
  office.resize(Math.round(innerWidth * dpr), Math.round(innerHeight * dpr));
  applyCanvas();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- време (истинско или ?time=)
const fake = parseFakeTime(PARAMS.time);
const t0 = Date.now();
function nowDate() {
  if (!fake) return new Date();
  const d = new Date();
  d.setHours(fake.h, fake.m, 0, 0);
  return new Date(d.getTime() + (Date.now() - t0));
}

// ---------------------------------------------------------------- цикъл
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  model.tick(now);
  office.update(dt, now);
  if (office.layoutVersion !== appliedVersion) applyCanvas();
  tokens.update(now);
  fx.update(dt);
  const date = nowDate();
  office.render(ctx, now, timeOfDay(date), date);
  ui.sync(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- PNG override (по желание)
// Сървърът връща списък на файловете в public/sprites, за да не правим заявки към липсващи файлове.
fetch('api/sprites').then((r) => (r.ok ? r.json() : [])).then(async (files) => {
  const has = (f) => files.includes(f);
  const img = (f) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `sprites/${f}`; });
  const json = (f) => fetch(`sprites/${f}`).then((r) => r.json());
  if (has('characters.png')) {
    setCharacterSheet(await img('characters.png'), has('characters.json') ? await json('characters.json') : null);
    for (const a of office.actors.values()) a.sprites.cache.clear();
  }
  if (has('tiles.png') && has('tiles.json')) {
    TILES.img = await img('tiles.png'); TILES.map = await json('tiles.json');
    office.relayout();
  }
}).catch(() => { /* без override – всичко е процедурно */ });

// ---------------------------------------------------------------- ?atlas – преглед на генерираните спрайтове
if (new URLSearchParams(location.search).has('atlas')) {
  const wrap = document.createElement('div');
  wrap.id = 'atlas';
  const colors = ['#4ac26b', '#4a8fe0', '#e07a4a', '#b04ae0', '#e04a6b', '#e0c24a', '#6b6b80', '#4ac26b'];
  for (let i = 0; i < 8; i++) {
    const c = buildAtlas(lookFor('atlas-' + i, i === 7), colors[i]);
    c.style.width = `${c.width * (Number(new URLSearchParams(location.search).get('atlas')) || 3)}px`;
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
}

// ---------------------------------------------------------------- връзка
const ingest = (e) => model.ingest(e);
if (PARAMS.demo) {
  ui.setConnection('demo');
  const earn = demoWallet(tokens);
  startDemo((e) => { ingest(e); earn(e); }, model);
} else {
  let retry = 1000;
  const connect = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => { ui.setConnection('connected'); retry = 1000; };
    ws.onmessage = (m) => {
      let e;
      try { e = JSON.parse(m.data); } catch { return; /* лош ред */ }
      if (e.type === 'wallet') tokens.onWallet(e);
      else if (e.type === 'sessions') model.sessions(e.list);
      else ingest(e);
    };
    ws.onclose = () => { ui.setConnection('down'); setTimeout(connect, retry); retry = Math.min(8000, retry * 1.5); };
    ws.onerror = () => { /* onclose ще се погрижи */ };
  };
  connect();
}
void T;
