// Магазин: DOM панел (острия текст, кирилица) с раздели; посочен предмет се вижда веднага в офиса (преглед),
// покупките минават през сървъра (или демо портфейла) – правилата са в catalog.js.
import { T, itemName, LANG, PARAMS, petName, petTitle, STATES } from './config.js';
import { prefs } from './prefs.js';
import { wxFrom } from './weather.js';
import { ITEMS, ITEM, TABS, SLOTS, GROUP_SLOTS, ACHIEVEMENTS, owns, avatarOf, unlocked, resolveDecor, PET_SLOTS, petCount, MAX_PETS, PET_NAME_MAX, inSeason, PIC_W, PIC_H, PIC_SLOTS, OFFICE_NAME_MAX } from './catalog.js';
import { CharacterSprites, avatarLook, randomAv, canShort, AVATAR_TOPS, AVATAR_BOTTOMS, DRESS_TOPS, DESK_ITEMS } from './sprites.js';
import { SKINS, HAIRS, PANTS, SKIRTS, SHOES, IRIS, ACCENTS } from './palette.js';
import { thumb, drawDeskItem, drawPicture } from './environment.js';
import { Cat, Dog, Critter } from './characters.js';
import { coinUrl } from './tokens.js';
import { makeCanvas, fmtUsd } from './util.js';
import { DEFAULT_OFFICE_SIGN, OFFICE_SUBTITLE_MAX, showOfficeSignText } from './office-sign.js';

/** Снимка -> пикселна картина PIC_W x PIC_H с до 12 цвята (k-means), изцяло в браузъра. */
async function pixelize(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
  const W = PIC_W, H = PIC_H, ar = W / H;
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (!sw || !sh) throw new Error('empty');
  if (sw / sh > ar) { const w = sh * ar; sx = (sw - w) / 2; sw = w; } else { const h = sw / ar; sy = (sh - h) / 4; sh = h; } // по-скоро горната част (лица)
  // смаляване на стъпки – по-чисто от един голям скок
  let c = makeCanvas(W * 8, H * 8), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, W * 8, H * 8);
  for (const k of [4, 2, 1]) {
    const d = makeCanvas(W * k, H * k), dg = d.getContext('2d');
    dg.imageSmoothingQuality = 'high'; dg.drawImage(c, 0, 0, W * k, H * k); c = d;
  }
  const data = c.getContext('2d').getImageData(0, 0, W, H).data;
  const pts = [];
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3] / 255; // прозрачното – върху тъмна стена
    pts.push([data[i * 4] * a + 42 * (1 - a), data[i * 4 + 1] * a + 32 * (1 - a), data[i * 4 + 2] * a + 48 * (1 - a)]);
  }
  // k-means: начални центрове по яркост (равномерно), 12 итерации
  const K = 12, lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
  const sorted = [...pts].sort((p, q) => lum(p) - lum(q));
  let cent = Array.from({ length: K }, (_, k) => [...sorted[Math.floor(((k + 0.5) / K) * sorted.length)]]);
  const lab = new Array(pts.length).fill(0);
  for (let it = 0; it < 12; it++) {
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      cent.forEach((q, k) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bd) { bd = d; best = k; } });
      lab[i] = best;
    });
    const sum = cent.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const t = sum[lab[i]]; t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++; });
    cent = cent.map((q, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : q));
  }
  // само използваните цветове, леко по-наситени (пикселното изкуство не обича кал)
  const used = [...new Set(lab)];
  const hex = (q) => {
    const m = (q[0] + q[1] + q[2]) / 3;
    return '#' + q.map((v) => Math.max(0, Math.min(255, Math.round(m + (v - m) * 1.15))).toString(16).padStart(2, '0')).join('');
  };
  return { pal: used.map((k) => hex(cent[k])), px: lab.map((k) => used.indexOf(k).toString(16)).join('') };
}

// малък прозорец (същото като в index.html): по-дребни миниатюри, за да се побират повече
const SMALL = matchMedia('(max-width: 899px), (max-height: 539px)');

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const fmt = (n) => Number(n).toLocaleString(LANG === 'bg' ? 'bg-BG' : 'en-US');
// 1 ч 05 мин / 42 мин – за статистиката
const fmtDurationShort = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} ${T.min}` : `${Math.floor(m / 60)} ${T.hour} ${String(m % 60).padStart(2, '0')} ${T.min}`; };

/** Любимец на парче под (иначе тъмните котки/кучета не се виждат на тъмната карта); кучето седи, за да личи породата. */
export function petThumb(it, mode = 'sit') {
  const dog = it.group === 'dog' || it.group === 'exotic', w = dog ? 22 : 18, h = dog ? 18 : 14;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#7e5538'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#6f4a30'; for (let y = 6; y < h; y += 6) g.fillRect(0, y, w, 1);
  const p = it.group === 'exotic' ? new Critter(it) : dog ? new Dog(it) : new Cat(it);
  p.x = dog ? 10 : 9; p.y = h - 1; p.mode = mode;
  p.draw(g, 0);
  return c;
}
/** Неотключено в албума: предмет с прозрачен фон -> тъмен силует; цяла картинка (стена, под, любимец на пода) -> сиво и тъмно. */
function silhouette(c) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let cut = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) { cut = true; break; }
  if (cut) { g.globalCompositeOperation = 'source-in'; g.fillStyle = '#8a83b0'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over'; return; } // светъл силует – чете се и на тъмния фон
  const tmp = makeCanvas(c.width, c.height); tmp.getContext('2d').drawImage(c, 0, 0);
  g.clearRect(0, 0, c.width, c.height); g.filter = 'grayscale(1) brightness(0.7)'; g.drawImage(tmp, 0, 0); g.filter = 'none';
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
    SMALL.addEventListener?.('change', () => { this.key = ''; if (!this.root.hidden) this.render(); });
    tokens.onChange(() => { if (!this.root.hidden) this.render(); });
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const typing = e.target?.closest?.('input, textarea'); // името на любимеца / търсенето на град
      if (!typing && 'bBбБ'.includes(e.key) && this.tokens.tokens != null && !prefs.focus) { this.toggle(); e.preventDefault(); }
      else if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
    window.pixelOffice?.onOpenShop?.(() => this.open());
    window.pixelOffice?.onOpenWeather?.(() => this.open('weather'));
    window.pixelOffice?.onOpenTab?.((tab) => this.open(tab)); // „Статистика“ от менюто в трея
    // статистиката се опреснява, докато разделът е отворен
    setInterval(() => { if (!this.root.hidden && this.tab === 'stats') this.renderStats(true); }, 15000);
    this.weather = null; // последното {type:'weather'} от сървъра
  }

  /** Ново време от сървъра (WS или след POST). */
  setWeather(m) { this.weather = m; if (!this.root.hidden && this.tab === 'weather') { this.key = ''; this.render(); } }

  build() {
    const r = this.root;
    r.innerHTML = '';
    const panel = el('div', 'shop-panel', r);
    const head = el('header', null, panel);
    this.ttl = el('b', 'ttl', head, T.shop.title);
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
    this.body.addEventListener('mouseover', (e) => this.hover(e.target.closest('.card, .tile[data-id]')));
    this.body.addEventListener('mouseleave', () => this.hover(null));
    this.body.addEventListener('click', (e) => this.click(e.target.closest('button')));
  }

  open(tab) {
    if (PARAMS.lan) return; // телефонът само гледа
    if (document.body.classList.contains('setting-up')) return; // първо началната настройка
    if (prefs.focus && tab !== 'weather' && tab !== 'stats') return; // „Фокус“: без магазин (времето и статистиката остават)
    if (tab) this.tab = tab;
    if (this.tokens.tokens == null) return;
    const was = this.root.hidden;
    this.root.hidden = false; this.key = ''; this.render();
    document.body.classList.add('shopping');
    window.pixelOffice?.shop?.(true);
    if (was) this.onToggle?.();
  }
  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.officeDraft = null;
    this.tokens.setPreview(null);
    document.body.classList.remove('shopping');
    window.pixelOffice?.shop?.(false);
    this.onToggle?.();
  }
  toggle() { if (this.root.hidden) this.open(); else this.close(); }

  // ------------------------------------------------------------------ рисуване
  render() {
    const t = this.tokens, s = t.save;
    this.bal.innerHTML = `<i style="background-image:url(${this.coin ||= coinUrl()})"></i>${fmt(t.tokens ?? 0)}`;
    // статистиката и времето не са „магазин“; във „Фокус“ няма и монети
    const info = this.tab === 'stats' || this.tab === 'weather';
    this.ttl.textContent = info ? T.shop.tabs[this.tab] : T.shop.title;
    this.bal.hidden = prefs.focus;
    for (const b of this.nav.children) { b.classList.toggle('on', b.dataset.tab === this.tab); b.hidden = prefs.focus && b.dataset.tab !== 'weather' && b.dataset.tab !== 'stats'; }
    const tab = TABS.find((x) => x.id === this.tab);
    const present = tab.id === 'crew' ? this.presentCrew() : null;
    // пълно прерисуване само ако нещо видимо се е променило (иначе посочването "мига")
    const afford = ITEMS.filter((it) => tab.groups.includes(it.group) && !owns(s, it.id) && it.price <= t.tokens).map((it) => it.id).join();
    const key = [this.tab, JSON.stringify(s.owned), JSON.stringify(s.equipped), JSON.stringify(s.achievements), afford,
      tab.id === 'trophies' ? JSON.stringify(s.stats) + s.lifetime : '', tab.id === 'stats' ? 'stats' : '', JSON.stringify(s.avatar), tab.id === 'weather' ? JSON.stringify(this.weather) : '', JSON.stringify(s.petNames), this.exoSel,
      tab.id === 'decor' ? JSON.stringify([s.officeName, s.officeSign, s.pictures]) : '',
      tab.id === 'avatar' ? (s.crewMe || '') + JSON.stringify(s.crewSeen) + this.crewHere().join() : '',
      present ? JSON.stringify([s.crew, s.crewSeen, s.crewMe, this.crewSel, this.tokens.office?.avatarId,
        [...present].map(([key, a]) => [key, a.id, a.agent.label, a.agent.atype, a.agent.provider])]) : ''].join('|');
    if (key === this.key) return;
    this.key = key;
    const scroll = this.body.scrollTop;
    // полето, в което се пише в момента (име на любимец), оцелява при прерисуване
    const typing = this.body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.name
      ? { name: document.activeElement.name, value: document.activeElement.value, at: document.activeElement.selectionStart } : null;
    this.body.innerHTML = '';
    if (tab.id === 'trophies') this.renderTrophies();
    else if (tab.id === 'avatar') this.renderAvatar();
    else if (tab.id === 'crew') this.renderCrew(present);
    else if (tab.id === 'weather') this.renderWeather();
    else if (tab.id === 'stats') this.renderStats();
    else if (tab.id === 'pets') this.renderPets();
    else if (tab.id === 'album') this.renderAlbum();
    else if (tab.merge) this.renderGroup(tab.groups, T.shop.tabs[tab.id]); // по един предмет на група – обща решетка
    else {
      if (tab.id === 'decor') this.renderMine(); // табелата и твоите картини
      for (const g of tab.groups) this.renderGroup([g], T.shop.groups[g]);
    }
    this.body.scrollTop = scroll;
    if (typing) {
      const inp = this.body.querySelector(`input[name="${typing.name}"]`);
      if (inp) { inp.value = typing.value; inp.focus(); try { inp.setSelectionRange(typing.at, typing.at); } catch { /* */ } }
    }
    // клик върху любимец в офиса -> неговият ред
    if (this.focusPet && tab.id === 'pets') { this.body.querySelector(`[data-pet="${this.focusPet}"]`)?.scrollIntoView({ block: 'start' }); this.focusPet = null; }
  }

  /** Отваря „Любимци“ на реда на дадения любимец (клик върху него в офиса). */
  openPet(slot) { this.focusPet = slot; if (SLOTS[slot]?.pet === 'exotic') this.exoSel = slot; this.open('pets'); }

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
      el('div', 'nm', card, itemName(it));
      if (it.by) el('div', 'by', card).textContent = T.shop.by(it.by);
      const price = it.price === 0 ? T.shop.free : have ? T.shop.owned : `<i style="background-image:url(${this.coin})"></i>${fmt(it.price)}`;
      el('div', 'pr', card, price);
      const act = el('div', 'act', card);
      if (!have) {
        const short = it.price - (this.tokens.tokens ?? 0), off = !inSeason(it);
        // сезонен извън сезона: „от 01.12“
        const b = el('button', 'buy', act, off ? T.shop.seasonFrom(it.from.split('-').reverse().join('.')) : short > 0 ? T.shop.need(fmt(short)) : T.shop.buy);
        b.dataset.buy = it.id; b.disabled = short > 0 || off;
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

  /** Албум: цялата колекция – купеното в цвят, останалото като силует с цената (и сезона). Само фиксирани цени –
   *  нищо случайно, всичко се купува направо. Клик по силует -> разделът му в магазина; посочване -> преглед в офиса. */
  renderAlbum() {
    const s = this.tokens.save, A = T.shop.album, now = new Date();
    const cats = TABS.filter((t) => t.groups.length).map((t) => ({ t, items: ITEMS.filter((it) => t.groups.includes(it.group) && it.group !== 'catslot') }));
    const all = cats.flatMap((c) => c.items), got = all.filter((it) => owns(s, it.id)).length;
    const tro = ACHIEVEMENTS.filter((a) => s.achievements?.[a.id]).length;
    const bar = (n, m) => `<span class="bar"><i style="width:${Math.round((n / Math.max(1, m)) * 100)}%"></i></span>`;
    const top = el('section', 'album-top', this.body);
    el('div', 'big', top, `<b>${A.total(got, all.length)}</b>${bar(got, all.length)}<span class="dim">${A.trophies(tro, ACHIEVEMENTS.length)}</span>`);
    el('p', 'hint', top, A.fair);
    const dm = (md) => md.split('-').reverse().join('.');
    for (const { t, items } of cats) {
      const n = items.filter((it) => owns(s, it.id)).length;
      const sec = el('section', 'album', this.body);
      el('h3', null, sec, `${T.shop.tabs[t.id]} <span class="cnt">${n} / ${items.length}</span>${bar(n, items.length)}`);
      const grid = el('div', 'tiles', sec);
      for (const it of items) {
        const have = owns(s, it.id), b = el('button', `tile${have ? ' got' : ''}${it.from ? ' season' : ''}`, grid);
        b.type = 'button'; b.dataset.id = it.id; b.dataset.go = t.id;
        const c = this.thumb(it), k = SMALL.matches ? 1 : Math.max(1, Math.round(parseFloat(c.style.width) / c.width / 2)); // половината от магазина
        c.style.width = `${c.width * k}px`; c.style.height = `${c.height * k}px`;
        if (!have) silhouette(c);
        b.appendChild(c);
        const cap = it.from ? `${dm(it.from)}–${dm(it.to)}${inSeason(it, now) ? ' ●' : ''}` : have ? '' : it.price ? `<i style="background-image:url(${this.coin})"></i>${fmt(it.price)}` : T.shop.free;
        if (cap) el('span', 'cap', b, cap);
        b.title = `${itemName(it)}${have ? ` · ${T.shop.owned}` : ''}${it.from ? ` · ${A.season(dm(it.from), dm(it.to))}` : ''}`;
      }
    }
    // постиженията: златни купички или сиви силуети
    const sec = el('section', 'album', this.body);
    el('h3', null, sec, `${T.shop.tabs.trophies} <span class="cnt">${tro} / ${ACHIEVEMENTS.length}</span>${bar(tro, ACHIEVEMENTS.length)}`);
    const grid = el('div', 'tiles', sec);
    for (const a of ACHIEVEMENTS) {
      const on = !!s.achievements?.[a.id], b = el('button', `tile cup${on ? ' got' : ''}`, grid);
      b.type = 'button'; b.dataset.go = 'trophies';
      const ic = trophy(on); ic.className = 'th'; ic.style.width = ic.style.height = '27px'; b.appendChild(ic);
      b.title = (T.achievements[a.id] || [a.id])[0];
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

  /** Аватарът: голям преглед + всички части. Всеки избор се записва веднага (безплатно). */
  renderAvatar() {
    const av = { body: 0, style: 0, top: 0, bottom: 0, ...avatarOf(this.tokens.save) };
    const sec = el('section', 'avatar', this.body);
    const opts = this.personEditor(sec, av, 'av');
    el('p', 'hint', opts, T.shop.avatar.hint);
    // на кой проект седиш ти (последните видени проекти + отворените)
    const A = T.shop.avatar, me = this.tokens.save.crewMe || null;
    const projects = this.crewProjects().slice(0, 10);
    if (me && !projects.includes(me)) projects.unshift(me);
    const wh = document.createElement('div'); opts.prepend(wh); // най-горе – иначе е под всички дрехи
    el('h3', null, wh, A.where);
    const r = el('div', 'sw', wh);
    const b0 = el('button', me ? '' : 'on', r, A.auto); b0.type = 'button'; b0.dataset.me = '';
    for (const k of projects) { const b = el('button', k === me ? 'on' : '', r); b.type = 'button'; b.dataset.me = k; b.textContent = this.crewLabel(k); }
    el('p', 'hint', wh, A.whereHint);
  }

  /** Проектите (p:…): отворените първо, после по последно идване. */
  crewProjects() {
    const s = this.tokens.save, seen = s.crewSeen || {}, here = new Set(this.crewHere());
    const keys = new Set([...here, ...Object.keys(seen), ...Object.keys(s.crew || {})]);
    return [...keys].filter((k) => k.startsWith('p:')).sort((p, q) => (here.has(q) - here.has(p)) || ((seen[q]?.at || 0) - (seen[p]?.at || 0)));
  }
  /** Етикетът на човека: проектът или типът помощник, както е изписан. */
  crewLabel(k) {
    const a = this.tokens.office && [...this.tokens.office.actors.values()].find((x) => x.crewBase === k);
    if (a) return a.agent.subagent ? a.agent.atype || a.agent.provider || k.slice(2) : a.agent.label;
    return this.tokens.save.crewSeen?.[k]?.label || k.slice(2);
  }

  /** Голям преглед (прав и на дивана) + бутоните за всяка част. attr = data-атрибутът на бутоните ('av' аватар / 'cav' колега). */
  personEditor(sec, av, attr) {
    const A = T.shop.avatar, gk = av.body === 1 ? 'f' : 'm', dress = AVATAR_BOTTOMS[gk][av.bottom] === 'dress';
    const pv = el('div', 'pv', sec);
    for (const pose of ['stand', 'couchSit']) pv.appendChild(this.personCanvas(av, pose, 4));
    const opts = el('div', 'opts', sec);
    const row = (title, items) => {
      el('h3', null, opts, title);
      const r = el('div', 'sw', opts);
      for (const [label, patch, color, on] of items) {
        const b = el('button', on ? 'on' : '', r, color ? '' : label);
        b.title = label; b.dataset[attr] = JSON.stringify({ ...av, ...patch });
        if (color) { b.classList.add('dot'); b.style.background = color; }
      }
    };
    row(A.body, [[A.male, { body: 0, style: 0 }, null, av.body !== 1], [A.female, { body: 1, style: 0 }, null, av.body === 1]]);
    row(A.style, A.styles[gk].map((x, i) => [x, { style: i }, null, av.style === i]));
    row(A.hair, HAIRS.map((h, i) => [A.hairs[i] || '', { hair: i }, h[1], av.hair === i]));
    row(A.skin, SKINS.map((x, i) => [A.skins[i] || '', { skin: i }, x[1], av.skin === i]));
    row(A.iris, IRIS.map((c, i) => ['', { iris: i }, c, (av.iris ?? 0) === i]));
    if (gk === 'm') row(A.beard, A.beards.map((x, i) => [x, { beard: i }, null, (av.beard || 0) === i]));
    else row(A.earrings, [[A.without, { earrings: false }, null, av.earrings === false], [A.earrings, { earrings: true }, null, av.earrings !== false]]);
    row(A.glasses, [[A.without, { glasses: false }, null, !av.glasses], [A.with, { glasses: true }, null, !!av.glasses]]);
    row(A.head, A.heads.map((x, i) => [x, { head: i }, null, (av.head || 0) === i]));
    // горнище; с рокля се показват само съвместимите (avatarLook пак пази)
    const tops = A.tops[gk].map((x, i) => [x, { top: i }, null, av.top === i]).filter((_, i) => !dress || DRESS_TOPS.has(AVATAR_TOPS[gk][i]));
    row(A.top, tops);
    if (canShort(av)) row(A.sleeves, A.sleeve.map((x, i) => [x, { short: i === 1 }, null, !!av.short === (i === 1)]));
    if (gk === 'f') row(A.bottom, A.bottoms.map((x, i) => {
      // към рокля с несъвместимо горнище -> блуза; цветът на панталона/полата – наново
      const patch = AVATAR_BOTTOMS.f[i] === 'dress' && !DRESS_TOPS.has(AVATAR_TOPS.f[av.top] || 'blouse') ? { bottom: i, top: 0 } : { bottom: i };
      return [x, { ...patch, legs: undefined }, null, av.bottom === i];
    }));
    const bottom = AVATAR_BOTTOMS[gk][av.bottom] || 'pants';
    if (bottom !== 'dress') {
      const list = bottom === 'skirt' ? SKIRTS : PANTS;
      const cur = av.legs ?? (bottom === 'skirt' ? 0 : gk === 'f' ? 3 : 0);
      row(bottom === 'skirt' ? A.skirt : A.legs, list.map((c, i) => ['', { legs: i }, c[1], cur === i]));
    }
    row(A.shoes, SHOES.map((c, i) => ['', { shoes: i }, c[0], (av.shoes ?? (gk === 'f' ? 3 : 0)) === i]));
    row(A.accent, ACCENTS.map((c, i) => ['', { accent: i }, c, (av.accent ?? 1) === i]));
    // личната вещ на бюрото: малки картинки
    el('h3', null, opts, A.desk);
    const dr = el('div', 'sw desk', opts);
    DESK_ITEMS.forEach((name, i) => {
      const b = el('button', (av.desk || 0) === i ? 'on' : '', dr);
      b.title = A.desks[i] || name || ''; b.dataset[attr] = JSON.stringify({ ...av, desk: i });
      if (!name) { b.textContent = A.desks[0]; return; }
      const c = makeCanvas(12, 16), g = c.getContext('2d');
      drawDeskItem(g, name, -55, -21);
      c.style.width = '24px'; c.style.height = '32px'; b.appendChild(c);
    });
    return opts;
  }

  /** Канвас с човек (поза, мащаб k) на дървен под. */
  personCanvas(av, pose, k, shirt = '#4ac26b') {
    const f = new CharacterSprites(avatarLook(av, 'avatar')).frame(pose, null, shirt);
    const c = makeCanvas(24, 34), g = c.getContext('2d');
    g.fillStyle = '#7e5538'; g.fillRect(0, 0, 24, 34);
    g.fillStyle = '#6f4a30'; for (const y of [10, 21, 32]) g.fillRect(0, y, 24, 1);
    g.drawImage(f.body, 0, 1); g.drawImage(f.front, 0, 1);
    c.className = 'th'; c.style.width = 24 * k + 'px'; c.style.height = 34 * k + 'px';
    return c;
  }

  /** „Моят офис“: името на табелата + до 3 твои картини на мястото на постерите. */
  renderMine() {
    const s = this.tokens.save, M = T.shop.mine, be = this.tokens.backend;
    const sec = el('section', 'mine', this.body);
    el('h3', null, sec, M.name);
    const form = el('form', 'office-sign-form', sec);
    const draft = this.officeDraft || { name: s.officeName || '', sign: { ...DEFAULT_OFFICE_SIGN, ...s.officeSign } };
    const preview = el('div', 'office-sign-text', form);
    preview.setAttribute('aria-label', M.signPreview);
    el('p', 'hint', sec).textContent = M.nameHint;
    const refreshPreview = () => {
      preview.hidden = !draft.sign.enabled;
      showOfficeSignText(preview, draft.name || M.signExample, draft.sign);
    };
    const field = (data, key, label, type, limit) => {
      const row = el('label', null, form);
      form.insertBefore(row, preview);
      el('span', null, row).textContent = label;
      const input = el('input', null, row);
      input.name = 'office-' + key;
      input.type = type;
      if (limit) input.maxLength = limit;
      if (type === 'checkbox') input.checked = data[key];
      else input.value = data[key];
      input.oninput = () => {
        data[key] = type === 'checkbox' ? input.checked : input.value;
        this.officeDraft = draft;
        refreshPreview();
      };
      return input;
    };
    field(draft, 'name', M.name, 'text', OFFICE_NAME_MAX).placeholder = M.namePh;
    field(draft.sign, 'enabled', M.customSign, 'checkbox');
    field(draft.sign, 'subtitle', M.subtitle, 'text', OFFICE_SUBTITLE_MAX);
    field(draft.sign, 'titleColor', M.titleColor, 'color');
    field(draft.sign, 'subtitleColor', M.subtitleColor, 'color');
    refreshPreview();
    const save = el('button', null, form, M.save);
    save.type = 'submit';
    save.disabled = !!this.officeSaving;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (this.officeSaving) return;
      this.officeSaving = save.disabled = true;
      const sent = JSON.stringify(draft);
      const r = await be.office?.(JSON.parse(sent));
      this.officeSaving = save.disabled = false;
      if (r?.ok && this.officeDraft === draft && JSON.stringify(draft) === sent) this.officeDraft = null;
      if (r && !r.ok) this.flash(r.error === 'officeSign' ? M.signError : T.shop.errors[r.error] || r.error);
      if (!this.root.hidden) { this.key = ''; this.render(); }
    };
    el('h3', null, sec, M.pics);
    const row = el('div', 'pics', sec);
    for (let i = 0; i < PIC_SLOTS; i++) {
      const pic = s.pictures?.[i] || null;
      const tile = el('div', 'pic', row);
      const c = makeCanvas(16, 20), g = c.getContext('2d');
      if (pic) drawPicture(g, 0, 0, pic);
      else { g.fillStyle = '#2a2030'; g.fillRect(0, 0, 16, 20); g.fillStyle = '#3a3452'; g.fillRect(1, 1, 14, 18); g.fillStyle = '#5a5272'; g.fillRect(7, 6, 2, 8); g.fillRect(4, 9, 8, 2); }
      tile.appendChild(c);
      el('div', 'nm', tile).textContent = M.where[i];
      const act = el('div', 'act', tile);
      const file = el('input', null, tile);
      file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
      const choose = el('button', null, act, M.choose); choose.type = 'button';
      choose.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files?.[0];
        if (!f) return;
        choose.disabled = true; choose.textContent = M.busy;
        let r = null;
        try { r = await be.office?.({ picture: i, pic: await pixelize(f) }); } catch { r = { ok: false, error: 'picture' }; }
        choose.disabled = false; choose.textContent = M.choose;
        if (r && !r.ok) this.flash(T.shop.errors[r.error] || r.error);
      };
      if (pic) {
        const rm = el('button', null, act, M.remove); rm.type = 'button';
        rm.onclick = async () => { const r = await be.office?.({ picture: i, pic: null }); if (r && !r.ok) this.flash(T.shop.errors[r.error] || r.error); };
      }
    }
    el('p', 'hint', sec).textContent = M.picHint;
  }

  /** Ключовете на колегите, които са в офиса в момента. */
  crewHere() {
    const o = this.tokens.office;
    return o ? [...o.actors.values()].filter((a) => a.crewBase).map((a) => a.crewBase) : [];
  }

  presentCrew() {
    const actors = this.tokens.office?.live() || [];
    return new Map(actors.filter((a) => a.crewKey && !a.agent.leaving && !a.leavingNow).map((a) => [a.crewKey, a]));
  }

  // Presence can change without a wallet update, even when nobody earns coins.
  syncCrewPresence(now) {
    if (this.root.hidden || this.tab !== 'crew' || now < (this.nextCrewRefresh || 0)) return;
    this.nextCrewRefresh = now + 250;
    this.render();
  }

  /** Раздел „Екип“: всички колеги (проекти и видове помощници) или редакторът на един. */
  renderCrew(here) {
    const s = this.tokens.save, C = T.shop.crew, crew = s.crew || {}, seen = s.crewSeen || {};
    const o = this.tokens.office;
    const labelOf = (k) => {
      const a = here.get(k);
      if (a) return a.agent.subagent ? a.agent.atype || a.agent.provider || k.slice(2) : a.agent.label;
      return seen[k]?.label || k.slice(2);
    };
    const avOf = (k) => crew[k]?.av || randomAv(k);
    const nameOf = (k) => o?.nameOf(k) || k.slice(2);
    const sec = el('section', 'crew', this.body);
    if (this.crewSel) {
      const k = this.crewSel, av = avOf(k);
      const top = el('div', 'crewtop', sec);
      const back = el('button', 'back', top, C.back); back.type = 'button'; back.dataset.crewback = '1';
      const tx = el('div', 'tx', top);
      el('b', null, tx).textContent = nameOf(k);
      el('span', 'dim', tx).textContent = k.startsWith('t:') ? C.sub(labelOf(k)) : C.lead(labelOf(k));
      const form = el('form', 'pname', sec);
      const inp = el('input', null, form);
      inp.name = 'crew-name'; inp.maxLength = 20; inp.placeholder = C.namePh(crew[k]?.name ? '' : nameOf(k)).replace(/s+$/, ''); inp.value = crew[k]?.name || '';
      inp.setAttribute('aria-label', C.name);
      el('button', null, form, T.shop.pets.rename).type = 'submit';
      form.onsubmit = async (e) => {
        e.preventDefault();
        const r = await this.tokens.backend.crew?.({ key: k, name: inp.value });
        if (r && !r.ok) this.flash(T.shop.errors[r.error] || r.error);
      };
      if (k.startsWith('p:') && !k.includes('#')) {
        const isMe = s.crewMe === k;
        const mb = el('button', isMe ? 'meon' : '', sec, isMe ? C.notMe : C.me); mb.type = 'button'; mb.dataset.me = isMe ? '' : k;
        el('p', 'hint', sec).textContent = isMe ? C.meNote : C.avatarNote;
      }
      const ed = el('div', 'avatar', sec);
      const opts = this.personEditor(ed, av, 'cav');
      if (crew[k]) { const rb = el('button', 'reset', opts, C.reset); rb.type = 'button'; rb.dataset.crewreset = '1'; }
      return;
    }
    el('p', 'intro', sec).textContent = C.intro;
    const keys = new Set([...Object.keys(seen), ...Object.keys(crew)]);
    const history = [...keys].filter((k) => /^[pt]:/.test(k) && !here.has(k))
      .sort((p, q) => ((seen[q]?.at || 0) - (seen[p]?.at || 0)) || p.localeCompare(q));
    if (!here.size && !history.length) { el('p', 'hint', sec).textContent = C.empty; return; }
    for (const [title, ks] of [[C.present, [...here.keys()]], [C.leads, history.filter((k) => k.startsWith('p:'))],
      [C.subs, history.filter((k) => k.startsWith('t:'))]]) {
      if (!ks.length) continue;
      el('h3', null, sec, title);
      const grid = el('div', 'people', sec);
      for (const k of ks) {
        const a = here.get(k), mine = a ? a.id === o.avatarId : s.crewMe === k;
        const av = mine ? avatarOf(s) : avOf(k);
        const b = el('button', a ? 'person here' : 'person', grid);
        b.type = 'button'; b.dataset.crewsel = k;
        b.appendChild(this.personCanvas(av, 'stand', 2, a ? STATES[a.vstate]?.color || '#4ac26b' : '#4ac26b'));
        const tx = el('span', 'tx', b);
        el('b', null, tx).textContent = mine ? C.meBadge : nameOf(k);
        el('span', 'dim', tx).textContent = labelOf(k);
        if (a) el('span', 'in', tx).textContent = C.here;
      }
    }
    el('p', 'hint', sec).textContent = C.twin;
  }

  /** Любимци по видове (котки, куче, екзотични): горе обобщение (колко са в офиса), после за всеки вид:
   *  – котки/куче: по един ред за всяко отключено място (име, шарка/порода, у дома); заключените места на вида са заедно
   *    в един ред от карти за покупка (така се вижда и третата котка);
   *  – екзотични: един ред с трите места (избираш мястото) и ЕДНА обща решетка с всички животни, чиито бутони действат
   *    върху избраното място. В офиса са най-много MAX_PETS. */
  renderPets() {
    const s = this.tokens.save, eq = s.equipped || {}, P = T.shop.pets, decor = resolveDecor(eq);
    const full = petCount(s) >= MAX_PETS;
    const coin = (n) => `<i style="background-image:url(${this.coin})"></i>${fmt(n)}`;
    const slotsOf = (kind) => PET_SLOTS.filter((sl) => SLOTS[sl].pet === kind);
    const titleOf = (slot) => {
      const k = SLOTS[slot].pet, i = slotsOf(k).indexOf(slot);
      return k === 'dog' ? P.dog : k === 'exotic' ? P.exotic[i] : P.cats[i];
    };
    // карта на шарка / порода / животно; slot = мястото, за което са бутоните ('' – още няма място: само преглед)
    const card = (grid, it, slot, cur, kind) => {
      const have = owns(s, it.id);
      const c = el('div', `card${have ? ' owned' : ''}${slot && cur === it.id ? ' on' : ''}`, grid);
      c.dataset.id = it.id; if (slot) c.dataset.slot = slot;
      c.appendChild(this.thumb(it));
      el('div', 'nm', c, itemName(it));
      if (it.by) el('div', 'by', c).textContent = T.shop.by(it.by);
      el('div', 'pr', c, it.price === 0 ? T.shop.free : have ? T.shop.owned : coin(it.price));
      // вече е на друго място от същия вид (позволено е, но личи)
      const other = slot && slotsOf(kind).find((sl) => sl !== slot && decor[sl]?.id === it.id);
      if (other) el('div', 'in', c).textContent = P.inSlot(titleOf(other));
      const act = el('div', 'act', c);
      if (!slot) { const b = el('button', null, act, P.needSlot); b.disabled = true; } // преглед: първо се купува място
      else if (!have) {
        const short = it.price - (this.tokens.tokens ?? 0);
        const b = el('button', 'buy', act, short > 0 ? T.shop.need(fmt(short)) : T.shop.buy);
        b.dataset.buy = it.id; b.dataset.slot = slot; b.disabled = short > 0;
      } else {
        const b = el('button', cur === it.id ? 'on' : '', act, cur === it.id ? T.shop.equipped : T.shop.equip);
        b.dataset.equip = it.id; b.dataset.slot = slot; b.disabled = cur === it.id || (!cur && full);
      }
      return c;
    };
    // име на любимеца от дадено място (скрито, докато екзотичното място няма животно)
    const nameForm = (parent, slot, cur, hidden = false) => {
      const form = el('form', 'pname', parent);
      if (hidden) form.style.display = 'none';
      const inp = el('input', null, form);
      inp.name = `pet-${slot}`; inp.maxLength = PET_NAME_MAX; inp.placeholder = petName(slot, null, cur); inp.value = s.petNames?.[slot] || '';
      inp.setAttribute('aria-label', P.name);
      el('button', null, form, P.rename).type = 'submit';
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (!this.tokens.backend.pet) return;
        const r = await this.tokens.backend.pet(slot, inp.value);
        if (r && !r.ok) this.flash(T.shop.errors[r.error] || r.error);
      };
    };
    // карта на заключено място: цена + „Купи“; следващото е изключено, докато предишното не е купено
    const lockedCard = (row, slot) => {
      const S = SLOTS[slot], it = ITEM[S.need], prev = S.after && !unlocked(s, S.after) ? S.after : null;
      const c = el('div', 'card slotcard locked', row);
      c.dataset.id = it.id; c.dataset.pet = slot;
      if (it.gives) c.appendChild(this.thumb(it)); else el('div', 'ph', c, '+');
      el('div', 'nm', c, itemName(it));
      el('div', 'pr', c, coin(it.price));
      const short = it.price - (this.tokens.tokens ?? 0), blocked = !!it.gives && full;
      const b = el('button', 'buy', el('div', 'act', c), prev ? P.needPrev(titleOf(prev)) : blocked ? P.full : short > 0 ? T.shop.need(fmt(short)) : T.shop.buy);
      b.dataset.buy = it.id; b.disabled = !!prev || blocked || short > 0;
    };
    // първо безплатният вид (започналите с куче виждат кучето най-горе)
    const kinds = s.starter === 'dog' ? ['dog', 'cat', 'exotic'] : ['cat', 'dog', 'exotic'];
    const worn = (k) => slotsOf(k).filter((sl) => decor[sl] && unlocked(s, sl)).length;
    const sum = el('div', 'petsum', this.body);
    el('span', full ? 'all' : '', sum, P.inOffice(petCount(s), MAX_PETS));
    const chips = {};
    for (const k of kinds) { const b = el('button', null, sum, `${P.kinds[k]} ${worn(k)}`); b.type = 'button'; chips[k] = b; }

    for (const kind of kinds) {
      const head = el('h2', 'kind', this.body, P.kinds[kind]);
      chips[kind].onclick = () => head.scrollIntoView({ block: 'start', behavior: 'smooth' }); // бърз преход към вида
      el('p', 'hint', this.body, P.about[kind]);

      if (kind === 'exotic') {
        const slots = slotsOf('exotic'), mine = slots.filter((sl) => unlocked(s, sl));
        if (!this.exoSel || !mine.includes(this.exoSel)) this.exoSel = mine[0] || null; // избраното място
        const sel = this.exoSel, cur = sel ? decor[sel]?.id || null : null;
        const sec = el('section', 'pet exo', this.body);
        const row = el('div', 'slotrow', sec);
        for (const slot of slots) {
          if (!unlocked(s, slot)) { lockedCard(row, slot); continue; }
          const at = decor[slot]?.id || null, c = el('div', `slotcard${slot === sel ? ' sel' : ''}`, row);
          c.dataset.pet = slot;
          const pick = el('button', 'pick', c); pick.type = 'button'; pick.dataset.sel = slot; pick.setAttribute('aria-pressed', String(slot === sel));
          if (at) pick.appendChild(this.thumb(ITEM[at], true)); else el('div', 'ph', pick, '?');
          el('b', null, pick, titleOf(slot));
          el('span', null, pick, at ? petTitle(slot, s.petNames, at) : P.empty);
          if (at) { const b = el('button', 'home', c, P.away); b.type = 'button'; b.dataset.slot = slot; b.dataset.remove = '1'; }
        }
        if (sel) {
          el('h4', null, sec, P.chooseFor(titleOf(sel)));
          nameForm(sec, sel, cur, !cur);
          if (!cur) el('p', 'hint', sec, P.pickOne);
        } else el('p', 'hint', sec, P.exoPreview);
        const grid = el('div', 'grid', sec);
        for (const it of ITEMS.filter((x) => x.group === 'exotic')) card(grid, it, sel || '', cur, 'exotic');
        el('p', 'hint', sec, P.unlockExotic());
        continue;
      }

      const locked = [];
      for (const slot of slotsOf(kind)) {
        const S = SLOTS[slot];
        if (!unlocked(s, slot)) { locked.push(slot); continue; }
        const sec = el('section', 'pet', this.body);
        sec.dataset.pet = slot;
        const cur = decor[slot]?.id || null;
        el('h3', null, sec, `${titleOf(slot)} · ${petTitle(slot, s.petNames, cur)}${cur ? '' : ` (${P.home})`}`);
        nameForm(sec, slot, cur);
        const all = ITEMS.filter((x) => x.group === S.group), crew = all.filter((x) => x.by);
        const grid = el('div', 'grid', sec);
        let crewGrid = null;
        if (crew.length) { el('h4', null, sec, P.crew); crewGrid = el('div', 'grid', sec); }
        for (const it of [...all.filter((x) => !x.by), ...crew]) card(it.by ? crewGrid : grid, it, slot, cur, kind);
        // у дома / обратно в офиса (връща се с безплатната шарка/порода)
        const b = el('button', null, el('div', 'act', sec), cur ? P.away : P.back);
        b.dataset.slot = slot;
        if (cur) b.dataset.remove = '1';
        else { b.dataset.equip = S.def || ITEM[S.need].gives; b.disabled = full; }
      }
      if (locked.length) { // заключените места на вида – заедно в един ред
        const sec = el('section', 'pet', this.body);
        el('h3', null, sec, P.more[kind]);
        const row = el('div', 'slotrow', sec);
        for (const slot of locked) lockedCard(row, slot);
        const first = ITEM[SLOTS[locked[0]].need];
        el('p', 'hint', sec, kind === 'dog' ? P.unlockDog(itemName(ITEM[first.gives])) : P.unlockCat);
      }
    }
    el('p', 'hint', el('section', null, this.body), P.limit);
  }

  /** Лична статистика: днес + 7 дни + по проекти; експорт CSV/JSON. Данните са от сървъра (stats.js). */
  async renderStats(refresh = false) {
    const S = T.stats;
    let sec = this.body.querySelector('section.stats');
    if (!sec) { sec = el('section', 'stats', this.body); el('p', 'dim', sec).textContent = S.loading; }
    if (PARAMS.demo) { sec.innerHTML = ''; el('p', 'hint', sec).textContent = S.demo; return; }
    let r = null;
    try { r = await (await fetch('api/stats?days=7')).json(); } catch { /* */ }
    if (this.tab !== 'stats' || !sec.isConnected) return;
    if (!r?.ok) { if (!refresh) { sec.innerHTML = ''; el('p', 'hint', sec).textContent = S.offline; } return; }
    const dur = (ms) => (ms < 60000 ? (ms > 0 ? '<1 ' + T.min : '–') : fmtDurationShort(ms));
    const tok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
    const today = r.days[0], t = today.total;
    sec.innerHTML = '';
    el('h3', null, sec, S.today);
    const cards = el('div', 'cards', sec);
    const card = (k, v, sub) => { const c = el('div', 'stat', cards); el('b', null, c).textContent = v; el('span', null, c).textContent = k; if (sub) el('small', null, c).textContent = sub; };
    card(S.work, dur(t.activeMs), `${S.leads}: ${dur(t.leadActiveMs)}`);
    card(S.waited, dur(t.waitingMs));
    card(S.tools, fmt(t.tools), S.sessions(t.sessions, t.subagents));
    card(S.tokens, `${tok(t.tokIn)} / ${tok(t.tokOut)}`, `${S.cache}: ${tok(t.tokCache)}`);
    card(S.cost, fmtUsd(t.usd), t.tokNoPrice ? S.noPrice(tok(t.tokNoPrice)) : S.costHint);
    if (!t.sessions && !t.subagents) el('p', 'hint', sec).textContent = S.empty;
    // 7 дни: работа (зелено) и чакане за теб (червено) – обща скала
    el('h3', null, sec, S.days);
    const max = Math.max(1, ...r.days.map((d) => d.total.activeMs + d.total.waitingMs));
    const bars = el('div', 'bars', sec);
    for (const d of [...r.days].reverse()) {
      const col = el('div', 'day', bars);
      const stack = el('div', 'stack', col);
      const a = el('i', 'w', stack); a.style.height = `${(d.total.activeMs / max) * 100}%`;
      const w = el('i', 'q', stack); w.style.height = `${(d.total.waitingMs / max) * 100}%`;
      col.title = `${d.day}: ${S.active} ${dur(d.total.activeMs)} · ${S.waiting} ${dur(d.total.waitingMs)}`;
      el('span', null, col).textContent = d.day.slice(8) + '.' + d.day.slice(5, 7);
    }
    if (today.projects.length) {
      const tb = el('table', 'proj', sec);
      tb.innerHTML = `<thead><tr><th>${S.project}</th><th>${S.active}</th><th>${S.waiting}</th><th>${S.calls}</th><th>${S.tok}</th><th>$</th></tr></thead>`;
      const body = el('tbody', null, tb);
      for (const p of today.projects) {
        const tr = el('tr', null, body);
        el('td', null, tr).textContent = p.project; // името на папката – само като текст
        for (const v of [dur(p.activeMs), dur(p.waitingMs), fmt(p.tools), `${tok(p.tokIn)} / ${tok(p.tokOut)}`, p.usd ? fmtUsd(p.usd) : '–']) el('td', 'n', tr, v);
      }
    }
    const act = el('div', 'sw', sec);
    const a1 = el('a', 'btn', act, S.csv); a1.href = 'api/stats.csv?days=30'; a1.download = 'cubicle-crew-stats-30d.csv';
    const a2 = el('a', 'btn', act, S.json); a2.href = 'api/stats?days=30'; a2.download = 'cubicle-crew-stats-30d.json';
    el('p', 'hint', sec).textContent = S.note;
  }

  /** Времето навън: избран град + търсене; текстът от интернет се слага само като textContent. */
  renderWeather() {
    const W = T.weather, m = this.weather;
    const sec = el('section', 'weather', this.body);
    if (PARAMS.demo) { // демото: без град, времето се избира с копче
      el('p', 'hint', sec).textContent = W.demo;
      const row = el('div', 'wxdemo', sec);
      for (const k of Object.keys(W.kinds)) {
        const b = el('button', null, row); b.type = 'button'; b.textContent = W.kinds[k];
        b.addEventListener('click', () => this.onFakeWeather?.(k));
      }
      return;
    }
    el('h3', null, sec, W.city);
    const cur = el('p', 'cur', sec);
    if (m?.city) {
      const c = m.city, wx = wxFrom(m.now);
      el('b', null, cur).textContent = [c.name, c.admin1 && c.admin1 !== c.name ? c.admin1 : '', c.country].filter(Boolean).join(', ');
      const st = !m.enabled ? W.off : wx ? [W.kinds[wx.kind], wx.temp != null ? `${Math.round(wx.temp)}°` : '', wx.pop != null ? W.pop(Math.round(wx.pop)) : ''].filter(Boolean).join(' · ') : W.loading;
      cur.appendChild(document.createTextNode(' · ' + st));
    } else cur.textContent = W.none;
    const form = el('form', 'find', sec);
    const inp = el('input', null, form); inp.placeholder = W.placeholder; inp.maxLength = 60; inp.value = this.wxQuery || '';
    el('button', null, form, W.search).type = 'submit';
    const list = el('div', 'sw', sec);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = inp.value.trim(); this.wxQuery = q;
      if (q.length < 2) return;
      list.textContent = W.searching;
      let r = null;
      try { r = await (await fetch(`api/weather/search?q=${encodeURIComponent(q)}&lang=${LANG}`)).json(); } catch { /* */ }
      list.textContent = '';
      if (!r || !r.ok) { list.textContent = W.offline; return; }
      if (!r.list.length) { list.textContent = W.nothing; return; }
      for (const c of r.list) {
        const b = el('button', null, list);
        b.textContent = [c.name, c.admin1 && c.admin1 !== c.name ? c.admin1 : '', c.country].filter(Boolean).join(', ');
        b.dataset.wx = JSON.stringify({ city: c });
      }
    };
    if (m?.city) {
      const act = el('div', 'sw', sec);
      el('button', null, act, m.enabled ? W.disable : W.enable).dataset.wx = JSON.stringify({ enabled: !m.enabled });
      el('button', null, act, W.remove).dataset.wx = JSON.stringify({ city: null });
    }
    el('p', 'hint', sec).textContent = W.hint;
  }

  thumb(it, small = false) {
    let src = this.thumbs.get(it.id);
    if (!src) { src = it.group === 'cat' || it.group === 'dog' || it.group === 'exotic' ? petThumb(it) : it.group === 'catslot' ? petThumb(ITEM[it.gives || 'exotic.fennec']) : thumb(it); this.thumbs.set(it.id, src); }
    // цяло число пъти увеличение (пиксел арт), около 116x88 (в малък прозорец ~76x58)
    const [tw, th] = small || SMALL.matches ? [76, 58] : [116, 88];
    const k = Math.max(1, Math.min(6, Math.round(Math.min(tw / src.width, th / src.height))));
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
    if (it.slot) { this.tokens.setPreview(it.gives ? { ...eq, [it.slot]: it.gives } : null); return; } // отключване на котка (екзотично място – без животно)
    const slot = card.dataset.slot; // котка 1/2/3
    if (slot) { this.tokens.setPreview(eq[slot] === id || (!eq[slot] && SLOTS[slot].def === id) ? null : { ...eq, [slot]: id }); return; }
    const slots = GROUP_SLOTS[it.group];
    if (slots.some((sl) => (eq[sl] || SLOTS[sl].def) === id)) { this.tokens.setPreview(null); return; } // вече е сложено
    this.tokens.setPreview({ ...eq, [slots[0]]: id });
  }

  async click(b) {
    if (!b || b.disabled) return;
    const be = this.tokens.backend;
    let r = null;
    if (b.dataset.sel) { this.exoSel = b.dataset.sel; this.key = ''; this.hoverId = null; this.tokens.setPreview(null); this.render(); return; } // избор на екзотично място
    if (b.dataset.buy && SLOTS[ITEM[b.dataset.buy]?.slot]?.pet === 'exotic') this.exoSel = ITEM[b.dataset.buy].slot; // новото място се избира веднага
    if (b.dataset.wx) {
      b.disabled = true;
      try {
        const res = await fetch('api/weather', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b.dataset.wx });
        const j = await res.json();
        if (j.ok) { this.wxQuery = ''; this.setWeather(j); this.onWeather?.(j); } else this.flash(T.weather.nothing);
      } catch { this.flash(T.shop.errors.offline); }
      b.disabled = false;
      return;
    }
    if (b.dataset.go) { this.tab = b.dataset.go; this.key = ''; this.hoverId = null; this.tokens.setPreview(null); this.render(); this.body.scrollTop = 0; return; } // албумът -> разделът
    if (b.dataset.crewsel) { this.crewSel = b.dataset.crewsel; this.key = ''; this.render(); this.body.scrollTop = 0; return; }
    if (b.dataset.crewback) { this.crewSel = null; this.key = ''; this.render(); return; }
    if (b.dataset.me !== undefined) r = await be.crew?.(b.dataset.me ? { key: b.dataset.me, me: true } : { me: null });
    else if (b.dataset.crewreset) r = await be.crew?.({ key: this.crewSel, reset: true });
    else if (b.dataset.cav) { if (!b.classList.contains('on') && be.crew) r = await be.crew({ key: this.crewSel, av: JSON.parse(b.dataset.cav) }); }
    else if (b.dataset.av) { if (!b.classList.contains('on') && be.avatar) r = await be.avatar(JSON.parse(b.dataset.av)); }
    else if (b.dataset.buy) r = await be.buy(b.dataset.buy, b.dataset.slot || null);
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
