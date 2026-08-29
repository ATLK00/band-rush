/**
 * client.js — Student ("Client") page logic.
 * See README.md for the full socket-flow write-up.
 *
 * New in this revision:
 *  - Reconnect-safe: a per-tab playerId is kept in sessionStorage, so a
 *    refresh (or brief dropped connection) restores your team/role/board
 *    instead of kicking you back to the PIN screen (client:rejoin).
 *  - Solo teams now still see the confirm pop-up for their own flips —
 *    they just don't need to wait on anyone else (see getVotingConfirmers
 *    on the server).
 *  - Wrong matches lock the opener out briefly (penalty), mirroring the
 *    freeze effect visually.
 *  - Items cost tokens earned from correct matches instead of a pure
 *    cooldown, plus a new self-only "peek" item.
 */

const socket = io({
  // Faster, snappier reconnects on flaky classroom wifi — don't wait a
  // full default backoff before retrying, and never give up.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2000,
  timeout: 10000,
});

const ITEM_COSTS = { swap: 1, freeze: 2, peek: 1 };
const ITEM_LABELS = { swap: "สลับตำแหน่งไพ่", freeze: "แช่แข็ง 5 วิ", peek: "ส่องไพ่ 3 วิ" };

function getOrCreatePlayerId() {
  let id = sessionStorage.getItem("mmg_playerId");
  if (!id) {
    id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "p-" + Math.random().toString(36).slice(2);
    sessionStorage.setItem("mmg_playerId", id);
  }
  return id;
}

const state = {
  playerId: getOrCreatePlayerId(),
  pin: null,
  teamId: null,
  teamName: null,
  teamColor: null,
  role: null,
  pairCount: 6,
  board: [],
  teams: [],
  tokens: 0,
  frozenUntil: 0,
  wrongLockUntil: 0,
};

function isBoardLocked() {
  return Date.now() < state.frozenUntil || Date.now() < state.wrongLockUntil;
}

// ---------------- Screen helpers ----------------
const screens = [
  "screen-loading",
  "screen-join",
  "screen-name",
  "screen-team",
  "screen-role",
  "screen-waiting",
  "screen-game",
  "screen-results",
];
function showScreen(id) {
  screens.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
}
function currentScreenId() {
  return screens.find((s) => !document.getElementById(s).classList.contains("hidden"));
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
function leaveSession() {
  sessionStorage.removeItem("mmg_pin");
}
function confirmLeave() {
  if (!confirm("ต้องการออกจากห้องใช่หรือไม่? คุณจะต้องใส่รหัส PIN ใหม่อีกครั้ง")) return;
  leaveSession();
  window.location.reload();
}
function goToTeamScreen() {
  renderTeamGrid();
  showScreen("screen-team");
}
function syncRoleSelectionUI() {
  document.querySelectorAll("#screen-role .choice-card").forEach((b) => {
    b.classList.toggle("selected", b.dataset.role === state.role);
  });
}
function updateWaitingSummary() {
  const el = document.getElementById("waiting-summary");
  if (state.role === "solo") {
    el.textContent = `ทีม: ${state.teamName} · คุณเล่นคนเดียว (ทำหน้าที่ครบทุกบทบาท)`;
  } else if (state.role) {
    el.textContent = `ทีม: ${state.teamName} · บทบาท: ${roleLabel(state.role)}`;
  } else {
    el.textContent = `ทีม: ${state.teamName}`;
  }
  const renameInput = document.getElementById("input-team-rename");
  if (renameInput && document.activeElement !== renameInput) {
    renameInput.value = state.teamName || "";
  }
  const changeRoleBtn = document.getElementById("btn-change-role");
  if (changeRoleBtn) changeRoleBtn.classList.toggle("hidden", state.role === "solo");
}

// A team's own back-btn behaves differently per screen: early screens (no
// team commitment yet) just leave the room; the role screen steps back to
// team selection instead of leaving entirely, since "change team" is the
// same flow. Waiting/game/results always confirm before leaving.
function handleBackClick() {
  if (currentScreenId() === "screen-role") {
    goToTeamScreen();
  } else {
    confirmLeave();
  }
}

// ---------------- Lock watchdog ----------------
// Freeze/penalty locks are timed on OUR OWN clock (see the note on
// publicTeams() server-side for why), but relying on a single setTimeout
// to flip the board back to "unlocked" is fragile on mobile: browsers
// throttle or fully suspend timers while a tab is backgrounded — e.g. the
// screen locks mid-freeze — which can leave the board LOOKING stuck long
// after the lock actually expired. This watchdog re-checks the real lock
// state on a short interval and self-corrects the instant it's stale, so
// a delayed/dropped timer can never leave a team stuck looking frozen.
let lastLockedRender = false;
setInterval(() => {
  if (currentScreenId() !== "screen-game") return;
  const locked = isBoardLocked();
  if (locked !== lastLockedRender) {
    lastLockedRender = locked;
    renderBoard();
  }
}, 400);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentScreenId() === "screen-game") {
    lastLockedRender = isBoardLocked();
    renderBoard();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  initDvdLayer();
  document.querySelectorAll(".back-btn").forEach((b) => b.addEventListener("click", handleBackClick));
  document.getElementById("btn-leave-room").addEventListener("click", confirmLeave);
  document.getElementById("btn-change-role").addEventListener("click", () => {
    syncRoleSelectionUI();
    showScreen("screen-role");
  });
  document.getElementById("btn-change-team").addEventListener("click", goToTeamScreen);
  document.getElementById("btn-team-rename").addEventListener("click", () => {
    const name = document.getElementById("input-team-rename").value.trim();
    if (!name) {
      toast("กรุณาใส่ชื่อทีม");
      return;
    }
    socket.emit("client:renameTeam", { name }, (res) => {
      if (!res || !res.ok) {
        toast((res && res.error) || "เปลี่ยนชื่อทีมไม่สำเร็จ");
        return;
      }
      state.teamName = res.name;
      updateWaitingSummary();
      toast("บันทึกชื่อทีมแล้ว");
    });
  });

  // Slow-network reassurance: if we're still on the loading screen after a
  // few seconds, say so instead of leaving a silent spinner that looks dead.
  setTimeout(() => {
    if (currentScreenId() === "screen-loading") {
      document.getElementById("loading-status").textContent = "เชื่อมต่อช้ากว่าปกติ กำลังลองใหม่...";
    }
  }, 6000);
});

socket.on("connect_error", () => {
  if (currentScreenId() === "screen-loading") {
    document.getElementById("loading-status").textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กำลังลองใหม่...";
  }
});

let hasBooted = false;
socket.on("connect", () => {
  if (!hasBooted) {
    hasBooted = true;
    // Sensible default first; attemptRejoin() below overrides it if a
    // saved session restores the player straight back into their room.
    showScreen("screen-join");
    attemptRejoin();
  } else {
    // A dropped-then-restored connection is a brand new socket as far as
    // the server is concerned, so it needs to re-attach to the room/team
    // the same way a page refresh does — just without yanking the person
    // back to a loading screen for a reconnect that happens mid-session.
    attemptRejoin();
    toast("เชื่อมต่อใหม่แล้ว");
  }
});

// Keep team rosters/names live while sitting in the lobby, so a reopened
// "เปลี่ยนทีม" grid shows current headcounts and a renamed team is reflected
// immediately for everyone on it.
socket.on("lobby:update", (lobby) => {
  if (!lobby || !lobby.teams || !state.pin) return;
  state.teams = lobby.teams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    count: t.players.length,
    maxPerTeam: t.maxPerTeam,
  }));
  if (currentScreenId() === "screen-team") renderTeamGrid();
  if (state.teamId) {
    const myTeam = lobby.teams.find((t) => t.id === state.teamId);
    if (myTeam && myTeam.name !== state.teamName) {
      state.teamName = myTeam.name;
      updateWaitingSummary();
    }
  }
});

// ---------------- Reconnect after refresh ----------------
function attemptRejoin() {
  const savedPin = sessionStorage.getItem("mmg_pin");
  if (!savedPin) return;
  socket.emit("client:rejoin", { pin: savedPin, playerId: state.playerId }, (res) => {
    if (!res || !res.ok) {
      leaveSession();
      return;
    }
    state.pin = savedPin;
    state.teamId = res.teamId;
    state.teamName = res.teamName;
    state.teamColor = res.teamColor;
    state.role = res.role;
    state.teams = res.teams || [];

    if (res.status === "lobby") {
      if (!state.role) {
        showScreen("screen-role");
      } else {
        updateWaitingSummary();
        showScreen("screen-waiting");
      }
    } else if (res.status === "playing") {
      const myTeam = state.teams.find((t) => t.id === state.teamId);
      if (myTeam) {
        state.pairCount = myTeam.pairCount;
        state.board = myTeam.board;
        state.tokens = myTeam.tokens || 0;
        // Server sends "ms remaining as of the server's clock" — never an
        // absolute deadline — precisely so we only ever add it to OUR OWN
        // Date.now() here. Comparing a server-absolute timestamp straight
        // against a client's clock is what used to leave the board looking
        // frozen long after the real freeze/penalty had actually ended.
        state.frozenUntil = myTeam.frozenMsLeft ? Date.now() + myTeam.frozenMsLeft : 0;
        state.wrongLockUntil = myTeam.wrongLockMsLeft ? Date.now() + myTeam.wrongLockMsLeft : 0;
      }
      document.getElementById("hud-team-dot").style.background = state.teamColor;
      document.getElementById("hud-team-name").textContent = state.teamName;
      document.getElementById("role-label").textContent = roleLabel(state.role);
      const canUseItem = state.role === "item" || state.role === "solo";
      document.getElementById("item-panel").classList.toggle("hidden", !canUseItem);
      setupItemButtons();
      if (canUseItem) renderTargetChips();
      // Item cooldowns run independently per item (up to 30s for peek) —
      // restore any still in progress so the buttons don't look falsely
      // "ready" right after a refresh/reconnect (the server would reject
      // the click anyway, but the button showing enabled is confusing).
      if (myTeam && myTeam.itemCooldownsMsLeft) {
        ["swap", "freeze", "peek"].forEach((type) => {
          const msLeft = myTeam.itemCooldownsMsLeft[type];
          if (msLeft > 0) startItemCooldown(type, msLeft);
        });
      }
      lastLockedRender = isBoardLocked();
      renderBoard();
      updateProgress();
      updateTokenUI();
      showScreen("screen-game");
      toast("เชื่อมต่อกลับเข้าเกมแล้ว");
    } else if (res.status === "ended") {
      renderResults(res.results || []);
      showScreen("screen-results");
    }
  });
}

// Phones suspend/throttle background tabs — the socket can die silently
// while the screen is locked or another app is in front, with no visible
// "disconnect" until well after the student switches back. Forcing a
// reconnect/resync the moment the tab becomes visible again closes that
// gap instead of leaving a stale board/lobby on screen.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (socket.connected) {
    attemptRejoin();
  } else {
    socket.connect();
  }
});

// ---------------- 1. Join with PIN ----------------
const pinInput = document.getElementById("input-pin");
pinInput.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 6);
});
pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-join").click();
});

document.getElementById("btn-join").addEventListener("click", () => {
  const pin = pinInput.value.trim();
  const errEl = document.getElementById("join-error");
  errEl.textContent = "";
  if (pin.length !== 6) {
    errEl.textContent = "กรุณาใส่รหัส PIN ให้ครบ 6 หลัก";
    return;
  }
  socket.emit("client:joinRoom", { pin, playerId: state.playerId }, (res) => {
    if (!res.ok) {
      errEl.textContent = res.error || "เข้าห้องไม่สำเร็จ";
      return;
    }
    state.pin = pin;
    state.teams = res.teams;
    sessionStorage.setItem("mmg_pin", pin);
    showScreen("screen-name");
  });
});

// ---------------- 2. Name ----------------
document.getElementById("btn-name").addEventListener("click", () => {
  const name = document.getElementById("input-name").value.trim();
  if (!name) {
    toast("กรุณาใส่ชื่อของคุณ");
    return;
  }
  socket.emit("client:setName", { name }, (res) => {
    if (!res.ok) {
      toast(res.error || "เกิดข้อผิดพลาด");
      return;
    }
    renderTeamGrid();
    showScreen("screen-team");
  });
});

// ---------------- 3. Team ----------------
function renderTeamGrid() {
  const grid = document.getElementById("team-grid");
  grid.innerHTML = "";
  state.teams.forEach((t) => {
    const full = t.count >= t.maxPerTeam;
    const btn = document.createElement("button");
    btn.className = "choice-card" + (full ? " disabled" : "");
    btn.disabled = full;
    btn.innerHTML = `
      <span class="team-dot" style="background:${t.color}"></span>
      <b>${t.name}</b>
      <span class="count">${t.count}/${t.maxPerTeam} คน${full ? " (เต็ม)" : ""}</span>
    `;
    btn.addEventListener("click", () => chooseTeam(t.id));
    grid.appendChild(btn);
  });
}

function chooseTeam(teamId) {
  socket.emit("client:chooseTeam", { teamId }, (res) => {
    if (!res.ok) {
      toast(res.error || "เลือกทีมไม่สำเร็จ");
      return;
    }
    state.teamId = teamId;
    state.teamName = res.teamName;
    state.teamColor = res.color;
    if (res.soloMode) {
      state.role = "solo";
      updateWaitingSummary();
      showScreen("screen-waiting");
    } else {
      // Joining/switching to a team always starts with a fresh role pick.
      state.role = null;
      syncRoleSelectionUI();
      showScreen("screen-role");
    }
  });
}

// ---------------- 4. Role ----------------
function setupRoleIcons() {
  document.querySelector('#screen-role .choice-card[data-role="opener"] .role-icon').innerHTML = iconHtml("card");
  document.querySelector('#screen-role .choice-card[data-role="item"] .role-icon').innerHTML = iconHtml("bolt");
  document.querySelector('#screen-role .choice-card[data-role="confirmer"] .role-icon').innerHTML = iconHtml("check");
}
setupRoleIcons();

document.querySelectorAll("#screen-role .choice-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    const role = btn.dataset.role;
    socket.emit("client:chooseRole", { role }, (res) => {
      const errEl = document.getElementById("role-error");
      if (!res.ok) {
        errEl.textContent = res.error || "เลือกบทบาทไม่สำเร็จ";
        return;
      }
      errEl.textContent = "";
      state.role = res.role;
      syncRoleSelectionUI();
      updateWaitingSummary();
      showScreen("screen-waiting");
    });
  });
});

socket.on("client:forceRoleSelect", () => {
  state.role = null;
  syncRoleSelectionUI();
  toast("มีเพื่อนเข้าทีมเพิ่ม กรุณาเลือกบทบาทของคุณอีกครั้ง");
  showScreen("screen-role");
});

function roleLabel(role) {
  return { opener: "คนเปิดไพ่", confirmer: "คนกดยืนยัน", item: "คนใช้ไอเทม", solo: "เล่นคนเดียว (ทุกบทบาท)" }[role] || role;
}

// ---------------- 6. Game start ----------------
socket.on("game:started", ({ endsAt, teams }) => {
  state.teams = teams;
  const myTeam = teams.find((t) => t.id === state.teamId);
  if (!myTeam) return;
  state.pairCount = myTeam.pairCount;
  state.board = myTeam.board;
  state.tokens = myTeam.tokens || 0;

  document.getElementById("hud-team-dot").style.background = myTeam.color;
  document.getElementById("hud-team-name").textContent = myTeam.name;
  document.getElementById("role-label").textContent = roleLabel(state.role);
  const canUseItem = state.role === "item" || state.role === "solo";
  document.getElementById("item-panel").classList.toggle("hidden", !canUseItem);
  setupItemButtons();
  if (canUseItem) renderTargetChips();

  renderBoard();
  updateProgress();
  updateTokenUI();
  showScreen("screen-game");
});

// ---------------- Board rendering ----------------
// Instrument art lives entirely in /public/assets/instruments/<id>.png —
// see that folder's README. This builds an <img> with a two-step fallback
// (specific photo -> generic placeholder -> nothing) so a missing file for
// a newly-added instrument never shows a broken-image icon mid-game.
function instrumentImgHtml(instrumentId) {
  const src = `assets/instruments/${instrumentId}.png`;
  const fallback = `assets/instruments/_placeholder.png`;
  return `<img class="instrument-img" src="${src}" alt="" loading="lazy" decoding="async"
    onerror="this.onerror=null;this.src='${fallback}';" />`;
}

function cardContent(card) {
  if (!card.instrumentId) {
    // Defensive fallback: should never happen, but if a card ever arrives
    // with an unrecognized/missing instrumentId, show a visible marker
    // instead of a blank face so it's obvious something needs a refresh.
    return { text: "ไม่ทราบ", sub: "-", color: "#999", dark: "#777", icon: iconHtml("card", "#999"), photo: false, badge: false };
  }
  const meta = CATEGORY_META[card.category] || { label: card.category || "-", color: "#999", dark: "#777" };
  if (card.kind === "category") {
    // White icon on a glossy medallion in the category's own color — reads
    // as a proper "sticker" instead of a bare line icon floating on white.
    return {
      text: meta.label,
      sub: "ประเภท",
      color: meta.color,
      dark: meta.dark,
      icon: categoryIconHtml(card.category, "#ffffff"),
      photo: false,
      badge: true,
    };
  }
  return { text: card.name || "-", sub: "ชื่อเครื่องดนตรี", color: meta.color, dark: meta.dark, icon: instrumentImgHtml(card.instrumentId), photo: true, badge: false };
}

function iconWrapHtml(c) {
  const cls = c.photo ? " photo" : c.badge ? " category-badge" : "";
  const style = c.badge ? `--badge-color:${c.color};--badge-dark:${c.dark || c.color}` : `color:${c.color}`;
  return `<div class="icon-wrap${cls}" style="${style}">${c.icon}</div>`;
}

function buildCardFace(card) {
  let frontHtml = "";
  if (card.state !== "hidden") {
    const c = cardContent(card);
    frontHtml = `${iconWrapHtml(c)}<div class="card-text">${c.text}</div><div class="label">${c.sub}</div>`;
  }
  return frontHtml;
}

function buildCardEl(card, idx, canOpen, locked) {
  const el = document.createElement("div");
  el.className = "card" + (card.state === "matched" ? " flipped matched" : card.state === "revealed" ? " flipped" : "");
  if (!canOpen || locked) el.classList.add("disabled-click");
  if (locked) el.classList.add("locked");
  el.dataset.idx = idx;
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back"><div class="back-mark">?</div></div>
      <div class="card-face card-front">${buildCardFace(card)}</div>
    </div>
  `;
  el.addEventListener("click", () => onCardClick(idx));
  return el;
}

function buildFallbackCardEl(idx) {
  // Should never be needed — belt-and-suspenders so one bad card's data
  // can never leave the whole board blank if something unexpected slips
  // through (e.g. a stray render exception).
  const el = document.createElement("div");
  el.className = "card disabled-click";
  el.dataset.idx = idx;
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back"><div class="back-mark">?</div></div>
      <div class="card-face card-front"><div class="card-text">-</div></div>
    </div>
  `;
  return el;
}

function renderBoard() {
  const board = document.getElementById("board");
  const canOpen = state.role === "opener" || state.role === "solo";
  const locked = isBoardLocked();
  // Build everything in an off-DOM fragment first, so the visible board
  // is only ever replaced once, as a complete unit — never left half
  // torn-down. Each card also renders inside its own try/catch, so a
  // single bad card can't blank out the rest of the board.
  const frag = document.createDocumentFragment();
  state.board.forEach((card, idx) => {
    let el;
    try {
      el = buildCardEl(card, idx, canOpen, locked);
    } catch (err) {
      console.error("Card render failed — showing fallback for this card only.", err, card);
      el = buildFallbackCardEl(idx);
    }
    frag.appendChild(el);
  });
  board.innerHTML = "";
  board.appendChild(frag);
}

function onCardClick(idx) {
  const canOpen = state.role === "opener" || state.role === "solo";
  if (!canOpen || isBoardLocked()) return;
  const card = state.board[idx];
  if (!card || card.state !== "hidden") return;
  socket.emit("client:flipCard", { cardIndex: idx });
}

socket.on("game:boardUpdate", ({ teamId, board }) => {
  if (teamId !== state.teamId) return;
  state.board = board;
  SFX.flip();
  renderBoard();
});

socket.on("game:cardsResolved", ({ teamId, matched, confirmed, board, matchedPairs, tokens, tokensEarned, comboStreak, wrongLockDurationMs }) => {
  if (teamId !== state.teamId) return;
  state.board = board;
  if (typeof tokens === "number") {
    state.tokens = tokens;
    updateTokenUI(tokensEarned > 0 ? tokensEarned : 0);
  }
  matched ? SFX.match() : SFX.wrong();
  document.getElementById("hud-progress").textContent = `คู่ที่จับได้ ${matchedPairs}/${state.pairCount}`;
  closeVoteOverlay();

  if (matched && comboStreak >= 2) {
    toast(`คอมโบ x${comboStreak}! ได้ ${tokensEarned} โทเค็น 🔥`);
  }
  // Penalty only applies to a genuine wrong guess (confirmed "yes" but the
  // pair didn't actually match) — clicking "ยกเลิก" to catch a bad flip
  // before committing costs nothing. wrongLockDurationMs is a plain
  // duration from the server, so the deadline below is computed entirely
  // against our own clock — no absolute server timestamp involved.
  if (!matched && confirmed && wrongLockDurationMs > 0) {
    state.wrongLockUntil = Date.now() + wrongLockDurationMs;
    toast(`เปิดไพ่ผิด! รอ ${Math.ceil(wrongLockDurationMs / 1000)} วิ`);
    lastLockedRender = true;
    renderBoard();
    return;
  } else if (!matched && !confirmed) {
    toast("ยกเลิกแล้ว ไม่มีบทลงโทษ");
  }
  renderBoard();
});

socket.on("game:cardsSwapped", ({ teamId, board, fromTeam, catchType }) => {
  if (teamId !== state.teamId) return;
  if (board) {
    state.board = board;
    lastLockedRender = isBoardLocked();
    renderBoard();
  }
  const fromT = state.teams.find((t) => t.id === fromTeam);
  const name = fromT ? fromT.name : "ทีมอื่น";
  if (catchType === "interrupted") {
    toast(`${name} จับได้ตอนคุณเปิดไพ่! ไพ่ถูกปิดและสลับ 😱`);
  } else {
    toast(`${name} สลับตำแหน่งไพ่ของทีมคุณ!`);
  }
});

socket.on("game:voteCancelled", ({ teamId }) => {
  if (teamId !== state.teamId) return;
  closeVoteOverlay();
});

function updateProgress() {
  const myTeam = state.teams.find((t) => t.id === state.teamId);
  document.getElementById("hud-progress").textContent = `คู่ที่จับได้ ${myTeam ? myTeam.matchedPairs : 0}/${state.pairCount}`;
}

function updateTokenUI(earned) {
  const el = document.getElementById("token-count");
  if (el) el.textContent = state.tokens;
  if (earned > 0) {
    const badge = document.getElementById("token-badge");
    const pop = document.getElementById("token-pop");
    if (badge) {
      badge.classList.remove("bump");
      // Force reflow so re-adding the class restarts the animation even
      // if tokens are earned twice in quick succession.
      void badge.offsetWidth;
      badge.classList.add("bump");
    }
    if (pop) {
      pop.textContent = `+${earned}`;
      pop.classList.remove("show");
      void pop.offsetWidth;
      pop.classList.add("show");
    }
  }
  refreshItemButtonAvailability();
}

// ---------------- Voting (confirmer / solo) ----------------
function closeVoteOverlay() {
  document.getElementById("vote-overlay").classList.add("hidden");
}

socket.on("game:voteRequest", ({ teamId, cards }) => {
  if (teamId !== state.teamId || (state.role !== "confirmer" && state.role !== "solo")) return;
  const pairEl = document.getElementById("vote-pair");
  pairEl.innerHTML = cards
    .map((c) => {
      const info = cardContent({ instrumentId: c.instrumentId, kind: c.kind, name: c.name, category: c.category });
      const cls = info.photo ? " photo" : info.badge ? " category-badge" : "";
      const style = info.badge ? `--badge-color:${info.color};--badge-dark:${info.dark || info.color}` : `color:${info.color}`;
      return `<div class="mini-card"><div class="mini-icon${cls}" style="${style}">${info.icon}</div><div class="mini-text">${info.text}</div></div>`;
    })
    .join("");
  document.getElementById("vote-progress").textContent = "";
  document.getElementById("vote-overlay").classList.remove("hidden");
  SFX.vote();
});

socket.on("game:voteProgress", ({ teamId, cast, total }) => {
  if (teamId !== state.teamId) return;
  document.getElementById("vote-progress").textContent = `โหวตแล้ว ${cast}/${total} คน`;
});

document.getElementById("btn-vote-yes").addEventListener("click", () => {
  socket.emit("client:vote", { vote: true });
  closeVoteOverlay();
});
document.getElementById("btn-vote-no").addEventListener("click", () => {
  socket.emit("client:vote", { vote: false });
  closeVoteOverlay();
});

// ---------------- Items ----------------
let selectedTarget = null;

function renderTargetChips() {
  const wrap = document.getElementById("target-select");
  wrap.innerHTML = "";
  state.teams
    .filter((t) => t.id !== state.teamId)
    .forEach((t) => {
      const chip = document.createElement("button");
      chip.className = "target-chip";
      chip.style.background = t.color;
      chip.textContent = t.name;
      chip.addEventListener("click", () => {
        selectedTarget = t.id;
        document.querySelectorAll(".target-chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
      });
      wrap.appendChild(chip);
    });
}

// Cooldowns are tracked per item type now — using "peek" (30s) does NOT
// lock "swap" or "freeze" (10s each), so each button animates its own bar
// and label independently instead of sharing one cooldown gate.
const itemCooldownUntil = { swap: 0, freeze: 0, peek: 0 }; // client-clock deadline per item
const itemCooldownTotal = { swap: 1, freeze: 1, peek: 1 }; // duration used to compute bar %
let cooldownTickRunning = false;

function setupItemButtons() {
  document.getElementById("btn-item-swap").innerHTML =
    iconHtml("swap") + `<span>${ITEM_LABELS.swap}</span><span class="cost-tag">${ITEM_COSTS.swap} โทเค็น</span>`;
  document.getElementById("btn-item-freeze").innerHTML =
    iconHtml("freeze") + `<span>${ITEM_LABELS.freeze}</span><span class="cost-tag">${ITEM_COSTS.freeze} โทเค็น</span>`;
  document.getElementById("btn-item-peek").innerHTML =
    iconHtml("eye") + `<span>${ITEM_LABELS.peek}</span><span class="cost-tag">${ITEM_COSTS.peek} โทเค็น</span>`;
  refreshItemButtonAvailability();
}

function refreshItemButtonAvailability() {
  const now = Date.now();
  ["swap", "freeze", "peek"].forEach((type) => {
    const btn = document.getElementById(`btn-item-${type}`);
    if (!btn) return;
    const cooling = itemCooldownUntil[type] > now;
    btn.disabled = cooling || state.tokens < ITEM_COSTS[type];
  });
}

function useItem(itemType) {
  if (itemType !== "peek" && !selectedTarget) {
    toast("เลือกทีมเป้าหมายก่อน");
    return;
  }
  // Optimistic UI: disable the button the instant it's clicked instead of
  // waiting for the server round-trip. Without this, the button stayed
  // clickable while the request was in flight — on any real ping that reads
  // as "lag" (nothing seems to happen) and lets impatient taps fire the
  // same item multiple times. We re-enable it below if the server says no.
  const btn = document.getElementById(`btn-item-${itemType}`);
  if (btn) btn.disabled = true;

  socket.emit("client:useItem", { itemType, targetTeamId: selectedTarget }, (res) => {
    if (!res.ok) {
      toast(res.error || "ใช้ไอเทมไม่ได้");
      refreshItemButtonAvailability(); // restore correct enabled/disabled state
      return;
    }
    SFX.item();
    if (typeof res.tokens === "number") {
      state.tokens = res.tokens;
      updateTokenUI();
    }
    startItemCooldown(itemType, res.cooldownMs || 0);
  });
}
document.getElementById("btn-item-swap").addEventListener("click", () => useItem("swap"));
document.getElementById("btn-item-freeze").addEventListener("click", () => useItem("freeze"));
document.getElementById("btn-item-peek").addEventListener("click", () => useItem("peek"));

function startItemCooldown(itemType, durationMs) {
  itemCooldownUntil[itemType] = Date.now() + durationMs;
  itemCooldownTotal[itemType] = durationMs || 1;
  refreshItemButtonAvailability();
  ensureCooldownTicking();
}

function ensureCooldownTicking() {
  if (cooldownTickRunning) return;
  cooldownTickRunning = true;
  const tick = () => {
    const now = Date.now();
    let anyActive = false;
    ["swap", "freeze", "peek"].forEach((type) => {
      const fill = document.getElementById(`cooldown-fill-${type}`);
      const label = document.getElementById(`cooldown-label-${type}`);
      if (!fill || !label) return;
      const remaining = itemCooldownUntil[type] - now;
      if (remaining <= 0) {
        fill.style.width = "0%";
        label.textContent = "";
        return;
      }
      anyActive = true;
      const pct = Math.max(0, Math.min(100, (remaining / itemCooldownTotal[type]) * 100));
      fill.style.width = pct + "%";
      label.textContent = `${(remaining / 1000).toFixed(1)} วิ`;
    });
    refreshItemButtonAvailability();
    if (anyActive) {
      requestAnimationFrame(tick);
    } else {
      cooldownTickRunning = false;
    }
  };
  tick();
}

socket.on("game:itemUsed", ({ fromTeam, itemType, targetTeamId }) => {
  if (fromTeam === state.teamId) return; // you already got feedback locally when you clicked
  const fromT = state.teams.find((t) => t.id === fromTeam);
  const fromName = fromT ? fromT.name : "ทีมอื่น";
  const label = ITEM_LABELS[itemType] || itemType;

  if (targetTeamId === state.teamId) {
    // The target team gets a more specific, urgent toast from the
    // game:cardsSwapped / game:teamFrozen handlers below — skip the
    // generic one here so they don't overwrite each other.
    return;
  }
  if (itemType === "peek") {
    // Self-only item — announce it to everyone else for visibility even
    // though nobody else is affected.
    toast(`${fromName} ใช้ไอเทม "${label}"`);
  } else {
    const targetT = state.teams.find((t) => t.id === targetTeamId);
    toast(`${fromName} ใช้ไอเทม "${label}" ใส่ ${targetT ? targetT.name : "ทีมอื่น"}`);
  }
});

// ---------------- Peek (self item — reveals the whole board briefly) ----------------
socket.on("game:peek", ({ teamId, cards, durationMs }) => {
  if (teamId !== state.teamId) return;
  toast("ส่องไพ่! จำตำแหน่งไว้ให้ดี");
  SFX.item();
  const board = document.getElementById("board");
  (cards || []).forEach(({ cardIndex, instrumentId, kind, name, category }) => {
    const el = board.children[cardIndex];
    const realCard = state.board[cardIndex];
    if (!el || !realCard || realCard.state !== "hidden") return;
    el.classList.add("flipped", "peek");
    const c = cardContent({ instrumentId, kind, name, category });
    el.querySelector(".card-front").innerHTML = `${iconWrapHtml(c)}<div class="card-text">${c.text}</div><div class="label">${c.sub}</div>`;
  });
  setTimeout(renderBoard, durationMs);
});

// ---------------- Freeze effect ----------------
socket.on("game:teamFrozen", ({ teamId, durationMs, fromTeam }) => {
  if (teamId !== state.teamId) return;
  // Deliberately ignore any absolute "until" timestamp from the server and
  // compute our own deadline from the duration + our own clock — see the
  // note on publicTeams() server-side for why this matters.
  state.frozenUntil = Date.now() + durationMs;
  SFX.freeze();
  const fromT = state.teams.find((t) => t.id === fromTeam);
  playFreezeEffect(durationMs, `ถูกแช่แข็งโดย ${fromT ? fromT.name : "ทีมอื่น"}! รอสักครู่...`);
  lastLockedRender = true;
  renderBoard();
});

// ---------------- Timer ----------------
socket.on("game:timerTick", ({ remainingMs }) => {
  const totalSec = Math.max(0, Math.round(remainingMs / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  document.getElementById("hud-timer").textContent = `${m}:${s}`;
});

socket.on("game:teamFinished", ({ teamId }) => {
  if (teamId === state.teamId) {
    SFX.finish();
    toast("ทีมของคุณจับคู่ครบแล้ว!");
  }
});

// ---------------- Results ----------------
function renderResults(results) {
  const list = document.getElementById("result-list");
  list.innerHTML = results
    .map((r, i) => {
      const pct = Math.round((r.matchedPairs / r.pairCount) * 100);
      const timeStr = r.elapsedMs ? `${Math.round(r.elapsedMs / 1000)} วิ` : "ยังไม่ครบ";
      return `
        <div class="result-row">
          <div class="result-rank rank-${i + 1}">${i + 1}</div>
          <div style="flex:1;">
            <div class="row between"><b>${r.name}</b><span class="small-note">${r.matchedPairs}/${r.pairCount} คู่ · ${timeStr}</span></div>
            <div class="bar-wrap"><div class="bar" style="width:${pct}%; background:${r.color};"></div></div>
            <p class="small-note" style="margin:4px 0 0;">พลาด ${r.wrongAttempts} ครั้ง · ใช้ไอเทม ${r.itemsUsedCount} ครั้ง</p>
          </div>
        </div>`;
    })
    .join("");
}

socket.on("game:over", ({ results }) => {
  renderResults(results);
  showScreen("screen-results");
});

document.getElementById("btn-play-again").addEventListener("click", () => {
  leaveSession();
  window.location.reload();
});

socket.on("client:kicked", () => {
  leaveSession();
  toast("คุณถูกนำออกจากห้องโดยหัวห้อง");
  setTimeout(() => window.location.reload(), 1500);
});

