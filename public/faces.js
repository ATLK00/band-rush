/**
 * faces.js
 * Shared between client.js and host.js.
 *
 * Two effects built from the same 11 face images:
 *  1. initDvdLayer()   -> ambient "DVD screensaver" faces drifting & bouncing
 *                          off the screen edges, running the whole session.
 *  2. playFreezeEffect() -> when a team is hit by the freeze item, all 11
 *                          faces rocket up from the bottom edge for 3s to
 *                          block vision, then the overlay clears itself.
 *
 * Replace the files in /public/assets/faces/ with real classmate photos —
 * same filenames — and both effects update automatically.
 */

const FACE_FILES = [
  "xthichat.png",
  "prom.png",
  "kittipob.png",
  "witsnu.png",
  "ploy.png",
  "fah.png",
  "nan.png",
  "boss.png",
  "ohm.png",
  "gam.png",
  "tar.png",
];

const FACE_DIR = "assets/faces/";

// Each classmate gets a consistent glow color across both effects — since
// the photos are transparent-background cutouts, CSS drop-shadow (which
// follows the alpha silhouette) reads as a colored outline hugging the
// actual photo shape, not a rectangle or forced circle.
const FACE_COLORS = [
  "#FF6B9D", "#4D96FF", "#6BCB77", "#FFB84C", "#C780FA",
  "#5CE1E6", "#FF8FA3", "#FFD93D", "#7B8CFF", "#55D6FF", "#F97C7C",
];

function faceGlow(color) {
  return `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 2px ${color})`;
}

/** Ambient DVD-bounce faces. Call once per page. */
function initDvdLayer() {
  const layer = document.getElementById("dvd-layer");
  if (!layer) return;
  layer.innerHTML = "";

  const size = 100;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Spread starting positions across a grid instead of pure independent
  // Math.random() x/y — with only 11 faces, fully independent random
  // placement has a real chance of dropping several of them in the same
  // corner of the screen to start with.
  const cols = Math.ceil(Math.sqrt(FACE_FILES.length));
  const rows = Math.ceil(FACE_FILES.length / cols);
  const cellW = Math.max(size, w / cols);
  const cellH = Math.max(size, h / rows);

  const sprites = FACE_FILES.map((file, i) => {
    const img = document.createElement("img");
    img.src = FACE_DIR + file;
    img.className = "dvd-face";
    img.alt = "";
    img.style.filter = faceGlow(FACE_COLORS[i % FACE_COLORS.length]);
    layer.appendChild(img);

    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * cellW;
    const cellY = row * cellH;
    const x = Math.min(w - size, cellX + Math.random() * Math.max(0, cellW - size));
    const y = Math.min(h - size, cellY + Math.random() * Math.max(0, cellH - size));

    // Slow, lazy drift — noticeably gentler than a real screensaver so it
    // stays a calm background detail instead of a distraction. Angle is
    // randomized as a single vector (rather than independent vx/vy signs)
    // so directions are spread evenly instead of clustering toward the
    // diagonals.
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.18 + 0.1;
    const state = {
      el: img,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
    };
    return state;
  });

  function tick() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Gentle mutual repulsion: pure wall-bounce physics never separates
    // two faces that happen to share a near-identical direction and
    // speed (likely by chance with only 11 sprites) — they'd otherwise
    // drift and bounce in lockstep forever, reading as a permanent
    // "clump" instead of faces spread across the screen. Nudge overlapping
    // faces apart a little every frame instead.
    for (let i = 0; i < sprites.length; i++) {
      for (let j = i + 1; j < sprites.length; j++) {
        const a = sprites[i];
        const b = sprites[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = a.size * 0.85;
        if (dist < minDist) {
          const push = ((minDist - dist) / minDist) * 0.06;
          const nx = dx / dist;
          const ny = dy / dist;
          a.vx += nx * push;
          a.vy += ny * push;
          b.vx -= nx * push;
          b.vy -= ny * push;
        }
      }
    }

    sprites.forEach((s) => {
      // Clamp speed so repulsion nudges can't build up into runaway
      // acceleration — keeps everything at the same calm ambient pace.
      const speed = Math.hypot(s.vx, s.vy);
      const maxSpeed = 0.3;
      if (speed > maxSpeed) {
        s.vx = (s.vx / speed) * maxSpeed;
        s.vy = (s.vy / speed) * maxSpeed;
      }

      s.x += s.vx;
      s.y += s.vy;
      if (s.x <= 0 || s.x >= w - s.size) s.vx *= -1;
      if (s.y <= 0 || s.y >= h - s.size) s.vy *= -1;
      s.x = Math.max(0, Math.min(w - s.size, s.x));
      s.y = Math.max(0, Math.min(h - s.size, s.y));
      s.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Blocks vision with all 11 faces flying up from the bottom edge.
 * @param {number} durationMs
 * @param {string} message text shown in the middle of the overlay
 */
function playFreezeEffect(durationMs = 3000, message = "ถูกแช่แข็ง! รอสักครู่...") {
  const overlay = document.getElementById("freeze-overlay");
  if (!overlay) return;
  overlay.innerHTML = `<div class="freeze-msg">${message}</div>`;
  overlay.classList.remove("hidden");

  FACE_FILES.forEach((file, i) => {
    const img = document.createElement("img");
    img.src = FACE_DIR + file;
    img.className = "freeze-face";
    img.alt = "";
    img.style.filter = faceGlow(FACE_COLORS[i % FACE_COLORS.length]);
    const leftPct = Math.random() * 92;
    const delay = Math.random() * 0.5;
    const dur = 1.4 + Math.random() * 1.1;
    img.style.left = `${leftPct}%`;
    img.style.animationDelay = `${delay}s`;
    img.style.animationDuration = `${dur}s`;
    overlay.appendChild(img);
  });

  setTimeout(() => {
    overlay.classList.add("hidden");
    overlay.innerHTML = "";
  }, durationMs);
}
