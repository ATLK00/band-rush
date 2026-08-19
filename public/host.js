/**
 * host.js — Teacher ("Host") page logic.
 * Create room -> big PIN + live roster -> start -> spectator dashboard ->
 * suspenseful ranked reveal of the final results.
 */

const socket = io();

const state = {
  pin: null,
  hostToken: null,
  settings: null,
  lastLobby: null,
};

function getOrCreateHostToken() {
  let t = localStorage.getItem("mmg_hostToken");
  if (!t) {
    t = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "h-" + Math.random().toString(36).slice(2);
    localStorage.setItem("mmg_hostToken", t);
  }
  return t;
}
function leaveHostSession() {
  localStorage.removeItem("mmg_hostPin");
}

const hostScreens = ["screen-setup", "screen-lobby", "screen-hostgame", "screen-hostresults"];
function showScreen(id) {
  hostScreens.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

document.addEventListener("DOMContentLoaded", () => {
  initDvdLayer();
  document.querySelectorAll(".back-btn").forEach((b) =>
    b.addEventListener("click", () => {
      leaveHostSession();
      window.location.reload();
    })
  );
  attemptHostRejoin();
});

// ---------------- Reconnect after refresh (teacher's own device) ----------------
function attemptHostRejoin() {
  const savedPin = localStorage.getItem("mmg_hostPin");
  if (!savedPin) return;
  state.hostToken = getOrCreateHostToken();
  socket.emit("host:rejoin", { pin: savedPin, hostToken: state.hostToken }, (res) => {
    if (!res || !res.ok) {
      leaveHostSession();
      return;
    }
    state.pin = savedPin;
    state.settings = res.settings;
    document.getElementById("lobby-pin").textContent = savedPin;

    if (res.status === "lobby") {
      renderLobby(res.lobby);
      showScreen("screen-lobby");
    } else if (res.status === "playing") {
      dashboardTeams = res.teams || [];
      renderDashboard();
      showScreen("screen-hostgame");
      if (res.endsAt) {
        const totalSec = Math.max(0, Math.round((res.endsAt - Date.now()) / 1000));
        const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
        const s = String(totalSec % 60).padStart(2, "0");
        document.getElementById("host-timer").textContent = `${m}:${s}`;
      }
      toast("เชื่อมต่อกลับเข้าห้องแล้ว");
    } else if (res.status === "ended") {
      renderResultsInstant(res.results || []);
      showScreen("screen-hostresults");
    }
  });
}

// ---------------- 1. Create room ----------------
document.getElementById("btn-create").addEventListener("click", () => {
  const settings = {
    numTeams: Number(document.getElementById("set-numTeams").value),
    maxPerTeam: Number(document.getElementById("set-maxPerTeam").value),
    gameTimeMinutes: Number(document.getElementById("set-gameTime").value),
    pairCount: Number(document.getElementById("set-pairCount").value),
  };
  state.hostToken = getOrCreateHostToken();
  socket.emit("host:createRoom", { ...settings, hostToken: state.hostToken }, (res) => {
    if (!res.ok) {
      toast("สร้างห้องไม่สำเร็จ");
      return;
    }
    state.pin = res.pin;
    state.settings = res.settings;
    localStorage.setItem("mmg_hostPin", res.pin);
    document.getElementById("lobby-pin").textContent = res.pin;
    showScreen("screen-lobby");
  });
});

// ---------------- 2. Lobby roster ----------------
const ROLE_LABEL = { opener: "เปิดไพ่", confirmer: "ยืนยัน", item: "ไอเทม", solo: "เล่นคนเดียว" };

function renderLobby(lobby) {
  state.lastLobby = lobby;
  const grid = document.getElementById("roster-grid");
  grid.innerHTML = "";
  lobby.teams.forEach((t) => {
    const box = document.createElement("div");
    box.className = "roster-team";
    box.style.borderTopColor = t.color;
    const playersHtml = t.players.length
      ? t.players
          .map(
            (p) =>
              `<div class="roster-player"><span>${escapeHtml(p.name || "ผู้เล่น")}${p.connected === false ? " (หลุดการเชื่อมต่อ)" : ""}</span><span class="role-tag">${p.role ? ROLE_LABEL[p.role] : "ยังไม่เลือก"}</span></div>`
          )
          .join("")
      : `<p class="small-note">ยังไม่มีผู้เล่น</p>`;
    box.innerHTML = `<h4><span class="team-dot" style="background:${t.color}"></span>${t.name} (${t.players.length}/${t.maxPerTeam})</h4>${playersHtml}`;
    grid.appendChild(box);
  });
}

socket.on("lobby:update", (lobby) => {
  if (lobby.pin !== state.pin) return;
  renderLobby(lobby);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- 3. Start game ----------------
document.getElementById("btn-start").addEventListener("click", () => {
  socket.emit("host:startGame", { pin: state.pin });
});

// ---------------- 4. Spectator dashboard ----------------
let dashboardTeams = [];

socket.on("game:started", ({ teams }) => {
  dashboardTeams = teams;
  renderDashboard();
  showScreen("screen-hostgame");
});

function renderDashboard() {
  const grid = document.getElementById("host-team-grid");
  grid.innerHTML = "";
  dashboardTeams.forEach((t) => {
    const box = document.createElement("div");
    box.className = "roster-team";
    box.style.borderTopColor = t.color;
    const pct = Math.round((t.matchedPairs / t.pairCount) * 100);
    const frozen = t.frozenUntil && t.frozenUntil > Date.now();
    box.innerHTML = `
      <h4><span class="team-dot" style="background:${t.color}"></span>${t.name} ${frozen ? '<span class="frozen-tag">แช่แข็ง</span>' : ""}</h4>
      <div class="bar-wrap" style="margin-bottom:6px;"><div class="bar" style="width:${pct}%; background:${t.color};"></div></div>
      <p class="small-note">${t.matchedPairs}/${t.pairCount} คู่ · พลาด ${t.wrongAttempts} · ไอเทม ${t.itemsUsedCount} ${t.finishedAt ? "· เสร็จแล้ว" : ""}</p>
    `;
    grid.appendChild(box);
  });
}

function findDashTeam(id) {
  return dashboardTeams.find((t) => t.id === id);
}

socket.on("game:cardsResolved", ({ teamId, matchedPairs }) => {
  const t = findDashTeam(teamId);
  if (t) t.matchedPairs = matchedPairs;
  renderDashboard();
});

socket.on("game:teamFrozen", ({ teamId, until }) => {
  const t = findDashTeam(teamId);
  if (t) t.frozenUntil = until;
  renderDashboard();
  setTimeout(renderDashboard, (until - Date.now()) + 50);
});

socket.on("game:cardsSwapped", () => {
  // Announcement toast is handled generically by game:itemUsed below.
});

const HOST_ITEM_LABELS = { swap: "สลับตำแหน่งไพ่", freeze: "แช่แข็ง", peek: "ส่องไพ่" };

function showItemActivity(text) {
  const el = document.getElementById("item-activity");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(showItemActivity._t);
  showItemActivity._t = setTimeout(() => el.classList.add("hidden"), 6000);
}

socket.on("game:itemUsed", (payload) => {
  const t = findDashTeam(payload.fromTeam);
  if (t) t.itemsUsedCount = (t.itemsUsedCount || 0) + 1;
  renderDashboard();
  const label = HOST_ITEM_LABELS[payload.itemType] || payload.itemType;
  if (payload.itemType === "peek") {
    const msg = `${t ? t.name : "ทีม"} ใช้ไอเทม "${label}"`;
    toast(msg);
    showItemActivity(msg);
  } else {
    const targetT = findDashTeam(payload.targetTeamId);
    const msg = `${t ? t.name : "ทีม"} ใช้ไอเทม "${label}" ใส่ ${targetT ? targetT.name : "ทีมอื่น"}`;
    toast(msg);
    showItemActivity(msg);
  }
});

socket.on("game:teamFinished", ({ teamId }) => {
  const t = findDashTeam(teamId);
  if (t) t.finishedAt = Date.now();
  renderDashboard();
  toast(`${t ? t.name : "ทีม"} จับคู่ครบแล้ว!`);
});

// ---------------- Timer ----------------
socket.on("game:timerTick", ({ remainingMs }) => {
  const totalSec = Math.max(0, Math.round(remainingMs / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  document.getElementById("host-timer").textContent = `${m}:${s}`;
});

// ---------------- 5. Suspenseful results reveal ----------------
socket.on("game:over", ({ results }) => {
  showScreen("screen-hostresults");
  runResultsReveal(results);
});

function runResultsReveal(results) {
  const list = document.getElementById("host-result-list");
  const winnerBanner = document.getElementById("winner-banner");
  list.innerHTML = "";
  winnerBanner.innerHTML = "";
  winnerBanner.classList.add("hidden");

  // Build rows bottom-rank-first, hidden, then reveal one by one with
  // suspense — last place appears first, champion appears last with a
  // fanfare + confetti burst.
  const rowsReversed = [...results].reverse();
  const rowEls = [];
  rowsReversed.forEach((r, revIdx) => {
    const rank = results.length - revIdx;
    const row = buildResultRow(r, rank);
    row.classList.add("reveal-pending");
    list.appendChild(row);
    rowEls.push(row);
  });

  rowEls.forEach((row, i) => {
    setTimeout(() => {
      row.classList.remove("reveal-pending");
      row.classList.add("reveal-in");
      const isChampion = i === rowEls.length - 1;
      if (isChampion) {
        SFX.finish();
        showWinnerBanner(results[0]);
        launchConfetti();
      } else {
        SFX.vote();
      }
    }, i * 850);
  });
}

function buildResultRow(r, rank) {
  const pct = Math.round((r.matchedPairs / r.pairCount) * 100);
  const timeStr = r.elapsedMs ? `${Math.round(r.elapsedMs / 1000)} วิ` : "ยังไม่ครบ";
  const div = document.createElement("div");
  div.className = "result-row";
  div.innerHTML = `
    <div class="result-rank rank-${rank}">${rank}</div>
    <div style="flex:1;">
      <div class="row between"><b>${r.name}</b><span class="small-note">${r.matchedPairs}/${r.pairCount} คู่ · ${timeStr}</span></div>
      <div class="bar-wrap"><div class="bar" style="width:${pct}%; background:${r.color};"></div></div>
      <p class="small-note" style="margin:4px 0 0;">พลาด ${r.wrongAttempts} ครั้ง · ใช้ไอเทม ${r.itemsUsedCount} ครั้ง</p>
    </div>`;
  return div;
}

/** Reconnect case: show the already-decided results immediately, no
 *  suspense replay (that's only for the live moment the game ends). */
function renderResultsInstant(results) {
  const list = document.getElementById("host-result-list");
  list.innerHTML = "";
  results.forEach((r, i) => list.appendChild(buildResultRow(r, i + 1)));
  if (results[0]) showWinnerBanner(results[0]);
}

function showWinnerBanner(winner) {
  const banner = document.getElementById("winner-banner");
  banner.classList.remove("hidden");
  banner.style.setProperty("--wcolor", winner.color);
  banner.innerHTML = `
    <div class="winner-trophy">${iconHtml("trophy", winner.color)}</div>
    <div class="winner-name">${winner.name}</div>
    <div class="winner-sub">ทีมชนะเลิศ!</div>
  `;
}

function launchConfetti() {
  const layer = document.getElementById("confetti-layer");
  layer.innerHTML = "";
  const colors = ["#FF6B9D", "#4D96FF", "#6BCB77", "#FFB84C", "#C780FA", "#FFD93D"];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = Math.random() * 0.6 + "s";
    piece.style.animationDuration = 2.2 + Math.random() * 1.6 + "s";
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
  }
  setTimeout(() => (layer.innerHTML = ""), 4200);
}

document.getElementById("btn-new-room").addEventListener("click", () => {
  leaveHostSession();
  window.location.reload();
});
