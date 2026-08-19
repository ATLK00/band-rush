/**
 * server.js
 * ---------------------------------------------------------------
 * Real-time backend for the Music Card Matching classroom game.
 * Stack: Express (static hosting) + Socket.io (real-time transport).
 * All game state lives in memory (per-process `rooms` map) — no DB
 * is needed for a classroom session. See README.md for the full
 * explanation of the voting, item-token economy, and reconnect logic.
 * ---------------------------------------------------------------
 */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------

// Each entry is one "instrument". A board pair is built from TWO cards for
// the same entry: one shows the instrument name, the other shows its
// family/category name (e.g. "กลองชุด" <-> "เครื่องกระทบ"). This teaches
// instrument-family classification instead of simple picture memory.
const INSTRUMENTS = [
  { id: "drum_kit", th: "กลองชุด", category: "percussion" },
  { id: "maracas", th: "มาราคัส", category: "percussion" },
  { id: "xylophone", th: "ระนาดเอก", category: "percussion" },
  { id: "cymbal", th: "ฉาบ", category: "percussion" },
  { id: "guitar", th: "กีตาร์", category: "strings" },
  { id: "violin", th: "ไวโอลิน", category: "strings" },
  { id: "harp", th: "ฮาร์ป", category: "strings" },
  { id: "cello", th: "เชลโล", category: "strings" },
  { id: "trumpet", th: "ทรัมเป็ต", category: "brass" },
  { id: "trombone", th: "ทรอมโบน", category: "brass" },
  { id: "saxophone", th: "แซกโซโฟน", category: "woodwind" },
  { id: "flute", th: "ขลุ่ย", category: "woodwind" },
  { id: "piano", th: "เปียโน", category: "keyboard" },
  { id: "accordion", th: "หีบเพลง", category: "keyboard" },
];

const CATEGORY_LABEL = {
  percussion: "เครื่องกระทบ",
  strings: "เครื่องสาย",
  brass: "เครื่องเป่าลมทองเหลือง",
  woodwind: "เครื่องเป่าลมไม้",
  keyboard: "เครื่องคีย์บอร์ด",
};

const TEAM_COLORS = [
  "#FF6B9D", "#4D96FF", "#6BCB77", "#FFB84C",
  "#C780FA", "#5CE1E6", "#FF8FA3", "#FFD93D",
];

const ITEM_COOLDOWN_MS = 5000; // short anti-double-click cooldown
const FREEZE_DURATION_MS = 3000;
const PEEK_DURATION_MS = 3000;
const WRONG_MATCH_LOCK_MS = 2500; // penalty: opener can't flip right after a wrong guess
const RECONNECT_GRACE_MS = 45000; // keep a disconnected player's slot this long
const ROOM_CLEANUP_DELAY_MS = 10 * 60 * 1000; // sweep finished rooms after 10 min

// Token economy: correct matches earn 1 token; items cost tokens. This
// forces teams to actually play well before they can sabotage others,
// instead of item-spamming on a pure time cooldown.
const ITEM_COSTS = { swap: 1, freeze: 2, peek: 1 };

// ---------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------

/** @type {Map<string, Room>} */
const rooms = new Map();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeBoard(pairCount) {
  const pool = shuffle(INSTRUMENTS).slice(0, pairCount);
  const cards = pool.flatMap((inst) => [
    { instrumentId: inst.id, kind: "name", state: "hidden" },
    { instrumentId: inst.id, kind: "category", state: "hidden" },
  ]);
  return shuffle(cards);
}

function genPin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(pin));
  return pin;
}

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .slice(0, 20)
    .replace(/[<>]/g, "");
}

function findTeam(room, teamId) {
  return room.teams.find((t) => t.id === teamId);
}

/** A "confirmer" for voting purposes is anyone in the confirmer role, OR a
 *  solo player (who must approve their own matches), counting only
 *  currently-connected members so a dropped connection can't soft-lock
 *  a pending vote forever. */
function getVotingConfirmers(team) {
  return team.players.filter(
    (p) => (p.role === "confirmer" || p.role === "solo") && p.connected !== false
  );
}

/** Board view that hides the identity of hidden cards from everyone. */
function sanitizeBoard(team) {
  return team.board.map((c) => ({
    state: c.state,
    instrumentId: c.state === "hidden" ? null : c.instrumentId,
    kind: c.state === "hidden" ? null : c.kind,
  }));
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, role: p.role, connected: p.connected !== false };
}

function publicTeams(room) {
  return room.teams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    players: t.players.map(publicPlayer),
    maxPerTeam: room.settings.maxPerTeam,
    matchedPairs: t.matchedPairs,
    wrongAttempts: t.wrongAttempts,
    itemsUsedCount: t.itemsUsedCount,
    tokens: t.tokens,
    pairCount: room.settings.pairCount,
    board: sanitizeBoard(t),
    frozenUntil: t.frozenUntil,
    wrongLockUntil: t.wrongLockUntil,
    itemCooldownUntil: t.itemCooldownUntil,
    finishedAt: t.finishedAt,
  }));
}

function lobbyView(room) {
  return {
    pin: room.pin,
    settings: room.settings,
    status: room.status,
    teams: room.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      maxPerTeam: room.settings.maxPerTeam,
      players: t.players.map(publicPlayer),
    })),
  };
}

function emitLobbyUpdate(pin) {
  const room = rooms.get(pin);
  if (!room) return;
  io.to(pin).emit("lobby:update", lobbyView(room));
}

function createRoom(settings) {
  const pin = genPin();
  const numTeams = Math.max(2, Math.min(8, settings.numTeams | 0));
  const maxPerTeam = Math.max(1, Math.min(8, settings.maxPerTeam | 0));
  const gameTimeMinutes = [5, 7, 10].includes(settings.gameTimeMinutes)
    ? settings.gameTimeMinutes
    : 5;
  const pairCount = [6, 8, 10, 12].includes(settings.pairCount)
    ? settings.pairCount
    : 6;

  const teams = Array.from({ length: numTeams }, (_, i) => ({
    id: `t${i + 1}`,
    name: `ทีม ${i + 1}`,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
    players: [],
    board: makeBoard(pairCount),
    pendingFlip: [],
    votes: {},
    matchedPairs: 0,
    wrongAttempts: 0,
    itemsUsedCount: 0,
    tokens: 0,
    finishedAt: null,
    frozenUntil: 0,
    wrongLockUntil: 0,
    itemCooldownUntil: 0,
  }));

  const room = {
    pin,
    hostSocketId: null,
    hostToken: crypto.randomUUID(),
    settings: { numTeams, maxPerTeam, gameTimeMinutes, pairCount },
    status: "lobby", // lobby | playing | ended
    teams,
    startedAt: null,
    endsAt: null,
    timerHandle: null,
    lastResults: null,
    cleanupTimer: null,
  };
  rooms.set(pin, room);
  return room;
}

const INSTRUMENT_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

/**
 * Two cards count as a correct match when they show matching CONTENT —
 * one "name" card + one "category" card whose family is the same — not
 * only when they happen to be the exact pair the board originally
 * generated. So "กีตาร์" (name) correctly matches ANY "เครื่องสาย"
 * (category) card on the board, not just the one card ID that was
 * secretly paired with it at shuffle time. This matches what a student
 * can actually see and reason about.
 */
function cardsMatch(c1, c2) {
  if (!c1 || !c2 || c1.kind === c2.kind) return false; // need one name + one category
  const nameCard = c1.kind === "name" ? c1 : c2;
  const categoryCard = c1.kind === "category" ? c1 : c2;
  const nameInst = INSTRUMENT_BY_ID[nameCard.instrumentId];
  const catInst = INSTRUMENT_BY_ID[categoryCard.instrumentId];
  return !!nameInst && !!catInst && nameInst.category === catInst.category;
}

function resolvePendingFlip(pin, team, confirmed) {
  const room = rooms.get(pin);
  if (!room || team.pendingFlip.length < 2) return;
  const [i1, i2] = team.pendingFlip;
  const c1 = team.board[i1];
  const c2 = team.board[i2];
  let matched = false;

  if (confirmed && cardsMatch(c1, c2)) {
    c1.state = "matched";
    c2.state = "matched";
    team.matchedPairs += 1;
    team.tokens += 1; // earn a token for a correct match
    matched = true;
  } else {
    c1.state = "hidden";
    c2.state = "hidden";
    // Penalty only applies to a genuine wrong guess (confirmed "yes" but
    // the cards didn't actually match). Clicking "ยกเลิก" to reject a
    // clearly-bad pair before committing is the team catching their own
    // mistake — that should NOT cost them a lockout or count as a miss.
    if (confirmed) {
      team.wrongAttempts += 1;
      team.wrongLockUntil = Date.now() + WRONG_MATCH_LOCK_MS;
    }
  }

  team.pendingFlip = [];
  team.votes = {};

  io.to(pin).emit("game:cardsResolved", {
    teamId: team.id,
    matched,
    confirmed,
    board: sanitizeBoard(team),
    matchedPairs: team.matchedPairs,
    tokens: team.tokens,
    wrongLockUntil: team.wrongLockUntil,
  });

  if (team.matchedPairs === room.settings.pairCount && !team.finishedAt) {
    team.finishedAt = Date.now();
    io.to(pin).emit("game:teamFinished", {
      teamId: team.id,
      elapsedMs: team.finishedAt - room.startedAt,
    });
    maybeEndGame(pin);
  }
}

function maybeEndGame(pin) {
  const room = rooms.get(pin);
  if (!room) return;
  const allDone = room.teams.every((t) => t.finishedAt);
  if (allDone) endGame(pin);
}

function startTimer(pin) {
  const room = rooms.get(pin);
  if (!room) return;
  room.timerHandle = setInterval(() => {
    const remainingMs = room.endsAt - Date.now();
    if (remainingMs <= 0) {
      io.to(pin).emit("game:timerTick", { remainingMs: 0 });
      endGame(pin);
      return;
    }
    io.to(pin).emit("game:timerTick", { remainingMs });
  }, 1000);
}

function endGame(pin) {
  const room = rooms.get(pin);
  if (!room || room.status === "ended") return;
  room.status = "ended";
  if (room.timerHandle) clearInterval(room.timerHandle);

  const results = room.teams
    .map((t) => ({
      teamId: t.id,
      name: t.name,
      color: t.color,
      matchedPairs: t.matchedPairs,
      pairCount: room.settings.pairCount,
      wrongAttempts: t.wrongAttempts,
      itemsUsedCount: t.itemsUsedCount,
      finished: !!t.finishedAt,
      elapsedMs: t.finishedAt ? t.finishedAt - room.startedAt : null,
    }))
    .sort((a, b) => {
      if (b.matchedPairs !== a.matchedPairs) return b.matchedPairs - a.matchedPairs;
      const aTime = a.elapsedMs ?? Infinity;
      const bTime = b.elapsedMs ?? Infinity;
      return aTime - bTime;
    });

  room.lastResults = results;
  io.to(pin).emit("game:over", { results });

  // Sweep the room out of memory well after class is over.
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => rooms.delete(pin), ROOM_CLEANUP_DELAY_MS);
}

function cleanupEmptyRoomMaybe(pin) {
  const room = rooms.get(pin);
  if (!room) return;
  const hostGone = !room.hostSocketId || !io.sockets.sockets.get(room.hostSocketId);
  const noPlayers = room.teams.every((t) => t.players.length === 0);
  if (hostGone && noPlayers) {
    if (room.timerHandle) clearInterval(room.timerHandle);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    rooms.delete(pin);
  }
}

function clearPlayerDisconnectTimer(player) {
  if (player && player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
}

// ---------------------------------------------------------------
// Socket.io wiring
// ---------------------------------------------------------------

io.on("connection", (socket) => {
  // ---------- HOST ----------
  socket.on("host:createRoom", (settings, cb) => {
    const room = createRoom(settings || {});
    room.hostSocketId = socket.id;
    socket.data.role = "host";
    socket.data.pin = room.pin;
    socket.join(room.pin);
    cb && cb({ ok: true, pin: room.pin, settings: room.settings, hostToken: room.hostToken });
    emitLobbyUpdate(room.pin);
  });

  socket.on("host:rejoin", ({ pin, hostToken } = {}, cb) => {
    const room = rooms.get(pin);
    if (!room || room.hostToken !== hostToken) return cb && cb({ ok: false });
    room.hostSocketId = socket.id;
    socket.data.role = "host";
    socket.data.pin = pin;
    socket.join(pin);
    cb &&
      cb({
        ok: true,
        settings: room.settings,
        status: room.status,
        lobby: lobbyView(room),
        teams: room.status !== "lobby" ? publicTeams(room) : null,
        endsAt: room.endsAt,
        results: room.lastResults,
      });
  });

  socket.on("host:startGame", ({ pin } = {}) => {
    const room = rooms.get(pin);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.status !== "lobby") return;
    room.status = "playing";
    room.startedAt = Date.now();
    room.endsAt = room.startedAt + room.settings.gameTimeMinutes * 60000;
    io.to(pin).emit("game:started", {
      endsAt: room.endsAt,
      teams: publicTeams(room),
    });
    startTimer(pin);
  });

  socket.on("host:kickPlayer", ({ pin, playerId } = {}) => {
    const room = rooms.get(pin);
    if (!room || room.hostSocketId !== socket.id) return;
    const team = room.teams.find((t) => t.players.some((p) => p.id === playerId));
    if (!team) return;
    const player = team.players.find((p) => p.id === playerId);
    clearPlayerDisconnectTimer(player);
    team.players = team.players.filter((p) => p.id !== playerId);
    io.to(playerId).emit("client:kicked");
    emitLobbyUpdate(pin);
  });

  // ---------- CLIENT (STUDENT) ----------
  socket.on("client:joinRoom", ({ pin, playerId } = {}, cb) => {
    const room = rooms.get(pin);
    if (!room) return cb && cb({ ok: false, error: "ไม่พบห้องนี้ ตรวจสอบรหัส PIN อีกครั้ง" });
    if (room.status !== "lobby") return cb && cb({ ok: false, error: "ห้องนี้เริ่มเกมไปแล้ว" });
    socket.data.pin = pin;
    socket.data.playerId = playerId || crypto.randomUUID();
    socket.join(pin);
    cb &&
      cb({
        ok: true,
        playerId: socket.data.playerId,
        teams: room.teams.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          count: t.players.length,
          maxPerTeam: room.settings.maxPerTeam,
        })),
      });
  });

  // Reconnect after a page refresh / dropped connection. Restores the
  // player's team + role + in-progress board without losing their slot.
  socket.on("client:rejoin", ({ pin, playerId } = {}, cb) => {
    const room = rooms.get(pin);
    if (!room || !playerId) return cb && cb({ ok: false });
    const team = room.teams.find((t) => t.players.some((p) => p.playerId === playerId));
    if (!team) return cb && cb({ ok: false });
    const player = team.players.find((p) => p.playerId === playerId);

    clearPlayerDisconnectTimer(player);
    player.id = socket.id;
    player.connected = true;
    socket.data.pin = pin;
    socket.data.playerId = playerId;
    socket.data.teamId = team.id;
    socket.data.name = player.name;
    socket.join(pin);
    socket.join(`${pin}:${team.id}`);

    cb &&
      cb({
        ok: true,
        name: player.name,
        role: player.role,
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color,
        status: room.status,
        teams: publicTeams(room),
        endsAt: room.endsAt,
        results: room.lastResults,
      });
    emitLobbyUpdate(pin);
  });

  socket.on("client:setName", ({ name } = {}, cb) => {
    const pin = socket.data.pin;
    const room = rooms.get(pin);
    if (!room) return cb && cb({ ok: false, error: "ไม่พบห้อง" });
    const clean = sanitizeName(name);
    if (!clean) return cb && cb({ ok: false, error: "กรุณาใส่ชื่อ" });
    socket.data.name = clean;
    cb && cb({ ok: true, name: clean });
  });

  socket.on("client:chooseTeam", ({ teamId } = {}, cb) => {
    const room = rooms.get(socket.data.pin);
    if (!room) return cb && cb({ ok: false, error: "ไม่พบห้อง" });
    const team = findTeam(room, teamId);
    if (!team) return cb && cb({ ok: false, error: "ไม่พบทีมนี้" });
    if (team.players.length >= room.settings.maxPerTeam) {
      return cb && cb({ ok: false, error: "ทีมนี้เต็มแล้ว" });
    }
    socket.data.teamId = teamId;
    const newPlayer = {
      id: socket.id,
      playerId: socket.data.playerId,
      name: socket.data.name || "ผู้เล่น",
      role: null,
      connected: true,
      disconnectTimer: null,
    };
    team.players.push(newPlayer);
    socket.join(`${socket.data.pin}:${teamId}`);

    // Solo-team convenience: a lone teammate gets every role at once (open,
    // confirm, item) so nobody is stuck waiting on a teammate who doesn't
    // exist. They still see the normal confirm pop-up for their own flips
    // (see getVotingConfirmers) — they just don't need to wait on anyone.
    let soloMode = false;
    if (team.players.length === 1) {
      newPlayer.role = "solo";
      soloMode = true;
    } else {
      team.players.forEach((p) => {
        if (p.role === "solo") {
          p.role = null;
          io.to(p.id).emit("client:forceRoleSelect");
        }
      });
    }

    cb && cb({ ok: true, teamName: team.name, color: team.color, soloMode });
    emitLobbyUpdate(socket.data.pin);
  });

  socket.on("client:chooseRole", ({ role } = {}, cb) => {
    const room = rooms.get(socket.data.pin);
    if (!room) return cb && cb({ ok: false, error: "ไม่พบห้อง" });
    const team = findTeam(room, socket.data.teamId);
    if (!team) return cb && cb({ ok: false, error: "ไม่พบทีม" });
    const player = team.players.find((p) => p.id === socket.id);
    if (!player) return cb && cb({ ok: false, error: "ไม่พบผู้เล่น" });

    if (team.players.length === 1) {
      player.role = "solo";
      cb && cb({ ok: true, role: "solo" });
      emitLobbyUpdate(socket.data.pin);
      return;
    }

    const openerTaken = team.players.some((p) => p.role === "opener" && p.id !== socket.id);
    const itemTaken = team.players.some((p) => p.role === "item" && p.id !== socket.id);

    let finalRole = role;
    if (role === "opener" && openerTaken) return cb && cb({ ok: false, error: "มีคนเปิดไพ่แล้ว" });
    if (role === "item" && itemTaken) return cb && cb({ ok: false, error: "มีคนใช้ไอเทมแล้ว" });
    if (role !== "confirmer" && openerTaken && itemTaken) finalRole = "confirmer";

    player.role = finalRole;
    cb && cb({ ok: true, role: finalRole });
    emitLobbyUpdate(socket.data.pin);
  });

  socket.on("client:flipCard", ({ cardIndex } = {}) => {
    const pin = socket.data.pin;
    const room = rooms.get(pin);
    if (!room || room.status !== "playing") return;
    const team = findTeam(room, socket.data.teamId);
    if (!team) return;
    const player = team.players.find((p) => p.id === socket.id);
    if (!player || (player.role !== "opener" && player.role !== "solo")) return;
    const now = Date.now();
    if (now < team.frozenUntil) return; // frozen by an opponent's item
    if (now < team.wrongLockUntil) return; // penalty lock after a wrong guess
    if (team.pendingFlip.length >= 2) return; // already awaiting a vote
    const card = team.board[cardIndex];
    if (!card || card.state !== "hidden") return;

    card.state = "revealed";
    team.pendingFlip.push(cardIndex);
    io.to(pin).emit("game:boardUpdate", { teamId: team.id, board: sanitizeBoard(team) });

    if (team.pendingFlip.length === 2) {
      team.votes = {};
      const confirmers = getVotingConfirmers(team);
      if (confirmers.length === 0) {
        // Nobody available to confirm (e.g. mid-transition) — auto-approve
        // so the round can't soft-lock the team.
        resolvePendingFlip(pin, team, true);
      } else {
        io.to(pin).emit("game:voteRequest", {
          teamId: team.id,
          cardIndexes: team.pendingFlip,
          cards: team.pendingFlip.map((i) => ({
            instrumentId: team.board[i].instrumentId,
            kind: team.board[i].kind,
          })),
        });
      }
    }
  });

  socket.on("client:vote", ({ vote } = {}) => {
    const pin = socket.data.pin;
    const room = rooms.get(pin);
    if (!room || room.status !== "playing") return;
    const team = findTeam(room, socket.data.teamId);
    if (!team) return;
    const player = team.players.find((p) => p.id === socket.id);
    if (!player || (player.role !== "confirmer" && player.role !== "solo")) return;
    if (team.pendingFlip.length < 2) return;

    team.votes[socket.id] = !!vote;
    const confirmers = getVotingConfirmers(team);
    const cast = confirmers.filter((c) => Object.prototype.hasOwnProperty.call(team.votes, c.id)).length;

    io.to(pin).emit("game:voteProgress", {
      teamId: team.id,
      cast,
      total: confirmers.length,
    });

    if (cast >= confirmers.length) {
      const yesVotes = confirmers.filter((c) => team.votes[c.id]).length;
      const majority = yesVotes > confirmers.length / 2;
      resolvePendingFlip(pin, team, majority);
    }
  });

  socket.on("client:useItem", ({ itemType, targetTeamId } = {}, cb) => {
    const pin = socket.data.pin;
    const room = rooms.get(pin);
    if (!room || room.status !== "playing") return cb && cb({ ok: false });
    const team = findTeam(room, socket.data.teamId);
    if (!team) return cb && cb({ ok: false });
    const player = team.players.find((p) => p.id === socket.id);
    if (!player || (player.role !== "item" && player.role !== "solo"))
      return cb && cb({ ok: false, error: "ไม่ใช่บทบาทไอเทม" });

    if (!Object.prototype.hasOwnProperty.call(ITEM_COSTS, itemType)) {
      return cb && cb({ ok: false, error: "ไอเทมไม่ถูกต้อง" });
    }
    const now = Date.now();
    if (now < team.itemCooldownUntil) {
      return cb && cb({ ok: false, error: "กดเร็วไป รอสักครู่" });
    }
    const cost = ITEM_COSTS[itemType];
    if (team.tokens < cost) {
      return cb && cb({ ok: false, error: `โทเค็นไม่พอ ต้องการ ${cost} โทเค็น (จับคู่ถูก 1 ครั้ง = 1 โทเค็น)` });
    }

    let targetTeam = null;
    if (itemType === "swap" || itemType === "freeze") {
      targetTeam = findTeam(room, targetTeamId);
      if (!targetTeam || targetTeam.id === team.id) {
        return cb && cb({ ok: false, error: "เลือกทีมเป้าหมายไม่ถูกต้อง" });
      }
    }

    // All checks passed — spend the resources.
    team.tokens -= cost;
    team.itemCooldownUntil = now + ITEM_COOLDOWN_MS;
    team.itemsUsedCount += 1;

    if (itemType === "swap") {
      // IMPORTANT: only swap within the same `kind` (name<->name or
      // category<->category). Swapping across kinds used to let a "name"
      // card and a "category" card trade instrumentId — which could leave
      // two cards showing the exact same instrument name (a visible dupe)
      // and unbalance how many of each family exist among name-cards vs
      // category-cards, occasionally making the board unsolvable. A
      // same-kind swap is a pure permutation, so the set of names on the
      // board and the set of categories on the board never changes —
      // it just scrambles which specific card shows which one.
      const hiddenByKind = { name: [], category: [] };
      targetTeam.board.forEach((c, i) => {
        if (c.state === "hidden") hiddenByKind[c.kind].push(i);
      });
      const swappableKinds = ["name", "category"].filter((k) => hiddenByKind[k].length >= 2);
      if (swappableKinds.length > 0) {
        const kind = swappableKinds[Math.floor(Math.random() * swappableKinds.length)];
        const [a, b] = shuffle(hiddenByKind[kind]);
        const tmp = targetTeam.board[a].instrumentId;
        targetTeam.board[a].instrumentId = targetTeam.board[b].instrumentId;
        targetTeam.board[b].instrumentId = tmp;
      }
      io.to(pin).emit("game:cardsSwapped", {
        teamId: targetTeam.id,
        fromTeam: team.id,
        board: sanitizeBoard(targetTeam),
      });
    } else if (itemType === "freeze") {
      targetTeam.frozenUntil = now + FREEZE_DURATION_MS;
      io.to(pin).emit("game:teamFrozen", {
        teamId: targetTeam.id,
        fromTeam: team.id,
        until: targetTeam.frozenUntil,
        durationMs: FREEZE_DURATION_MS,
      });
    } else if (itemType === "peek") {
      // Self-help item: briefly reveal exactly ONE random hidden card (not
      // the whole board — revealing everything at once both trivializes
      // the round and causes a jarring "every card flips at once" visual
      // glitch). Doesn't change any real card state.
      const hiddenIdx = team.board
        .map((c, i) => (c.state === "hidden" && !team.pendingFlip.includes(i) ? i : -1))
        .filter((i) => i !== -1);
      if (hiddenIdx.length > 0) {
        const pickIdx = hiddenIdx[Math.floor(Math.random() * hiddenIdx.length)];
        const card = team.board[pickIdx];
        io.to(`${pin}:${team.id}`).emit("game:peek", {
          teamId: team.id,
          durationMs: PEEK_DURATION_MS,
          cardIndex: pickIdx,
          instrumentId: card.instrumentId,
          kind: card.kind,
        });
      }
    }

    io.to(pin).emit("game:itemUsed", {
      fromTeam: team.id,
      itemType,
      targetTeamId: targetTeam ? targetTeam.id : team.id,
      cooldownUntil: team.itemCooldownUntil,
      tokens: team.tokens,
    });
    cb && cb({ ok: true, cooldownUntil: team.itemCooldownUntil, tokens: team.tokens });
  });

  socket.on("disconnect", () => {
    const pin = socket.data.pin;
    if (!pin) return;
    const room = rooms.get(pin);
    if (!room) return;

    if (socket.data.role === "host" && room.hostSocketId === socket.id) {
      setTimeout(() => cleanupEmptyRoomMaybe(pin), RECONNECT_GRACE_MS);
      return;
    }

    const team = findTeam(room, socket.data.teamId);
    const player = team && team.players.find((p) => p.id === socket.id);
    if (team && player) {
      // Don't remove them immediately — a page refresh looks identical to
      // a disconnect. Keep their team slot + role reserved for a grace
      // period so client:rejoin can restore them seamlessly.
      player.connected = false;
      emitLobbyUpdate(pin);
      player.disconnectTimer = setTimeout(() => {
        const stillThere = team.players.find((p) => p.playerId === player.playerId);
        if (stillThere && !stillThere.connected) {
          team.players = team.players.filter((p) => p.playerId !== player.playerId);
          emitLobbyUpdate(pin);
        }
        cleanupEmptyRoomMaybe(pin);
      }, RECONNECT_GRACE_MS);
    } else {
      setTimeout(() => cleanupEmptyRoomMaybe(pin), RECONNECT_GRACE_MS);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Music Match Game server running on http://localhost:${PORT}`);
});
