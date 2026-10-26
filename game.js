const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const radar = document.getElementById("radar");
const radarCanvas = document.getElementById("radar-screen");
const radarCtx = radarCanvas.getContext("2d");
const radarCount = document.getElementById("radar-count");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const keys = new Set();

const ship = {
  x: WIDTH / 2,
  y: HEIGHT - 76,
  width: 38,
  height: 36,
  speed: 5.4,
  cooldown: 0,
  invulnerable: 0
};

const MAX_ALLIES = 20;
const allies = [];

function normalizeAllyCount(value) {
  const count = Number(value);
  return Number.isFinite(count)
    ? Math.max(0, Math.min(MAX_ALLIES, Math.trunc(count)))
    : 3;
}

let selectedAllyCount = normalizeAllyCount(readStore("starfall-ally-count", "3"));

function spawnAllies(count) {
  allies.length = 0;
  const names = ["VEGA", "KITE", "COMET"];
  const total = normalizeAllyCount(count);
  const columns = Math.max(1, Math.min(total, Math.floor((WIDTH - 48) / 40)));
  for (let index = 0; index < total; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, total - row * columns);
    const spacing = Math.min(48, (WIDTH - 48) / Math.max(1, rowCount - 1));
    const x = Math.max(24, Math.min(WIDTH - 24,
      WIDTH / 2 + (column - (rowCount - 1) / 2) * spacing));
    const y = Math.max(30, HEIGHT - 110 - row * 38);
    allies.push({
      callsign: names[index] || `ALLY-${index + 1}`,
      x, y, targetX: x, targetY: y,
      roamTimer: Math.random(),
      cooldown: 0.35 + Math.random() * 0.3,
      health: 2,
      active: true
    });
  }
}

const stars = Array.from({ length: 110 }, () => ({
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  size: Math.random() * 1.8 + 0.4,
  speed: Math.random() * 1.3 + 0.35
}));

const hulls = [
  { id: "nova", name: "Nova", cost: 0, color: "#4e9bff", accent: "#e4f2ff" },
  { id: "solar", name: "Solar flare", cost: 25, color: "#ff9b58", accent: "#fff0c2" },
  { id: "ion", name: "Ion drift", cost: 60, color: "#a78bfa", accent: "#f4eaff" },
  { id: "frost", name: "Frostline", cost: 90, color: "#88c7ff", accent: "#eef8ff" }
];

const weaponCatalog = [
  { id: "laser", name: "Laser machine gun", type: "starter", cost: 0, detail: "Rapid, accurate laser fire" },
  { id: "missile", name: "Seeker missile", type: "starter", cost: 0, detail: "Homing hit with heavy damage" },
  { id: "spread", name: "Tri-burst laser", type: "spread", cost: 55, detail: "Three bolts cover a wide arc" },
  { id: "plasma", name: "Plasma lance", type: "plasma", cost: 90, detail: "Slow, armor-piercing plasma shot" },
  { id: "burst", name: "Cyclone burst cannon", type: "burst", cost: 115, detail: "Five-shot fan for close formations" },
  { id: "rail", name: "Rail driver", type: "rail", cost: 150, detail: "Heavy shot with high damage" }
];

const threatLevels = { calm: 0.78, standard: 1, veteran: 1.28 };

function readStore(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The game remains playable when browser storage is unavailable.
  }
}

let bullets = [];
let allyBullets = [];
let missiles = [];
let enemyShots = [];
let enemies = [];
let particles = [];
let transport = null;
let lastEscortWave = 0;
let escortQueued = false;
let score = 0;
let lives = 3;
let wave = 1;
let spawnTimer = 0;
let state = "menu";
let paused = false;
let currentWeapon = "laser";
let lastTime = 0;
let elapsed = 0;

// These timers advance only during active gameplay.
let gameTimers = [];

let highScore = Number(readStore("starfall-high-score", "0")) || 0;
let credits = Number(readStore("starfall-credits", "0")) || 0;
let ownedHulls;

try {
  ownedHulls = new Set(JSON.parse(readStore("starfall-hulls", '["nova"]')));
} catch {
  ownedHulls = new Set(["nova"]);
}

ownedHulls.add("nova");

let activeHull = readStore("starfall-active-hull", "nova");

if (!hulls.some((hull) => hull.id === activeHull && ownedHulls.has(hull.id))) {
  activeHull = "nova";
}

let soundEnabled = readStore("starfall-sound", "false") === "true";
let ownedWeapons;

try {
  ownedWeapons = new Set(
    JSON.parse(readStore("starfall-weapons", '["laser","missile"]'))
  );
} catch {
  ownedWeapons = new Set(["laser", "missile"]);
}

ownedWeapons.add("laser");
ownedWeapons.add("missile");

if (!ownedWeapons.has(currentWeapon)) currentWeapon = "laser";

let audioContext;

const scoreDisplay = document.getElementById("score");
const livesDisplay = document.getElementById("lives");
const waveDisplay = document.getElementById("wave");
const highScoreDisplay = document.getElementById("high-score");
const menuBestDisplay = document.getElementById("menu-best");
const gameoverCopy = document.getElementById("gameover-copy");
const killFeed = document.getElementById("live-combat-feed");
const overlay = document.getElementById("overlay");
const hullList = document.getElementById("hull-list");
const weaponList = document.getElementById("weapon-list");
const weaponSelector = document.getElementById("weapon-selector");
const creditsDisplay = document.getElementById("credits");
const soundSetting = document.getElementById("sound-setting");
const difficultySetting = document.getElementById("difficulty-setting");
const escortStatus = document.getElementById("escort-status");
const escortLabel = document.getElementById("escort-label");
const escortHull = document.getElementById("escort-hull");
const escortIntegrity = document.getElementById("escort-integrity");

// Create the allied ship setting without changing the HTML.
const allyCountControl = document.createElement("div");
Object.assign(allyCountControl.style, {
  display: "grid", gap: "8px", marginTop: "18px", color: "#d9ecff"
});
const allyCountLabel = document.createElement("label");
allyCountLabel.htmlFor = "ally-count-setting";
allyCountLabel.textContent = "Allied ships";
const allyCountSetting = document.createElement("input");
allyCountSetting.id = "ally-count-setting";
allyCountSetting.type = "number";
allyCountSetting.min = "0";
allyCountSetting.max = String(MAX_ALLIES);
allyCountSetting.step = "1";
allyCountSetting.value = String(selectedAllyCount);
allyCountSetting.setAttribute("aria-describedby", "ally-count-help");
Object.assign(allyCountSetting.style, {
  width: "110px", padding: "10px", border: "1px solid #65e5d3",
  borderRadius: "8px", background: "#071018", color: "#d9ecff",
  font: "600 16px monospace"
});
const allyCountHelp = document.createElement("small");
allyCountHelp.id = "ally-count-help";
allyCountHelp.textContent = `Choose 0–${MAX_ALLIES} allies. Applies on Play or Retry.`;
allyCountControl.append(allyCountLabel, allyCountSetting, allyCountHelp);
document.querySelector('[data-screen="settings"]').appendChild(allyCountControl);
allyCountSetting.addEventListener("change", () => {
  selectedAllyCount = normalizeAllyCount(allyCountSetting.value);
  allyCountSetting.value = String(selectedAllyCount);
  writeStore("starfall-ally-count", String(selectedAllyCount));
});


// Create the pause button without changing your HTML.
const pauseButton = document.createElement("button");
pauseButton.id = "pause-button";
pauseButton.type = "button";
pauseButton.textContent = "Pause";
pauseButton.hidden = true;
pauseButton.setAttribute("aria-pressed", "false");
pauseButton.setAttribute("aria-controls", "game");
pauseButton.title = "Pause or resume (P / Escape)";

Object.assign(pauseButton.style, {
  position: "fixed",
  top: "16px",
  right: "16px",
  zIndex: "1000",
  padding: "10px 18px",
  border: "1px solid #65e5d3",
  borderRadius: "8px",
  background: "#071018",
  color: "#d9ecff",
  font: "600 14px monospace",
  cursor: "pointer",
  touchAction: "manipulation"
});

document.body.appendChild(pauseButton);

function togglePause() {
  if (state !== "playing") return;

  paused = !paused;
  keys.clear();
  lastTime = performance.now();

  pauseButton.textContent = paused ? "Resume" : "Pause";
  pauseButton.setAttribute("aria-pressed", String(paused));
}

pauseButton.addEventListener("click", togglePause);

function scheduleGameTimer(callback, seconds) {
  gameTimers.push({ callback, remaining: seconds });
}

function updateGameTimers(delta) {
  const pending = gameTimers;
  gameTimers = [];

  for (const timer of pending) {
    timer.remaining -= delta;

    if (timer.remaining <= 0) {
      timer.callback();
    } else {
      gameTimers.push(timer);
    }
  }
}

function setState(nextState) {
  state = nextState;
  paused = false;
  keys.clear();

  pauseButton.hidden = nextState !== "playing";
  pauseButton.textContent = "Pause";
  pauseButton.setAttribute("aria-pressed", "false");

  overlay.hidden = nextState === "playing";
  radar.hidden = nextState !== "playing";

  document.querySelectorAll("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== nextState;
  });

  if (nextState === "menu") {
    menuBestDisplay.textContent = String(highScore).padStart(5, "0");
  }

  if (nextState === "shop") renderShop();

  if (nextState === "gameover") {
    gameoverCopy.textContent =
      `You reached wave ${wave} and scored ${score.toLocaleString()} points.`;
  }
}

function startGame() {
  if (state === "playing") return;

  keys.clear();
  gameTimers = [];
  score = 0;
  lives = 3;
  wave = 1;
  spawnTimer = 0.45;
  bullets = [];
  allyBullets = [];
  missiles = [];
  enemyShots = [];
  enemies = [];
  particles = [];
  transport = null;
  lastEscortWave = 0;
  escortQueued = false;
  escortStatus.hidden = true;
  killFeed.replaceChildren();
  ship.x = WIDTH / 2;

  selectedAllyCount = normalizeAllyCount(allyCountSetting.value);
  allyCountSetting.value = String(selectedAllyCount);
  writeStore("starfall-ally-count", String(selectedAllyCount));
  spawnAllies(selectedAllyCount);

  ship.cooldown = 0;
  ship.invulnerable = 0;
  updateHud();
  setState("playing");
  lastTime = performance.now();
  requestAnimationFrame(frame);
}

function updateHud() {
  scoreDisplay.textContent = String(score).padStart(5, "0");
  livesDisplay.textContent 