// Цветове и помощни функции за тях.

export const hex2rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const c255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => c255(v).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
export const shade = (h, k) => { const [r, g, b] = hex2rgb(h); return rgb2hex(r * k, g * k, b * k); };
export const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
/** 3 тона: светъл, среден, сянка (сянката е леко изместена към лилаво – по-жива от чисто черно). */
export const ramp = (mid) => ({ hi: mix(mid, '#fff6e8', 0.3), mid, lo: mix(shade(mid, 0.6), '#2a1e3a', 0.25) });

export const OUTLINE = '#17121f';
export const INK = '#1d1626';

// ---- герои ----
export const SKINS = [
  ['#ffe2c8', '#f4c6a0', '#d49a74'],
  ['#f8d2ac', '#e6ad82', '#c0845c'],
  ['#e8b48a', '#cc9064', '#a26a44'],
  ['#c88c5e', '#a96e44', '#7e4e2e'],
  ['#9c6642', '#7e4e30', '#5a3420'],
  ['#704628', '#58361e', '#3e2414'],
];
export const HAIRS = [
  ['#4a3a34', '#2c2220', '#1a1414'], // черна
  ['#7a5034', '#563622', '#3a2416'], // кестенява
  ['#a8743c', '#80542a', '#5c3a1e'], // светлокестенява
  ['#f0d070', '#d0a840', '#a07c28'], // руса
  ['#e08850', '#b8602e', '#88401e'], // рижа
  ['#c8c8d0', '#9898a8', '#6c6c7c'], // сива
  ['#6a8ae8', '#4a62c0', '#323e88'], // синя
  ['#f08ab8', '#c85c90', '#94386a'], // розова
  ['#7ad0a0', '#4aa078', '#2e7054'], // зелена
  ['#8a4a8a', '#643064', '#401c40'], // лилава
];
export const PANTS = [
  ['#4a5a8a', '#36446c', '#24304e'], // дънки
  ['#4a4a58', '#363642', '#24242e'], // въглен
  ['#a8946a', '#887450', '#645438'], // каки
  ['#2e3448', '#222636', '#161a26'], // тъмносин
  ['#6a4a3a', '#52382c', '#3a2820'], // кафяв
  ['#5a6a52', '#465440', '#323c2e'], // маслинен
];
export const SHOES = [
  ['#3a3038', '#241c24'],
  ['#e8e4dc', '#a8a49c'],
  ['#7a4a2e', '#52301c'],
  ['#c84a4a', '#8a2e2e'],
];
export const ACCENTS = ['#e05a5a', '#4a9ae0', '#f0b84a', '#5ac08a', '#c06ae0', '#f07a3a', '#3ac0c0', '#e8e8f0'];
export const MUGS = ['#e8e4dc', '#e05a5a', '#4a8fe0', '#f0c04a', '#4ac26b', '#2e2e3a', '#f08ab8'];

// ---- стая ----
export const ENV = {
  floor: ['#7a5236', '#845a3b', '#6f4a30', '#7e5538'],
  floorSeam: '#5a3a24',
  floorGrain: '#694530',
  floorHi: '#946a48',
  wall: '#56607e',
  wallStripe: '#5b6685',
  wallDark: '#3b415c',
  wainscot: '#3e4560',
  wainscotHi: '#4c5574',
  rail: '#7d88a8',
  base: '#2a2d40',
  baseHi: '#3a3e56',
  ceiling: '#2c3048',
  shadow: 'rgba(20,12,24,0.35)',
  deskTop: '#c08a58', deskTopHi: '#d4a06c', deskEdge: '#a06e44',
  deskFront: '#8c5d3a', deskFrontDk: '#6e472c', deskFrontHi: '#9e6c46',
  monitor: '#24252f', monitorHi: '#3a3c4c', monitorDk: '#16171e',
  chair: '#3d4660', chairHi: '#52607e', chairDk: '#2a3044',
  metal: '#9aa0b4', metalDk: '#6a7084',
  frame: '#e2dccb', frameDk: '#a8a08e',
  leaf: ['#5ab05a', '#3e8a46', '#2a6232'],
  pot: ['#d2784a', '#a8583a', '#7a3e2a'],
  paper: '#f4f1e8', paperDk: '#c9c2b0',
};

export const SYNTAX = ['#c678dd', '#61afef', '#98c379', '#e5c07b', '#abb2bf', '#e06c75', '#56b6c2'];
