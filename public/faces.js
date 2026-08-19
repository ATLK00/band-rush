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

  const sprites = FACE_FILES.map((file, i) => {
    const img = document.createElement("img");
    img.src = FACE_DIR + file;
    img.className = "dvd-face";
    img.alt = "";
    img.style.filter = faceGlow(FACE_COLORS[i % FACE_COLORS.length]);
    layer.appendChild(img);

    const size = 100;
    // Slow, lazy drift — noticeably gentler than a real screensaver so it
    // stays a calm background detail instead of a distraction.
    const state = {
      el: img,
      x: Math.random() * (window.innerWidth - size),
      y: Math.random() * (window.innerHeight - size),
      vx: (Math.random() * 0.18 + 0.1) * (Math.random() < 0.5 ? -1 : 1),
      vy: (Math.random() * 0.18 + 0.1) * (Math.random() < 0.5 ? -1 : 1),
      size,
    };
    return state;
  });

  function tick() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    sprites.forEach((s) => {
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
