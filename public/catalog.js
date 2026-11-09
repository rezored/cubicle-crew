// Каталог на обзавеждането + постижения. Общ за сървъра и клиента (без DOM): цени, слотове и правилата
// за купуване/слагане се проверяват на едно място. Рисуването на всеки предмет е в environment.js.
// ВНИМАНИЕ: id-тата са записът в save.json (и бъдещи Steam ключове) – НИКОГА не ги преименувай.
import { cleanOfficeSign } from './office-sign.js';

// ---- слотове: къде се слага предмет от дадена група ----
// def = безплатният предмет по подразбиране; def: null = слотът може да е празен (вкл./изкл. предмет)
export const SLOTS = {
  wall:          { group: 'wall',     def: 'wall.slate' },
  wainscot:      { group: 'wainscot', def: 'wainscot.dark' },
  floor:         { group: 'floor',    def: 'floor.oak' },
  'rug.team0':   { group: 'rug',      def: 'rug.plain.blue' },
  'rug.team1':   { group: 'rug',      def: 'rug.plain.green', hidden: true }, // един общ килим от 1.9 – слотът остава заради записите
  'rug.lounge':  { group: 'lrug',     def: 'lrug.red' },
  sofa:          { group: 'sofa',     def: 'sofa.modern.teal' },
  'chair.team0': { group: 'chair',    def: 'chair.navy' },
  'chair.team1': { group: 'chair',    def: 'chair.navy', hidden: true }, // под-агентските бюра са общи от 1.9 – остава заради записите
  'chair.lead':  { group: 'chair',    def: 'chair.red' },
  plants:        { group: 'plants',   def: 'plants.ficus' },
  posters:       { group: 'posters',  def: 'posters.classic' },
  lamp:          { group: 'lamp',     def: 'lamp.floor' },
  // любимци (pet): до MAX_PETS общо, кучето е едно. Безплатен е видът, избран в началната настройка (starter;
  // старите записи = котка), другият се отключва с покупка (need). Прибран любимец = null в equipped.
  cat:           { group: 'cat',      def: 'cat.grey', pet: 'cat', starter: 'cat', need: 'cat1.extra' }, // шарките са обща група за трите котки
  window:        { group: 'window',   def: 'window.city' },
  cat2:          { group: 'cat',      def: null, pet: 'cat', need: 'cat2.tabby', after: 'cat' }, // котка 2/3: купуват се след предишната
  cat3:          { group: 'cat',      def: null, pet: 'cat', need: 'cat3.extra', after: 'cat2' },
  dog:           { group: 'dog',      def: null, pet: 'dog', starter: 'dog', need: 'dog.extra' },
  // екзотични любимци (фенек, капибара, вомбат…): три места по 1000, животното се избира отделно
  exotic:        { group: 'exotic',   def: null, pet: 'exotic', need: 'exotic1.extra' },
  exotic2:       { group: 'exotic',   def: null, pet: 'exotic', need: 'exotic2.extra', after: 'exotic' },
  exotic3:       { group: 'exotic',   def: null, pet: 'exotic', need: 'exotic3.extra', after: 'exotic2' },
  neon:          { group: 'neon',     def: null },
  aquarium:      { group: 'aquarium', def: null },
  arcade:        { group: 'arcade',   def: null },
  massage:       { group: 'massage',  def: null },
  espresso:      { group: 'espresso', def: null },
  season:        { group: 'season',   def: null },  // сезонна украса в долния ляв ъгъл (купува се само в сезона си)
};

// ---- раздели в магазина (ред на табовете) ----
export const TABS = [
  { id: 'walls', groups: ['wall', 'wainscot'] },
  { id: 'floor', groups: ['floor', 'rug', 'lrug'] },
  { id: 'furniture', groups: ['sofa', 'chair', 'lamp'] },
  { id: 'decor', groups: ['plants', 'posters', 'window', 'season'] },
  { id: 'pets', groups: ['cat', 'catslot', 'dog', 'exotic'] },
  { id: 'special', groups: ['neon', 'espresso', 'aquarium', 'arcade', 'massage'], merge: true },
  { id: 'avatar', groups: [] },
  { id: 'crew', groups: [] },     // екипът: постоянните колеги (проекти и видове помощници)
  { id: 'stats', groups: [] },
  { id: 'weather', groups: [] },
  { id: 'trophies', groups: [] },
  { id: 'album', groups: [] }, // колекцията: какво имаш и какво още може да се купи (без случайност)
];

// Аватар на оркестраторите (★) – безплатен, един и същ всеки път. Индекси в SKINS / HAIRS от palette.js;
// body: 0 = мъж, 1 = жена; style/top/bottom: индекси в AVATAR_HAIR/AVATAR_TOPS/AVATAR_BOTTOMS[m|f] от sprites.js.
// Старите записи нямат тези полета -> 0. Мъжът винаги е с панталон (avatarLook пренебрегва bottom).
// Новите (2.22) полета са по желание: head (HEADS), beard (BEARDS), earrings, short, legs (PANTS/SKIRTS), shoes,
// iris, accent, desk (DESK_ITEMS) – липсват -> както досега. Броят им е тук, защото модулът е общ със сървъра
// (test/crew.test.js проверява, че съвпада с palette.js / sprites.js).
export const AVATAR = {
  skins: 6, hairs: 10, styles: { m: 6, f: 8 }, tops: 6, bottoms: 3,
  heads: 4, beards: 4, legs: 6, tights: 6, shoes: 4, iris: 6, accents: 8, desks: 9,
  def: { skin: 1, hair: 1, glasses: false, body: 0, style: 0, top: 0, bottom: 0 },
};
export const avatarOf = (save) => save?.avatar || AVATAR.def;

/** Проверява и нормализира описание на човек (аватар или колега); null = невалидно. */
export function cleanAv(a) {
  if (!a || typeof a !== 'object') return null;
  const num = (k, def = 0) => (a[k] === undefined || a[k] === null ? def : Number(a[k]));
  const idx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
  const body = num('body'), g = body === 1 ? 'f' : 'm';
  const out = { skin: num('skin', -1), hair: num('hair', -1), glasses: !!a.glasses, body, style: num('style'), top: num('top'), bottom: body === 1 ? num('bottom') : 0 };
  if (!idx(out.skin, AVATAR.skins) || !idx(out.hair, AVATAR.hairs) || (body !== 0 && body !== 1)) return null;
  if (!idx(out.style, AVATAR.styles[g]) || !idx(out.top, AVATAR.tops) || !idx(out.bottom, AVATAR.bottoms)) return null;
  // незадължителните – само ако са подадени
  for (const [k, n] of [['head', AVATAR.heads], ['beard', AVATAR.beards], ['legs', AVATAR.legs], ['tights', AVATAR.tights], ['shoes', AVATAR.shoes], ['iris', AVATAR.iris], ['accent', AVATAR.accents], ['desk', AVATAR.desks]]) {
    if (a[k] === undefined || a[k] === null) continue;
    const v = Number(a[k]);
    if (!idx(v, n)) return null;
    out[k] = v;
  }
  if (a.earrings !== undefined) out.earrings = !!a.earrings;
  if (a.short !== undefined) out.short = !!a.short;
  if (body === 0) delete out.earrings;
  if (body === 0 && out.beard === undefined) out.beard = 0;
  if (body === 1) delete out.beard;
  return out;
}
export function setAvatar(save, a) {
  const av = cleanAv(a);
  if (!av) return { ok: false, error: 'avatar' };
  save.avatar = av;
  return { ok: true };
}

// ---- екипът: постоянни колеги ----
// Всеки главен агент е „човекът на проекта“ (ключ p:<етикет>), всеки под-агент – „човекът на типа“
// (t:<agentType>, напр. t:explore, t:general-purpose, t:<твой агент от .claude/agents>). Без запис лицето е
// случайно, но постоянно по ключа (randomAv). save.crew[key] = { name?, av? } – промените от раздел „Екип“;
// save.crewSeen[key] = { at, label } – кой е идвал (пише сървърът, за списъка в раздела).
export const CREW_MAX = 120, CREW_SEEN_MAX = 60, CREW_NAME_MAX = 20;
const keyPart = (v) => String(v ?? '').trim().toLowerCase().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60);
/** Ключът на човека за събитие/агент: { label, subagent, atype, provider }. null = няма какво да се пази. */
export function crewKey(ev) {
  if (!ev) return null;
  if (ev.subagent) {
    const t = keyPart(ev.atype) || (ev.provider ? keyPart(ev.provider) + '-helper' : 'general-purpose');
    return 't:' + t;
  }
  const p = keyPart(ev.label);
  return p ? 'p:' + p : null;
}
// Concurrent actors add a numeric suffix to the base key.
export const crewKeyOk = (k) => typeof k === 'string' && /^[pt]:./.test(k) && k.replace(/#\d{1,6}$/, '').length <= 64;
export function cleanCrewName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, CREW_NAME_MAX);
}
/** Промяна на колега: { key, name?, av? } (av: null = пак случаен; reset: true = изцяло по подразбиране).
 *  { key: 'p:…', me: true } – на този проект седиш ти (аватарът); { me: null } – пак автоматично (първият дошъл). */
export function setCrew(save, body = {}) {
  const key = body.key;
  if ('me' in body) {
    if (!body.me) { delete save.crewMe; return { ok: true }; }
    if (!crewKeyOk(key) || !key.startsWith('p:') || key.includes('#')) return { ok: false, error: 'crew' };
    save.crewMe = key;
    return { ok: true };
  }
  if (!crewKeyOk(key)) return { ok: false, error: 'crew' };
  save.crew ||= {};
  if (body.reset) { delete save.crew[key]; return { ok: true }; }
  const cur = { ...(save.crew[key] || {}) };
  if ('name' in body) { const n = cleanCrewName(body.name); if (n) cur.name = n; else delete cur.name; }
  if ('av' in body) {
    if (body.av === null) delete cur.av;
    else { const av = cleanAv(body.av); if (!av) return { ok: false, error: 'avatar' }; cur.av = av; }
  }
  if (!cur.name && !cur.av) delete save.crew[key];
  else {
    if (!save.crew[key] && Object.keys(save.crew).length >= CREW_MAX) return { ok: false, error: 'full' };
    save.crew[key] = cur;
  }
  return { ok: true };
}
/** Сървърът отбелязва, че човекът е идвал (най-много веднъж на 10 мин). 0 = нищо, 1 = обновено, 2 = нов. */
export function seeCrew(save, key, label, now = Date.now()) {
  if (!crewKeyOk(key)) return 0;
  save.crewSeen ||= {};
  const cur = save.crewSeen[key];
  const lab = String(label ?? '').slice(0, 60);
  if (cur && now - cur.at < 600000 && cur.label === lab) return 0;
  save.crewSeen[key] = { at: now, label: lab };
  const keys = Object.keys(save.crewSeen);
  if (keys.length > CREW_SEEN_MAX) {
    keys.sort((p, q) => save.crewSeen[p].at - save.crewSeen[q].at);
    for (const k of keys.slice(0, keys.length - CREW_SEEN_MAX)) delete save.crewSeen[k];
  }
  return cur ? 1 : 2;
}

// ---- моят офис: име на табелата + твои картини на стената ----
// save.officeName – текстът на табелата над дъската; save.pictures[i] = { pal: ['#rrggbb'…] (≤16), px: PIC_W*PIC_H
// шестнайсетични цифри (индекси в pal) } – картинката е направена в браузъра (shop.js pixelize), на сървъра идват
// само тези числа. i: 0 = над диспенсъра, 1–2 = между прозорците (колкото постери има в стаята).
export const PIC_W = 14, PIC_H = 18, PIC_SLOTS = 3, OFFICE_NAME_MAX = 24;
export function cleanOfficeName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, OFFICE_NAME_MAX);
}
export function cleanPic(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.pal)) return null;
  const pal = p.pal.slice(0, 17), px = String(p.px ?? '').toLowerCase();
  if (!pal.length || pal.length > 16 || !pal.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return null;
  if (px.length !== PIC_W * PIC_H || !/^[0-9a-f]+$/.test(px)) return null;
  for (const ch of px) if (parseInt(ch, 16) >= pal.length) return null;
  return { pal: pal.map((c) => c.toLowerCase()), px };
}
/** { name } – табелата; { picture: i, pic | null } – картина i (null = пак постерът). */
export function setOffice(save, b = {}) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'officeSign' };
  const sign = 'sign' in b ? cleanOfficeSign(b.sign) : undefined;
  if (sign === null) return { ok: false, error: 'officeSign' };
  if ('picture' in b) {
    const i = Number(b.picture);
    if (!Number.isInteger(i) || i < 0 || i >= PIC_SLOTS) return { ok: false, error: 'picture' };
    const pic = b.pic === null ? null : cleanPic(b.pic);
    if (b.pic !== null && !pic) return { ok: false, error: 'picture' };
    const list = Array.from({ length: PIC_SLOTS }, (_, k) => save.pictures?.[k] || null);
    list[i] = pic;
    save.pictures = list;
  }
  if ('name' in b) {
    const n = cleanOfficeName(b.name);
    if (n) save.officeName = n; else delete save.officeName;
  }
  if (sign) save.officeSign = sign;
  return { ok: true };
}

const I = (id, group, price, name, data = {}) => ({ id, group, price, name, ...data });
export const ITEMS = [
  // стени (цвят; останалите тонове се смятат от него)
  I('wall.slate', 'wall', 0, 'Синьо-сива', { wall: '#56607e', stripe: '#5b6685', dark: '#3b415c', ceiling: '#2c3048' }),
  I('wall.sage', 'wall', 60, 'Градински чай', { wall: '#6e8a70' }),
  I('wall.terracotta', 'wall', 60, 'Теракота', { wall: '#a8644e' }),
  I('wall.charcoal', 'wall', 60, 'Графит', { wall: '#3c3c48' }),
  I('wall.navy', 'wall', 80, 'Тъмносиня', { wall: '#34406a' }),
  I('wall.cream', 'wall', 80, 'Крем', { wall: '#cbbf9e' }),
  I('wall.lavender', 'wall', 80, 'Лавандула', { wall: '#7a6a9a' }),
  I('wall.forest', 'wall', 120, 'Горско зелено', { wall: '#3e6a4e' }),
  // ламперия
  I('wainscot.dark', 'wainscot', 0, 'Тъмна ламперия', { panel: '#3e4560', hi: '#4c5574', rail: '#7d88a8', base: '#2a2d40', baseHi: '#3a3e56' }),
  I('wainscot.white', 'wainscot', 90, 'Бели панели', { panel: '#d8d2c4', hi: '#ece6da', rail: '#f4f1ea', base: '#a8a090', baseHi: '#c4bcac' }),
  I('wainscot.wood', 'wainscot', 150, 'Дървена ламперия', { panel: '#6a4630', hi: '#845a3e', rail: '#a07850', base: '#4a2e1e', baseHi: '#5e3c28' }),
  // под
  I('floor.oak', 'floor', 0, 'Дъб', { style: 'planks', planks: ['#7a5236', '#845a3b', '#6f4a30', '#7e5538'], seam: '#5a3a24', grain: '#694530', hi: '#946a48' }),
  I('floor.birch', 'floor', 180, 'Бреза', { style: 'planks', planks: ['#c8a878', '#d0b080', '#bea06e', '#ccac7c'], seam: '#9a7a50', grain: '#b09068', hi: '#e0c498' }),
  I('floor.walnut', 'floor', 200, 'Орех', { style: 'planks', planks: ['#4e3222', '#563826', '#462c1e', '#523424'], seam: '#2e1c12', grain: '#3e2618', hi: '#6a4630' }),
  I('floor.checker', 'floor', 250, 'Шахматни плочки', { style: 'checker', a: '#cfc8b8', b: '#8e8678', seam: '#6e685c' }),
  I('floor.concrete', 'floor', 300, 'Бетон (лофт)', { style: 'concrete', base: '#8a8c90', dk: '#7c7e82', hi: '#9a9ca0', seam: '#6a6c70' }),
  // килими под екипите (един купен килим става и за двата екипа)
  I('rug.plain.blue', 'rug', 0, 'Син', { style: 'plain', c: ['#323a62', '#425080', '#4a578a'] }),
  I('rug.plain.green', 'rug', 0, 'Зелен', { style: 'plain', c: ['#2e4a42', '#3c5e52', '#466a5c'] }),
  I('rug.plain.plum', 'rug', 40, 'Сливов', { style: 'plain', c: ['#4a2e4a', '#5e3c5e', '#6a466a'] }),
  I('rug.stripes', 'rug', 80, 'На райета', { style: 'stripes', c: ['#2e3a5a', '#c8a050', '#a8484a', '#d8d4cc'] }),
  I('rug.round', 'rug', 180, 'Кръгъл', { style: 'round', c: ['#3a5a7a', '#4a7090', '#e8e4dc'] }),
  I('rug.persian', 'rug', 220, 'Персийски', { style: 'persian', c: ['#5a1a20', '#8a2e30', '#c8a050', '#2a3a6a'] }),
  // килим в зоната за почивка
  I('lrug.red', 'lrug', 0, 'Червен', { style: 'classic' }),
  I('lrug.boho', 'lrug', 150, 'Бохо', { style: 'boho' }),
  I('lrug.fluffy', 'lrug', 200, 'Пухкав бял', { style: 'fluffy' }),
  // диван
  I('sofa.modern.teal', 'sofa', 0, 'Модерен – петрол', { style: 'modern', c: '#3a7a8a', hi: '#4c94a4', dk: '#265660', dk2: '#1c3e46' }),
  I('sofa.modern.mustard', 'sofa', 120, 'Модерен – горчица', { style: 'modern', c: '#c8962e' }),
  I('sofa.modern.coral', 'sofa', 120, 'Модерен – корал', { style: 'modern', c: '#d0604e' }),
  I('sofa.modern.navy', 'sofa', 120, 'Модерен – тъмносин', { style: 'modern', c: '#3a4a7a' }),
  I('sofa.modern.forest', 'sofa', 120, 'Модерен – зелен', { style: 'modern', c: '#3e7048' }),
  I('sofa.modern.grey', 'sofa', 120, 'Модерен – сив', { style: 'modern', c: '#6a6a78' }),
  I('sofa.modern.pink', 'sofa', 120, 'Модерен – розов', { style: 'modern', c: '#c86a96' }),
  I('sofa.beanbags', 'sofa', 250, 'Пуфове', { style: 'beanbags' }),
  I('sofa.chesterfield', 'sofa', 400, 'Честърфийлд', { style: 'chesterfield', c: '#7a3a2a' }),
  // столове (за под-агентите на всеки екип и за оркестраторите)
  I('chair.navy', 'chair', 0, 'Тъмносин', { c: '#3d4660', hi: '#52607e', dk: '#2a3044' }),
  I('chair.red', 'chair', 0, 'Червен', { c: '#8a2e36', hi: '#b04a50', dk: '#5a1c24' }),
  I('chair.green', 'chair', 50, 'Зелен', { c: '#3e7a52' }),
  I('chair.purple', 'chair', 50, 'Лилав', { c: '#6a4a8a' }),
  I('chair.orange', 'chair', 50, 'Оранжев', { c: '#c0703a' }),
  I('chair.black', 'chair', 50, 'Черен', { c: '#2e2e38' }),
  I('chair.white', 'chair', 50, 'Бял', { c: '#c4c4d0' }),
  I('chair.gaming', 'chair', 300, 'Геймърски', { style: 'gaming', c: '#2a2a34', accent: '#e04a6b' }),
  I('chair.throne', 'chair', 900, 'Трон', { style: 'throne', c: '#8a1e2e', gold: '#e0b84a' }),
  // растения (големите в стаята)
  I('plants.ficus', 'plants', 0, 'Фикус', { style: 'ficus' }),
  I('plants.cactus', 'plants', 90, 'Кактуси', { style: 'cactus' }),
  I('plants.monstera', 'plants', 120, 'Монстера', { style: 'monstera' }),
  I('plants.flowers', 'plants', 150, 'Цъфтящи', { style: 'flowers' }),
  // постери
  I('posters.classic', 'posters', 0, 'Класика', { kinds: ['mountain', 'rocket', 'chart'] }),
  I('posters.space', 'posters', 60, 'Космос', { kinds: ['planet', 'rocket', 'galaxy'] }),
  I('posters.nature', 'posters', 60, 'Природа', { kinds: ['sunset', 'tree', 'wave'] }),
  I('posters.code', 'posters', 60, 'Код', { kinds: ['brackets', 'terminal', 'bug'] }),
  // лампа в зоната за почивка
  I('lamp.floor', 'lamp', 0, 'Лампион', { style: 'floor' }),
  I('lamp.arc', 'lamp', 160, 'Дъгова лампа', { style: 'arc' }),
  // котки
  I('cat.grey', 'cat', 0, 'Сива котка', { c: '#3a3440', hi: '#5a5262', eye: '#e0c24a' }),
  I('cat.ginger', 'cat', 150, 'Рижа котка', { c: '#c0703a', hi: '#e0985a', eye: '#4ac26b' }),
  I('cat.black', 'cat', 150, 'Черна котка', { c: '#1c1820', hi: '#34303a', eye: '#e0c24a' }),
  I('cat.white', 'cat', 150, 'Бяла котка', { c: '#d8d4cc', hi: '#f4f2ec', eye: '#4a8fe0' }),
  I('cat.tabby', 'cat', 150, 'Тигрова котка', { c: '#8a7a64', hi: '#a8987e', eye: '#4ac26b', pat: 'tabby', p: '#5a4a3a' }),
  I('cat.tuxedo', 'cat', 200, 'Котка смокинг', { c: '#1c1820', hi: '#34303a', eye: '#e0c24a', pat: 'tuxedo', p: '#f0ece4' }),
  I('cat.calico', 'cat', 250, 'Трицветна котка', { c: '#ece6da', hi: '#fffaf0', eye: '#4ac26b', pat: 'calico', p: '#d0783a', p2: '#2a2228' }),
  I('cat.siamese', 'cat', 250, 'Сиамска котка', { c: '#e8dcc4', hi: '#f6eedc', eye: '#4a8fe0', pat: 'siamese', p: '#4a3428' }),
  I('cat.tortie', 'cat', 250, 'Котка костенурка', { c: '#2a2026', hi: '#40323a', eye: '#e0a040', pat: 'tortie', p: '#c0703a', p2: '#e0a060' }),
  // още котки: отключват мястото и идват с една шарка (cat2.tabby е старата "Втора котка" – id-то остава)
  I('cat2.tabby', 'catslot', 600, 'Втора котка', { slot: 'cat2', gives: 'cat.tabby' }),
  I('cat3.extra', 'catslot', 900, 'Трета котка', { slot: 'cat3', gives: 'cat.tuxedo' }),
  // котка за започналите с куче и куче за започналите с котка (alt: всеки може да купи само едното)
  I('cat1.extra', 'catslot', 600, 'Котка', { slot: 'cat', gives: 'cat.grey', alt: true }),
  I('dog.extra', 'catslot', 600, 'Куче', { slot: 'dog', gives: 'dog.bueno', alt: true }),
  // екзотични места: всяко струва 1000; купуването само отключва мястото – животното (вид и цвят) се избира после, свободно,
  // и може да са три еднакви. По един цвят от вид е безплатен, останалите са 300 / 500 (екзотични са!); купен цвят важи за всички места.
  I('exotic1.extra', 'catslot', 1000, 'Екзотично място 1', { slot: 'exotic' }),
  I('exotic2.extra', 'catslot', 1000, 'Екзотично място 2', { slot: 'exotic2' }),
  I('exotic3.extra', 'catslot', 1000, 'Екзотично място 3', { slot: 'exotic3' }),
  // животни (sp = вид, рисува се от Critter в characters.js; c/hi/m/e/eye + p/p2 маркировки, nose = нос за тъмните). Първият на вида е
  // старото id (записите остават валидни); нови цветове – нови id-та, никога преименуване
  I('exotic.fennec', 'exotic', 0, 'Фенек – пясъчен', { sp: 'fennec', c: '#d8b27c', hi: '#ecce9c', m: '#f4e8d4', e: '#c89a60', eye: '#1c1410', p: '#2a2220', p2: '#e8b0a0', by: 'TheDjRider' }),
  I('exotic.fennec.cream', 'exotic', 300, 'Фенек – кремав', { sp: 'fennec', c: '#ecdcc0', hi: '#f8eedc', m: '#fbf4e8', e: '#d8c4a0', eye: '#1c1410', p: '#2a2220', p2: '#e8b0a0', by: 'TheDjRider' }),
  I('exotic.fennec.pale', 'exotic', 500, 'Фенек – блед', { sp: 'fennec', c: '#f2e8d8', hi: '#fcf8ee', m: '#ffffff', e: '#e2d4ba', eye: '#1c1410', p: '#2a2220', p2: '#e8b0a0', by: 'TheDjRider' }),
  I('exotic.capybara', 'exotic', 0, 'Капибара – кафява', { sp: 'capybara', c: '#8a5e3c', hi: '#a47650', m: '#6e4a2e', e: '#5e3e26', eye: '#1c1410', p: '#a88460', by: 'TheDjRider' }),
  I('exotic.capybara.red', 'exotic', 300, 'Капибара – червеникавокафява', { sp: 'capybara', c: '#a65a38', hi: '#c27650', m: '#85402a', e: '#6e3420', eye: '#1c1410', p: '#c48862', by: 'TheDjRider' }),
  I('exotic.capybara.yellow', 'exotic', 500, 'Капибара – жълтеникавокафява', { sp: 'capybara', c: '#b3905a', hi: '#cbaa72', m: '#8e6d3e', e: '#7a5c32', eye: '#1c1410', p: '#d2b888', by: 'TheDjRider' }),
  I('exotic.capybara.gray', 'exotic', 300, 'Капибара – сивкавокафява', { sp: 'capybara', c: '#7f7064', hi: '#988878', m: '#5e5248', e: '#4f443a', eye: '#1c1410', p: '#a89c8c', by: 'TheDjRider' }),
  I('exotic.wombat', 'exotic', 0, 'Вомбат – тъмносив', { sp: 'wombat', c: '#5c585c', hi: '#78747c', m: '#403c42', e: '#34303a', eye: '#d8c8a8', p: '#f4eee0', by: 'TheDjRider' }),
  I('exotic.wombat.black', 'exotic', 500, 'Вомбат – лъскаво черен', { sp: 'wombat', c: '#26222a', hi: '#524a60', m: '#16121a', e: '#14101a', eye: '#d8c8a8', nose: '#5a4e52', p: '#f4eee0', by: 'TheDjRider' }),
  I('exotic.wombat.sandy', 'exotic', 300, 'Вомбат – пясъчен', { sp: 'wombat', c: '#b89a6c', hi: '#d0b284', m: '#8e7650', e: '#7a6440', eye: '#1c1410', p: '#5e4a34', by: 'TheDjRider' }),
  I('exotic.wombat.cream', 'exotic', 500, 'Вомбат – кремав', { sp: 'wombat', c: '#d8c8a8', hi: '#ece0c4', m: '#b4a280', e: '#9c8a68', eye: '#1c1410', p: '#5e4a34', by: 'TheDjRider' }),
  I('exotic.wombat.tan', 'exotic', 300, 'Вомбат – светлокафяв', { sp: 'wombat', c: '#a8804e', hi: '#c09862', m: '#84603a', e: '#6e4e2c', eye: '#1c1410', p: '#5e4a34', by: 'TheDjRider' }),
  // by = GitHub име на контрибютър, нарисувал предмета (любимец по негов дизайн, вж. CONTRIBUTING.md): името на
  // любимеца е фиксирано в T.pets.breeds, авторът се вижда в магазина и при посочване
  // кучета (породи) – рисуват се от Dog в characters.js. m = муцуна, e = уши, ears flop|up|half, tail long|curl|stub|plume,
  // legs short = къси крака, len = по-дълго (+) / по-късо (-) тяло, tall = по-високо, pat saddle|chest|mask|spots|tick с цвят p (tick: p2 = кафявите петна)
  I('dog.bueno', 'dog', 0, 'Буено микс', { c: '#eae6de', hi: '#fffdf6', m: '#f2eee6', e: '#2a2624', eye: '#2e1c10', ears: 'half', tail: 'plume', len: 2, tall: 1, pat: 'tick', p: '#282420', p2: '#a8773f', by: 'buensoft' }),
  I('dog.beagle', 'dog', 0, 'Бигъл', { c: '#c08a4a', hi: '#d8a464', m: '#f0e8dc', e: '#6a4426', eye: '#2a1a12', ears: 'flop', tail: 'long', pat: 'saddle', p: '#3a2a22' }),
  I('dog.golden', 'dog', 150, 'Голдън ретривър', { c: '#d8a050', hi: '#ecbc6c', m: '#e4b468', e: '#c08840', eye: '#2a1a12', ears: 'flop', tail: 'long' }),
  I('dog.black', 'dog', 150, 'Черен лабрадор', { c: '#2a2624', hi: '#423c38', m: '#34302e', e: '#1e1a18', eye: '#a07a3a', ears: 'flop', tail: 'long' }),
  I('dog.dachshund', 'dog', 200, 'Дакел', { c: '#8a4a26', hi: '#a8603a', m: '#7a3e20', e: '#5e321a', eye: '#1a1210', ears: 'flop', tail: 'long', legs: 'short', len: 3 }),
  I('dog.corgi', 'dog', 250, 'Корги', { c: '#d88a3e', hi: '#eca45a', m: '#f4ece0', e: '#c07430', eye: '#2a1a12', ears: 'up', tail: 'stub', legs: 'short', len: 1, pat: 'chest', p: '#f4ece0' }),
  I('dog.husky', 'dog', 250, 'Хъски', { c: '#6a7080', hi: '#868c9c', m: '#eef0f4', e: '#545a68', eye: '#4a8fe0', ears: 'up', tail: 'curl', pat: 'mask', p: '#eef0f4' }),
  I('dog.dalmatian', 'dog', 250, 'Далматинец', { c: '#ece8e0', hi: '#fffcf4', m: '#ece8e0', e: '#2a2624', eye: '#2a1a12', ears: 'flop', tail: 'long', pat: 'spots', p: '#24201e' }),
  I('dog.pug', 'dog', 250, 'Мопс', { c: '#d8bc8a', hi: '#ecd4a4', m: '#2e2624', e: '#2e2624', eye: '#1a1210', ears: 'flop', tail: 'curl', legs: 'short', len: -1 }),
  I('dog.maltese', 'dog', 250, 'Малтийска болонка', { c: '#eeeae4', hi: '#fffdf8', m: '#f8f4ed', e: '#d8d2c8', eye: '#272025', ears: 'flop', tail: 'plume', legs: 'short', len: -1, tall: 1 }),
  // изглед през прозорците
  I('window.city', 'window', 0, 'Град', { style: 'city' }),
  I('window.sea', 'window', 500, 'Море', { style: 'sea' }),
  I('window.mountains', 'window', 500, 'Планини', { style: 'mountains' }),
  // сезонни: продават се само между from и to (ММ-ДД, може да минава през Нова година); купеното остава завинаги
  I('season.pumpkins', 'season', 200, 'Тикви', { style: 'pumpkins', from: '10-01', to: '11-15' }),
  I('season.tree', 'season', 300, 'Коледна елха', { style: 'tree', from: '12-01', to: '01-10' }),
  I('season.tulips', 'season', 200, 'Лалета', { style: 'tulips', from: '03-01', to: '05-31' }),
  I('season.fan', 'season', 200, 'Вентилатор', { style: 'fan', from: '06-01', to: '08-31' }),
  // специални
  I('neon.code', 'neon', 350, 'Неонов надпис', { c: '#ff4ad0' }),
  I('neon.cheers', 'neon', 350, 'Наздраве', { c: '#ffb02e', style: 'cheers' }),
  // контрибюшън на Иван Туртев (by = засега името му, GitHub акаунтът предстои)
  I('neon.metal', 'neon', 0, 'Бира и метъл', { c: '#ff6a3a', style: 'metal', by: 'Ivan Turtev' }),
  I('espresso.pro', 'espresso', 800, 'Еспресо машина', {}),
  I('aquarium.reef', 'aquarium', 1200, 'Аквариум', {}),
  I('arcade.retro', 'arcade', 1500, 'Аркадна машина', {}),
  I('massage.chair', 'massage', 1300, 'Масажен стол', { by: 'Hristiyan Dimov' }),
];
export const ITEM = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
export const GROUP_SLOTS = {};
for (const [slot, s] of Object.entries(SLOTS)) if (!s.hidden) (GROUP_SLOTS[s.group] ||= []).push(slot);

// ---- постижения (фаза 4): проверяват се след всяка промяна; наградата отива само в tokens (не в lifetimeTokens) ----
// котката/кучето "от другия вид" (alt) не се брои – всеки може да купи само едното
// сезонните също не се броят – иначе „всичко“ би чакало цяла година
const paid = (s) => (s.owned || []).filter((id) => ITEM[id]?.price > 0 && !ITEM[id].alt && !ITEM[id].from).length;
const ALL_PAID = ITEMS.filter((it) => it.price > 0 && !it.alt && !it.from).length;
const M = {
  tokens: (s) => s.lifetimeTokens || 0,
  tasks: (s) => s.tasksDone || 0,
  hours: (s) => Math.floor((s.lifetimeActiveSec || 0) / 3600),
  days: (s) => s.daysActive || 0,
  shop: paid,
};
const A = (id, metric, goal, reward) => ({ id, metric, goal, reward, value: (s) => Math.min(goal, M[metric](s)) });
export const ACHIEVEMENTS = [
  A('tokens.100', 'tokens', 100, 10), A('tokens.1k', 'tokens', 1000, 50), A('tokens.5k', 'tokens', 5000, 150), A('tokens.20k', 'tokens', 20000, 400),
  A('tasks.10', 'tasks', 10, 20), A('tasks.100', 'tasks', 100, 100), A('tasks.500', 'tasks', 500, 300),
  A('hours.10', 'hours', 10, 50), A('hours.100', 'hours', 100, 300),
  A('days.7', 'days', 7, 50), A('days.30', 'days', 30, 200),
  A('shop.1', 'shop', 1, 10), A('shop.10', 'shop', 10, 100), A('shop.all', 'shop', ALL_PAID, 1000),
];

// ---- правила (едни и същи на сървъра и в демото) ----
// шарка, която идва с отключена котка, се води купена
const BUNDLED = {};
for (const it of ITEMS) if (it.gives) BUNDLED[it.gives] = it.id;
export const owns = (save, id) => !!ITEM[id] && (ITEM[id].price === 0 || (save.owned || []).includes(id) || (!!BUNDLED[id] && (save.owned || []).includes(BUNDLED[id])));
/** Мястото е отключено: без need, безплатният вид според началната настройка (старите записи = котка) или купено. */
export function unlocked(save, slot) {
  const s = SLOTS[slot];
  if (!s?.need) return true;
  if (s.starter && (save.starter || 'cat') === s.starter) return true;
  return owns(save, s.need);
}
/** Колко любимци има в офиса сега (най-много MAX_PETS). */
export const MAX_PETS = 3;
export const PET_SLOTS = Object.keys(SLOTS).filter((sl) => SLOTS[sl].pet);
export function petCount(save) {
  const d = resolveDecor(save.equipped);
  return PET_SLOTS.filter((sl) => d[sl] && unlocked(save, sl)).length;
}
const emptyPet = (save, slot) => !!SLOTS[slot]?.pet && !resolveDecor(save.equipped)[slot];
// стари записи: на мястото cat2 стоеше самият 'cat2.tabby'
const LEGACY = { 'cat2.tabby': 'cat.tabby' };

/** Сезонен предмет: продава се ли днес (from/to = 'ММ-ДД'; 12-01..01-10 минава през Нова година). */
export function inSeason(it, d = new Date()) {
  if (!it?.from) return true;
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return it.from <= it.to ? md >= it.from && md <= it.to : md >= it.from || md <= it.to;
}

/** Купува предмет. Връща { ok, error } и променя save на място. Купен предмет от слот с един вариант се слага веднага. */
export function buyItem(save, id, slot = null) {
  const it = ITEM[id];
  if (!it) return { ok: false, error: 'unknown' };
  if (owns(save, id)) return { ok: false, error: 'owned' };
  if (!inSeason(it)) return { ok: false, error: 'season' };
  if (it.slot) {
    // ново място за любимец: предишната котка трябва да я има; ако идва с готов любимец (gives) – в офиса трябва да има място
    const s = SLOTS[it.slot];
    if (unlocked(save, it.slot) || (s.after && !unlocked(save, s.after))) return { ok: false, error: 'locked' };
    if (it.gives && petCount(save) >= MAX_PETS) return { ok: false, error: 'pets' };
  }
  if (save.tokens < it.price) return { ok: false, error: 'funds' };
  save.tokens -= it.price;
  (save.owned ||= []).push(id);
  // отключен любимец: идва веднага със своята шарка/порода; място без gives (екзотичните) остава празно до избора на животно
  if (it.slot) { (save.equipped ||= {})[it.slot] = it.gives ?? null; return { ok: true, slot: it.slot }; }
  // посоченото място (напр. коя котка), иначе първото, което още е на подразбиране
  const slots = (GROUP_SLOTS[it.group] || []).filter((s) => unlocked(save, s));
  const target = (slot && slots.includes(slot) && slot) || slots.find((s) => !save.equipped?.[s] || save.equipped[s] === SLOTS[s].def) || slots[0];
  // прибран любимец при пълен офис: купено е, но не се слага
  if (target && !(emptyPet(save, target) && petCount(save) >= MAX_PETS)) (save.equipped ||= {})[target] = id;
  return { ok: true, slot: target };
}

/** Слага (или маха, id = null) предмет на място. */
export function equipItem(save, slot, id) {
  const s = SLOTS[slot];
  if (!s) return { ok: false, error: 'slot' };
  if (id == null) {
    save.equipped ||= {};
    if (s.pet && s.def) save.equipped[slot] = null; // любимецът се прибира у дома (и първата котка)
    else if (s.def) save.equipped[slot] = s.def; else delete save.equipped[slot];
    return { ok: true };
  }
  const it = ITEM[id];
  if (!it || it.group !== s.group) return { ok: false, error: 'slot' };
  if (!owns(save, id) || !unlocked(save, slot)) return { ok: false, error: 'locked' };
  if (emptyPet(save, slot) && petCount(save) >= MAX_PETS) return { ok: false, error: 'pets' };
  (save.equipped ||= {})[slot] = id;
  return { ok: true };
}

/** Име на любимец (по място): до PET_NAME_MAX знака, без контролни знаци и <>; празно = името по подразбиране. */
// ---- лакомство за любимец: клик по купичката в офиса, фиксирана цена, без случайност ----
export const TREAT_PRICE = 5;
export function giveTreat(save) {
  if ((save.tokens || 0) < TREAT_PRICE) return { ok: false, error: 'funds' };
  save.tokens -= TREAT_PRICE;
  save.treats = (save.treats || 0) + 1;
  return { ok: true };
}

export const PET_NAME_MAX = 16;
export function cleanPetName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, PET_NAME_MAX);
}
export function setPetName(save, slot, name) {
  if (!SLOTS[slot]?.pet) return { ok: false, error: 'slot' };
  const n = cleanPetName(name);
  save.petNames ||= {};
  if (n) save.petNames[slot] = n; else delete save.petNames[slot];
  return { ok: true };
}

/** Начална настройка (веднъж; setup === null = още не е минала): с какъв любимец започва офисът и името му.
 *  Без pet (пропусната) -> котка, както досега. Ако вече е минала – нищо не се променя. */
export function setupOffice(save, data = {}) {
  if (save.setup) return { ok: true };
  const pet = data.pet === 'dog' ? 'dog' : 'cat';
  save.starter = pet;
  save.equipped ||= {};
  if (pet === 'dog') { save.equipped.cat = null; save.equipped.dog = ITEM['dog.extra'].gives; }
  if (data.name != null) setPetName(save, pet, data.name);
  save.setup = new Date().toISOString().slice(0, 10);
  return { ok: true };
}

/** Нови постижения (още не записани). Наградата се добавя от извикващия. */
export function newAchievements(save) {
  const got = save.achievements || {};
  return ACHIEVEMENTS.filter((a) => !got[a.id] && a.value(save) >= a.goal);
}

/** Записва новите постижения и добавя наградите. Връща ги (за известие). */
export function grantAchievements(save, today) {
  const fresh = newAchievements(save);
  for (const a of fresh) { (save.achievements ||= {})[a.id] = today; save.tokens += a.reward; }
  return fresh;
}

/** equipped -> { slot: предмет } за рисуване (липсващо/невалидно -> по подразбиране, празно -> null). */
export function resolveDecor(equipped = {}) {
  const out = {};
  for (const [slot, s] of Object.entries(SLOTS)) {
    if (s.pet && equipped[slot] === null) { out[slot] = null; continue; } // прибран любимец
    const it = ITEM[LEGACY[equipped[slot]] || equipped[slot]];
    out[slot] = it && it.group === s.group ? it : s.def ? ITEM[s.def] : null;
  }
  return out;
}
