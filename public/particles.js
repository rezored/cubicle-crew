// Частици: искри от клавиатурата, летящи символи код, Zzz, пара, прашинки, конфети, хартиени самолетчета.
import { CFG } from './config.js';
import { drawText, textWidth } from './pixelfont.js';
import { drawCoin } from './tokens.js';
import { rgba } from './palette.js';
import { R } from './util.js';

const CONFETTI = ['#e04a6b', '#e0c24a', '#4ac26b', '#4a8fe0', '#b04ae0', '#e07a4a', '#ffffff'];

export class Particles {
  constructor() { this.list = []; }

  add(p) {
    if (this.list.length >= CFG.MAX_PARTICLES) this.list.shift();
    p.age = 0;
    this.list.push(p);
    return p;
  }

  spark(x, y, color) {
    this.add({ kind: 'px', layer: 'top', x, y, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 25, g: 90, life: 0.35, color, size: 1 });
  }
  glyph(x, y, color) {
    const ch = '{};<>/=()+*#$'[Math.floor(Math.random() * 13)];
    this.add({ kind: 'glyph', layer: 'top', ch, x, y, vx: (Math.random() - 0.5) * 6, vy: -9 - Math.random() * 5, g: 0, life: 1.6, color });
  }
  zzz(x, y) {
    this.add({ kind: 'glyph', layer: 'top', ch: Math.random() < 0.5 ? 'z' : 'Z', x, y, vx: 5, vy: -6, g: 0, life: 2.2, color: '#c8c8e8', wobble: 1 });
  }
  steam(x, y) {
    this.add({ kind: 'px', layer: 'mid', x: x + Math.random() * 2, y, vx: 0, vy: -5 - Math.random() * 3, g: 0, life: 1.5, color: '#ffffff', alpha: 0.35, wobble: 1, size: 1 });
  }
  dust(x, y) {
    this.add({ kind: 'px', layer: 'mid', x, y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 1.5, g: 0, life: 5 + Math.random() * 4, color: '#fff4d0', alpha: 0.5, twinkle: Math.random() * 6, size: 1 });
  }
  bubble(x, y) {
    this.add({ kind: 'px', layer: 'mid', x, y, vx: 0, vy: -4, g: 0, life: 1.4, color: '#d8f0ff', alpha: 0.8, size: 1 });
  }
  confetti(x, y, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, v = 40 + Math.random() * 50;
      this.add({ kind: 'confetti', layer: 'top', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 70, drag: 1.6, life: 2.2 + Math.random(), color: CONFETTI[i % CONFETTI.length], ph: Math.random() * 6 });
    }
  }
  sparkle(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 20;
      this.add({ kind: 'px', layer: 'top', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 8, g: 0, drag: 2.5, life: 0.8 + Math.random() * 0.5, color, size: Math.random() < 0.3 ? 2 : 1 });
    }
  }
  /** "+N" с монета – спечелени токени; big = бонус (по-дълго и с искри). */
  token(x, y, n, big) {
    this.add({ kind: 'token', layer: 'top', txt: `+${n}`, x, y, vx: 0, vy: big ? -7 : -9, g: 0, drag: big ? 0.3 : 0, life: big ? 2.6 : 1.8 });
    if (big) this.sparkle(x, y + 2, '#f0c840', 12);
  }
  /** Хартиено самолетче от (x0,y0) до (x1,y1) по дъга. */
  plane(x0, y0, x1, y1, onLand) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    this.add({ kind: 'plane', layer: 'top', x0, y0, x1, y1, x: x0, y: y0, life: Math.max(0.9, d / 70), arc: Math.min(40, 12 + d * 0.25), onLand });
  }

  update(dt) {
    const out = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age >= p.life) { if (p.onLand) p.onLand(); continue; }
      if (p.kind === 'plane') {
        const k = p.age / p.life;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const nx = p.x0 + (p.x1 - p.x0) * e, ny = p.y0 + (p.y1 - p.y0) * e - Math.sin(k * Math.PI) * p.arc;
        p.dir = nx >= p.x ? 1 : -1; p.x = nx; p.y = ny;
      } else {
        if (p.drag) { p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; }
        p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt + (p.wobble ? Math.sin(p.age * 5 + p.y) * 0.15 : 0);
        p.y += p.vy * dt;
      }
      out.push(p);
    }
    this.list = out;
  }

  draw(ctx, layer) {
    for (const p of this.list) {
      if (p.layer !== layer) continue;
      const k = p.age / p.life;
      const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.kind === 'px') {
        let a = (p.alpha ?? 1) * fade;
        if (p.twinkle != null) a *= 0.4 + 0.6 * Math.abs(Math.sin(p.age * 1.3 + p.twinkle));
        ctx.fillStyle = rgba(p.color, a);
        ctx.fillRect(x, y, p.size || 1, p.size || 1);
      } else if (p.kind === 'glyph') {
        ctx.globalAlpha = fade;
        drawText(ctx, p.ch, x, y, p.color);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'confetti') {
        ctx.globalAlpha = fade;
        const flip = Math.sin(p.age * 12 + p.ph) > 0;
        R(ctx, p.color, x, y, flip ? 2 : 1, flip ? 1 : 2);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'token') {
        // центрирано: монета + текст, тъмен контур отдолу за четимост върху всякакъв фон
        ctx.globalAlpha = fade;
        const w = 6 + textWidth(p.txt), x0 = x - Math.floor(w / 2);
        drawText(ctx, p.txt, x0 + 6, y + 1, '#2a1a08');
        drawText(ctx, p.txt, x0 + 7, y, '#2a1a08');
        drawText(ctx, p.txt, x0 + 6, y, '#ffe27a');
        drawCoin(ctx, x0, y);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'plane') {
        const d = p.dir || 1;
        R(ctx, 'rgba(20,10,30,0.25)', x - 2, y + 6 + Math.round(Math.sin(k * Math.PI) * 4), 5, 1);
        R(ctx, '#f6f3ea', x - 2, y, 5, 1); R(ctx, '#f6f3ea', x - 1 * d, y + 1, 3, 1); R(ctx, '#c9c2b0', x, y + 1, 1, 1);
        R(ctx, '#f6f3ea', x + 3 * d, y - 1, 1, 1);
      }
    }
  }
}
