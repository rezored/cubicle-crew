export const OFFICE_SUBTITLE_MAX = 48;
export const DEFAULT_OFFICE_SIGN = {
  enabled: false, subtitle: '', titleColor: '#315982', subtitleColor: '#635481',
};

export function cleanOfficeSign(value) {
  const color = /^#[0-9a-f]{6}$/i;
  if (!value || typeof value.enabled !== 'boolean' || typeof value.subtitle !== 'string' ||
      typeof value.titleColor !== 'string' || !color.test(value.titleColor) ||
      typeof value.subtitleColor !== 'string' || !color.test(value.subtitleColor)) return null;
  const subtitle = Array.from(value.subtitle.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, OFFICE_SUBTITLE_MAX).join('');
  return { enabled: value.enabled, subtitle, titleColor: value.titleColor.toLowerCase(), subtitleColor: value.subtitleColor.toLowerCase() };
}

/** Един и същ DOM текст в офиса и в прегледа на магазина. */
export function showOfficeSignText(el, name, sign) {
  const title = document.createElement('span');
  title.textContent = name;
  title.style.color = sign.titleColor;
  el.replaceChildren(title);
  if (sign.subtitle) {
    const subtitle = document.createElement('span');
    subtitle.className = 'subtitle';
    subtitle.textContent = sign.subtitle;
    subtitle.style.color = sign.subtitleColor;
    el.appendChild(subtitle);
  }
  el.title = [name, sign.subtitle].filter(Boolean).join(' · ');
}
