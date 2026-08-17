// server.js
// Band Rush (ตั้งวงด่วน!) — Real-time server
// รัน: npm install && npm start   (ดู README.md)

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const store = require('./store');
const engine = require('./gameEngine');

const PORT = process.env.PORT || 3000;
const TICK_MS = 1000;
const SPAWN_MS = 3500;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const roomIntervals = new Map(); // pin -> { tick, spawn }

function teamRoomName(pin, teamId) {
  return `${pin}:${teamId}`;
}

function broadcastTeamSync(pin, teamId) {
  const room = store.getRoom(pin);
  if (!room) return;
  const team = room.teams[teamId];
  if (!team) return;
  io.to(teamRoomName(pin, teamId)).emit('sync_state', {
    pin,
    type: room.type,
    status: room.status,
    timer_seconds: room.timer_seconds,
    team: serializeTeam(team),
  });
}

function broadcastDashboard(pin) {
  const room = store.getRoom(pin);
  if (!room) return;
  io.to(pin).emit('dashboard_update', {
    pin,
    status: room.status,
    timer_seconds: room.timer_seconds,
    teams: engine.computeDashboard(room),
  });
}

function serializeTeam(team) {
  return {
    teamId: team.teamId,
    score: team.score,
    coins: team.coins,
    combo_count: team.combo_count,
    active_debuffs: team.active_debuffs,
    players: team.players,
    playerOrder: team.playerOrder,
    cards_on_desk: team.cards_on_desk,
  };
}

function stopRoomLoop(pin) {
  const handles = roomIntervals.get(pin);
  if (handles) {
    clearInterval(handles.tick);
    clearInterval(handles.spawn);
    roomIntervals.delete(pin);
  }
}

function startRoomLoop(pin) {
  stopRoomLoop(pin);
  const tick = setInterval(() => {
    const room = store.getRoom(pin);
    if (!room || room.status !== 'PLAYING') return;
    room.timer_seconds = Math.max(0, room.timer_seconds - 1);

    // เคลียร์ debuff ที่หมดอายุ + sync ให้ทุกทีมที่มีการเปลี่ยนแปลง
    room.teamOrder.forEach((teamId) => {
      const changed = engine.clearExpiredDebuffs(room.teams[teamId]);
      if (changed) broadcastTeamSync(pin, teamId);
    });

    broadcastDashboard(pin);

    if (room.timer_seconds <= 0) {
      room.status = 'DONE';
      io.to(pin).emit('game_over', { pin, teams: engine.computeDashboard(room) });
      stopRoomLoop(pin);
    }
  }, TICK_MS);

  const spawn = setInterval(() => {
    const room = store.getRoom(pin);
    if (!room || room.status !== 'PLAYING') return;
    room.teamOrder.forEach((teamId) => {
      const team = room.teams[teamId];
      if (engine.isTeamFrozen(team)) return; // แช่แข็งอยู่ ห้ามการ์ดใหม่ตกลงมา
      const card = engine.spawnCard(team);
      if (card) broadcastTeamSync(pin, teamId);
    });
  }, SPAWN_MS);

  roomIntervals.set(pin, { tick, spawn });
}

io.on('connection', (socket) => {
  socket.data.pin = null;
  socket.data.teamId = null;
  socket.data.isTeacher = false;

  // ---- create_room(type) ----
  socket.on('create_room', (payload, ack) => {
    const type = payload && payload.type === 'COOP' ? 'COOP' : 'COMPETITIVE';
    const pin = engine.generatePin((p) => !!store.getRoom(p));
    const room = engine.createRoom(pin, type);
    store.setRoom(pin, room);

    socket.join(pin);
    socket.data.pin = pin;
    socket.data.isTeacher = true;

    const res = { pin, type: room.type, status: room.status };
    if (typeof ack === 'function') ack(res);
    else socket.emit('room_created', res);
  });

  // ---- join_room(pin, name, teamId) ----
  socket.on('join_room', (payload, ack) => {
    const { pin, name, teamId } = payload || {};
    const room = store.getRoom(pin);
    if (!room) {
      const err = { error: 'room_not_found' };
      if (typeof ack === 'function') ack(err); else socket.emit('join_error', err);
      return;
    }
    const safeTeamId = teamId || 'team_1';
    const team = engine.joinRoom(room, { name: name || 'Player', teamId: safeTeamId, socketId: socket.id });

    socket.join(pin);
    socket.join(teamRoomName(pin, safeTeamId));
    socket.data.pin = pin;
    socket.data.teamId = safeTeamId;
    socket.data.isTeacher = false;

    const res = {
      pin,
      teamId: safeTeamId,
      type: room.type,
      status: room.status,
      assignedRoles: team.players[socket.id].assigned_roles,
    };
    if (typeof ack === 'function') ack(res);
    broadcastTeamSync(pin, safeTeamId);
    broadcastDashboard(pin);
  });

  // ---- start_game() — ครูหรือผู้เล่น (โหมด COOP) เริ่มเกม ----
  socket.on('start_game', () => {
    const { pin } = socket.data;
    const room = store.getRoom(pin);
    if (!room || room.status === 'PLAYING') return;
    room.status = 'PLAYING';
    room.teamOrder.forEach((teamId) => {
      const team = room.teams[teamId];
      // แจกการ์ดตั้งต้น 2 ใบต่อทีม
      engine.spawnCard(team);
      engine.spawnCard(team);
    });
    startRoomLoop(pin);
    io.to(pin).emit('game_started', { pin, status: room.status, timer_seconds: room.timer_seconds });
    room.teamOrder.forEach((teamId) => broadcastTeamSync(pin, teamId));
    broadcastDashboard(pin);
  });

  // ---- flip_card(cardId, isFaceUp) ----
  socket.on('flip_card', ({ cardId, isFaceUp }) => {
    const { pin, teamId } = socket.data;
    const room = store.getRoom(pin);
    if (!room || !teamId) return;
    const team = room.teams[teamId];
    if (engine.isTeamFrozen(team)) return;
    const card = engine.flipCard(team, cardId, !!isFaceUp, socket.id);
    if (card) broadcastTeamSync(pin, teamId);
  });

  // ---- swipe_card(cardId, direction) ----
  socket.on('swipe_card', ({ cardId, direction }) => {
    const { pin, teamId } = socket.data;
    const room = store.getRoom(pin);
    if (!room || !teamId) return;
    const team = room.teams[teamId];
    if (engine.isTeamFrozen(team)) return;
    const result = engine.swipeCard(team, cardId, socket.id);
    if (result.error) {
      socket.emit('action_error', { action: 'swipe_card', error: result.error });
      return;
    }
    const fromDirection = direction === 'right' ? 'left' : direction === 'left' ? 'right' : 'left';
    io.to(result.toSocketId).emit('receive_card', { card: result.card, fromDirection });
    broadcastTeamSync(pin, teamId);
  });

  // ---- submit_match(cardId, targetRole) ----
  socket.on('submit_match', ({ cardId, targetRole }) => {
    const { pin, teamId } = socket.data;
    const room = store.getRoom(pin);
    if (!room || !teamId) return;
    const team = room.teams[teamId];
    if (engine.isTeamFrozen(team)) return;
    const result = engine.submitMatch(team, cardId, targetRole, socket.id);
    if (result.error) {
      socket.emit('action_error', { action: 'submit_match', error: result.error });
      return;
    }
    io.to(teamRoomName(pin, teamId)).emit('match_result', result);
    broadcastTeamSync(pin, teamId);
    if (room.type === 'COMPETITIVE') broadcastDashboard(pin);
  });

  // ---- discard_junk(cardId) — ปัดการ์ดขยะทิ้งนอกจอ ----
  socket.on('discard_junk', ({ cardId }) => {
    const { pin, teamId } = socket.data;
    const room = store.getRoom(pin);
    if (!room || !teamId) return;
    const team = room.teams[teamId];
    const result = engine.discardJunk(team, cardId, socket.id);
    if (!result.error) broadcastTeamSync(pin, teamId);
  });

  // ---- buy_and_use_item(itemType, targetTeamId) — ข้อ 5.2 Atomic Purchase ----
  socket.on('buy_and_use_item', ({ itemType, targetTeamId }) => {
    const { pin, teamId } = socket.data;
    const room = store.getRoom(pin);
    if (!room || !teamId) return;
    const result = engine.buyItem(room, teamId, itemType, targetTeamId);
    if (result.error) {
      socket.emit('action_error', { action: 'buy_and_use_item', error: result.error });
      return;
    }
    io.to(teamRoomName(pin, teamId)).emit('coin_updated', { newBalance: result.newBalance });
    broadcastTeamSync(pin, teamId);
    if (result.targetTeamId && result.targetTeamId !== teamId) {
      io.to(teamRoomName(pin, result.targetTeamId)).emit('sabotage_hit', {
        itemType,
        fromTeamId: teamId,
        effect: result.effect,
      });
      broadcastTeamSync(pin, result.targetTeamId);
    } else if (result.effect && result.effect.kind === 'reveal_all') {
      // Forte: บอก client ให้หงายกลับหลัง 3 วิ
      setTimeout(() => {
        const r = store.getRoom(pin);
        if (!r) return;
        const t = r.teams[teamId];
        if (t) {
          t.cards_on_desk.forEach((c) => (c.isFaceUp = false));
          broadcastTeamSync(pin, teamId);
        }
      }, 3000);
    }
    broadcastDashboard(pin);
  });

  socket.on('disconnect', () => {
    const { pin, teamId } = socket.data;
    if (!pin) return;
    const room = store.getRoom(pin);
    if (!room) return;
    if (teamId) {
      engine.removePlayer(room, socket.id);
      broadcastTeamSync(pin, teamId);
      broadcastDashboard(pin);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎸 Band Rush server listening on http://localhost:${PORT}`);
});
