// gameData.js
// เครื่องดนตรีและหมวดหมู่ทั้งหมดในเกม Band Rush

const CATEGORIES = ['Strings', 'Brass', 'Woodwind', 'Percussion', 'Keyboard'];

const CATEGORY_LABELS_TH = {
  Strings: 'เครื่องสาย',
  Brass: 'เครื่องทองเหลือง',
  Woodwind: 'เครื่องลมไม้',
  Percussion: 'เครื่องกระทบ',
  Keyboard: 'คีย์บอร์ด',
};

const INSTRUMENTS = [
  { instrument: 'violin', label: 'ไวโอลิน', family: 'Strings', emoji: '🎻' },
  { instrument: 'cello', label: 'เชลโล', family: 'Strings', emoji: '🎻' },
  { instrument: 'guitar', label: 'กีตาร์', family: 'Strings', emoji: '🎸' },
  { instrument: 'harp', label: 'พิณฝรั่ง', family: 'Strings', emoji: '🎼' },
  { instrument: 'trumpet', label: 'ทรัมเป็ต', family: 'Brass', emoji: '🎺' },
  { instrument: 'trombone', label: 'ทรอมโบน', family: 'Brass', emoji: '🎺' },
  { instrument: 'tuba', label: 'ทูบา', family: 'Brass', emoji: '🎺' },
  { instrument: 'french_horn', label: 'เฟรนช์ฮอร์น', family: 'Brass', emoji: '📯' },
  { instrument: 'flute', label: 'ฟลุต', family: 'Woodwind', emoji: '🪈' },
  { instrument: 'clarinet', label: 'คลาริเน็ต', family: 'Woodwind', emoji: '🪈' },
  { instrument: 'saxophone', label: 'แซกโซโฟน', family: 'Woodwind', emoji: '🎷' },
  { instrument: 'oboe', label: 'โอโบ', family: 'Woodwind', emoji: '🪈' },
  { instrument: 'drums', label: 'กลองชุด', family: 'Percussion', emoji: '🥁' },
  { instrument: 'xylophone', label: 'ระนาด', family: 'Percussion', emoji: '🥁' },
  { instrument: 'tambourine', label: 'แทมบูรีน', family: 'Percussion', emoji: '🪘' },
  { instrument: 'cymbals', label: 'ฉาบ', family: 'Percussion', emoji: '🥁' },
  { instrument: 'piano', label: 'เปียโน', family: 'Keyboard', emoji: '🎹' },
  { instrument: 'organ', label: 'ออร์แกน', family: 'Keyboard', emoji: '🎹' },
  { instrument: 'synth', label: 'ซินธ์', family: 'Keyboard', emoji: '🎹' },
  { instrument: 'accordion', label: 'หีบเพลง', family: 'Keyboard', emoji: '🪗' },
];

// การ์ดขยะ (Coda item spawns these) - ไม่มี family ที่แท้จริง ต้องปัดทิ้งนอกจอเท่านั้น
const JUNK_CARDS = [
  { instrument: 'shoe', label: 'รองเท้า', family: null, emoji: '👞', junk: true },
  { instrument: 'broom', label: 'ไม้กวาด', family: null, emoji: '🧹', junk: true },
  { instrument: 'fish', label: 'ปลา', family: null, emoji: '🐟', junk: true },
];

const ITEM_SHOP = {
  coda: { key: 'coda', name: 'Coda (ระเบิดขยะ)', price: 20, type: 'attack', tier: 'bronze' },
  glissando: { key: 'glissando', name: 'Glissando (พายุสลับการ์ด)', price: 40, type: 'attack', tier: 'silver' },
  fermata: { key: 'fermata', name: 'Fermata (หยุดเวลา)', price: 80, type: 'attack', tier: 'gold' },
  forte: { key: 'forte', name: 'Forte (สว่างวาบ)', price: 30, type: 'buff', tier: 'special' },
};

module.exports = { CATEGORIES, CATEGORY_LABELS_TH, INSTRUMENTS, JUNK_CARDS, ITEM_SHOP };
