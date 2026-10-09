// Какво показва мониторът във всяко състояние (екранът е 18x13 логически пиксела).
import { STATES } from './config.js';
import { SYNTAX, mix, shade, rgba } from './palette.js';
import { R, rng } from './util.js';
import { drawText } from './pixelfont.js';

const lineCache = new Map();
/** Детерминиран "код": ред i -> списък от [отстъп, [дължина, цвят]...]. */
function codeLine(seed, i) {
  const key = seed * 977 + i;
  let l = lineCache.get(key);
  if (!l) {
    const r = rng(key);
    const indent = [0, 1, 1, 2, 2, 3][r.int(6)] * 2;
    const toks = [];
    let w = indent;
    const max = 16 - r.int(6);
    while (w < max) { const tl = 1 + r.int(4); toks.push([Math.min(tl, max - w), r.pick(SYNTAX)]); w += tl + 1; }
    l = { indent, toks, blank: r() < 0.12 };
    if (lineCache.size > 4000) lineCache.clear();
    lineCache.set(key, l);
  }
  return l;
}

function drawCode(ctx, x, y, w, h, seed, t, speed, grow) {
  R(ctx, '#1b1d2a', x, y, w, h);
  R(ctx, '#252838', x, y, 2, h);                    // колона с номера на редове
  const step = 2, rows = Math.floor(h / step);
  const pos = t / speed, base = Math.floor(pos), frac = pos - base;
  for (let j = 0; j < rows; j++) {
    const li = base + j;
    const l = codeLine(seed, li);
    if (l.blank) continue;
    let cx = x + 3 + l.indent;
    const last = j === rows - 1;
    let budget = last && grow ? Math.floor(frac * 16) : 99;
    for (const [tl, c] of l.toks) {
      if (budget <= 0) break;
      const ww = Math.min(tl, budget, x + w - cx);
      if (ww > 0) R(ctx, c, cx, y + j * step + 1, ww, 1);
      cx += tl + 1; budget -= tl + 1;
    }
    if (last && grow && Math.floor(t / 260) % 2) R(ctx, '#f0f0f0', Math.min(x + w - 1, cx), y + j * step, 1, 2);
  }
}

function drawDoc(ctx, x, y, w, h, seed, t, color) {
  R(ctx, '#e8e6df', x, y, w, h);
  R(ctx, '#cfcdc4', x + w - 2, y, 2, h);           // скрол лента
  const sp = (t / 900) % 1;
  R(ctx, shade(color, 0.9), x + w - 2, y + Math.floor(sp * (h - 4)), 2, 4);
  const pos = t / 900, base = Math.floor(pos);
  const hl = Math.floor((t / 450) % 6);
  for (let j = 0; j < 6; j++) {
    const r = rng(seed * 31 + base + j);
    const ly = y + 1 + j * 2;
    const heading = r() < 0.18;
    const lw = heading ? 6 + r.int(4) : 9 + r.int(6);
    if (j === hl) R(ctx, rgba(color, 0.35), x, ly - 1, w - 2, 3);
    R(ctx, heading ? '#3a3a52' : '#8a8a9c', x + 2, ly, lw, 1);
  }
}

function drawTerminal(ctx, x, y, w, h, seed, t, color) {
  R(ctx, '#0b0e0b', x, y, w, h);
  const pos = t / 170, base = Math.floor(pos);
  for (let j = 0; j < 5; j++) {
    const r = rng(seed * 17 + base + j);
    const ly = y + 1 + j * 2;
    if (r() < 0.25) { R(ctx, '#7ee08a', x + 1, ly, 1, 1); R(ctx, '#e0e0e0', x + 3, ly, 3 + r.int(8), 1); }
    else R(ctx, r() < 0.15 ? '#e0c24a' : '#5aa86a', x + 1, ly, 4 + r.int(12), 1);
  }
  // прогрес бар
  const p = (t % 4200) / 4200;
  R(ctx, shade(color, 0.5), x + 1, y + h - 2, w - 2, 1);
  R(ctx, color, x + 1, y + h - 2, Math.max(1, Math.round((w - 2) * p)), 1);
}

function drawThinking(ctx, x, y, w, h, seed, t, color) {
  drawCode(ctx, x, y, w, h, seed, 1e9, 1e12, false);
  ctx.fillStyle = 'rgba(20,20,30,0.55)'; ctx.fillRect(x, y, w, h);
  // въртящ се индикатор от 8 точки
  const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2);
  const k = Math.floor(t / 110) % 8;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const d = (i - k + 8) % 8;
    ctx.fillStyle = d === 0 ? '#fff4b0' : d < 3 ? color : shade(color, 0.45);
    ctx.fillRect(Math.round(cx + Math.cos(a) * 4) - (d === 0 ? 1 : 0), Math.round(cy + Math.sin(a) * 4) - (d === 0 ? 1 : 0), d === 0 ? 2 : 1, d === 0 ? 2 : 1);
  }
}

function drawDelegate(ctx, x, y, w, h, seed, t, color) {
  R(ctx, mix('#1b1d2a', color, 0.15), x, y, w, h);
  const top = [x + 7, y + 1], l = [x + 2, y + 9], r = [x + 12, y + 9];
  const box = (bx, by, c) => { R(ctx, c, bx, by, 4, 3); R(ctx, shade(c, 0.6), bx, by + 2, 4, 1); };
  R(ctx, shade(color, 0.7), x + 8, y + 4, 1, 3); R(ctx, shade(color, 0.7), x + 4, y + 6, 10, 1);
  R(ctx, shade(color, 0.7), x + 4, y + 6, 1, 3); R(ctx, shade(color, 0.7), x + 13, y + 6, 1, 3);
  box(top[0], top[1], color); box(l[0], l[1], '#e0b0ff'); box(r[0], r[1], '#e0b0ff');
  // "пакетче", което тече надолу
  const p = (t % 1400) / 1400;
  const side = Math.floor(t / 1400) % 2;
  const px = p < 0.5 ? x + 8 : x + 8 + Math.round((side ? 5 : -4) * (p - 0.5) * 2);
  const py = p < 0.5 ? y + 4 + Math.round(p * 4) : y + 6 + Math.round((p - 0.5) * 4);
  R(ctx, '#ffffff', px, py, 1, 1);
}

function drawWaiting(ctx, x, y, w, h, t, color) {
  const on = Math.floor(t / 320) % 2 === 0;
  R(ctx, on ? color : '#3a0e18', x, y, w, h);
  R(ctx, on ? '#3a0e18' : color, x + 1, y + 1, w - 2, h - 2);
  drawText(ctx, '?', x + Math.floor(w / 2) - 3, y + 2, on ? '#ffffff' : color, 2 > h / 6 ? 1 : 2);
}

function drawIdle(ctx, x, y, w, h, seed, t) {
  R(ctx, '#10121c', x, y, w, h);
  // заставка: оранжева звездичка, която бавно се движи
  const px = x + 2 + Math.round((Math.sin(t / 2300 + seed) * 0.5 + 0.5) * (w - 6));
  const py = y + 2 + Math.round((Math.cos(t / 3100 + seed * 2) * 0.5 + 0.5) * (h - 6));
  const c = '#d9773f';
  R(ctx, c, px + 1, py, 1, 3); R(ctx, c, px, py + 1, 3, 1);
  ctx.fillStyle = 'rgba(217,119,63,0.25)'; ctx.fillRect(px - 1, py - 1, 5, 5);
}

/** Рисува екрана; prev/fade – плавен преход между две състояния. */
export function drawScreen(ctx, sx, sy, sw, sh, state, t, seed, prevState, fade) {
  const draw = (st) => {
    const color = STATES[st]?.color || '#888';
    switch (st) {
      case 'typing': return drawCode(ctx, sx, sy, sw, sh, seed, t, 520, true);
      case 'reading': return drawDoc(ctx, sx, sy, sw, sh, seed, t, color);
      case 'running': return drawTerminal(ctx, sx, sy, sw, sh, seed, t, color);
      case 'thinking': return drawThinking(ctx, sx, sy, sw, sh, seed, t, color);
      case 'delegating': return drawDelegate(ctx, sx, sy, sw, sh, seed, t, color);
      case 'waiting': return drawWaiting(ctx, sx, sy, sw, sh, t, color);
      case 'off': return R(ctx, '#0e1016', sx, sy, sw, sh);
      default: return drawIdle(ctx, sx, sy, sw, sh, seed, t);
    }
  };
  draw(state);
  if (prevState && fade < 1) {
    ctx.save(); ctx.globalAlpha = 1 - fade; draw(prevState); ctx.restore();
  }
  // лек отблясък
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(sx, sy, sw, 1);
}
