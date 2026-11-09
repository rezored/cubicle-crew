// Екипът (постоянни колеги), разширеният аватар и „Моят офис“ (табела + картини) – правилата в catalog.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR, cleanAv, setAvatar, crewKey, setCrew, seeCrew, CREW_SEEN_MAX, setOffice, cleanPic, PIC_W, PIC_H } from '../public/catalog.js';
import { SKINS, HAIRS, PANTS, SKIRTS, SHOES, IRIS, ACCENTS, TIGHTS } from '../public/palette.js';
import { AVATAR_HAIR, AVATAR_TOPS, AVATAR_BOTTOMS, HEADS, BEARDS, DESK_ITEMS, randomAv, avatarLook } from '../public/sprites.js';
import { DEFAULT_OFFICE_SIGN } from '../public/office-sign.js';

test('office: enamel styling uses the existing name and leaves saved pictures alone', () => {
  const pictures = [null, { pal: ['#557799'], px: '0'.repeat(PIC_W * PIC_H) }];
  const save = { officeName: 'Studio', pictures };
  const sign = { ...DEFAULT_OFFICE_SIGN, enabled: true, subtitle: '  Добре   дошли  ', titleColor: '#ABCDEF', title: 'Extra name' };
  assert.equal(setOffice(save, { sign }).ok, true);
  assert.equal(save.officeName, 'Studio');
  assert.deepEqual(save.officeSign, { ...DEFAULT_OFFICE_SIGN, enabled: true, subtitle: 'Добре дошли', titleColor: '#abcdef' });
  assert.equal(setOffice(save, { name: 'Нов офис' }).ok, true);
  assert.equal(save.officeName, 'Нов офис');
  assert.equal(save.officeSign.subtitle, 'Добре дошли');
  assert.equal(setOffice(save, { sign: { ...save.officeSign, enabled: false } }).ok, true);
  assert.equal(save.officeSign.enabled, false);
  assert.deepEqual(save.pictures, pictures);
});

test('office: invalid styling does not partially change the name or picture slots', () => {
  const save = { officeName: 'Existing', pictures: [null] };
  const before = structuredClone(save);
  assert.deepEqual(setOffice(save, { name: 'New', picture: 0, pic: null, sign: { ...DEFAULT_OFFICE_SIGN, titleColor: 'red' } }),
    { ok: false, error: 'officeSign' });
  assert.deepEqual(save, before);
});

test('crew: concurrent actors can save outfits independently, including a long project key', () => {
  const save = {};
  const project = 'p:' + 'a'.repeat(60), twin = project + '#10';
  const first = randomAv(project), second = randomAv(twin);
  assert.equal(setCrew(save, { key: project, av: first }).ok, true);
  assert.equal(setCrew(save, { key: twin, av: second, name: 'Second seat' }).ok, true);
  assert.deepEqual(save.crew[project].av, cleanAv(first));
  assert.deepEqual(save.crew[twin], { av: cleanAv(second), name: 'Second seat' });
  assert.equal(setCrew(save, { key: twin, me: true }).ok, false);
});

test('crew: броят опции в catalog.js съвпада с палитрата и спрайтовете', () => {
  assert.equal(AVATAR.skins, SKINS.length);
  assert.equal(AVATAR.hairs, HAIRS.length);
  assert.equal(AVATAR.styles.m, AVATAR_HAIR.m.length);
  assert.equal(AVATAR.styles.f, AVATAR_HAIR.f.length);
  assert.equal(AVATAR.tops, AVATAR_TOPS.m.length);
  assert.equal(AVATAR.tops, AVATAR_TOPS.f.length);
  assert.equal(AVATAR.bottoms, AVATAR_BOTTOMS.f.length);
  assert.equal(AVATAR.heads, HEADS.length);
  assert.equal(AVATAR.beards, BEARDS.length);
  assert.equal(AVATAR.legs, Math.max(PANTS.length, SKIRTS.length));
  assert.equal(AVATAR.tights, TIGHTS.length);
  assert.equal(AVATAR.shoes, SHOES.length);
  assert.equal(AVATAR.iris, IRIS.length);
  assert.equal(AVATAR.accents, ACCENTS.length);
  assert.equal(AVATAR.desks, DESK_ITEMS.length);
});

test('crew: ключът – проектът за главните, типът за под-агентите', () => {
  assert.equal(crewKey({ label: 'Pixel-Office' }), 'p:pixel-office');
  assert.equal(crewKey({ label: 'x', subagent: true, atype: 'Explore' }), 't:explore');
  assert.equal(crewKey({ label: 'x', subagent: true }), 't:general-purpose');
  assert.equal(crewKey({ label: 'x', subagent: true, provider: 'codex' }), 't:codex-helper');
  assert.equal(crewKey({ label: '' }), null);
});

test('crew: случайният човек е постоянен по ключа и минава проверката', () => {
  assert.deepEqual(randomAv('p:web-shop'), randomAv('p:web-shop'));
  for (let i = 0; i < 200; i++) {
    const av = randomAv('k' + i);
    assert.ok(cleanAv(av), JSON.stringify(av));
    assert.ok(avatarLook(av, 'x').hair);
  }
});

test('crew: старият аватар (без новите полета) изглежда както преди', () => {
  const old = { skin: 2, hair: 3, glasses: true, body: 1, style: 1, top: 0, bottom: 0 };
  const l = avatarLook(old, 'me');
  assert.deepEqual(l.acc, ['glasses']);
  assert.equal(l.earrings, true);
  assert.equal(l.beard, null);
  assert.equal(l.short, false);
  assert.equal(l.tights, null);
  assert.deepEqual(l.pants, SKIRTS[0]);
  assert.equal(l.desk, null);
  const save = {};
  assert.equal(setAvatar(save, old).ok, true);
  assert.equal(setAvatar(save, { ...old, style: 8 }).ok, false);   // жените имат 8 прически (0..7)
  assert.equal(setAvatar(save, { ...old, body: 0, style: 6 }).ok, false); // мъжете – 6
  assert.equal(setAvatar(save, { ...old, head: 3, desk: 5, legs: 2 }).ok, true);
  assert.equal(save.avatar.head, 3);
  assert.equal(setAvatar(save, { ...old, head: 9 }).ok, false);
});

test('crew: име и външен вид на колега, връщане към случаен', () => {
  const save = {};
  assert.equal(setCrew(save, { key: 'bad', name: 'x' }).ok, false);
  assert.equal(setCrew(save, { key: 'p:web', name: '  Мария <b>  ' }).ok, true);
  assert.equal(save.crew['p:web'].name, 'Мария b');
  assert.equal(setCrew(save, { key: 'p:web', av: { skin: 0, hair: 0, body: 1, style: 7 } }).ok, true);
  assert.equal(save.crew['p:web'].av.style, 7);
  assert.equal(setCrew(save, { key: 'p:web', av: { skin: 99, hair: 0 } }).ok, false);
  assert.equal(setCrew(save, { key: 'p:web', name: '' }).ok, true);
  assert.ok(save.crew['p:web'].av && !save.crew['p:web'].name);
  assert.equal(setCrew(save, { key: 'p:web', reset: true }).ok, true);
  assert.equal(save.crew['p:web'], undefined);
});

test('crew: кой е идвал – най-много веднъж на 10 мин, с таван', () => {
  const save = {};
  assert.equal(seeCrew(save, 't:explore', 'Explore', 1000), 2);
  assert.equal(seeCrew(save, 't:explore', 'Explore', 2000), 0);
  assert.equal(seeCrew(save, 't:explore', 'Explore', 1000 + 600001), 1);
  for (let i = 0; i < CREW_SEEN_MAX + 10; i++) seeCrew(save, 'p:p' + i, 'p' + i, 5000 + i);
  assert.equal(Object.keys(save.crewSeen).length, CREW_SEEN_MAX);
  assert.ok(save.crewSeen['p:p' + (CREW_SEEN_MAX + 9)]);
});

test('office: табела и картини', () => {
  const save = {};
  assert.equal(setOffice(save, { name: ' Нощните\nсови <ООД> ' }).ok, true);
  assert.equal(save.officeName, 'Нощните сови ООД');
  assert.equal(setOffice(save, { name: '' }).ok, true);
  assert.equal(save.officeName, undefined);
  const pic = { pal: ['#000000', '#FFFFFF'], px: '01'.repeat((PIC_W * PIC_H) / 2) };
  assert.ok(cleanPic(pic));
  assert.equal(cleanPic({ ...pic, px: '2'.repeat(PIC_W * PIC_H) }), null); // индекс извън палитрата
  assert.equal(cleanPic({ ...pic, px: '01' }), null);
  assert.equal(cleanPic({ pal: ['red'], px: pic.px }), null);
  assert.equal(setOffice(save, { picture: 1, pic }).ok, true);
  assert.deepEqual(save.pictures.map(Boolean), [false, true, false]);
  assert.equal(save.pictures[1].pal[1], '#ffffff');
  assert.equal(setOffice(save, { picture: 3, pic }).ok, false);
  assert.equal(setOffice(save, { picture: 1, pic: null }).ok, true);
  assert.equal(save.pictures[1], null);
});

test('crew: „Това съм аз“ – само за проект, null = пак автоматично', () => {
  const save = {};
  assert.equal(setCrew(save, { key: 'p:web', me: true }).ok, true);
  assert.equal(save.crewMe, 'p:web');
  assert.equal(setCrew(save, { key: 't:explore', me: true }).ok, false);
  assert.equal(setCrew(save, { key: 'p:web#2', me: true }).ok, false);
  assert.equal(save.crewMe, 'p:web');
  assert.equal(setCrew(save, { me: null }).ok, true);
  assert.equal(save.crewMe, undefined);
});
