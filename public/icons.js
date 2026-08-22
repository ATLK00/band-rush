/**
 * icons.js
 * Hand-drawn minimalist line-icon set used everywhere instead of emoji.
 * Every icon is plain inline SVG so it inherits currentColor / a passed
 * color and scales crisply at any size.
 */

const ICONS = {
  card: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="6" width="26" height="34" rx="4"/>
      <path d="M34 14 L40 20 V40 a2 2 0 0 1-2 2 H16"/>
    </svg>`,
  check: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 25 L19 36 L40 12"/>
    </svg>`,
  bolt: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="${c}" stroke="none">
      <path d="M26 4 L10 27 H22 L20 44 L38 19 H26 Z"/>
    </svg>`,
  swap: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 16 H36"/><path d="M28 8 L36 16 L28 24"/>
      <path d="M42 32 H12"/><path d="M20 40 L12 32 L20 24"/>
    </svg>`,
  freeze: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round">
      <path d="M24 4 V44 M8 12 L40 36 M40 12 L8 36"/>
      <path d="M24 4 L19 9 M24 4 L29 9 M24 44 L19 39 M24 44 L29 39"/>
      <path d="M8 12 L14 12 M8 12 L10 18 M40 36 L34 36 M40 36 L38 30"/>
      <path d="M40 12 L34 12 M40 12 L38 18 M8 36 L14 36 M8 36 L10 30"/>
    </svg>`,
  trophy: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 6 H34 V18 a10 10 0 0 1-20 0 Z"/>
      <path d="M14 9 H6 a2 2 0 0 0-2 2 c0 7 5 11 10 11.5"/>
      <path d="M34 9 H42 a2 2 0 0 1 2 2 c0 7-5 11-10 11.5"/>
      <path d="M24 28 V36 M16 42 H32 M18 36 H30 L32 42 H16 Z"/>
    </svg>`,
  back: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M28 10 L14 24 L28 38"/><path d="M14 24 H40"/>
    </svg>`,
  timer: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="24" cy="26" r="16"/><path d="M24 16 V26 L32 32"/><path d="M18 4 H30"/>
    </svg>`,
  solo: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="24" cy="14" r="8"/><path d="M8 42 c0-10 7-16 16-16 s16 6 16 16"/>
    </svg>`,
  eye: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 24 C10 12 20 8 24 8 C28 8 38 12 44 24 C38 36 28 40 24 40 C20 40 10 36 4 24 Z"/>
      <circle cx="24" cy="24" r="6"/>
    </svg>`,
  coin: (c = "currentColor") => `
    <svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="24" cy="24" r="18"/><path d="M24 15 V33 M18 19 h9 a4 4 0 0 1 0 8 h-9 M18 29 h10"/>
    </svg>`,
};

const CATEGORY_META = {
  percussion: {
    label: "เครื่องกระทบ",
    color: "#FF6B9D",
    icon: (c) => `<svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="24" cy="13" rx="16" ry="7"/>
      <path d="M8 13 V30 C8 38 40 38 40 30 V13"/>
    </svg>`,
  },
  strings: {
    label: "เครื่องสาย",
    color: "#4D96FF",
    icon: (c) => `<svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6 C24 2 30 6 30 6 L30 20 C36 26 33 34 27 36 C21 39 14 33 15 26 C16 20 18 20 18 20 Z"/>
      <line x1="24" y1="6" x2="24" y2="40"/>
    </svg>`,
  },
  brass: {
    label: "เครื่องเป่าลมทองเหลือง",
    color: "#FFB84C",
    icon: (c) => `<svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 20 H28 L40 34 C30 30 18 30 8 30 Z"/>
      <circle cx="8" cy="25" r="4"/>
    </svg>`,
  },
  woodwind: {
    label: "เครื่องเป่าลมไม้",
    color: "#6BCB77",
    icon: (c) => `<svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="19" width="38" height="9" rx="4.5"/>
      <circle cx="15" cy="23.5" r="1.6" fill="${c}" stroke="none"/>
      <circle cx="24" cy="23.5" r="1.6" fill="${c}" stroke="none"/>
      <circle cx="33" cy="23.5" r="1.6" fill="${c}" stroke="none"/>
    </svg>`,
  },
  keyboard: {
    label: "เครื่องลิ่มนิ้ว",
    color: "#C780FA",
    icon: (c) => `<svg viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="13" width="38" height="21" rx="2"/>
      <line x1="16" y1="13" x2="16" y2="27"/><line x1="27" y1="13" x2="27" y2="27"/><line x1="38" y1="13" x2="38" y2="27"/>
    </svg>`,
  },
};

function categoryIconHtml(categoryId, color) {
  const meta = CATEGORY_META[categoryId];
  if (!meta) return "";
  return meta.icon(color || meta.color);
}

function iconHtml(name, color) {
  const fn = ICONS[name];
  return fn ? fn(color) : "";
}
