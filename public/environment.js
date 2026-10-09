// Стаята: под, стени, прозорци с истинското небе, мебели, часовник, дъска.
// Статичното се рисува ВЕДНЪЖ в офскрийн канвас (bg) + по едно изображение за всяка мебел.
// Всяка мебел минава през prop(name, ...) – ако има sprites/tiles.png с това име, ползва се то.
import { CFG } from './config.js';
import { ENV, mix, shade, rgba, ACCENTS, MUGS, SYNTAX } from './palette.js';
import { R, rng, makeCanvas, pixLine, hashStr } from './util.js';
import { POD } from './layout.js';
import { drawText, textWidth, compactNum } from './pixelfont.js';
import { drawCoin } from './tokens.js';
import { SLOTS, resolveDecor } from './catalog.js';

// =====================================================================
// Обзавеждане (decor): предметите от catalog.js -> цветове/стилове за рисуване
// =====================================================================
const DEFAULT_DECOR = resolveDecor({});
/** Ключ за tileset: предметът по подразбиране ползва старото име ('sofa_back'), другите – 'sofa_back@sofa.chesterfield'. */
const variant = (slot, it) => (!it || it.id === SLOTS[slot].def ? null : it.id);
/** 3 тона от един цвят (ако предметът не ги дава изрично). */
function tones(it) {
  return { c: it.c, hi: it.hi || mix(it.c, '#ffffff', 0.2), dk: it.dk || shade(it.c, 0.66), dk2: it.dk2 || shade(it.c, 0.48) };
}
function wallTones(it) {
  return { wall: it.wall, stripe: it.stripe || mix(it.wall, '#ffffff', 0.05), dark: it.dark || shade(it.wall, 0.68), ceiling: it.ceiling || shade(it.wall, 0.5) };
}

// =====================================================================
// Време на деня
// =====================================================================
const SKY_KEYS = [ // час, горе, долу, дневна светлина
  [0, '#060a1c', '#131a3a', 0],
  [4.6, '#0a0f2e', '#1c2450', 0],
  [5.8, '#262c66', '#c27a6e', 0.25],
  [6.8, '#4a72c0', '#f2bc8e', 0.7],
  [8.5, '#4a8fe0', '#a8d6f2', 1],
  [16.8, '#4a8fe0', '#a8d6f2', 1],
  [18.4, '#5a5aa4', '#f2985a', 0.6],
  [19.4, '#2c2a68', '#b0586a', 0.25],
  [20.5, '#0e1236', '#262a58', 0.04],
  [24, '#060a1c', '#131a3a', 0],
];

export function timeOfDay(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1][0] <= h) i++;
  const [h0, t0, b0, d0] = SKY_KEYS[i], [h1, t1, b1, d1] = SKY_KEYS[i + 1];
  const k = (h - h0) / (h1 - h0 || 1);
  const daylight = d0 + (d1 - d0) * k;
  const warm = Math.max(Math.exp(-((h - 6.4) ** 2) / 0.8), Math.exp(-((h - 18.8) ** 2) / 0.8));
  const night = 1 - daylight;
  // множител за цялата сцена: нощем синкаво и по-тъмно, на изгрев/залез топло
  let tint = mix('#ffffff', '#4c5694', night * 0.62);
  tint = mix(tint, '#ffc690', warm * 0.28);
  return {
    h, daylight, night, warm,
    skyTop: mix(t0, t1, k), skyBottom: mix(b0, b1, k),
    tint,
    sun: h >= 5.6 && h <= 19.6 ? (h - 5.6) / 14 : null,
    moon: h >= 19 || h <= 6.5 ? ((h + 24 - 19) % 24) / 11.5 : null,
  };
}

export function parseFakeTime(s) {
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  return { h: Number(m[1]) % 24, m: Number(m[2] || 0) };
}

// =====================================================================
// Override с tileset (по желание)
// =====================================================================
export const TILES = { img: null, map: null };
/** Мебел като отделен канвас. Ако tiles.json има това име – рисува тайла, иначе fallback(ctx). */
// части на работното място: горен ляв ъгъл в рамката 72x76 (вж. POD в layout.js)
const POD_ANCHORS = { chair: [POD.chair.x, POD.chair.y], desk: [POD.desk.x, POD.desk.y], monitor: [POD.monitor.x, POD.monitor.y] };
POD_ANCHORS.chair_lead = [POD.chair.x, POD.chair.y - 4]; POD_ANCHORS.desk_lead = POD_ANCHORS.desk;
function prop(name, w, h, fallback, vari = null) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  // вариант (купен предмет): само 'име@id' от tileset-а; без него – процедурно (не старият тайл с другия цвят)
  const t = TILES.map && TILES.map[vari ? `${name}@${vari}` : name];
  if (t && TILES.img) {
    const tw = t.w ?? t[2], th = t.h ?? t[3];
    const an = t.ax != null ? [t.ax, t.ay] : POD_ANCHORS[name];
    const dx = an ? an[0] : Math.round((w - tw) / 2), dy = an ? an[1] : h - th;
    ctx.drawImage(TILES.img, t.x ?? t[0], t.y ?? t[1], tw, th, dx, dy, tw, th);
  } else fallback(ctx);
  return c;
}
function patternTile(name) {
  const t = TILES.map && TILES.map[name];
  if (!t || !TILES.img) return null;
  const c = makeCanvas(t.w ?? t[2], t.h ?? t[3]);
  c.getContext('2d').drawImage(TILES.img, t.x ?? t[0], t.y ?? t[1], c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// =====================================================================
// Мебели (процедурно)
// =====================================================================
function drawChairBack(ctx, lead, it) {
  if (it.style === 'gaming') return drawGamingChair(ctx, it);
  if (it.style === 'throne') return drawThrone(ctx, it);
  const { dk: D, c: C, hi: H } = tones(it);
  if (lead) { R(ctx, D, 18, 11, 16, 5); R(ctx, C, 19, 12, 14, 4); R(ctx, H, 20, 12, 3, 3); } // по-висока облегалка
  R(ctx, D, 17, 15, 18, 15); R(ctx, D, 16, 16, 20, 13);
  R(ctx, C, 17, 16, 18, 12); R(ctx, H, 18, 17, 3, 9); R(ctx, H, 21, 16, 10, 1);
  R(ctx, shade(C, 0.85), 31, 17, 3, 11);
  R(ctx, D, 18, 22, 16, 1);               // шев
  R(ctx, D, 13, 24, 4, 6); R(ctx, C, 14, 24, 2, 1);   // подлакътници
  R(ctx, D, 35, 24, 4, 6); R(ctx, C, 36, 24, 2, 1);
}

function drawGamingChair(ctx, it) {
  const { dk: D, c: C, hi: H } = tones(it), A = it.accent, AD = shade(A, 0.7);
  R(ctx, D, 17, 5, 18, 25); R(ctx, D, 15, 13, 22, 16);          // висока облегалка с "крила"
  R(ctx, C, 18, 6, 16, 23); R(ctx, C, 16, 14, 20, 14);
  R(ctx, A, 19, 7, 2, 21); R(ctx, A, 31, 7, 2, 21); R(ctx, AD, 20, 7, 1, 21); R(ctx, AD, 32, 7, 1, 21);
  R(ctx, H, 22, 6, 8, 1);
  R(ctx, '#d8d4cc', 23, 8, 6, 3); R(ctx, '#f4f1ea', 23, 8, 5, 1);  // възглавничка за главата
  R(ctx, D, 18, 22, 16, 1);
  R(ctx, D, 12, 23, 5, 7); R(ctx, A, 13, 23, 3, 1);               // подлакътници
  R(ctx, D, 35, 23, 5, 7); R(ctx, A, 36, 23, 3, 1);
}
function drawThrone(ctx, it) {
  const { c: C, hi: H, dk: D } = tones(it), G = it.gold, GD = shade(G, 0.68), GH = mix(G, '#ffffff', 0.45);
  R(ctx, GD, 15, 4, 22, 26); R(ctx, G, 16, 5, 20, 24);            // златна рамка
  for (const [x, y, h] of [[16, 1, 4], [25, 0, 5], [34, 1, 4]]) { R(ctx, GD, x - 1, y, 4, h); R(ctx, G, x, y, 2, h); R(ctx, GH, x, y, 1, 1); }
  R(ctx, '#e04a4a', 25, 2, 2, 2); R(ctx, '#4a8fe0', 16, 3, 2, 1); R(ctx, '#4a8fe0', 34, 3, 2, 1);
  R(ctx, D, 18, 7, 16, 21); R(ctx, C, 19, 8, 14, 19); R(ctx, H, 20, 9, 2, 15); // кадифе
  for (const [x, y] of [[23, 12], [28, 12], [23, 18], [28, 18]]) R(ctx, D, x, y, 1, 1);
  R(ctx, GH, 17, 5, 18, 1);
  R(ctx, GD, 11, 21, 6, 9); R(ctx, G, 12, 21, 4, 2); R(ctx, GH, 12, 21, 4, 1);   // подлакътници
  R(ctx, GD, 35, 21, 6, 9); R(ctx, G, 36, 21, 4, 2); R(ctx, GH, 36, 21, 4, 1);
}

const LEAD = {
  deskTop: '#7a4e34', deskTopHi: '#946048', deskEdge: '#5e3a26', deskFront: '#5a3624', deskFrontDk: '#3e2418', deskFrontHi: '#6e4430', metal: '#e0c060',
};
function drawDesk(ctx, lead) {
  const E = lead ? { ...ENV, ...LEAD } : ENV, d = POD.desk;
  const x = d.x, y = d.y, w = d.w;
  // плот
  R(ctx, E.deskEdge, x, y, w, d.top);
  R(ctx, E.deskTop, x, y, w, d.top - 1);
  R(ctx, E.deskTopHi, x + 1, y, w - 2, 1);
  for (const [gx, gy, gw] of [[10, 32, 14], [30, 34, 18], [44, 32, 9], [14, 35, 7], [54, 35, 8]]) R(ctx, mix(E.deskTop, E.deskEdge, 0.45), gx, gy, gw, 1);
  R(ctx, E.deskEdge, x, y + d.top - 1, w, 1);
  // фронт
  const fy = y + d.top;
  R(ctx, E.deskFront, x + 1, fy, w - 2, d.front - 1);
  R(ctx, E.deskFrontDk, x + 1, fy, w - 2, 1);
  R(ctx, E.deskFrontDk, x + 1, fy, 1, d.front - 1); R(ctx, E.deskFrontDk, x + w - 2, fy, 1, d.front - 1);
  R(ctx, E.deskFrontHi, x + 4, fy + 2, 34, 1);
  R(ctx, E.deskFrontDk, x + 4, fy + 8, 34, 1);
  // чекмеджета
  R(ctx, E.deskFrontDk, 46, fy + 1, 17, 9);
  R(ctx, E.deskFrontHi, 47, fy + 2, 15, 3); R(ctx, E.deskFront, 47, fy + 3, 15, 2);
  R(ctx, E.deskFrontHi, 47, fy + 6, 15, 3); R(ctx, E.deskFront, 47, fy + 7, 15, 2);
  R(ctx, E.metal, 53, fy + 3, 4, 1); R(ctx, E.metal, 53, fy + 7, 4, 1);
  // крачета
  R(ctx, E.deskFrontDk, x + 1, fy + d.front - 1, 3, 2); R(ctx, E.deskFrontDk, x + w - 4, fy + d.front - 1, 3, 2);
  if (lead) { // табелка с име
    R(ctx, '#8a6a20', 17, fy + 3, 16, 5); R(ctx, '#e0c060', 18, fy + 3, 14, 4); R(ctx, '#f8e8a0', 18, fy + 3, 14, 1);
    R(ctx, '#6a4a14', 20, fy + 5, 10, 1);
  }
}

function drawMonitor(ctx, sticky) {
  const E = ENV, m = POD.monitor, s = POD.screen;
  R(ctx, E.monitorDk, m.x, m.y, m.w, m.h);
  R(ctx, E.monitor, m.x, m.y, m.w - 1, m.h - 1);
  R(ctx, E.monitorHi, m.x + 1, m.y, m.w - 3, 1);
  R(ctx, '#0e1016', s.x, s.y, s.w, s.h);
  R(ctx, E.monitorDk, m.x + 9, m.y + m.h, 4, 3);       // стойка
  R(ctx, E.monitor, m.x + 6, m.y + m.h + 3, 10, 2); R(ctx, E.monitorHi, m.x + 6, m.y + m.h + 3, 10, 1);
  if (sticky) { R(ctx, sticky, m.x + 1, m.y - 1, 4, 4); R(ctx, shade(sticky, 0.8), m.x + 1, m.y + 2, 4, 1); }
}

function drawKeyboard(ctx) {
  const k = POD.keyboard;
  R(ctx, '#23242e', k.x, k.y, k.w, k.h + 1);
  R(ctx, '#3a3d50', k.x + 1, k.y, k.w - 2, k.h);
  for (let i = 0; i < 7; i++) { R(ctx, '#5c6078', k.x + 2 + i * 2, k.y + 1, 1, 1); if (i < 6) R(ctx, '#5c6078', k.x + 3 + i * 2, k.y + 2, 1, 1); }
  R(ctx, '#d8d8e2', 35, 32, 2, 3); R(ctx, '#a8a8b8', 36, 33, 1, 2);    // мишка
}

function drawLamp(ctx, color) {
  const E = ENV, l = POD.lamp;
  R(ctx, E.metalDk, l.x + 1, 33, 6, 2); R(ctx, E.metal, l.x + 1, 33, 6, 1);
  R(ctx, E.metalDk, l.x + 3, 22, 1, 11); R(ctx, E.metal, l.x + 2, 22, 1, 10);
  R(ctx, E.metalDk, l.x + 3, 21, 4, 1);
  R(ctx, shade(color, 0.7), l.x + 4, 19, 7, 2); R(ctx, color, l.x + 5, 19, 5, 1);
  R(ctx, shade(color, 0.7), l.x + 3, 21, 9, 2); R(ctx, color, l.x + 4, 21, 6, 1);
}

function drawMug(ctx, x, y, color) {
  R(ctx, shade(color, 0.6), x - 1, y, 5, 5);
  R(ctx, color, x, y, 3, 4); R(ctx, shade(color, 0.78), x + 2, y, 1, 4);
  R(ctx, '#4a2c1c', x, y, 3, 1);
  R(ctx, shade(color, 0.78), x + 3, y + 1, 1, 2);
}

const DESK_ITEMS = {
  plant(ctx) {
    const P = ENV.pot, L = ENV.leaf;
    R(ctx, P[2], 56, 30, 9, 2); R(ctx, P[0], 57, 30, 7, 1);
    R(ctx, P[1], 57, 32, 7, 4); R(ctx, P[0], 57, 32, 2, 4); R(ctx, P[2], 63, 32, 1, 4);
    for (const [x, y, c] of [[58, 26, 1], [59, 24, 0], [60, 23, 0], [61, 25, 1], [62, 27, 2], [57, 28, 2], [59, 27, 1], [61, 28, 1], [60, 26, 0], [63, 25, 0], [56, 26, 1]])
      R(ctx, L[c], x, y, 2, 2);
  },
  cactus(ctx) {
    const P = ENV.pot, L = ENV.leaf;
    R(ctx, P[1], 57, 31, 7, 5); R(ctx, P[0], 57, 31, 2, 5); R(ctx, P[2], 56, 30, 9, 2);
    R(ctx, L[1], 59, 21, 3, 9); R(ctx, L[0], 59, 21, 1, 9);
    R(ctx, L[1], 56, 24, 2, 3); R(ctx, L[1], 57, 26, 2, 1); R(ctx, L[1], 63, 23, 2, 4); R(ctx, L[1], 62, 25, 1, 1);
    R(ctx, '#f08ab8', 60, 20, 2, 1);
  },
  duck(ctx) {
    R(ctx, '#c8a020', 57, 31, 8, 5); R(ctx, '#f0d040', 57, 31, 7, 4); R(ctx, '#fff080', 58, 31, 3, 1);
    R(ctx, '#c8a020', 59, 27, 5, 5); R(ctx, '#f0d040', 59, 27, 4, 4);
    R(ctx, '#f07a30', 63, 29, 2, 1); R(ctx, '#1d1626', 61, 28, 1, 1);
  },
  books(ctx) {
    R(ctx, '#2e2a3a', 55, 29, 11, 7);
    R(ctx, '#c84a4a', 56, 33, 9, 2); R(ctx, '#4a7ad0', 57, 31, 8, 2); R(ctx, '#e0b040', 56, 29, 9, 2);
    R(ctx, '#f4f1e8', 64, 31, 1, 2); R(ctx, '#f4f1e8', 56, 33, 1, 2);
  },
  photo(ctx) {
    R(ctx, '#3a2a20', 57, 26, 8, 9); R(ctx, '#e2dccb', 57, 26, 7, 8);
    R(ctx, '#7ab8f0', 58, 27, 5, 4); R(ctx, '#5aa05a', 58, 30, 5, 2); R(ctx, '#f0d070', 61, 28, 1, 1);
    R(ctx, '#3a2a20', 59, 34, 3, 2);
  },
  robot(ctx) {
    R(ctx, '#4a4e62', 57, 33, 7, 3); R(ctx, '#9aa0b4', 58, 29, 5, 4); R(ctx, '#c8ccd8', 58, 29, 4, 1);
    R(ctx, '#9aa0b4', 57, 25, 7, 4); R(ctx, '#c8ccd8', 57, 25, 6, 1);
    R(ctx, '#4ae0e0', 58, 26, 1, 1); R(ctx, '#4ae0e0', 61, 26, 1, 1); R(ctx, '#e04a4a', 60, 23, 1, 2);
  },
};
export const DESK_ITEM_NAMES = Object.keys(DESK_ITEMS);

/** Изображенията на едно работно място: back (стол) и front (бюро, монитор, лампа, вещи). */
export function buildPod(variantSeed, lead = false, decor = DEFAULT_DECOR, team = 0) {
  const r = rng(variantSeed);
  const W = CFG.POD_W, H = CFG.POD_H;
  const cslot = lead ? 'chair.lead' : `chair.team${team ? 1 : 0}`, chair = decor[cslot];
  // ключът за tileset следва ролята (chair/chair_lead), вариантът – купения стол
  const back = prop(lead ? 'chair_lead' : 'chair', W, H, (c) => drawChairBack(c, lead, chair), variant(cslot, chair));
  const lampColor = r.pick(['#e0b050', '#5a9ae0', '#e05a5a', '#6ac08a', '#e8e8f0']);
  const sticky = r() < 0.5 ? r.pick(['#f0e060', '#f08ab8', '#7ad0f0', '#a0e070']) : null;
  const item = r.pick(DESK_ITEM_NAMES);
  const mugColor = r.pick(MUGS);
  const front = makeCanvas(W, H);
  const fx = front.getContext('2d');
  fx.drawImage(prop(lead ? 'desk_lead' : 'desk', W, H, (c) => drawDesk(c, lead)), 0, 0);
  fx.drawImage(prop('monitor', W, H, (c) => drawMonitor(c, sticky)), 0, 0);
  drawKeyboard(fx);
  drawLamp(fx, lampColor);
  drawMug(fx, 38, 30, mugColor);
  DESK_ITEMS[item](fx);
  return { back, front, item, mugColor, lampColor };
}

function drawPrinter(ctx, w, h) {
  const cab = '#d8d2c4', dk = '#a8a090';
  R(ctx, dk, 1, h - 16, w - 2, 16); R(ctx, cab, 2, h - 15, w - 4, 14); R(ctx, dk, 2, h - 9, w - 4, 1);
  R(ctx, '#7a7a8a', Math.floor(w / 2) - 2, h - 13, 4, 1); R(ctx, '#7a7a8a', Math.floor(w / 2) - 2, h - 6, 4, 1);
  // принтер
  R(ctx, '#3a3a48', 2, h - 26, w - 4, 10); R(ctx, '#55556a', 3, h - 25, w - 6, 2); R(ctx, '#1e1e26', 5, h - 19, w - 10, 2);
  R(ctx, '#f4f1e8', 7, h - 30, w - 14, 5); R(ctx, '#c9c2b0', 7, h - 26, w - 14, 1);
  R(ctx, '#4ac26b', w - 6, h - 23, 1, 1);
}

function drawBookshelf(ctx, w, h) {
  const wood = '#6a4630', woodHi = '#845a3e', woodDk = '#4a2e1e';
  R(ctx, woodDk, 0, 0, w, h); R(ctx, wood, 1, 1, w - 2, h - 2); R(ctx, woodHi, 1, 1, w - 2, 1);
  const r = rng(77);
  const shelves = 4, sh = Math.floor((h - 4) / shelves);
  for (let s = 0; s < shelves; s++) {
    const y0 = 2 + s * sh;
    R(ctx, '#2e1e14', 2, y0, w - 4, sh - 2);
    let x = 3;
    while (x < w - 4) {
      const bw = 2 + r.int(3), bh = sh - 3 - r.int(4);
      if (r() < 0.12 && x < w - 8) { // наклонена книга / празно
        x += 3; continue;
      }
      const c = r.pick(['#c84a4a', '#4a7ad0', '#e0b040', '#5aa05a', '#8a5ac0', '#e07a4a', '#e8e4dc', '#3a8a8a']);
      R(ctx, c, x, y0 + sh - 2 - bh, Math.min(bw, w - 4 - x), bh);
      R(ctx, shade(c, 0.72), x + bw - 1, y0 + sh - 2 - bh, 1, bh);
      if (bh > 5) R(ctx, mix(c, '#ffffff', 0.4), x, y0 + sh - bh, Math.min(bw - 1, 1) || 1, 1);
      x += bw;
    }
    R(ctx, woodHi, 1, y0 + sh - 2, w - 2, 1); R(ctx, woodDk, 1, y0 + sh - 1, w - 2, 1);
  }
  // малко растение отгоре
  R(ctx, ENV.pot[1], w - 10, 0, 6, 3);
}

function drawCounter(ctx, w, h, pro = false) {
  // h = цялата височина (плот + машина)
  const top = h - 20;
  const cab = '#d8d2c4', cabDk = '#a8a090', cabHi = '#ece6da';
  R(ctx, cabDk, 0, top, w, 20); R(ctx, cab, 1, top + 3, w - 2, 16);
  R(ctx, '#4a4a58', 0, top, w, 3); R(ctx, '#6a6a7c', 0, top, w, 1);
  R(ctx, cabDk, Math.floor(w / 2), top + 4, 1, 15);
  R(ctx, cabHi, 2, top + 4, 2, 14);
  R(ctx, '#7a7a8a', Math.floor(w / 2) - 3, top + 8, 2, 1); R(ctx, '#7a7a8a', Math.floor(w / 2) + 2, top + 8, 2, 1);
  // кафемашина
  const mx = 3, my = top - 18;
  if (pro) { // хромирана еспресо машина с манометър и две групи
    R(ctx, '#5a5e70', mx - 1, my - 2, 18, 20); R(ctx, '#c8ccd8', mx, my - 1, 16, 18); R(ctx, '#eef0f6', mx + 1, my - 1, 14, 1);
    R(ctx, '#9aa0b4', mx + 13, my, 2, 16);
    R(ctx, '#e8e4dc', mx + 2, my - 4, 3, 3); R(ctx, '#e8e4dc', mx + 6, my - 4, 3, 3); R(ctx, '#e05a5a', mx + 10, my - 4, 3, 3); // чашки отгоре
    R(ctx, '#2a2a36', mx + 5, my + 1, 6, 5); R(ctx, '#f4f1e8', mx + 6, my + 2, 4, 3); R(ctx, '#c84a4a', mx + 8, my + 3, 1, 1); // манометър
    R(ctx, '#3a3a48', mx + 1, my + 8, 14, 2);
    for (const gx of [mx + 2, mx + 9]) { R(ctx, '#2a2a36', gx, my + 10, 5, 2); R(ctx, '#7a7a8a', gx + 2, my + 12, 1, 1); R(ctx, '#e8e4dc', gx + 1, my + 13, 3, 3); }
    R(ctx, '#c84a4a', mx + 1, my + 16, 14, 1);
  } else {
    R(ctx, '#1e1e26', mx, my, 15, 18); R(ctx, '#3a3a48', mx + 1, my + 1, 13, 16); R(ctx, '#55556a', mx + 1, my + 1, 13, 1);
    R(ctx, '#1e1e26', mx + 3, my + 8, 9, 7); R(ctx, '#9aa0b4', mx + 6, my + 8, 3, 2);   // ниша и чучур
    R(ctx, '#e8e4dc', mx + 6, my + 12, 3, 3);   // чашка
    R(ctx, '#c84a4a', mx + 11, my + 3, 2, 1); R(ctx, '#4ac26b', mx + 11, my + 5, 2, 1);
    R(ctx, '#2a2a36', mx + 2, my + 3, 7, 3); R(ctx, '#6ae0ff', mx + 3, my + 4, 3, 1);
  }
  // буркан с кафе и чаши
  R(ctx, '#e8e4dc', 21, top - 4, 3, 4); R(ctx, '#e05a5a', 25, top - 4, 3, 4);
  R(ctx, '#c8b090', 21, top - 9, 4, 5); R(ctx, '#5a3a24', 21, top - 7, 4, 2);
}

function drawCooler(ctx, w, h) {
  R(ctx, '#9aa0b4', 1, h - 22, w - 2, 22); R(ctx, '#e4e8f0', 2, h - 21, w - 4, 20); R(ctx, '#c4c8d4', w - 4, h - 21, 2, 20);
  R(ctx, '#3a3e50', 4, h - 17, 6, 3); R(ctx, '#4a8fe0', 4, h - 17, 2, 1); R(ctx, '#e05a5a', 8, h - 17, 2, 1);
  R(ctx, '#7a8090', 2, h - 9, w - 4, 1);
  // бутилка
  R(ctx, '#3a6ab0', 3, h - 34, 8, 12); R(ctx, '#6aa8f0', 3, h - 33, 8, 10); R(ctx, '#a8d4ff', 4, h - 32, 2, 7);
  R(ctx, '#3a6ab0', 5, h - 23, 4, 2);
}

function drawPlant(ctx, w, h, big, style = 'ficus') {
  const P = ENV.pot, L = ENV.leaf;
  const pw = big ? 12 : 8, ph = big ? 9 : 6, px = Math.floor((w - pw) / 2);
  if (style === 'cactus') return drawCactusPlant(ctx, w, h, big, pw, ph, px);
  if (style === 'monstera') return drawMonstera(ctx, w, h, big, pw, ph, px);
  const r = rng(big ? 5 : 9);
  // листа
  const n = big ? 26 : 12;
  for (let i = 0; i < n; i++) {
    const a = r.range(-Math.PI * 0.95, -Math.PI * 0.05), d = r.range(2, big ? 13 : 7);
    const x = Math.round(w / 2 + Math.cos(a) * d * (big ? 0.85 : 0.9)), y = Math.round(h - ph - 2 + Math.sin(a) * d * 1.3);
    const c = d > (big ? 8 : 4) ? L[0] : L[1];
    R(ctx, L[2], x - 1, y, 3, 2); R(ctx, c, x - 1, y - 1, 3, 2);
  }
  if (big) for (let i = 0; i < 4; i++) R(ctx, L[2], Math.floor(w / 2) - 1 + (i % 2), h - ph - 8 + i * 2, 1, 2);
  if (style === 'flowers') { // цветчета по върховете на листата
    const fr = rng(big ? 15 : 19);
    for (let i = 0; i < (big ? 9 : 4); i++) {
      const a = fr.range(-Math.PI * 0.9, -Math.PI * 0.1), d = fr.range(big ? 6 : 3, big ? 12 : 6);
      const x = Math.round(w / 2 + Math.cos(a) * d * 0.85), y = Math.round(h - ph - 3 + Math.sin(a) * d * 1.3);
      const fc = fr.pick(['#f08ab8', '#f0d040', '#ffffff', '#e05a5a']);
      R(ctx, fc, x - 1, y, 3, 1); R(ctx, fc, x, y - 1, 1, 3); R(ctx, '#f8e070', x, y, 1, 1);
    }
  }
  drawPot(ctx, P, pw, ph, px, h);
}
function drawPot(ctx, P, pw, ph, px, h) {
  R(ctx, P[2], px - 1, h - ph, pw + 2, 2); R(ctx, P[0], px, h - ph, pw, 1);
  R(ctx, P[1], px, h - ph + 2, pw, ph - 2); R(ctx, P[0], px + 1, h - ph + 2, 2, ph - 3); R(ctx, P[2], px + pw - 2, h - ph + 2, 2, ph - 2);
}
function drawCactusPlant(ctx, w, h, big, pw, ph, px) {
  const G = ['#6ab06a', '#4a8a52', '#2e6238'], cx = Math.floor(w / 2), top = h - ph;
  const col = (x, y0, hh, ww) => { R(ctx, G[2], x - 1, y0, ww + 2, hh); R(ctx, G[1], x, y0, ww, hh); R(ctx, G[0], x, y0 + 1, 1, hh - 2); for (let y = y0 + 2; y < y0 + hh; y += 3) R(ctx, '#e8f0d8', x + ww - 1, y, 1, 1); };
  if (big) {
    col(cx - 2, top - 24, 24, 4);
    col(cx - 8, top - 15, 8, 3); R(ctx, G[1], cx - 6, top - 9, 4, 3);
    col(cx + 4, top - 19, 9, 3); R(ctx, G[1], cx + 2, top - 12, 3, 3);
    R(ctx, '#f08ab8', cx - 1, top - 26, 2, 2); R(ctx, '#f8c0d8', cx - 1, top - 26, 1, 1);
  } else {
    col(cx - 2, top - 11, 11, 3); col(cx + 2, top - 6, 6, 2);
  }
  drawPot(ctx, ['#e8e4dc', '#c8c0b0', '#9a9284'], pw, ph, px, h);
}
function drawMonstera(ctx, w, h, big, pw, ph, px) {
  const L = ['#3e9a52', '#2a7a40', '#1c5430'], cx = Math.floor(w / 2), top = h - ph;
  const leaves = big
    ? [[-9, -22, 9, 7], [3, -26, 9, 7], [-12, -12, 9, 6], [4, -15, 10, 7], [-4, -31, 8, 6], [-3, -18, 8, 6]]
    : [[-6, -12, 6, 5], [1, -14, 6, 5], [-3, -8, 6, 4]];
  for (const [dx, dy, lw, lh] of leaves) {
    const x = cx + dx, y = top + dy;
    pixLine(ctx, L[2], cx, top, x + Math.floor(lw / 2), y + lh);
    R(ctx, L[2], x, y + 1, lw, lh - 1); R(ctx, L[1], x + 1, y, lw - 2, lh); R(ctx, L[0], x + 1, y + 1, Math.floor(lw / 2) - 1, lh - 2);
    if (lw > 6) { R(ctx, L[2], x + Math.floor(lw / 2), y + 1, 1, lh - 2); ctx.clearRect(x + 1, y + 2, 1, 1); ctx.clearRect(x + lw - 2, y + lh - 3, 1, 1); }
  }
  drawPot(ctx, ['#4a4a58', '#363642', '#24242e'], pw, ph, px, h);
}

// местата за сядане на дивана (в координатите на картинката) – вж. lounge.spots.sofa в layout.js
const SOFA_SEATS = [16, 42];
function drawSofaBack(ctx, w, h, it) {
  if (it.style === 'beanbags') { // горната част на пуфовете (зад седналия)
    SOFA_SEATS.forEach((sx, i) => { const c = tones({ c: ['#c8763a', '#4a7ad0'][i] }); R(ctx, c.dk2, sx - 8, h - 6, 17, 6); R(ctx, c.c, sx - 7, h - 5, 15, 5); R(ctx, c.hi, sx - 5, h - 5, 6, 2); });
    return;
  }
  const SOFA = tones(it);
  R(ctx, SOFA.dk2, 2, 0, w - 4, 16); R(ctx, SOFA.c, 3, 1, w - 6, 14); R(ctx, SOFA.hi, 4, 1, w - 8, 2);
  R(ctx, SOFA.dk, Math.floor(w / 2), 3, 1, 11);
  R(ctx, SOFA.dk, 4, 14, w - 8, 3);       // седалката отзад
  if (it.style === 'chesterfield') { // капитониране
    for (let x = 7; x < w - 6; x += 5) for (let y = 4; y < 13; y += 4) R(ctx, SOFA.dk2, x + ((y / 4) % 2 ? 2 : 0), y, 1, 1);
    R(ctx, SOFA.dk2, 2, 0, 1, 1); R(ctx, SOFA.dk2, w - 3, 0, 1, 1);
  }
}
function drawSofaFront(ctx, w, h, it) {
  if (it.style === 'beanbags') {
    SOFA_SEATS.forEach((sx, i) => {
      const c = tones({ c: ['#c8763a', '#4a7ad0'][i] }), y = h - 9;
      R(ctx, c.dk2, sx - 10, y, 21, 9); R(ctx, c.c, sx - 9, y, 19, 7); R(ctx, c.hi, sx - 8, y, 7, 2); R(ctx, c.dk, sx - 9, y + 6, 19, 2);
      R(ctx, 'rgba(16,10,24,0.3)', sx - 9, h - 1, 19, 1);
    });
    return;
  }
  const SOFA = tones(it);
  const y = h - 12;
  R(ctx, SOFA.dk2, 4, y, w - 8, 12); R(ctx, SOFA.c, 5, y, w - 10, 6); R(ctx, SOFA.hi, 5, y, w - 10, 1);
  R(ctx, SOFA.dk, 5, y + 6, w - 10, 5); R(ctx, SOFA.dk, Math.floor(w / 2), y, 1, 6);
  // подлакътници
  for (const ax of [0, w - 7]) {
    R(ctx, SOFA.dk2, ax, y - 8, 7, 20); R(ctx, SOFA.c, ax + 1, y - 7, 5, 18); R(ctx, SOFA.hi, ax + 1, y - 7, 5, 2);
    R(ctx, SOFA.dk, ax + 1, y + 6, 5, 5);
    if (it.style === 'chesterfield') { R(ctx, SOFA.dk2, ax, y - 8, 1, 1); R(ctx, SOFA.dk2, ax + 6, y - 8, 1, 1); for (let k = 0; k < 4; k++) R(ctx, '#e0b84a', ax + 1 + k + (k > 1 ? 1 : 0), y + 4, 1, 1); }
  }
  R(ctx, '#2a1e18', 3, h - 1, 3, 1); R(ctx, '#2a1e18', w - 6, h - 1, 3, 1);
  // възглавничка
  R(ctx, '#e0b040', w - 15, y - 6, 7, 6); R(ctx, '#f0d070', w - 15, y - 6, 6, 2);
}

/** Дъска за дартс: черен ръб, сектори червено/зелено и черно/кремаво, център. */
function drawDartboard(ctx, w, h) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  R(ctx, 'rgba(16,10,24,0.35)', 2, h - 1, w - 3, 1); // сянка на стената
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > 7.3) continue;
      const odd = Math.floor((Math.atan2(y - cy, x - cx) + Math.PI) / (Math.PI / 5)) % 2;
      const col = d > 6.3 ? '#2a2026' : d > 5.2 ? (odd ? '#c84848' : '#3a9a5a') : d > 2.2 ? (odd ? '#2a2428' : '#e8dcc0') : d > 1.1 ? '#3a9a5a' : '#c84848';
      R(ctx, col, x, y, 1, 1);
    }
  }
  R(ctx, '#4a3e44', Math.round(cx), 0, 1, 1); // окачване
}

function drawTable(ctx, w, h) {
  R(ctx, '#4a2e1e', 0, 0, w, 4); R(ctx, '#8a5c3a', 0, 0, w, 3); R(ctx, '#a06e46', 1, 0, w - 2, 1);
  R(ctx, '#4a2e1e', 2, 4, 2, h - 4); R(ctx, '#4a2e1e', w - 4, 4, 2, h - 4);
  // списания и чаша
  R(ctx, '#e8e4dc', 4, -0, 7, 2); R(ctx, '#4a8fe0', 5, 0, 5, 1);
}

function drawFloorLamp(ctx, w, h) {
  R(ctx, '#2a2a36', 2, h - 2, 7, 2);
  R(ctx, '#4a4a5a', 5, 10, 1, h - 12);
  R(ctx, '#c8a060', 1, 2, 9, 9); R(ctx, '#e8c890', 2, 3, 7, 7); R(ctx, '#f8e4b0', 3, 3, 3, 6);
  R(ctx, '#a07840', 1, 10, 9, 1);
}

// дъгова лампа: стойка вляво, дъга над дивана, абажур вдясно (ARC_LAMP.bulb = къде свети)
const ARC_LAMP = { w: 30, h: 42, bulb: [25, 15] };
function drawArcLamp(ctx, w, h) {
  R(ctx, '#2a2a36', 0, h - 3, 9, 3); R(ctx, '#4a4a5a', 1, h - 3, 7, 1);
  R(ctx, '#3a3a48', 4, 12, 1, h - 15);
  const pts = [[4, 12], [5, 8], [7, 5], [10, 3], [14, 2], [18, 3], [21, 5], [23, 7], [24, 9]];
  for (let i = 1; i < pts.length; i++) pixLine(ctx, '#3a3a48', pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  R(ctx, '#2a2a36', 20, 10, 10, 2); R(ctx, '#d8d4cc', 21, 10, 8, 4); R(ctx, '#f4f1ea', 22, 10, 4, 1); R(ctx, '#a8a090', 21, 13, 8, 1);
  R(ctx, '#fff4c8', 24, 14, 2, 1);
}

function drawDoorClosed(ctx, d) {
  const x = d.x, y = d.y;
  R(ctx, '#2a2030', x - 2, y - 2, d.w + 4, d.h + 2);
  R(ctx, '#e2dccb', x - 1, y - 1, d.w + 2, d.h + 1);
  drawDoorPanel(ctx, x, y, d.w, d.h);
  // табела "изход"
  R(ctx, '#1e3a24', x + 6, y - 9, 12, 6); R(ctx, '#4ac26b', x + 7, y - 8, 10, 4);
  R(ctx, '#e8ffe8', x + 9, y - 7, 5, 1); R(ctx, '#e8ffe8', x + 12, y - 8, 1, 3); R(ctx, '#e8ffe8', x + 13, y - 7, 1, 1);
}
export function drawDoorPanel(ctx, x, y, w, h) {
  R(ctx, '#7a4e30', x, y, w, h); R(ctx, '#8e5e3c', x + 1, y + 1, w - 2, h - 1);
  R(ctx, '#7a4e30', x + 3, y + 4, w - 6, 12); R(ctx, '#a8d4f0', x + 4, y + 5, w - 8, 10); R(ctx, '#d8f0ff', x + 4, y + 5, 3, 4);
  R(ctx, '#7a4e30', x + 3, y + 20, w - 6, h - 24); R(ctx, '#966440', x + 4, y + 21, w - 8, h - 26);
  R(ctx, '#e0c060', x + w - 5, y + Math.floor(h / 2) + 1, 2, 2);
}

function drawWindowFrame(ctx, x, y, w, h) {
  const F = ENV.frame, FD = ENV.frameDk;
  R(ctx, '#2a2a40', x - 2, y - 2, w + 4, h + 4);        // сянка/отвор
  R(ctx, FD, x - 1, y - 1, w + 2, h + 2);
  R(ctx, F, x - 1, y - 1, w + 1, 2); R(ctx, F, x - 1, y - 1, 2, h + 1);
  ctx.clearRect(x + 1, y + 1, w - 2, h - 2);            // стъклото е прозрачно – небето се рисува отдолу
  const mx = x + Math.floor(w / 2);
  R(ctx, FD, mx - 1, y + 1, 2, h - 2); R(ctx, F, mx - 1, y + 1, 1, h - 2);
  R(ctx, FD, x + 1, y + Math.floor(h / 2) - 1, w - 2, 2); R(ctx, F, x + 1, y + Math.floor(h / 2) - 1, w - 2, 1);
  // перваз
  R(ctx, FD, x - 4, y + h + 1, w + 8, 3); R(ctx, F, x - 4, y + h + 1, w + 8, 1);
  R(ctx, 'rgba(20,14,30,0.35)', x - 3, y + h + 4, w + 6, 2);
  // отблясък по стъклото
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 3 + i, y + 9 - i, 1, 1);
  for (let i = 0; i < 4; i++) ctx.fillRect(mx + 3 + i, y + h - 4 - i, 1, 1);
}

// постери от комплектите в магазина (вътрешна площ 12x16)
const POSTERS = {
  planet(ctx, x, y) {
    R(ctx, '#141838', x, y, 12, 16);
    for (const [sx, sy] of [[1, 1], [10, 3], [2, 13], [9, 14], [6, 1]]) R(ctx, '#f0f0ff', x + sx, y + sy, 1, 1);
    R(ctx, '#e07a4a', x + 3, y + 5, 6, 6); R(ctx, '#e07a4a', x + 2, y + 6, 8, 4); R(ctx, '#f0a070', x + 3, y + 6, 3, 2); R(ctx, '#a84a2a', x + 6, y + 9, 3, 1);
    R(ctx, '#f0d070', x + 1, y + 8, 10, 1); R(ctx, '#c8a040', x, y + 9, 2, 1); R(ctx, '#c8a040', x + 10, y + 7, 2, 1); // пръстен
  },
  galaxy(ctx, x, y) {
    R(ctx, '#0e0a24', x, y, 12, 16);
    const pts = [[6, 8, '#ffffff'], [5, 7, '#e0c0ff'], [7, 9, '#e0c0ff'], [4, 6, '#a06ae0'], [8, 10, '#a06ae0'], [3, 7, '#6a4ab0'], [9, 9, '#6a4ab0'], [7, 5, '#a06ae0'], [5, 11, '#a06ae0'], [9, 5, '#6a4ab0'], [3, 11, '#6a4ab0'], [10, 6, '#4a3a8a'], [2, 10, '#4a3a8a']];
    for (const [px, py, c] of pts) R(ctx, c, x + px, y + py, 1, 1);
    for (const [sx, sy] of [[1, 2], [10, 1], [1, 14], [10, 14]]) R(ctx, '#f0f0ff', x + sx, y + sy, 1, 1);
  },
  sunset(ctx, x, y) {
    ['#f0a040', '#f08a50', '#e06a5a', '#b04a6a'].forEach((c, i) => R(ctx, c, x, y + i * 2, 12, 2));
    R(ctx, '#f8e070', x + 4, y + 6, 4, 2); R(ctx, '#f8e070', x + 3, y + 7, 6, 1);
    R(ctx, '#3a5a9a', x, y + 8, 12, 4); R(ctx, '#f8c070', x + 4, y + 9, 4, 1); R(ctx, '#f8c070', x + 5, y + 11, 2, 1);
    R(ctx, '#2a1e30', x, y + 12, 12, 4);
  },
  tree(ctx, x, y) {
    R(ctx, '#d8ecf8', x, y, 12, 16); R(ctx, '#7ac06a', x, y + 13, 12, 3);
    R(ctx, '#6a4630', x + 5, y + 8, 2, 6);
    R(ctx, '#3e8a46', x + 2, y + 2, 8, 7); R(ctx, '#3e8a46', x + 1, y + 4, 10, 4); R(ctx, '#5ab05a', x + 3, y + 3, 4, 3); R(ctx, '#e05a5a', x + 7, y + 5, 1, 1); R(ctx, '#e05a5a', x + 3, y + 7, 1, 1);
  },
  wave(ctx, x, y) {
    R(ctx, '#f4ead8', x, y, 12, 16);
    R(ctx, '#2a5a9a', x, y + 9, 12, 7); R(ctx, '#2a5a9a', x + 2, y + 5, 5, 4); R(ctx, '#2a5a9a', x + 5, y + 3, 4, 3);
    R(ctx, '#4a8ad0', x + 3, y + 6, 3, 3); R(ctx, '#ffffff', x + 7, y + 3, 2, 1); R(ctx, '#ffffff', x + 8, y + 4, 2, 1); R(ctx, '#ffffff', x + 1, y + 9, 3, 1);
    R(ctx, '#e05a4a', x + 9, y + 1, 2, 2);
  },
  brackets(ctx, x, y) {
    R(ctx, '#20242e', x, y, 12, 16);
    drawText(ctx, '{}', x + 2, y + 3, '#e5c07b'); drawText(ctx, '</>', x, y + 9, '#61afef');
  },
  terminal(ctx, x, y) {
    R(ctx, '#101410', x, y, 12, 16); R(ctx, '#3a3e4a', x, y, 12, 2); R(ctx, '#e05a5a', x + 1, y, 1, 1); R(ctx, '#f0c04a', x + 3, y, 1, 1); R(ctx, '#4ac26b', x + 5, y, 1, 1);
    drawText(ctx, '>', x + 1, y + 4, '#4ac26b'); R(ctx, '#4ac26b', x + 5, y + 5, 5, 1); R(ctx, '#4ac26b', x + 1, y + 10, 7, 1); R(ctx, '#98c379', x + 1, y + 12, 3, 2);
  },
  bug(ctx, x, y) {
    R(ctx, '#f4f1e8', x, y, 12, 16);
    R(ctx, '#2a2030', x + 4, y + 3, 4, 2); R(ctx, '#c84a4a', x + 3, y + 5, 6, 7); R(ctx, '#2a2030', x + 6, y + 5, 1, 7);
    R(ctx, '#2a2030', x + 4, y + 7, 1, 1); R(ctx, '#2a2030', x + 7, y + 9, 1, 1);
    for (const ly of [6, 8, 10]) { R(ctx, '#2a2030', x + 1, y + ly, 2, 1); R(ctx, '#2a2030', x + 9, y + ly, 2, 1); }
    R(ctx, '#4ac26b', x + 2, y + 13, 8, 1);
  },
};

function drawPoster(ctx, x, y, kind) {
  R(ctx, '#2a2030', x, y, 16, 20); R(ctx, '#e8e4dc', x + 1, y + 1, 14, 18);
  const ix = x + 2, iy = y + 2;
  if (POSTERS[kind]) { POSTERS[kind](ctx, ix, iy); return; }
  if (kind === 'mountain') { // планина
    R(ctx, '#7ab8f0', ix, iy, 12, 10); R(ctx, '#f8e070', ix + 8, iy + 2, 2, 2);
    for (let i = 0; i < 6; i++) R(ctx, '#5a6a8a', ix + 1 + i, iy + 9 - i, 11 - 2 * i > 0 ? 12 - 2 * i : 1, 1);
    R(ctx, '#e8f0ff', ix + 5, iy + 4, 2, 1);
    R(ctx, '#3e8a46', ix, iy + 10, 12, 2);
    R(ctx, '#c84a4a', ix + 2, iy + 13, 8, 1); R(ctx, '#a8a090', ix + 2, iy + 15, 6, 1);
  } else if (kind === 'rocket') { // ракета
    R(ctx, '#1e2244', ix, iy, 12, 16);
    for (const [sx, sy] of [[1, 2], [9, 1], [3, 10], [10, 12], [6, 5]]) R(ctx, '#f0f0ff', ix + sx, iy + sy, 1, 1);
    R(ctx, '#e8e4dc', ix + 5, iy + 3, 3, 7); R(ctx, '#c84a4a', ix + 5, iy + 2, 3, 1); R(ctx, '#c84a4a', ix + 6, iy + 1, 1, 1);
    R(ctx, '#4a8fe0', ix + 6, iy + 5, 1, 1); R(ctx, '#c84a4a', ix + 4, iy + 8, 1, 2); R(ctx, '#c84a4a', ix + 8, iy + 8, 1, 2);
    R(ctx, '#f0b040', ix + 5, iy + 10, 3, 2); R(ctx, '#f07a30', ix + 6, iy + 12, 1, 2);
  } else { // графика
    R(ctx, '#f4f1e8', ix, iy, 12, 16);
    const hs = [4, 7, 5, 10, 12];
    hs.forEach((hh, i) => R(ctx, SYNTAX[i], ix + 1 + i * 2, iy + 14 - hh, 2, hh));
    R(ctx, '#2a2030', ix, iy + 14, 12, 1);
  }
}

function drawWhiteboardFrame(ctx, b) {
  R(ctx, '#2a2030', b.x - 1, b.y - 1, b.w + 2, b.h + 2);
  R(ctx, '#b8bcc8', b.x, b.y, b.w, b.h);
  R(ctx, '#f4f6f8', b.x + 1, b.y + 1, b.w - 2, b.h - 2);
  R(ctx, '#e4e8ee', b.x + 1, b.y + b.h - 4, b.w - 2, 3);
  // поставка с маркери
  R(ctx, '#9aa0b4', b.x + 4, b.y + b.h, b.w - 8, 2);
  R(ctx, '#c84a4a', b.x + 8, b.y + b.h - 1, 4, 1); R(ctx, '#4a7ad0', b.x + 14, b.y + b.h - 1, 4, 1); R(ctx, '#2a2a36', b.x + 20, b.y + b.h - 1, 5, 1);
  // разделители на колоните
  const cw = Math.floor((b.w - 2) / 3);
  for (let i = 1; i < 3; i++) R(ctx, '#c8ccd8', b.x + 1 + i * cw, b.y + 3, 1, b.h - 7);
}

function drawClockFace(ctx, c) {
  ctx.fillStyle = '#2a2030';
  circle(ctx, c.x, c.y, c.r + 1);
  ctx.fillStyle = '#f4f1e8';
  circle(ctx, c.x, c.y, c.r);
  ctx.fillStyle = '#7a7a8a';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillRect(Math.round(c.x + Math.sin(a) * (c.r - 1)), Math.round(c.y - Math.cos(a) * (c.r - 1)), 1, 1);
  }
}
function circle(ctx, cx, cy, r) {
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
    ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}

// =====================================================================
// Под и килими (стилове от магазина)
// =====================================================================
function drawCheckerFloor(g, fl, y0, W, H) {
  const T = 10;
  for (let y = y0; y < H; y += T) for (let x = 0; x < W; x += T) {
    const c = ((x + y - y0) / T) % 2 ? fl.b : fl.a;
    R(g, c, x, y, T, T); R(g, mix(c, '#ffffff', 0.12), x, y, T, 1); R(g, mix(c, fl.seam, 0.5), x, y + T - 1, T, 1);
  }
}
function drawConcreteFloor(g, fl, y0, W, H, r) {
  R(g, fl.base, 0, y0, W, H - y0);
  for (let i = 0; i < (W * (H - y0)) / 60; i++) R(g, r() < 0.5 ? fl.dk : fl.hi, r.int(W), y0 + r.int(H - y0), 1 + r.int(3), 1);
  for (let x = 0; x < W; x += 64) R(g, fl.seam, x, y0, 1, H - y0);
  for (let y = y0 + 40; y < H; y += 48) R(g, fl.seam, 0, y, W, 1);
}
function fringe(g, rug) {
  for (let x = rug.x + 2; x < rug.x + rug.w - 2; x += 3) { R(g, '#c8b48a', x, rug.y - 1, 1, 1); R(g, '#c8b48a', x, rug.y + rug.h, 1, 1); }
}
function drawRug(g, rug, it) {
  const c = it.c;
  if (it.style === 'round') {
    const cx = rug.x + rug.w / 2, cy = rug.y + rug.h / 2;
    const ell = (rx, ry, col) => { g.fillStyle = col; for (let y = -ry; y < ry; y++) { const hw = Math.round(rx * Math.sqrt(1 - ((y + 0.5) / ry) ** 2)); g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1); } };
    const rx = Math.floor(rug.w / 2), ry = Math.floor(rug.h / 2);
    ell(rx, ry, c[0]); ell(rx - 3, ry - 2, c[1]); ell(rx - 8, ry - 6, c[2]); ell(rx - 10, ry - 8, c[1]);
    ell(Math.floor(rx / 2), Math.floor(ry / 2), c[0]); ell(Math.floor(rx / 2) - 3, Math.floor(ry / 2) - 2, c[1]);
    return;
  }
  if (it.style === 'stripes') {
    R(g, c[0], rug.x, rug.y, rug.w, rug.h);
    R(g, mix(c[0], '#ffffff', 0.08), rug.x + 3, rug.y + 3, rug.w - 6, rug.h - 6);
    // тънки цветни ивици през 10 px
    for (let y = rug.y + 7, i = 0; y < rug.y + rug.h - 6; y += 10, i++) R(g, c[1 + (i % 3)], rug.x + 3, y, rug.w - 6, 2);
    fringe(g, rug);
    return;
  }
  if (it.style === 'persian') {
    const [dk, red, gold, blue] = c;
    R(g, dk, rug.x, rug.y, rug.w, rug.h);
    R(g, gold, rug.x + 2, rug.y + 2, rug.w - 4, rug.h - 4);
    R(g, blue, rug.x + 4, rug.y + 4, rug.w - 8, rug.h - 8);
    R(g, red, rug.x + 7, rug.y + 7, rug.w - 14, rug.h - 14);
    // орнамент по бордюра
    g.fillStyle = gold;
    for (let x = rug.x + 6; x < rug.x + rug.w - 6; x += 4) { g.fillRect(x, rug.y + 5, 2, 1); g.fillRect(x, rug.y + rug.h - 6, 2, 1); }
    for (let y = rug.y + 6; y < rug.y + rug.h - 6; y += 4) { g.fillRect(rug.x + 5, y, 1, 2); g.fillRect(rug.x + rug.w - 6, y, 1, 2); }
    // медальон в средата (ромб) и в ъглите
    const cx = Math.round(rug.x + rug.w / 2), cy = Math.round(rug.y + rug.h / 2), mr = Math.min(18, Math.floor(rug.h / 3));
    for (let k = mr; k > 0; k -= 3) {
      g.fillStyle = [gold, blue, dk][(mr - k) / 3 % 3];
      for (let y = -k; y <= k; y++) { const hw = Math.round((k - Math.abs(y)) * 1.6); g.fillRect(cx - hw, cy + y, hw * 2 + 1, 1); }
    }
    g.fillStyle = gold;
    for (const [qx, qy] of [[rug.x + 12, rug.y + 12], [rug.x + rug.w - 14, rug.y + 12], [rug.x + 12, rug.y + rug.h - 14], [rug.x + rug.w - 14, rug.y + rug.h - 14]]) { g.fillRect(qx, qy - 1, 2, 4); g.fillRect(qx - 1, qy, 4, 2); }
    g.fillStyle = shade(red, 0.85);
    for (let x = rug.x + 10; x < rug.x + rug.w - 10; x += 6) for (let y = rug.y + 10; y < rug.y + rug.h - 10; y += 6) if (((x + y) / 6) % 2 === 0) g.fillRect(x, y, 1, 1);
    fringe(g, rug);
    return;
  }
  // plain (по подразбиране)
  const [c0, c1, c2] = c;
  R(g, c0, rug.x, rug.y, rug.w, rug.h);
  R(g, c1, rug.x + 2, rug.y + 2, rug.w - 4, rug.h - 4);
  R(g, c2, rug.x + 4, rug.y + 4, rug.w - 8, rug.h - 8);
  g.fillStyle = c1;
  for (let x = rug.x + 6; x < rug.x + rug.w - 6; x += 6) for (let y = rug.y + 6; y < rug.y + rug.h - 6; y += 6) if (((x + y) / 6) % 2 === 0) g.fillRect(x, y, 1, 1);
  fringe(g, rug);
}
function drawLoungeRug(g, lr, it, r) {
  if (it.style === 'boho') {
    R(g, '#c8a878', lr.x, lr.y, lr.w, lr.h); R(g, '#e8d8b8', lr.x + 2, lr.y + 2, lr.w - 4, lr.h - 4);
    for (let x = lr.x + 4; x < lr.x + lr.w - 4; x++) {
      const k = (x - lr.x) % 8, zz = k < 4 ? k : 8 - k;
      R(g, '#c8603a', x, lr.y + 5 + zz, 1, 2); R(g, '#3a7a8a', x, lr.y + lr.h - 9 - zz, 1, 2);
    }
    for (let x = lr.x + 8; x < lr.x + lr.w - 8; x += 8) R(g, '#e0b040', x, lr.y + Math.floor(lr.h / 2) - 1, 3, 3);
    for (let y = lr.y + 1; y < lr.y + lr.h - 1; y += 2) { R(g, '#e8d8b8', lr.x - 2, y, 2, 1); R(g, '#e8d8b8', lr.x + lr.w, y, 2, 1); } // ресни
    return;
  }
  if (it.style === 'fluffy') {
    const cx = lr.x + lr.w / 2, cy = lr.y + lr.h / 2, rx = lr.w / 2, ry = lr.h / 2;
    for (let y = -ry; y < ry; y++) {
      const hw = Math.round(rx * Math.sqrt(1 - ((y + 0.5) / ry) ** 2));
      R(g, '#cfcac0', Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
      R(g, '#ece8e0', Math.round(cx - hw + 2), Math.round(cy + y), Math.max(0, hw * 2 - 4), 1);
    }
    for (let i = 0; i < (lr.w * lr.h) / 14; i++) {
      const x = cx + (r() - 0.5) * (rx * 1.6), y = cy + (r() - 0.5) * (ry * 1.5);
      R(g, r() < 0.6 ? '#f8f6f0' : '#d8d4cc', Math.round(x), Math.round(y), 1 + r.int(2), 1);
    }
    return;
  }
  R(g, '#6a2e34', lr.x, lr.y, lr.w, lr.h); R(g, '#8a3e40', lr.x + 2, lr.y + 2, lr.w - 4, lr.h - 4);
  R(g, '#a85a4a', lr.x + 4, lr.y + 4, lr.w - 8, lr.h - 8); R(g, '#8a3e40', lr.x + 6, lr.y + 6, lr.w - 12, lr.h - 12);
  for (let x = lr.x + 8; x < lr.x + lr.w - 8; x += 4) R(g, '#e0b070', x, lr.y + Math.floor(lr.h / 2), 2, 1);
}

// =====================================================================
// Специални предмети: аквариум, аркадна машина, неонов надпис
// =====================================================================
const AQUA = { w: 28, h: 36, tank: { x: 1, y: 2, w: 26, h: 20 } };
function drawAquarium(ctx) {
  const { w, h, tank: t } = AQUA;
  R(ctx, '#3a2a20', 2, t.y + t.h, w - 4, h - t.y - t.h); R(ctx, '#5a3e2c', 3, t.y + t.h + 1, w - 6, h - t.y - t.h - 2);   // шкафче
  R(ctx, '#3a2a20', Math.floor(w / 2), t.y + t.h + 2, 1, h - t.y - t.h - 3); R(ctx, '#e0c060', Math.floor(w / 2) - 3, t.y + t.h + 6, 2, 1); R(ctx, '#e0c060', Math.floor(w / 2) + 2, t.y + t.h + 6, 2, 1);
  R(ctx, '#2a2a36', t.x - 1, t.y - 2, t.w + 2, t.h + 2); R(ctx, '#3a3a48', t.x - 1, t.y - 2, t.w + 2, 2);           // рамка и капак
  R(ctx, '#2e7ab0', t.x, t.y, t.w, t.h);
  R(ctx, '#3a8ac0', t.x, t.y, t.w, 6); R(ctx, '#7ac8f0', t.x, t.y, t.w, 1);
  R(ctx, '#d8c08a', t.x, t.y + t.h - 3, t.w, 3); R(ctx, '#b8a070', t.x + 4, t.y + t.h - 2, 6, 1);              // пясък
  R(ctx, '#6a6a7a', t.x + 15, t.y + t.h - 6, 6, 3); R(ctx, '#8a8a9a', t.x + 16, t.y + t.h - 6, 3, 1);           // камък
  for (const [px, ph] of [[3, 9], [6, 12], [22, 8]]) for (let k = 0; k < ph; k++) R(ctx, k % 2 ? '#3e9a52' : '#5ab05a', t.x + px + (k % 4 < 2 ? 0 : 1), t.y + t.h - 3 - k, 1, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(t.x + 1, t.y + 2, 1, t.h - 6);
}
/** Рибките (динамично, над картинката на аквариума). */
export function drawAquariumFish(ctx, aq, t) {
  const tk = AQUA.tank, x0 = aq.x + tk.x, y0 = aq.y + tk.y;
  const fish = [['#f07a30', 0.9, 6, 0], ['#f0d040', 1.3, 10, 2.1], ['#e05a8a', 0.7, 13, 4.2]];
  for (const [c, v, fy, ph] of fish) {
    const k = (Math.sin(t / 1000 * v + ph) + 1) / 2, dir = Math.cos(t / 1000 * v + ph) > 0 ? 1 : -1;
    const x = Math.round(x0 + 3 + k * (tk.w - 9)), y = Math.round(y0 + fy + Math.sin(t / 400 + ph) * 1);
    R(ctx, c, x, y, 3, 2); R(ctx, shade(c, 0.75), dir > 0 ? x - 1 : x + 3, y, 1, 2); R(ctx, '#1d1626', dir > 0 ? x + 2 : x, y, 1, 1);
  }
  // мехурчета
  const b = (t / 60) % (tk.h - 4);
  R(ctx, 'rgba(220,240,255,0.8)', x0 + 19, Math.round(y0 + tk.h - 5 - b), 1, 1);
  R(ctx, 'rgba(220,240,255,0.6)', x0 + 20, Math.round(y0 + tk.h - 5 - ((b + 7) % (tk.h - 4))), 1, 1);
}
const ARCADE = { w: 18, h: 36, screen: { x: 4, y: 8, w: 10, h: 8 } };
function drawArcade(ctx) {
  const { w, h, screen: s } = ARCADE;
  R(ctx, '#1e1430', 1, 0, w - 2, h); R(ctx, '#5a2e8a', 2, 1, w - 4, h - 2); R(ctx, '#7a4ab0', 2, 1, 2, h - 2);
  R(ctx, '#f0d040', 3, 2, w - 6, 4); R(ctx, '#e05a5a', 5, 3, w - 10, 2);             // табела
  R(ctx, '#0a0a12', s.x - 1, s.y - 1, s.w + 2, s.h + 2); R(ctx, '#101830', s.x, s.y, s.w, s.h);
  R(ctx, '#2a1e40', 1, s.y + s.h + 2, w - 2, 5); R(ctx, '#3a2a58', 2, s.y + s.h + 2, w - 4, 1);    // панел
  R(ctx, '#1d1626', 5, s.y + s.h + 3, 1, 2); R(ctx, '#e04a4a', 4, s.y + s.h + 2, 3, 1);           // джойстик
  R(ctx, '#4ac26b', 10, s.y + s.h + 4, 2, 1); R(ctx, '#4a8fe0', 13, s.y + s.h + 4, 2, 1);
  R(ctx, '#1e1430', 3, h - 10, w - 6, 6); R(ctx, '#e0c060', 7, h - 8, 4, 2);                    // монетник
}
/** Екранът на аркадата: малка игра (динамично). */
export function drawArcadeScreen(ctx, ar, t) {
  const s = ARCADE.screen, x0 = ar.x + s.x, y0 = ar.y + s.y;
  const k = Math.floor(t / 180);
  for (let i = 0; i < 4; i++) R(ctx, ['#e04a6b', '#4ac26b', '#e0c24a', '#4a8fe0'][i], x0 + 1 + i * 2 + (k % 2), y0 + 1, 1, 1);
  const px = x0 + 1 + (Math.floor(t / 300) % (s.w - 3));
  R(ctx, '#ffffff', px, y0 + s.h - 2, 3, 1);
  R(ctx, '#f0d040', x0 + ((k * 3) % (s.w - 1)), y0 + 2 + (k % (s.h - 4)), 1, 1);
}
function drawNeon(g, x, y, c) {
  R(g, '#1a1420', x, y, 22, 11); R(g, '#241c2c', x + 1, y + 1, 20, 9);
  drawText(g, '</>', x + 6, y + 3, c);
  R(g, shade(c, 0.6), x + 2, y + 9, 18, 1);
}

/** Височини на силуета зад прозорците (град, планини; при море – не се ползва). */
function skylineFor(view, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (view === 'mountains') out.push(Math.round(7 + 4 * Math.sin(i / 23) + 3 * Math.sin(i / 9 + 1.3) + 1.5 * Math.sin(i / 4.1))); // два реда върхове
    else if (view === 'sea') out.push(4);
    else out.push(3 + (hashStr('b' + Math.floor(i / 5)) % 6));
  }
  return out;
}

// =====================================================================
// Стаята
// =====================================================================
export function buildRoom(L, seed = 1, decor = DEFAULT_DECOR) {
  const { W, H } = L;
  const WH = CFG.WALL_H;
  const r = rng(seed);
  const bg = makeCanvas(W, H);
  const g = bg.getContext('2d');

  // ---------- под ----------
  const fl = decor.floor;
  const floorTile = patternTile(variant('floor', fl) ? `floor@${fl.id}` : 'floor');
  if (floorTile) {
    g.fillStyle = g.createPattern(floorTile, 'repeat'); g.fillRect(0, WH, W, H - WH);
  } else if (fl.style === 'checker') drawCheckerFloor(g, fl, WH, W, H);
  else if (fl.style === 'concrete') drawConcreteFloor(g, fl, WH, W, H, rng(seed + 101));
  else {
    const PH = 6;
    for (let y = WH; y < H; y += PH) {
      let x = -r.int(40);
      while (x < W) {
        const len = 22 + r.int(34);
        const c = r.pick(fl.planks);
        R(g, c, x, y, len, PH);
        R(g, fl.seam, x, y + PH - 1, len, 1);
        R(g, fl.seam, x, y, 1, PH - 1);
        R(g, mix(c, fl.hi, 0.5), x + 1, y, len - 2, 1);
        for (let k = 0; k < 3; k++) if (r() < 0.7) R(g, fl.grain, x + 2 + r.int(Math.max(1, len - 8)), y + 1 + r.int(PH - 3), 2 + r.int(5), 1);
        if (r() < 0.06) R(g, fl.seam, x + 3 + r.int(Math.max(1, len - 6)), y + 2, 1, 1); // чепове
        x += len;
      }
    }
  }
  // сянка до стената и по ъглите
  const ao = g.createLinearGradient(0, WH, 0, WH + 14);
  ao.addColorStop(0, 'rgba(16,10,24,0.45)'); ao.addColorStop(1, 'rgba(16,10,24,0)');
  g.fillStyle = ao; g.fillRect(0, WH, W, 14);
  const vg = g.createLinearGradient(0, H - 30, 0, H);
  vg.addColorStop(0, 'rgba(16,10,24,0)'); vg.addColorStop(1, 'rgba(16,10,24,0.25)');
  g.fillStyle = vg; g.fillRect(0, H - 30, W, 30);

  // ---------- килими ----------
  L.rugs.forEach((rug, ti) => {
    if (rug.w <= 0 || rug.h <= 0) return;
    drawRug(g, rug, decor[`rug.team${ti ? 1 : 0}`]);
  });
  drawLoungeRug(g, L.lounge.rug, decor['rug.lounge'], rng(seed + 202));

  // ---------- сенки на мебелите ----------
  const sh = (x, y, w, h) => { g.fillStyle = ENV.shadow; g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2); };
  for (const p of L.pods) { sh(p.x + 7, p.y + 49, 60, 4); sh(p.x + 16, p.y + 30, 22, 3); }
  const lo = L.lounge;
  sh(lo.bookshelf.x - 1, lo.bookshelf.base - 2, lo.bookshelf.w + 3, 4);
  sh(lo.counter.x - 1, lo.counter.base - 2, lo.counter.w + 3, 4);
  sh(lo.cooler.x, lo.cooler.base - 2, lo.cooler.w + 2, 3);
  sh(lo.sofa.x + 1, lo.sofa.base - 3, lo.sofa.w, 5);
  sh(lo.table.x, lo.table.base - 1, lo.table.w + 2, 3);

  // ---------- стена ----------
  const wallTile = !variant('wall', decor.wall) && !variant('wainscot', decor.wainscot) && patternTile('wall');
  if (wallTile) { g.fillStyle = g.createPattern(wallTile, 'repeat'); g.fillRect(0, 0, W, WH); }
  else {
    const Wc = wallTones(decor.wall), Ws = decor.wainscot;
    R(g, Wc.wall, 0, 0, W, WH);
    for (let x = 0; x < W; x += 8) R(g, Wc.stripe, x, 4, 3, 34);
    R(g, Wc.ceiling, 0, 0, W, 3); R(g, Wc.dark, 0, 3, W, 1);
    const wy = 38;
    R(g, Ws.rail, 0, wy, W, 2); R(g, Wc.dark, 0, wy + 2, W, 1);
    R(g, Ws.panel, 0, wy + 3, W, WH - wy - 7);
    const line = shade(Ws.panel, 0.78);
    for (let x = 4; x < W; x += 20) { R(g, Ws.hi, x, wy + 5, 16, 1); R(g, Ws.hi, x, wy + 5, 1, WH - wy - 11); R(g, Ws.id === 'wainscot.dark' ? Wc.dark : line, x + 1, WH - 7, 15, 1); R(g, Ws.id === 'wainscot.dark' ? Wc.dark : line, x + 15, wy + 6, 1, WH - wy - 12); }
    R(g, Ws.base, 0, WH - 4, W, 4); R(g, Ws.baseHi, 0, WH - 4, W, 1);
  }

  // ---------- врата ----------
  drawDoorClosed(g, L.door);

  // ---------- елементи по стената ----------
  const ax0 = L.deskArea.x0, ax1 = L.deskArea.x1;
  let cursor = ax0 + 4;
  let board = null;
  if (ax1 - ax0 >= 150) {
    board = { x: cursor, y: 9, w: 68, h: 30 };
    cursor += board.w + 12;
  }
  const windows = [];
  const posters = [];
  const WW = 34, WHH = 26, GAP = 16;
  const span = ax1 - 6 - cursor - (lo.darts.w + 10); // място за дъската за дартс
  const nWin = Math.max(1, Math.floor((span + GAP) / (WW + GAP)));
  const free = span - nWin * WW;
  const gap = nWin > 1 ? free / (nWin - 1) : 0;
  for (let i = 0; i < nWin; i++) {
    const x = Math.round(nWin > 1 ? cursor + i * (WW + gap) : cursor + free / 2);
    windows.push({ x, y: 7, w: WW, h: WHH });
    if (i < nWin - 1 && gap >= 22 && i % 2 === 0) posters.push({ x: Math.round(x + WW + gap / 2 - 8), y: 12, kind: decor.posters.kinds[posters.length % 3] });
  }
  for (const w of windows) drawWindowFrame(g, w.x, w.y, w.w, w.h);
  for (const p of posters) drawPoster(g, p.x, p.y, p.kind);
  if (board) drawWhiteboardFrame(g, board);
  const dt = lo.darts;
  g.drawImage(prop('dartboard', dt.w, dt.h, (c) => drawDartboard(c, dt.w, dt.h)), dt.x, dt.y);
  // стената в зоната за почивка: часовник над кафемашината и постер над диспенсъра
  const clock = { x: lo.counter.x + 22, y: 20, r: 7 };
  drawClockFace(g, clock);
  drawPoster(g, lo.cooler.x - 1, 10, decor.posters.kinds[1 + (posters.length % 2)]);
  if (decor.neon) drawNeon(g, lo.x + lo.w - 26, 12, decor.neon.c);

  // ---------- мебели като отделни обекти (сортират се по дълбочина) ----------
  const objects = [];
  const add = (img, x, base, key = base) => objects.push({ img, x: Math.round(x), y: Math.round(base - img.height), key });
  const bs = lo.bookshelf;
  add(prop('bookshelf', bs.w, bs.h, (c) => drawBookshelf(c, bs.w, bs.h)), bs.x, bs.base);
  const ct = lo.counter;
  add(prop('counter', ct.w, ct.h + 22, (c) => drawCounter(c, ct.w, ct.h + 22, !!decor.espresso), variant('espresso', decor.espresso)), ct.x, ct.base);
  const cl = lo.cooler;
  add(prop('cooler', cl.w, cl.h, (c) => drawCooler(c, cl.w, cl.h)), cl.x, cl.base);
  const pl = decor.plants, pv = variant('plants', pl);
  const bigPlant = () => prop('plant_big', 28, 36, (c) => drawPlant(c, 28, 36, true, pl.style), pv);
  // аквариумът заема мястото на голямото растение до диспенсъра, аркадата – на това в ъгъла
  let aquarium = null, arcade = null;
  if (decor.aquarium) {
    const img = prop('aquarium', AQUA.w, AQUA.h, drawAquarium);
    aquarium = { x: Math.round(lo.tallPlant.x - AQUA.w / 2), y: lo.tallPlant.base - AQUA.h, key: lo.tallPlant.base };
    add(img, aquarium.x, lo.tallPlant.base);
  } else add(bigPlant(), lo.tallPlant.x - 14, lo.tallPlant.base);
  if (decor.arcade) {
    const img = prop('arcade', ARCADE.w, ARCADE.h, drawArcade);
    arcade = { x: Math.round(lo.cornerPlant.x - ARCADE.w / 2), y: lo.cornerPlant.base - ARCADE.h, key: lo.cornerPlant.base };
    add(img, arcade.x, lo.cornerPlant.base);
  } else add(bigPlant(), lo.cornerPlant.x - 14, lo.cornerPlant.base);
  const sf = lo.sofa, so = decor.sofa, sv = variant('sofa', so);
  add(prop('sofa_back', sf.w, 18, (c) => drawSofaBack(c, sf.w, 18, so), sv), sf.x, sf.base - 14, sf.base - 14);
  add(prop('sofa_front', sf.w, 20, (c) => drawSofaFront(c, sf.w, 20, so), sv), sf.x, sf.base, sf.base + 1);
  if (so.style !== 'beanbags') add(prop('table', lo.table.w, lo.table.h, (c) => drawTable(c, lo.table.w, lo.table.h)), lo.table.x, lo.table.base);
  let lampGlow;
  if (decor.lamp.style === 'arc') {
    add(prop('floor_lamp', ARC_LAMP.w, ARC_LAMP.h, (c) => drawArcLamp(c, ARC_LAMP.w, ARC_LAMP.h), decor.lamp.id), lo.floorLamp.x, lo.floorLamp.base);
    lampGlow = { x: lo.floorLamp.x + ARC_LAMP.bulb[0], y: lo.floorLamp.base - ARC_LAMP.h + ARC_LAMP.bulb[1] };
  } else {
    add(prop('floor_lamp', 11, 36, (c) => drawFloorLamp(c, 11, 36)), lo.floorLamp.x, lo.floorLamp.base);
    lampGlow = { x: lo.floorLamp.x + 5, y: lo.floorLamp.base - 30 };
  }
  // растения около бюрата, ако има място
  const smallPlant = prop('plant_small', 16, 20, (c) => drawPlant(c, 16, 20, false, pl.style), pv);
  add(smallPlant, L.door.x + L.door.w + 1, CFG.WALL_H + 4);
  if (H - Math.max(...L.rugs.map((r) => r.y + r.h)) > 26) add(bigPlant(), 4, H - 6);

  // до бюрото на всеки оркестратор: растение отляво и шкаф с принтер отдясно
  for (const p of L.pods) {
    if (p.role !== 'lead') continue;
    add(bigPlant(), p.x - 30, p.y + 48);
    add(prop('printer', 26, 30, (c) => drawPrinter(c, 26, 30)), p.x + CFG.POD_W + 10, p.y + 48);
  }

  // ---------- небе: звезди, облаци, силует на града ----------
  const skyX0 = windows.length ? windows[0].x : 0;
  const skyX1 = windows.length ? windows[windows.length - 1].x + WW : W;
  const stars = [];
  for (const w of windows) for (let i = 0; i < 7; i++) stars.push({ x: w.x + 2 + r.int(w.w - 4), y: w.y + 2 + r.int(w.h - 12), ph: r() * 6.28, big: r() < 0.15 });
  const clouds = [];
  for (let i = 0; i < Math.max(3, windows.length * 1.5); i++) clouds.push({ x: r() * (skyX1 - skyX0 + 60), y: 9 + r.int(10), w: 8 + r.int(10), v: 0.6 + r() * 1.2 });
  const view = decor.window.style;
  const skyline = skylineFor(view, skyX1 - skyX0);

  return {
    W, H, bg, objects, windows, posters, board, clock, door: L.door, layout: L,
    sky: { x0: skyX0, x1: skyX1, stars, clouds, skyline, view },
    lampGlow, aquarium, arcade, neon: decor.neon ? { x: lo.x + lo.w - 15, y: 17, c: decor.neon.c } : null,
    doorOpen: 0,
  };
}

// =====================================================================
// Динамични слоеве
// =====================================================================
export function drawSky(ctx, room, tod, t) {
  const { windows, sky } = room;
  if (!windows.length) return;
  const h = windows[0].h;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(mix(tod.skyTop, tod.skyBottom, y / (h - 1)));
  const span = sky.x1 - sky.x0;
  for (const w of windows) {
    ctx.save();
    ctx.beginPath(); ctx.rect(w.x, w.y, w.w, w.h); ctx.clip();
    for (let y = 0; y < h; y++) R(ctx, rows[y], w.x, w.y + y, w.w, 1);
    // звезди
    if (tod.night > 0.25) {
      for (const s of sky.stars) {
        if (s.x < w.x || s.x >= w.x + w.w) continue;
        const a = (tod.night - 0.25) * 1.3 * (0.55 + 0.45 * Math.sin(t / 700 + s.ph));
        ctx.fillStyle = rgba('#f4f0ff', Math.min(1, a));
        ctx.fillRect(s.x, s.y, 1, 1);
        if (s.big && a > 0.6) { ctx.fillStyle = rgba('#f4f0ff', a * 0.4); ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3); }
      }
    }
    // луна / слънце
    if (tod.moon != null && tod.night > 0.3) {
      const mx = Math.round(sky.x0 + tod.moon * span), my = Math.round(w.y + 5 + Math.abs(tod.moon - 0.5) * 10);
      ctx.fillStyle = rgba('#f0ecd8', 0.15); ctx.fillRect(mx - 4, my - 4, 9, 9);
      R(ctx, '#f0ecd8', mx - 2, my - 3, 5, 7); R(ctx, '#f0ecd8', mx - 3, my - 2, 7, 5);
      R(ctx, '#c8c4b0', mx, my - 1, 2, 2); R(ctx, '#c8c4b0', mx - 2, my + 1, 1, 1);
    }
    if (tod.sun != null && tod.daylight > 0.15) {
      const sx = Math.round(sky.x0 + tod.sun * span);
      const sy = Math.round(w.y + 3 + Math.pow(Math.abs(tod.sun - 0.5) * 2, 2) * 15);
      const sc = mix('#fff6c0', '#ffa860', tod.warm);
      ctx.fillStyle = rgba(sc, 0.25); ctx.fillRect(sx - 5, sy - 5, 11, 11);
      R(ctx, sc, sx - 2, sy - 3, 5, 7); R(ctx, sc, sx - 3, sy - 2, 7, 5);
    }
    // облаци
    const ca = 0.25 + tod.daylight * 0.7;
    const cc = mix(mix('#f8f8ff', '#ffb8a0', tod.warm * 0.8), '#3a3e66', tod.night * 0.8);
    for (const c of sky.clouds) {
      const x = Math.round(sky.x0 - 20 + ((c.x + t / 1000 * c.v) % (span + 40)));
      if (x + c.w < w.x || x > w.x + w.w) continue;
      ctx.fillStyle = rgba(cc, ca);
      ctx.fillRect(x, c.y + 4, c.w, 3); ctx.fillRect(x + 2, c.y + 2, c.w - 5, 2); ctx.fillRect(x + 4, c.y + 1, Math.max(2, c.w - 10), 1);
      ctx.fillStyle = rgba(shade(cc, 0.85), ca); ctx.fillRect(x + 1, c.y + 7, c.w - 2, 1);
    }
    if (sky.view === 'sea') { drawSea(ctx, w, sky, tod, t); ctx.restore(); continue; }
    if (sky.view === 'mountains') { drawMountains(ctx, w, sky, tod); ctx.restore(); continue; }
    // силует на града
    const cityC = mix(tod.skyBottom, '#141428', 0.65);
    for (let x = w.x; x < w.x + w.w; x++) {
      const hh = sky.skyline[x - sky.x0] || 3;
      R(ctx, cityC, x, w.y + w.h - hh, 1, hh);
      if (tod.night > 0.4 && hh > 4 && (x * 7 + hh * 13) % 9 === 0) {
        ctx.fillStyle = rgba('#f8d880', tod.night * (0.6 + 0.4 * Math.sin(t / 3000 + x)));
        ctx.fillRect(x, w.y + w.h - hh + 2, 1, 1);
      }
    }
    ctx.restore();
  }
}

function drawSea(ctx, w, sky, tod, t) {
  const top = w.y + w.h - 8;
  const water = mix(mix('#2a6ab0', '#3a4a8a', tod.warm), '#0c1430', tod.night * 0.85);
  R(ctx, water, w.x, top, w.w, 8);
  R(ctx, mix(water, '#ffffff', 0.25), w.x, top, w.w, 1);
  // отблясъци, които се местят
  const glint = mix('#ffffff', '#ffd8a0', tod.warm);
  for (let i = 0; i < 6; i++) {
    const x = w.x + ((i * 11 + Math.floor(t / 400) * (i % 2 ? 1 : -1)) % w.w + w.w) % w.w, y = top + 2 + (i % 3) * 2;
    ctx.fillStyle = rgba(tod.night > 0.5 ? '#c8d0f0' : glint, 0.35 + 0.3 * Math.sin(t / 300 + i));
    ctx.fillRect(x, y, 2, 1);
  }
  // лодка с платно
  const bx = Math.round(sky.x0 + ((t / 1000 * 1.5) % (sky.x1 - sky.x0 + 20)) - 10);
  if (bx > w.x - 6 && bx < w.x + w.w) {
    const bc = mix('#f4f1e8', '#3a3e66', tod.night * 0.7);
    R(ctx, mix('#6a4630', '#141428', tod.night * 0.6), bx, top - 1, 6, 2); R(ctx, bc, bx + 2, top - 6, 1, 5); R(ctx, bc, bx + 3, top - 5, 2, 4);
  }
}
function drawMountains(ctx, w, sky, tod) {
  const far = mix(mix(tod.skyBottom, '#5a6a9a', 0.5), '#141428', tod.night * 0.6);
  const near = mix(mix(tod.skyBottom, '#2a3a48', 0.75), '#0c0e1c', tod.night * 0.6);
  const snow = mix('#f4f6ff', '#5a6088', tod.night * 0.7);
  for (let x = w.x; x < w.x + w.w; x++) {
    const i = x - sky.x0, hh = sky.skyline[i] || 6;
    const h2 = Math.round(hh + 4 + 3 * Math.sin(i / 7 + 2));
    R(ctx, far, x, w.y + w.h - h2, 1, h2);
    if (h2 > 13) R(ctx, snow, x, w.y + w.h - h2, 1, 1);
    R(ctx, near, x, w.y + w.h - hh, 1, hh);
    if (hh > 11) R(ctx, snow, x, w.y + w.h - hh, 1, Math.min(2, hh - 11));
  }
  R(ctx, mix('#2e5a34', '#0c1410', tod.night * 0.7), w.x, w.y + w.h - 2, w.w, 2);
}

/** Слънчеви снопове от прозорците върху пода (adds light). */
export function drawShafts(ctx, room, tod, t) {
  const a = tod.daylight * 0.16 * (1 - tod.night * 0.5);
  if (a < 0.01) return;
  const color = mix('#fff2c8', '#ffa860', tod.warm);
  const skew = Math.round((tod.h - 12.5) * -5);
  const len = 46 + Math.round(tod.warm * 20);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const w of room.windows) {
    const y0 = w.y + w.h;
    const gr = ctx.createLinearGradient(0, y0, 0, CFG.WALL_H + len);
    gr.addColorStop(0, rgba(color, a * 0.8));
    gr.addColorStop(0.35, rgba(color, a));
    gr.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(w.x + 2, y0 + 2);
    ctx.lineTo(w.x + w.w - 2, y0 + 2);
    ctx.lineTo(w.x + w.w - 2 + skew, CFG.WALL_H + len);
    ctx.lineTo(w.x + 2 + skew, CFG.WALL_H + len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  void t;
}

const ICONS = {
  agents: ['.111.', '.111.', '.....', '11111', '11111'],
  tools: ['..11.', '.11..', '1111.', '..11.', '.11..'],
  subs: ['1...1', '1...1', '.....', '11.11', '11.11'],
};
function icon(ctx, rows, x, y, c) {
  ctx.fillStyle = c;
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') ctx.fillRect(x + i, y + j, 1, 1); });
}

/** Часовник с истинското време, дъска със статистики, вратата. */
export function drawWallDynamic(ctx, room, date, stats, t) {
  // часовник
  const c = room.clock;
  const hh = date.getHours() % 12 + date.getMinutes() / 60, mm = date.getMinutes() + date.getSeconds() / 60;
  const ha = hh / 12 * Math.PI * 2, ma = mm / 60 * Math.PI * 2, sa = date.getSeconds() / 60 * Math.PI * 2;
  pixLine(ctx, '#2a2030', c.x, c.y, c.x + Math.sin(ma) * (c.r - 2), c.y - Math.cos(ma) * (c.r - 2));
  pixLine(ctx, '#2a2030', c.x, c.y, c.x + Math.sin(ha) * (c.r - 4), c.y - Math.cos(ha) * (c.r - 4));
  R(ctx, '#e04a4a', Math.round(c.x + Math.sin(sa) * (c.r - 2)), Math.round(c.y - Math.cos(sa) * (c.r - 2)), 1, 1);
  R(ctx, '#e04a4a', c.x, c.y, 1, 1);

  // дъска
  const b = room.board;
  if (b) {
    const cw = Math.floor((b.w - 2) / 3);
    const cols = [
      { ic: ICONS.agents, c: '#3a9a5a', n: stats.agents, notes: stats.agentColors },
      { ic: ICONS.tools, c: '#d0663a', n: stats.tools, notes: Array(Math.min(9, Math.ceil(Math.log2(stats.tools + 1)))).fill('#f0c04a') },
      { ic: ICONS.subs, c: '#9a3ad0', n: stats.subs, notes: Array(Math.min(9, stats.subs)).fill('#c88af0') },
    ];
    cols.forEach((col, i) => {
      const x0 = b.x + 1 + i * cw;
      icon(ctx, col.ic, x0 + 2, b.y + 3, col.c);
      const s = compactNum(col.n);
      drawText(ctx, s, x0 + cw - 2 - textWidth(s), b.y + 3, '#2a2030');
      R(ctx, col.c, x0 + 2, b.y + 9, cw - 4, 1);
      col.notes.slice(0, 9).forEach((nc, k) => {
        const nx = x0 + 3 + (k % 3) * 6, ny = b.y + 12 + Math.floor(k / 3) * 5;
        R(ctx, nc, nx, ny, 5, 4); R(ctx, shade(nc, 0.8), nx, ny + 3, 5, 1);
      });
    });
    // табелка с токените под дъската
    if (stats.tokens != null) {
      const s = compactNum(stats.tokens), w = textWidth(s) + 10, x = b.x + b.w - w - 2, y = b.y + b.h + 4;
      R(ctx, '#1a1420', x, y, w, 9);
      R(ctx, '#3a2e48', x + 1, y + 1, w - 2, 7);
      drawCoin(ctx, x + 2, y + 2);
      drawText(ctx, s, x + 8, y + 2, '#ffe27a');
    }
  }

  // врата
  const d = room.door;
  if (room.doorOpen > 0.02) {
    R(ctx, '#120e18', d.x, d.y, d.w, d.h);
    R(ctx, '#2a2436', d.x, d.y + d.h - 6, d.w, 6);
    const pw = Math.max(3, Math.round(d.w * (1 - room.doorOpen * 0.82)));
    drawDoorPanel(ctx, d.x, d.y, pw, d.h);
    R(ctx, 'rgba(0,0,0,0.25)', d.x + pw - 1, d.y, 1, d.h);
  }
  void t;
}

/** Цялостен оттенък според часа (multiply). */
export function drawTint(ctx, room, tod) {
  if (tod.tint === '#ffffff') return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = tod.tint;
  ctx.fillRect(0, 0, room.W, room.H);
  ctx.restore();
}

/** Мека кръгла светлина (adds light). */
export function glow(ctx, x, y, r, color, a) {
  if (a <= 0.005) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.45, rgba(color, a * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export { ACCENTS };

// =====================================================================
// Миниатюри за магазина (същите функции като в стаята)
// =====================================================================
const NOON = timeOfDay(new Date(2026, 5, 1, 12, 0));
/** Картинка на предмет от каталога (котките се рисуват в shop.js с Cat). */
export function thumb(it) {
  const mk = (w, h, fn) => { const c = makeCanvas(w, h); fn(c.getContext('2d')); return c; };
  const D = DEFAULT_DECOR;
  switch (it.group) {
    case 'wall': case 'wainscot': return mk(32, 24, (g) => {
      const Wc = wallTones(it.group === 'wall' ? it : D.wall), Ws = it.group === 'wainscot' ? it : D.wainscot;
      R(g, Wc.wall, 0, 0, 32, 24); for (let x = 0; x < 32; x += 8) R(g, Wc.stripe, x, 2, 3, 10);
      R(g, Ws.rail, 0, 12, 32, 2); R(g, Ws.panel, 0, 14, 32, 7); R(g, Ws.hi, 3, 15, 10, 1); R(g, Ws.hi, 19, 15, 10, 1); R(g, Ws.base, 0, 21, 32, 3);
    });
    case 'floor': return mk(36, 24, (g) => {
      if (it.style === 'checker') drawCheckerFloor(g, it, 0, 36, 24);
      else if (it.style === 'concrete') drawConcreteFloor(g, it, 0, 36, 24, rng(3));
      else { const r = rng(4); for (let y = 0; y < 24; y += 6) { let x = -r.int(12); while (x < 36) { const len = 14 + r.int(12), c = r.pick(it.planks); R(g, c, x, y, len, 6); R(g, it.seam, x, y + 5, len, 1); R(g, it.seam, x, y, 1, 5); R(g, mix(c, it.hi, 0.5), x + 1, y, len - 2, 1); x += len; } } }
    });
    case 'rug': return mk(40, 26, (g) => drawRug(g, { x: 2, y: 2, w: 36, h: 22 }, it));
    case 'lrug': return mk(40, 26, (g) => drawLoungeRug(g, { x: 3, y: 2, w: 34, h: 22 }, it, rng(5)));
    case 'sofa': return mk(60, 36, (g) => { const b = makeCanvas(58, 18), f = makeCanvas(58, 20); drawSofaBack(b.getContext('2d'), 58, 18, it); drawSofaFront(f.getContext('2d'), 58, 20, it); g.drawImage(b, 1, 2); g.drawImage(f, 1, 16); });
    case 'chair': return mk(32, 32, (g) => { const c = makeCanvas(CFG.POD_W, CFG.POD_H); drawChairBack(c.getContext('2d'), it.id === 'chair.red', it); g.drawImage(c, -10, 1); });
    case 'plants': return mk(28, 36, (g) => drawPlant(g, 28, 36, true, it.style));
    case 'posters': return mk(56, 22, (g) => it.kinds.forEach((k, i) => drawPoster(g, 1 + i * 19, 1, k)));
    case 'lamp': return it.style === 'arc' ? mk(ARC_LAMP.w, ARC_LAMP.h, (g) => drawArcLamp(g, ARC_LAMP.w, ARC_LAMP.h)) : mk(11, 36, (g) => drawFloorLamp(g, 11, 36));
    case 'window': return mk(38, 30, (g) => {
      const w = { x: 2, y: 2, w: 34, h: 26 };
      drawSky(g, { windows: [w], sky: { x0: 2, x1: 36, stars: [], clouds: [{ x: 8, y: 5, w: 10, v: 0 }], skyline: skylineFor(it.style, 34), view: it.style } }, NOON, 0);
      const f = makeCanvas(38, 30); drawWindowFrame(f.getContext('2d'), w.x, w.y, w.w, w.h); g.drawImage(f, 0, 0); // стъклото в рамката е прозрачно
    });
    case 'neon': return mk(24, 13, (g) => drawNeon(g, 1, 1, it.c));
    case 'espresso': return mk(30, 42, (g) => drawCounter(g, 30, 42, true));
    case 'aquarium': return mk(AQUA.w, AQUA.h, (g) => { drawAquarium(g); drawAquariumFish(g, { x: 0, y: 0 }, 1200); });
    case 'arcade': return mk(ARCADE.w, ARCADE.h, (g) => { drawArcade(g); drawArcadeScreen(g, { x: 0, y: 0 }, 900); });
    default: return null;
  }
}
