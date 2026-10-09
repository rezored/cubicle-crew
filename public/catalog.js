// Каталог на обзавеждането + постижения. Общ за сървъра и клиента (без DOM): цени, слотове и правилата
// за купуване/слагане се проверяват на едно място. Рисуването на всеки предмет е в environment.js.
// ВНИМАНИЕ: id-тата са записът в save.json (и бъдещи Steam ключове) – НИКОГА не ги преименувай.

// ---- слотове: къде се слага предмет от дадена група ----
// def = безплатният предмет по подразбиране; def: null = слотът може да е празен (вкл./изкл. предмет)
export const SLOTS = {
  wall:          { group: 'wall',     def: 'wall.slate' },
  wainscot:      { group: 'wainscot', def: 'wainscot.dark' },
  floor:         { group: 'floor',    def: 'floor.oak' },
  'rug.team0':   { group: 'rug',      def: 'rug.plain.blue' },
  'rug.team1':   { group: 'rug',      def: 'rug.plain.green' },
  'rug.lounge':  { group: 'lrug',     def: 'lrug.red' },
  sofa:          { group: 'sofa',     def: 'sofa.modern.teal' },
  'chair.team0': { group: 'chair',    def: 'chair.navy' },
  'chair.team1': { group: 'chair',    def: 'chair.navy' },
  'chair.lead':  { group: 'chair',    def: 'chair.red' },
  plants:        { group: 'plants',   def: 'plants.ficus' },
  posters:       { group: 'posters',  def: 'posters.classic' },
  lamp:          { group: 'lamp',     def: 'lamp.floor' },
  cat:           { group: 'cat',      def: 'cat.grey' },
  window:        { group: 'window',   def: 'window.city' },
  cat2:          { group: 'cat2',     def: null },
  neon:          { group: 'neon',     def: null },
  aquarium:      { group: 'aquarium', def: null },
  arcade:        { group: 'arcade',   def: null },
  espresso:      { group: 'espresso', def: null },
};

// ---- раздели в магазина (ред на табовете) ----
export const TABS = [
  { id: 'walls', groups: ['wall', 'wainscot'] },
  { id: 'floor', groups: ['floor', 'rug', 'lrug'] },
  { id: 'furniture', groups: ['sofa', 'chair', 'lamp'] },
  { id: 'decor', groups: ['plants', 'posters', 'window'] },
  { id: 'pets', groups: ['cat', 'cat2'] },
  { id: 'special', groups: ['neon', 'espresso', 'aquarium', 'arcade'], merge: true },
  { id: 'avatar', groups: [] },
  { id: 'trophies', groups: [] },
];

// Аватар на оркестраторите (★) – безплатен, един и същ всеки път. Индекси в SKINS / HAIRS от palette.js.
// Под-агентите остават случайни (по id).
export const AVATAR = { skins: 6, hairs: 10, def: { skin: 1, hair: 1, glasses: false } };
export const avatarOf = (save) => save?.avatar || AVATAR.def;
export function setAvatar(save, a) {
  const skin = Number(a?.skin), hair = Number(a?.hair);
  if (!Number.isInteger(skin) || skin < 0 || skin >= AVATAR.skins || !Number.isInteger(hair) || hair < 0 || hair >= AVATAR.hairs) return { ok: false, error: 'avatar' };
  save.avatar = { skin, hair, glasses: !!a.glasses };
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
  I('rug.plain.blue', 'rug', 0, 'Син', { style: 'plain', c: ['#3a3e5a', '#4a5070', '#525a7c'] }),
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
  I('cat2.tabby', 'cat2', 600, 'Втора котка', { c: '#8a7a64', hi: '#a8987e', eye: '#4ac26b' }),
  // изглед през прозорците
  I('window.city', 'window', 0, 'Град', { style: 'city' }),
  I('window.sea', 'window', 500, 'Море', { style: 'sea' }),
  I('window.mountains', 'window', 500, 'Планини', { style: 'mountains' }),
  // специални
  I('neon.code', 'neon', 350, 'Неонов надпис', { c: '#ff4ad0' }),
  I('espresso.pro', 'espresso', 800, 'Еспресо машина', {}),
  I('aquarium.reef', 'aquarium', 1200, 'Аквариум', {}),
  I('arcade.retro', 'arcade', 1500, 'Аркадна машина', {}),
];
export const ITEM = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
export const GROUP_SLOTS = {};
for (const [slot, s] of Object.entries(SLOTS)) (GROUP_SLOTS[s.group] ||= []).push(slot);

// ---- постижения (фаза 4): проверяват се след всяка промяна; наградата отива само в tokens (не в lifetimeTokens) ----
const paid = (s) => (s.owned || []).filter((id) => ITEM[id]?.price > 0).length;
const ALL_PAID = ITEMS.filter((it) => it.price > 0).length;
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
export const owns = (save, id) => ITEM[id] && (ITEM[id].price === 0 || (save.owned || []).includes(id));

/** Купува предмет. Връща { ok, error } и променя save на място. Купен предмет от слот с един вариант се слага веднага. */
export function buyItem(save, id) {
  const it = ITEM[id];
  if (!it) return { ok: false, error: 'unknown' };
  if (owns(save, id)) return { ok: false, error: 'owned' };
  if (save.tokens < it.price) return { ok: false, error: 'funds' };
  save.tokens -= it.price;
  (save.owned ||= []).push(id);
  // първото място за групата, което още е на подразбиране, получава новия предмет
  const slots = GROUP_SLOTS[it.group] || [];
  const target = slots.find((s) => !save.equipped?.[s] || save.equipped[s] === SLOTS[s].def) || slots[0];
  if (target) (save.equipped ||= {})[target] = id;
  return { ok: true, slot: target };
}

/** Слага (или маха, id = null) предмет на място. */
export function equipItem(save, slot, id) {
  const s = SLOTS[slot];
  if (!s) return { ok: false, error: 'slot' };
  if (id == null) {
    save.equipped ||= {};
    if (s.def) save.equipped[slot] = s.def; else delete save.equipped[slot];
    return { ok: true };
  }
  const it = ITEM[id];
  if (!it || it.group !== s.group) return { ok: false, error: 'slot' };
  if (!owns(save, id)) return { ok: false, error: 'locked' };
  (save.equipped ||= {})[slot] = id;
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
    const it = ITEM[equipped[slot]];
    out[slot] = it && it.group === s.group ? it : s.def ? ITEM[s.def] : null;
  }
  return out;
}
