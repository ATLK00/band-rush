// gameEngine.js
// ตรรกะหลักของเกม (ข้อ 5 ใน GDD) — ทุกฟังก์ชันแก้ state ของ room โดยตรง (in-place)
// แล้วให้ server.js เป็นคนตัดสินใจว่าจะ broadcast event ไหนต่อ

const { CATEGORIES, INSTRUMENTS, JUNK_CARDS, ITEM_SHOP } = require('./gameData');

const MAX_CARDS_PER_DESK = 6;
const FROZEN_MS = 5000; // Fermata
const FORTE_REVEAL_MS = 3000; // Forte
const COOP_START_SECONDS = 60;
const COMPETITIVE_START_SECONDS = 300;

let cardCounter = 1;
function nextCardId() {
  return `c_${cardCounter++}`;
}

function generatePin(existingCheck) {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (existingCheck(pin));
  return pin;
}

function makeEmptyTeam(teamId) {
  return {
    teamId,
    score: 0,
    coins: 0,
    combo_count: 0,
    active_debuffs: [],
    players: {},
    playerOrder: [],
    cards_on_desk: [],
  };
}

function createRoom(pin, type) {
  return {
    pin,
    type, // 'COOP' | 'COMPETITIVE'
    status: 'LOBBY',
    timer_seconds: type === 'COOP' ? COOP_START_SECONDS : COMPETITIVE_START_SECONDS,
    teamOrder: [],
    teams: {},
    createdAt: Date.now(),
  };
}

// กระจายหมวดหมู่ (Strings/Brass/...) ให้ผู้เล่นในทีมอย่างเท่าเทียม ทุกครั้งที่รายชื่อเปลี่ยน
function reassignRoles(team) {
  const n = team.playerOrder.length;
  if (n === 0) return;
  team.playerOrder.forEach((socketId, idx) => {
    // กระจายหมวดแบบ round-robin เพื่อไม่ให้มีหมวดใดตกหล่น ไม่ว่าจำนวนผู้เล่นจะมากหรือน้อยกว่าจำนวนหมวด
    const assigned = [];
    for (let i = idx; i < CATEGORIES.length; i += n) assigned.push(CATEGORIES[i]);
    team.players[socketId].assigned_roles = assigned.length ? assigned : [CATEGORIES[idx % CATEGORIES.length]];
  });
}

function joinRoom(room, { name, teamId, socketId }) {
  if (!room.teams[teamId]) {
    room.teams[teamId] = makeEmptyTeam(teamId);
    room.teamOrder.push(teamId);
  }
  const team = room.teams[teamId];
  team.players[socketId] = { name, assigned_roles: [] };
  team.playerOrder.push(socketId);
  reassignRoles(team);
  return team;
}

function removePlayer(room, socketId) {
  for (const teamId of room.teamOrder) {
    const team = room.teams[teamId];
    if (team.players[socketId]) {
      delete team.players[socketId];
      team.playerOrder = team.playerOrder.filter((id) => id !== socketId);
      // การ์ดที่ค้างอยู่ในมือคนที่ออก โอนให้คนแรกที่เหลือ (ถ้ามี)
      if (team.playerOrder.length > 0) {
        team.cards_on_desk.forEach((c) => {
          if (c.owner === socketId) c.owner = team.playerOrder[0];
        });
        reassignRoles(team);
      }
      return teamId;
    }
  }
  return null;
}

function pickRandomCardTemplate() {
  return INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)];
}

function spawnCard(team, template) {
  if (team.playerOrder.length === 0) return null;
  if (team.cards_on_desk.length >= MAX_CARDS_PER_DESK) return null;
  const t = template || pickRandomCardTemplate();
  const owner = team.playerOrder[Math.floor(Math.random() * team.playerOrder.length)];
  const card = {
    cardId: nextCardId(),
    instrument: t.instrument,
    label: t.label,
    emoji: t.emoji,
    family: t.family,
    junk: !!t.junk,
    isFaceUp: false,
    owner,
    x: Math.round(10 + Math.random() * 70), // % จากซ้าย
    y: Math.round(15 + Math.random() * 60), // % จากบน
  };
  team.cards_on_desk.push(card);
  return card;
}

function isTeamFrozen(team) {
  const now = Date.now();
  team.active_debuffs = team.active_debuffs.filter((d) => d.expiresAt > now);
  return team.active_debuffs.some((d) => d.type === 'frozen');
}

function flipCard(team, cardId, isFaceUp, socketId) {
  const card = team.cards_on_desk.find((c) => c.cardId === cardId);
  if (!card) return null;
  if (socketId && card.owner !== socketId) return null; // เฉพาะเจ้าของการ์ดเท่านั้นที่พลิกได้
  if (isFaceUp) {
    // ข้อจำกัด: เปิดหงายค้างไว้ได้ทีละ 1 ใบต่อทีมเท่านั้น (ข้อ 4)
    team.cards_on_desk.forEach((c) => {
      if (c.cardId !== cardId) c.isFaceUp = false;
    });
  }
  card.isFaceUp = isFaceUp;
  return card;
}

// ข้อ 5.1: กลไกปัดข้ามจอ — โอนความเป็นเจ้าของการ์ดให้ "คนถัดไป" ใน array ของทีม
function swipeCard(team, cardId, fromSocketId) {
  const card = team.cards_on_desk.find((c) => c.cardId === cardId);
  if (!card) return { error: 'card_not_found' };
  if (card.owner !== fromSocketId) return { error: 'not_owner' };
  if (team.playerOrder.length < 2) return { error: 'no_teammate' };
  const idx = team.playerOrder.indexOf(fromSocketId);
  const nextIdx = (idx + 1) % team.playerOrder.length;
  const toSocketId = team.playerOrder[nextIdx];
  card.owner = toSocketId;
  card.x = 0;
  card.y = Math.round(15 + Math.random() * 60);
  card.isFaceUp = false;
  return { card, toSocketId };
}

// ข้อ 5.2 style atomic check, แต่ใช้กับการจับคู่แทนการซื้อของ
function submitMatch(team, cardId, targetRole, socketId) {
  const idx = team.cards_on_desk.findIndex((c) => c.cardId === cardId);
  if (idx === -1) return { error: 'card_not_found' };
  const card = team.cards_on_desk[idx];
  if (card.owner !== socketId) return { error: 'not_owner' };
  if (card.junk) {
    return { error: 'junk_must_be_discarded' };
  }
  const isCorrect = card.family === targetRole;
  if (isCorrect) {
    team.cards_on_desk.splice(idx, 1);
    let pointsAdded = 10;
    let coinsAdded = 10;
    team.combo_count += 1;
    if (team.combo_count % 3 === 0) coinsAdded += 15; // Combo bonus ข้อ 3
    team.score += pointsAdded;
    team.coins += coinsAdded;
    return { isCorrect: true, pointsAdded, coinsAdded, comboCount: team.combo_count };
  }
  team.combo_count = 0;
  return { isCorrect: false, pointsAdded: 0, coinsAdded: 0, comboCount: 0 };
}

// ทิ้งการ์ดขยะออกนอกจอ (ปัดทิ้งเท่านั้น ตามข้อ 3 - Coda)
function discardJunk(team, cardId, socketId) {
  const idx = team.cards_on_desk.findIndex((c) => c.cardId === cardId);
  if (idx === -1) return { error: 'card_not_found' };
  const card = team.cards_on_desk[idx];
  if (card.owner !== socketId) return { error: 'not_owner' };
  if (!card.junk) return { error: 'not_junk' };
  team.cards_on_desk.splice(idx, 1);
  return { discarded: true };
}

// ข้อ 5.2: Atomic Purchase Algorithm
function buyItem(room, buyerTeamId, itemKey, targetTeamId) {
  const item = ITEM_SHOP[itemKey];
  if (!item) return { error: 'unknown_item' };
  const team = room.teams[buyerTeamId];
  if (!team) return { error: 'team_not_found' };

  // ในโหมด COOP ไอเทมทั้งหมดเป็น "ช่วยเหลือตัวเอง" เท่านั้น (ข้อ 2.1)
  const isCoop = room.type === 'COOP';
  const effectiveTarget = isCoop ? buyerTeamId : targetTeamId;
  const targetTeam = room.teams[effectiveTarget];
  if (!targetTeam) return { error: 'target_not_found' };
  if (!isCoop && item.type === 'attack' && effectiveTarget === buyerTeamId) {
    return { error: 'cannot_target_self' };
  }

  // ----- ขั้นตอน atomic (อ่านแล้วตัดสินใจในจังหวะเดียว เพราะ JS เป็น single-threaded) -----
  if (team.coins < item.price) {
    return { error: 'error_insufficient_funds' };
  }
  team.coins -= item.price;
  // ----------------------------------------------------------------------------------

  const effect = applyItemEffect(room, item.key, team, targetTeam, isCoop);
  return { success: true, item, newBalance: team.coins, effect, targetTeamId: effectiveTarget };
}

function applyItemEffect(room, itemKey, buyerTeam, targetTeam, isCoop) {
  const now = Date.now();
  switch (itemKey) {
    case 'coda': {
      if (isCoop) {
        // COOP: เคลียร์ไพ่ขยะทั้งหมดบนโต๊ะตัวเอง
        buyerTeam.cards_on_desk = buyerTeam.cards_on_desk.filter((c) => !c.junk);
        return { kind: 'clear_junk' };
      }
      // COMPETITIVE: เสกการ์ดขยะ 5 ใบลงจอเป้าหมาย
      const spawned = [];
      for (let i = 0; i < 5; i++) {
        const junkTemplate = JUNK_CARDS[Math.floor(Math.random() * JUNK_CARDS.length)];
        const c = spawnCard(targetTeam, junkTemplate);
        if (c) spawned.push(c);
      }
      return { kind: 'junk_dropped', cards: spawned };
    }
    case 'glissando': {
      if (isCoop) {
        // COOP: ต่อเวลา +10 วินาที แทน (ตามข้อ 2.1 "ซื้อเวลาเพิ่ม")
        room.timer_seconds += 10;
        return { kind: 'time_added', seconds: 10 };
      }
      // COMPETITIVE: สลับพิกัดการ์ดคว่ำทั้งหมดบนจอเป้าหมาย
      targetTeam.cards_on_desk.forEach((c) => {
        if (!c.isFaceUp) {
          c.x = Math.round(10 + Math.random() * 70);
          c.y = Math.round(15 + Math.random() * 60);
        }
      });
      return { kind: 'shuffled' };
    }
    case 'fermata': {
      // ใช้ได้ทั้งสองโหมด: แช่แข็งจอเป้าหมาย 5 วิ (COOP จะแช่แข็งตัวเอง = ไม่คุ้ม เลยไม่ค่อยมีใครซื้อ)
      targetTeam.active_debuffs.push({ type: 'frozen', expiresAt: now + FROZEN_MS });
      return { kind: 'frozen', durationMs: FROZEN_MS };
    }
    case 'forte': {
      // เปิดไพ่คว่ำของทีมตัวเองทั้งหมด 3 วิ (buff ของทีมตัวเองเสมอ)
      buyerTeam.cards_on_desk.forEach((c) => (c.isFaceUp = true));
      return { kind: 'reveal_all', durationMs: FORTE_REVEAL_MS };
    }
    default:
      return { kind: 'none' };
  }
}

function clearExpiredDebuffs(team) {
  const now = Date.now();
  const before = team.active_debuffs.length;
  team.active_debuffs = team.active_debuffs.filter((d) => d.expiresAt > now);
  return before !== team.active_debuffs.length;
}

function computeDashboard(room) {
  const out = {};
  room.teamOrder.forEach((teamId) => {
    const t = room.teams[teamId];
    out[teamId] = { score: t.score, coins: t.coins, comboCount: t.combo_count };
  });
  return out;
}

module.exports = {
  CATEGORIES,
  ITEM_SHOP,
  generatePin,
  createRoom,
  joinRoom,
  removePlayer,
  spawnCard,
  pickRandomCardTemplate,
  flipCard,
  swipeCard,
  submitMatch,
  discardJunk,
  buyItem,
  isTeamFrozen,
  clearExpiredDebuffs,
  computeDashboard,
  MAX_CARDS_PER_DESK,
};
