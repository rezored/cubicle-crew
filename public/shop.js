// Магазин: DOM панел (острия текст, кирилица) с раздели; посочен предмет се вижда веднага в офиса (преглед),
// покупките минават през сървъра (или демо портфейла) – правилата са в catalog.js.
import { T } from './config.js';
import { ITEMS, TABS, SLOTS, GROUP_SLOTS, ACHIEVEMENTS, owns, avatarOf } from './catalog.js';
import { CharacterSprites, avatarLook } from './sprites.js';
import { SKINS, HAIRS } from './palette.js';
import { thumb } from './environment.js';
import { Cat } from './characters.js';
import { coinUrl } from './tokens.js';
import { makeCanvas } from './util.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const fmt = (n) => Number(n).toLocaleString('bg-BG');

function catThumb(it) {
  const c = makeCanvas(18, 14), g = c.getContext('2d');
  g.fillStyle = '#7e5538'; g.fillRect(0, 0, 18, 14);   // под – иначе тъмните котки не се виждат на тъмната карта
  g.fillStyle = '#6f4a30'; g.fillRect(0, 6, 18, 1); g.fillRect(0, 12, 18, 1);
  const cat = new Cat(it);
  cat.x = 9; cat.y = 13; cat.mode = 'sit';
  cat.draw(g, 0);
  return c;
}
/** Купичка 9x9 – златна, ако е отключено. */
function trophy(on) {
  const c = makeCanvas(9, 9), g = c.getContext('2d');
  const [a, b, d] = on ? ['#f0c840', '#fff4b0', '#a87a1a'] : ['#6b6b80', '#8a8aa0', '#4a4a5a'];
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  px(1, 0, 7, 1, d); px(1, 1, 7, 3, a); px(2, 1, 2, 2, b); px(0, 1, 1, 2, d); px(8, 1, 1, 2, d);
  px(2, 4, 5, 1, a); px(3, 5, 3, 1, d); px(4, 5, 1, 2, a); px(2, 7, 5, 2, d); px(3, 7, 3, 1, a);
  return c;
}

export class Shop {
  constructor(tokens, ui) {
    this.tokens = tokens; this.ui = ui;
    this.root = document.getElementById('shop');
    this.tab = 'walls';
    try { this.tab = localStorage.getItem('po.shopTab') || 'walls'; } catch { /* */ }
    if (!TABS.some((t) => t.id === this.tab)) this.tab = 'walls';
    this.thumbs = new Map();
    this.key = '';
    this.build();
    tokens.onChange(() => { if (!this.root.hidden) this.render(); });
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if ('bBбБ'.includes(e.key) && this.tokens.tokens != null) { this.toggle(); e.preventDefault(); }
      else if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
    window.pixelOffice?.onOpenShop?.(() => this.open());
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    const panel = el('div', 'shop-panel', r);
    const head = el('header', null, panel);
    el('b', 'ttl', head, T.shop.title);
    this.bal = el('span', 'bal', head);
    const x = el('button', 'x', head, '✕'); x.title = 'Esc';
    x.onclick = () => this.close();
    this.nav = el('nav', null, panel);
    for (const t of TABS) {
      const b = el('button', null, this.nav, T.shop.tabs[t.id]);
      b.dataset.tab = t.id;
      b.onclick = () => { this.tab = t.id; try { localStorage.setItem('po.shopTab', t.id); } catch { /* */ } this.key = ''; this.render(); this.body.scrollTop = 0; };
    }
    this.body = el('div', 'body', panel);
    this.foot = el('footer', null, panel, T.shop.hint);
    r.addEventListener('click', (e) => { if (e.target === r) this.close(); });
    this.body.addEventListener('mouseover', (e) => this.hover(e.target.closest('.card')));
    this.body.addEventListener('mouseleave', () => this.hover(null));
    this.body.addEventListener('click', (e) => this.click(e.target.closest('button')));
  }

  open() {
    if (this.tokens.tokens == null) return;
    this.root.hidden = false; this.key = ''; this.render();
    window.pixelOffice?.shop?.(true);
  }
  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.tokens.setPreview(null);
    window.pixelOffice?.shop?.(false);
  }
  toggle() { if (this.root.hidden) this.open(); else this.close(); }

  // ------------------------------------------------------------------ рисуване
  render() {
    const t = this.tokens, s = t.save;
    this.bal.innerHTML = `<i style="background-image:url(${this.coin ||= coinUrl()})"></i>${fmt(t.tokens ?? 0)}`;
    for (const b of this.nav.children) b.classList.toggle('on', b.dataset.tab === this.tab);
    const tab = TABS.find((x) => x.id === this.tab);
    // пълно прерисуване само ако нещо видимо се е променило (иначе посочването "мига")
    const afford = ITEMS.filter((it) => tab.groups.includes(it.group) && !owns(s, it.id) && it.price <= t.tokens).map((it) => it.id).join();
    const key = [this.tab, JSON.stringify(s.owned), JSON.stringify(s.equipped), JSON.stringify(s.achievements), afford,
      tab.id === 'trophies' ? JSON.stringify(s.stats) + s.lifetime : '', JSON.stringify(s.avatar)].join('|');
    if (key === this.key) return;
    this.key = key;
    const scroll = this.body.scrollTop;
    this.body.innerHTML = '';
    if (tab.id === 'trophies') this.renderTrophies();
    else if (tab.id === 'avatar') this.renderAvatar();
    else if (tab.merge) this.renderGroup(tab.groups, T.shop.tabs[tab.id]); // по един предмет на група – обща решетка
    else for (const g of tab.groups) this.renderGroup([g], T.shop.groups[g]);
    this.body.scrollTop = scroll;
  }

  renderGroup(groups, title) {
    const s = this.tokens.save, eq = s.equipped || {};
    const sec = el('section', null, this.body);
    el('h3', null, sec, title);
    const grid = el('div', 'grid', sec);
    for (const it of ITEMS.filter((x) => groups.includes(x.group))) {
      const slots = GROUP_SLOTS[it.group];
      const have = owns(s, it.id);
      const where = slots.filter((sl) => (eq[sl] || SLOTS[sl].def) === it.id);
      const card = el('div', `card${have ? ' owned' : ''}${where.length ? ' on' : ''}`, grid);
      card.dataset.id = it.id;
      card.appendChild(this.thumb(it));
      el('div', 'nm', card, it.name);
      const price = it.price === 0 ? T.shop.free : have ? T.shop.owned : `<i style="background-image:url(${this.coin})"></i>${fmt(it.price)}`;
      el('div', 'pr', card, price);
      const act = el('div', 'act', card);
      if (!have) {
        const short = it.price - (this.tokens.tokens ?? 0);
        const b = el('button', 'buy', act, short > 0 ? T.shop.need(fmt(short)) : T.shop.buy);
        b.dataset.buy = it.id; b.disabled = short > 0;
      } else if (slots.length > 1) {
        for (const sl of slots) {
          const b = el('button', where.includes(sl) ? 'on' : '', act, T.shop.slots[sl]);
          b.dataset.equip = it.id; b.dataset.slot = sl;
        }
      } else if (SLOTS[slots[0]].def == null) {
        const b = el('button', where.length ? 'on' : '', act, where.length ? T.shop.remove : T.shop.equip);
        b.dataset.slot = slots[0];
        if (where.length) b.dataset.remove = '1'; else b.dataset.equip = it.id;
      } else {
        const b = el('button', where.length ? 'on' : '', act, where.length ? T.shop.equipped : T.shop.equip);
        b.dataset.equip = it.id; b.dataset.slot = slots[0]; b.disabled = !!where.length;
      }
    }
  }

  renderTrophies() {
    const s = this.tokens.save, st = s.stats || {};
    const view = { lifetimeTokens: s.lifetime || 0, tasksDone: st.tasksDone || 0, lifetimeActiveSec: st.lifetimeActiveSec || 0, daysActive: st.daysActive || 0, owned: s.owned || [] };
    const sec = el('section', 'trophies', this.body);
    for (const a of ACHIEVEMENTS) {
      const got = s.achievements?.[a.id];
      const v = a.value(view);
      const row = el('div', `trophy${got ? ' got' : ''}`, sec);
      const ic = trophy(!!got); ic.className = 'ic'; row.appendChild(ic);
      const [name, desc] = T.achievements[a.id] || [a.id, ''];
      el('div', 'tx', row, `<b>${name}</b><span>${desc}</span>`);
      el('div', 'pg', row, got ? `${T.shop.unlocked}<em>${T.shop.reward(a.reward)}</em>` :
        `<span class="bar"><i style="width:${Math.round((v / a.goal) * 100)}%"></i></span>${T.shop.progress(fmt(v), fmt(a.goal))}<em>${T.shop.reward(a.reward)}</em>`);
    }
  }

  /** Аватарът: голям преглед + кожа, коса, очила. Всеки избор се записва веднага (безплатно). */
  renderAvatar() {
    const av = avatarOf(this.tokens.save), A = T.shop.avatar;
    const sec = el('section', 'avatar', this.body);
    const pv = el('div', 'pv', sec);
    for (const pose of ['stand', 'couchSit']) {
      const f = new CharacterSprites(avatarLook(av, 'avatar')).frame(pose, null, '#4ac26b');
      const c = makeCanvas(24, 34), g = c.getContext('2d');
      g.fillStyle = '#7e5538'; g.fillRect(0, 0, 24, 34);
      g.fillStyle = '#6f4a30'; for (const y of [10, 21, 32]) g.fillRect(0, y, 24, 1);
      g.drawImage(f.body, 0, 1); g.drawImage(f.front, 0, 1);
      c.className = 'th'; c.style.width = '96px'; c.style.height = '136px';
      pv.appendChild(c);
    }
    const opts = el('div', 'opts', sec);
    const row = (title, items) => {
      el('h3', null, opts, title);
      const r = el('div', 'sw', opts);
      for (const [label, patch, color, on] of items) {
        const b = el('button', on ? 'on' : '', r, color ? '' : label);
        b.title = label; b.dataset.av = JSON.stringify({ ...av, ...patch });
        if (color) { b.classList.add('dot'); b.style.background = color; }
      }
    };
    row(A.skin, SKINS.map((s, i) => [A.skins[i] || '', { skin: i }, s[1], av.skin === i]));
    row(A.hair, HAIRS.map((h, i) => [A.hairs[i] || '', { hair: i }, h[1], av.hair === i]));
    row(A.glasses, [[A.without, { glasses: false }, null, !av.glasses], [A.with, { glasses: true }, null, !!av.glasses]]);
    el('p', 'hint', opts, A.hint);
  }

  thumb(it) {
    let src = this.thumbs.get(it.id);
    if (!src) { src = it.group === 'cat' || it.group === 'cat2' ? catThumb(it) : thumb(it); this.thumbs.set(it.id, src); }
    // цяло число пъти увеличение (пиксел арт), около 84x66
    const k = Math.max(1, Math.min(4, Math.round(Math.min(84 / src.width, 66 / src.height))));
    const c = makeCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    c.className = 'th';
    c.style.width = `${src.width * k}px`; c.style.height = `${src.height * k}px`;
    return c;
  }

  // ------------------------------------------------------------------ действия
  hover(card) {
    const id = card?.dataset.id;
    if (id === this.hoverId) return;
    this.hoverId = id;
    if (!id) { this.tokens.setPreview(null); return; }
    const it = ITEMS.find((x) => x.id === id), eq = this.tokens.save.equipped || {};
    const slots = GROUP_SLOTS[it.group];
    if (slots.some((sl) => (eq[sl] || SLOTS[sl].def) === id)) { this.tokens.setPreview(null); return; } // вече е сложено
    this.tokens.setPreview({ ...eq, [slots[0]]: id });
  }

  async click(b) {
    if (!b || b.disabled) return;
    const be = this.tokens.backend;
    let r = null;
    if (b.dataset.av) { if (!b.classList.contains('on') && be.avatar) r = await be.avatar(JSON.parse(b.dataset.av)); }
    else if (b.dataset.buy) r = await be.buy(b.dataset.buy);
    else if (b.dataset.remove) r = await be.equip(b.dataset.slot, null);
    else if (b.dataset.equip && !b.classList.contains('on')) r = await be.equip(b.dataset.slot, b.dataset.equip);
    if (!r) return;
    if (!r.ok) this.flash(T.shop.errors[r.error] || r.error);
    else { this.hoverId = null; this.tokens.setPreview(null); }
  }

  flash(msg) {
    this.foot.textContent = msg; this.foot.classList.add('err');
    clearTimeout(this.ft);
    this.ft = setTimeout(() => { this.foot.textContent = T.shop.hint; this.foot.classList.remove('err'); }, 3500);
  }
}
