const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const radar = document.getElementById("radar");
const radarCanvas = document.getElementById("radar-screen");
const radarCtx = radarCanvas.getContext("2d");
const radarCount = document.getElementById("radar-count");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const keys = new Set();
const ship = { x: WIDTH / 2, y: HEIGHT - 76, width: 38, height: 36, speed: 5.4, cooldown: 0, invulnerable: 0 };
const allies = ["VEGA", "KITE", "COMET", "ECHO"].map((callsign, index) => {
  const x = WIDTH / 2 + [-92, -46, 46, 92][index];
  return { callsign, x, y: HEIGHT - 52, targetX: x, targetY: HEIGHT - 52, roamTimer: index * 0.2, cooldown: 0.35 + index * 0.12, health: 2, active: true };
});
const stars = Array.from({ length: 110 }, () => ({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, size: Math.random() * 1.8 + 0.4, speed: Math.random() * 1.3 + 0.35 }));
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
  { id: "plasma", name: "Plasma lance", type: "plasma", cost: 90, detail: "Slow, armor-piercing plasma shot" }
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
let currentWeapon = "laser";
let lastTime = 0;
let elapsed = 0;
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
if (!hulls.some((hull) => hull.id === activeHull && ownedHulls.has(hull.id))) activeHull = "nova";
let soundEnabled = readStore("starfall-sound", "false") === "true";
let ownedWeapons;
try {
  ownedWeapons = new Set(JSON.parse(readStore("starfall-weapons", '["laser","missile"]')));
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

function setState(nextState) {
  state = nextState;
  overlay.hidden = nextState === "playing";
  radar.hidden = nextState !== "playing";
  document.querySelectorAll("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== nextState;
  });
  if (nextState === "menu") menuBestDisplay.textContent = String(highScore).padStart(5, "0");
  if (nextState === "shop") renderShop();
  if (nextState === "gameover") {
    gameoverCopy.textContent = `You reached wave ${wave} and scored ${score.toLocaleString()} points.`;
  }
}

function startGame() {
  if (state === "playing") return;
  keys.clear();
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
  for (const ally of allies) {
    ally.health = 2;
    ally.active = true;
    ally.x = ship.x + (Math.random() - 0.5) * 90;
    ally.y = ship.y - 35 + (Math.random() - 0.5) * 55;
    ally.targetX = ally.x;
    ally.targetY = ally.y;
    ally.roamTimer = Math.random();
    ally.cooldown = 0.35;
  }
  ship.cooldown = 0;
  ship.invulnerable = 0;
  updateHud();
  setState("playing");
  lastTime = performance.now();
  requestAnimationFrame(frame);
}

function updateHud() {
  scoreDisplay.textContent = String(score).padStart(5, "0");
  livesDisplay.textContent = String(Math.max(0, lives));
  document.getElementById("life-mark").textContent = "◆ ".repeat(Math.max(0, lives)).trim();
  waveDisplay.textContent = String(wave).padStart(2, "0");
  highScoreDisplay.textContent = String(highScore).padStart(5, "0");
}

function playTone(frequency, duration, type, volume) {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function renderShop() {
  creditsDisplay.textContent = String(credits);
  hullList.innerHTML = hulls.map((hull) => {
    const owned = ownedHulls.has(hull.id);
    const equipped = activeHull === hull.id;
    const label = equipped ? "Equipped" : owned ? "Equip" : `Acquire · ${hull.cost}`;
    const disabled = equipped || (!owned && credits < hull.cost);
    return `<article class="hull-card"><div class="hull-swatch" style="--hull-color:${hull.color};--hull-accent:${hull.accent}" aria-hidden="true"><span>✦</span></div><div class="hull-details"><strong>${hull.name}</strong><span>${owned ? "Squadron issue" : `${hull.cost} flight credits`}</span></div><button class="hull-action" type="button" data-hull="${hull.id}" ${disabled ? "disabled" : ""}>${label}</button></article>`;
  }).join("");
  weaponList.innerHTML = weaponCatalog.map((weapon) => {
    const owned = ownedWeapons.has(weapon.id);
    const equipped = currentWeapon === weapon.id;
    const label = equipped ? "Selected" : owned ? "Select" : `Unlock · ${weapon.cost}`;
    const disabled = equipped || (!owned && credits < weapon.cost);
    return `<article class="weapon-card"><div class="weapon-icon weapon-icon-${weapon.id}" aria-hidden="true">${weapon.id === "missile" ? "↟" : weapon.id === "spread" ? "⋔" : weapon.id === "plasma" ? "╱" : "╎"}</div><div class="hull-details"><strong>${weapon.name}</strong><span>${owned ? weapon.detail : `${weapon.cost} flight credits · ${weapon.detail}`}</span></div><button class="hull-action" type="button" data-buy-weapon="${weapon.id}" ${disabled ? "disabled" : ""}>${label}</button></article>`;
  }).join("");
}

function purchaseOrSelectWeapon(weaponId) {
  const weapon = weaponCatalog.find((item) => item.id === weaponId);
  if (!weapon) return;
  if (!ownedWeapons.has(weaponId)) {
    if (credits < weapon.cost) return;
    credits -= weapon.cost;
    ownedWeapons.add(weaponId);
    writeStore("starfall-credits", String(credits));
    writeStore("starfall-weapons", JSON.stringify([...ownedWeapons]));
  }
  selectWeapon(weaponId);
  renderShop();
}

function purchaseOrEquip(hullId) {
  const hull = hulls.find((item) => item.id === hullId);
  if (!hull) return;
  if (!ownedHulls.has(hullId)) {
    if (credits < hull.cost) return;
    credits -= hull.cost;
    ownedHulls.add(hullId);
    writeStore("starfall-credits", String(credits));
    writeStore("starfall-hulls", JSON.stringify([...ownedHulls]));
  }
  activeHull = hullId;
  writeStore("starfall-active-hull", activeHull);
  renderShop();
}

function spawnEnemy() {
  const size = Math.random() < 0.22 ? 30 : 23;
  const threat = threatLevels[difficultySetting.value] || 1;
  const enemy = {
    x: 28 + Math.random() * (WIDTH - 56),
    y: size / 2 + 8,
    size,
    speed: (1.15 + Math.random() * 0.8 + wave * 0.12) * threat,
    verticalDirection: Math.random() < 0.5 ? -1 : 1,
    drift: (Math.random() - 0.5) * 1.2,
    phase: Math.random() * Math.PI * 2,
    shootTimer: (1.2 + Math.random() * 2) / threat,
    tough: size > 24,
    hp: size > 24 ? 2 : 1
  };
  enemies.push(enemy);
  addShipArrivalEntry(enemy);
}

function startEscortMission() {
  transport = { x: 48, y: HEIGHT * 0.63, width: 66, height: 34, hp: 3, maxHp: 3, speed: 68 };
  escortLabel.textContent = "ESCORT TRANSPORT";
  escortStatus.classList.remove("escort-success", "escort-danger");
  escortStatus.hidden = false;
  updateEscortHud();
}

function updateEscortHud() {
  if (!transport) return;
  escortHull.style.width = `${transport.hp / transport.maxHp * 100}%`;
  escortIntegrity.textContent = `HULL ${transport.hp} / ${transport.maxHp}`;
}

function resolveEscort(success) {
  transport = null;
  escortLabel.textContent = success ? "TRANSPORT SAFE · +150" : "TRANSPORT LOST";
  escortStatus.classList.toggle("escort-success", success);
  escortStatus.classList.toggle("escort-danger", !success);
  escortIntegrity.textContent = success ? "MISSION COMPLETE" : "MISSION FAILED";
  escortHull.style.width = success ? "100%" : "0%";
  if (success) {
    score += 150;
    credits += 12;
    writeStore("starfall-credits", String(credits));
  } else {
    loseLife();
  }
  window.setTimeout(() => {
    if (!transport) escortStatus.hidden = true;
    if (!transport && escortQueued && state === "playing") {
      escortQueued = false;
      startEscortMission();
    }
  }, 2200);
}

function fire() {
  if (ship.cooldown > 0) return;
  if (currentWeapon === "missile") {
    const target = enemies.reduce((closest, enemy) => {
      const distance = Math.hypot(enemy.x - ship.x, enemy.y - ship.y);
      return distance < closest.distance ? { enemy, distance } : closest;
    }, { enemy: null, distance: Infinity }).enemy;
    missiles.push({ x: ship.x, y: ship.y - 20, vx: 0, vy: -3.8, speed: 5.2, target, damage: 2, width: 12, height: 18, source: "ACE", active: false });
    ship.cooldown = 0.8;
    playTone(180, 0.16, "sawtooth", 0.045);
    return;
  }
  if (currentWeapon === "spread") {
    for (const vx of [-1.4, 0, 1.4]) bullets.push({ x: ship.x, y: ship.y - 19, vx, speed: 8.2, source: "ACE" });
    ship.cooldown = 0.24;
    playTone(520, 0.08, "square", 0.035);
    return;
  }
  if (currentWeapon === "plasma") {
    bullets.push({ x: ship.x, y: ship.y - 22, speed: 10, damage: 2, width: 9, height: 28, kind: "plasma", source: "ACE" });
    ship.cooldown = 0.42;
    playTone(240, 0.12, "sawtooth", 0.04);
    return;
  }
  bullets.push({ x: ship.x, y: ship.y - 19, speed: 8.8, source: "ACE" });
  ship.cooldown = 0.075;
  playTone(620, 0.045, "square", 0.025);
}

function selectWeapon(weapon) {
  if (!ownedWeapons.has(weapon)) return;
  currentWeapon = weapon;
  renderWeaponSelector();
}

function renderWeaponSelector() {
  weaponSelector.innerHTML = weaponCatalog.filter((weapon) => ownedWeapons.has(weapon.id)).map((weapon, index) => `<button type="button" data-weapon="${weapon.id}" aria-pressed="${weapon.id === currentWeapon}"><kbd>${index + 1}</kbd> ${weapon.id === "missile" ? "SEEKER" : weapon.id === "spread" ? "TRI-BURST" : weapon.id === "plasma" ? "PLASMA" : "LASER MG"}</button>`).join("");
}

function addFeedEntry(sourceText, resultText, variant = "") {
  const entry = document.createElement("div");
  entry.className = `feed-entry ${variant}`.trim();
  const source = document.createElement("strong");
  source.textContent = sourceText;
  const result = document.createElement("span");
  result.textContent = resultText;
  entry.append(source, result);
  killFeed.prepend(entry);
  while (killFeed.children.length > 4) killFeed.lastElementChild.remove();
  window.setTimeout(() => entry.remove(), 5000);
}

function addKillFeedEntry(callsign, enemy) {
  addFeedEntry(callsign, `DESTROYED ${enemy.tough ? "ELITE" : "RAIDER"}`);
}

function addShipArrivalEntry(enemy) {
  addFeedEntry("RADAR", enemy.tough ? "ELITE SHIP INBOUND" : "ALIEN SHIP INBOUND", "feed-alert");
}

function burst(x, y, color, amount = 12) {
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 3.2;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.35 + Math.random() * 0.55, color, size: 1 + Math.random() * 2.5 });
  }
}

function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function update(delta) {
  elapsed += delta;
  for (const star of stars) {
    star.y += star.speed * delta * 60;
    if (star.y > HEIGHT) {
      star.y = -2;
      star.x = Math.random() * WIDTH;
    }
  }

  if (keys.has("arrowleft") || keys.has("a") || keys.has("touch-left")) ship.x -= ship.speed * delta * 60;
  if (keys.has("arrowright") || keys.has("d") || keys.has("touch-right")) ship.x += ship.speed * delta * 60;
  if (keys.has(" ") || keys.has("touch-fire")) fire();
  ship.x = Math.max(ship.width / 2 + 8, Math.min(WIDTH - ship.width / 2 - 8, ship.x));
  ship.cooldown = Math.max(0, ship.cooldown - delta);
  ship.invulnerable = Math.max(0, ship.invulnerable - delta);
  for (const ally of allies) {
    if (!ally.active) continue;
    ally.roamTimer -= delta;
    if (ally.roamTimer <= 0 || Math.hypot(ally.targetX - ally.x, ally.targetY - ally.y) < 12) {
      ally.targetX = 24 + Math.random() * (WIDTH - 48);
      ally.targetY = 90 + Math.random() * (HEIGHT - 175);
      ally.roamTimer = 0.8 + Math.random() * 1.8;
    }
    const travel = Math.min(1, delta * 1.7);
    ally.x += (ally.targetX - ally.x) * travel;
    ally.y += (ally.targetY - ally.y) * travel;
    ally.cooldown -= delta;
  }

  spawnTimer -= delta;
  if (spawnTimer <= 0) {
    spawnEnemy();
    const threat = threatLevels[difficultySetting.value] || 1;
    spawnTimer = Math.max(0.32, 1.05 - wave * 0.035) * (0.7 + Math.random() * 0.6) / threat;
  }

  for (const bullet of bullets) {
    bullet.x += (bullet.vx || 0) * delta * 60;
    bullet.y -= bullet.speed * delta * 60;
  }
  for (const bullet of allyBullets) {
    bullet.x += bullet.vx * delta * 60;
    bullet.y += bullet.vy * delta * 60;
  }
  for (const missile of missiles) {
    if (missile.target && !missile.target.active && enemies.includes(missile.target)) {
      const desiredAngle = Math.atan2(missile.target.y - missile.y, missile.target.x - missile.x);
      const currentAngle = Math.atan2(missile.vy, missile.vx);
      const difference = Math.atan2(Math.sin(desiredAngle - currentAngle), Math.cos(desiredAngle - currentAngle));
      const angle = currentAngle + difference * Math.min(1, delta * 3.5);
      missile.vx = Math.cos(angle) * missile.speed;
      missile.vy = Math.sin(angle) * missile.speed;
    }
    missile.x += missile.vx * delta * 60;
    missile.y += missile.vy * delta * 60;
  }
  for (const shot of enemyShots) {
    shot.x += shot.vx * delta * 60;
    shot.y += shot.vy * delta * 60;
  }
  bullets = bullets.filter((bullet) => bullet.y > -12);
  allyBullets = allyBullets.filter((bullet) => bullet.y > -12 && bullet.y < HEIGHT + 12 && bullet.x > -12 && bullet.x < WIDTH + 12);
  missiles = missiles.filter((missile) => missile.y > -18 && missile.y < HEIGHT + 18 && missile.x > -18 && missile.x < WIDTH + 18 && !missile.active);
  enemyShots = enemyShots.filter((shot) => shot.y > -12 && shot.y < HEIGHT + 12 && shot.x > -12 && shot.x < WIDTH + 12);

  for (const enemy of enemies) {
    enemy.phase += delta * 2;
    enemy.y += enemy.verticalDirection * enemy.speed * delta * 60;
    const minY = enemy.size / 2 + 8;
    const maxY = HEIGHT * 0.58;
    if (enemy.y < minY) {
      enemy.y = minY;
      enemy.verticalDirection = 1;
    } else if (enemy.y > maxY) {
      enemy.y = maxY;
      enemy.verticalDirection = -1;
    }
    enemy.x += (enemy.drift + Math.sin(enemy.phase) * 0.55) * delta * 60;
    enemy.x = Math.max(enemy.size / 2, Math.min(WIDTH - enemy.size / 2, enemy.x));
    enemy.shootTimer -= delta;
    if (enemy.shootTimer <= 0 && enemy.y > 10 && enemy.y < HEIGHT - 150) {
      const threat = threatLevels[difficultySetting.value] || 1;
      const targets = [ship, ...allies.filter((ally) => ally.active)];
      if (transport) targets.push(transport);
      const target = targets[Math.floor(Math.random() * targets.length)];
      const speed = (3.2 + wave * 0.12) * threat;
      const distance = Math.hypot(target.x - enemy.x, target.y - enemy.y) || 1;
      enemyShots.push({
        x: enemy.x,
        y: enemy.y + enemy.size / 2,
        vx: (target.x - enemy.x) / distance * speed,
        vy: (target.y - enemy.y) / distance * speed
      });
      enemy.shootTimer = (2 + Math.random() * 1.6) / threat;
    }
  }

  if (transport) {
    transport.x += transport.speed * delta;
    if (transport.x > WIDTH - transport.width / 2) resolveEscort(true);
  }

  for (const ally of allies) {
    if (!ally.active || ally.cooldown > 0 || enemies.length === 0) continue;
    const target = enemies.reduce((closest, enemy) => {
      const distance = Math.abs(enemy.x - ally.x) + Math.max(0, ally.y - enemy.y) * 0.45;
      return distance < closest.distance ? { enemy, distance } : closest;
    }, { enemy: enemies[0], distance: Infinity }).enemy;
    const distance = Math.hypot(target.x - ally.x, target.y - ally.y) || 1;
    allyBullets.push({
      x: ally.x,
      y: ally.y - 12,
      vx: (target.x - ally.x) / distance * 7.2,
      vy: (target.y - ally.y) / distance * 7.2,
      source: ally.callsign
    });
    ally.cooldown = 0.62 + Math.random() * 0.35;
    playTone(440, 0.035, "triangle", 0.012);
  }

  for (const enemy of enemies) {
    for (const bullet of [...bullets, ...allyBullets, ...missiles]) {
      const bulletWidth = bullet.width || 4;
      const bulletHeight = bullet.height || 16;
      if (bullet.active || !overlaps(bullet.x - bulletWidth / 2, bullet.y - bulletHeight / 2, bulletWidth, bulletHeight, enemy.x - enemy.size / 2, enemy.y - enemy.size / 2, enemy.size, enemy.size)) continue;
      bullet.active = true;
      enemy.hp -= bullet.damage || 1;
      if (enemy.hp <= 0) {
        enemy.active = true;
        score += enemy.tough ? 30 : 10;
        credits += enemy.tough ? 3 : 1;
        writeStore("starfall-credits", String(credits));
        playTone(enemy.tough ? 280 : 420, 0.12, "triangle", 0.045);
        addKillFeedEntry(bullet.source || "SQUADRON", enemy);
        burst(enemy.x, enemy.y, enemy.tough ? "#ff9b58" : "#ff5d73", 14);
      } else {
        burst(enemy.x, enemy.y, "#ffd166", 4);
      }
    }
  }
  bullets = bullets.filter((bullet) => !bullet.active);
  allyBullets = allyBullets.filter((bullet) => !bullet.active);
  missiles = missiles.filter((missile) => !missile.active);
  enemies = enemies.filter((enemy) => {
    if (enemy.active) return false;
    if (enemy.y > HEIGHT + enemy.size) {
      loseLife();
      return false;
    }
    return true;
  });

  if (transport) {
    for (const shot of enemyShots) {
      if (shot.active || !overlaps(shot.x - 4, shot.y - 6, 8, 12, transport.x - transport.width / 2, transport.y - transport.height / 2, transport.width, transport.height)) continue;
      shot.active = true;
      transport.hp -= 1;
      burst(shot.x, shot.y, "#ff4055", 5);
      if (transport.hp <= 0) {
        resolveEscort(false);
        break;
      }
      updateEscortHud();
    }
  }

  for (const ally of allies) {
    if (!ally.active) continue;
    for (const shot of enemyShots) {
      if (shot.active || !overlaps(ally.x - 10, ally.y - 10, 20, 20, shot.x - 4, shot.y - 6, 8, 12)) continue;
      shot.active = true;
      ally.health -= 1;
      burst(shot.x, shot.y, "#ff5d73", 5);
      if (ally.health <= 0) {
        ally.active = false;
        burst(ally.x, ally.y, "#4e9bff", 12);
      }
    }
  }

  if (ship.invulnerable <= 0) {
    for (const enemy of enemies) {
      if (!overlaps(ship.x - 13, ship.y - 15, 26, 30, enemy.x - enemy.size / 2, enemy.y - enemy.size / 2, enemy.size, enemy.size)) continue;
      enemy.active = true;
      burst(enemy.x, enemy.y, "#ff4055", 12);
      loseLife();
      break;
    }
    for (const shot of enemyShots) {
      if (shot.active || !overlaps(ship.x - 13, ship.y - 15, 26, 30, shot.x - 4, shot.y - 6, 8, 12)) continue;
      shot.active = true;
      burst(shot.x, shot.y, "#ff5d73", 5);
      loseLife();
      break;
    }
  }
  enemyShots = enemyShots.filter((shot) => !shot.active);

  for (const particle of particles) {
    particle.x += particle.vx * delta * 60;
    particle.y += particle.vy * delta * 60;
    particle.life -= delta;
  }
  particles = particles.filter((particle) => particle.life > 0);

  const nextWave = 1 + Math.floor(score / 180);
  if (nextWave > wave) {
    wave = nextWave;
    if (wave > lastEscortWave && wave % 3 === 0) {
      lastEscortWave = wave;
      if (transport) escortQueued = true;
      else startEscortMission();
    }
  }
  updateHud();
}

function loseLife() {
  if (ship.invulnerable > 0 || state !== "playing") return;
  lives -= 1;
  ship.invulnerable = 1.35;
  playTone(110, 0.28, "sawtooth", 0.06);
  burst(ship.x, ship.y, "#67e8d2", 18);
  if (lives <= 0) {
    highScore = Math.max(highScore, score);
    writeStore("starfall-high-score", String(highScore));
    setState("gameover");
  }
}

function drawShip() {
  if (ship.invulnerable > 0 && Math.floor(elapsed * 14) % 2 === 0) return;
  const hull = hulls.find((item) => item.id === activeHull) || hulls[0];
  const enginePulse = 8 + Math.sin(elapsed * 24) * 2.5;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  const flame = ctx.createLinearGradient(0, 12, 0, 22 + enginePulse);
  flame.addColorStop(0, "#fff3a6");
  flame.addColorStop(0.35, hull.accent);
  flame.addColorStop(1, "rgba(78, 155, 255, 0)");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(-4, 12);
  ctx.lineTo(0, 22 + enginePulse);
  ctx.lineTo(4, 12);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = hull.color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = hull.color;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(5, -5);
  ctx.lineTo(18, 13);
  ctx.lineTo(17, 17);
  ctx.lineTo(6, 12);
  ctx.lineTo(0, 17);
  ctx.lineTo(-6, 12);
  ctx.lineTo(-17, 17);
  ctx.lineTo(-18, 13);
  ctx.lineTo(-5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(7, 16, 24, 0.38)";
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(3, 7);
  ctx.lineTo(0, 11);
  ctx.lineTo(-3, 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hull.accent;
  ctx.beginPath();
  ctx.moveTo(-11, 7);
  ctx.lineTo(-4, 2);
  ctx.lineTo(-6, 9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, 7);
  ctx.lineTo(4, 2);
  ctx.lineTo(6, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hull.accent;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(4, -2);
  ctx.lineTo(3, 4);
  ctx.lineTo(-3, 4);
  ctx.lineTo(-4, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff9b58";
  ctx.fillRect(-13, 13, 4, 2);
  ctx.fillRect(9, 13, 4, 2);
  ctx.fillStyle = "#d9ecff";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("ACE", 0, 30);
  ctx.restore();
}

function drawEnemy(enemy) {
  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  ctx.scale(enemy.size / 28, enemy.size / 28);
  const mainColor = enemy.tough ? "#b9223d" : "#ff4055";
  const edgeColor = enemy.tough ? "#ff9b58" : "#ff9aa7";
  ctx.shadowColor = mainColor;
  ctx.shadowBlur = enemy.tough ? 15 : 9;
  ctx.fillStyle = mainColor;
  ctx.beginPath();
  ctx.moveTo(0, 15);
  ctx.lineTo(-14, 2);
  ctx.lineTo(-12, -7);
  ctx.lineTo(-5, -4);
  ctx.lineTo(0, -10);
  ctx.lineTo(5, -4);
  ctx.lineTo(12, -7);
  ctx.lineTo(14, 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = enemy.tough ? "#681d2d" : "#8c2034";
  ctx.beginPath();
  ctx.moveTo(-8, 1);
  ctx.lineTo(0, -5);
  ctx.lineTo(8, 1);
  ctx.lineTo(0, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd3a0";
  ctx.fillRect(-10, 1, 3, 2);
  ctx.fillRect(7, 1, 3, 2);
  ctx.fillStyle = "#ffb15c";
  ctx.fillRect(-2, 10, 4, 3);
  ctx.fillStyle = edgeColor;
  ctx.fillRect(-8, -6, 3, 1);
  ctx.fillRect(5, -6, 3, 1);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#d6f7f1";
  for (const star of stars) {
    ctx.globalAlpha = 0.35 + star.size * 0.3;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(101, 229, 211, 0.08)";
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT - 36);
  ctx.lineTo(WIDTH, HEIGHT - 36);
  ctx.stroke();
  for (const bullet of bullets) {
    const plasma = bullet.kind === "plasma";
    ctx.fillStyle = plasma ? "#ffb15c" : "#8fffee";
    ctx.shadowColor = plasma ? "#ff713d" : "#65e5d3";
    ctx.shadowBlur = plasma ? 16 : 12;
    ctx.fillRect(bullet.x - (bullet.width || 4) / 2, bullet.y - (bullet.height || 16) / 2, bullet.width || 4, bullet.height || 16);
  }
  for (const bullet of allyBullets) {
    if (bullet.active) continue;
    ctx.fillStyle = "#75b8ff";
    ctx.shadowColor = "#4e9bff";
    ctx.shadowBlur = 8;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
    ctx.fillRect(-1.5, -7, 3, 14);
    ctx.restore();
  }
  for (const missile of missiles) {
    ctx.save();
    ctx.translate(missile.x, missile.y);
    ctx.rotate(Math.atan2(missile.vy, missile.vx) + Math.PI / 2);
    ctx.fillStyle = "#ffb15c";
    ctx.shadowColor = "#ff713d";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  for (const shot of enemyShots) {
    ctx.fillStyle = "#ff4055";
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const enemy of enemies) drawEnemy(enemy);
  if (transport) drawTransport();
  for (const ally of allies) drawWingmate(ally);
  for (const particle of particles) {
    ctx.globalAlpha = Math.min(1, particle.life * 2);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
  drawShip();
  drawRadar();
}

function drawWingmate(ally) {
  if (!ally.active) return;
  ctx.save();
  ctx.translate(ally.x, ally.y);
  ctx.shadowColor = "#4e9bff";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#4e9bff";
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(4, -4);
  ctx.lineTo(12, 7);
  ctx.lineTo(11, 10);
  ctx.lineTo(3, 7);
  ctx.lineTo(0, 11);
  ctx.lineTo(-3, 7);
  ctx.lineTo(-11, 10);
  ctx.lineTo(-12, 7);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#a8d6ff";
  ctx.beginPath();
  ctx.moveTo(-8, 5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 5);
  ctx.lineTo(3, 0);
  ctx.lineTo(4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#d9ecff";
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(3, 1);
  ctx.lineTo(0, 5);
  ctx.lineTo(-3, 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffb15c";
  ctx.fillRect(-2, 9, 4, 5 + Math.sin(elapsed * 22 + ally.x) * 1.5);
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#d9ecff";
  ctx.fillText(ally.callsign, 0, 19);
  ctx.restore();
}

function drawTransport() {
  ctx.save();
  ctx.translate(transport.x, transport.y);
  ctx.fillStyle = "#3177c9";
  ctx.fillRect(-transport.width / 2, -transport.height / 2, transport.width, transport.height);
  ctx.fillStyle = "#8fc7ff";
  ctx.fillRect(-transport.width / 2 + 9, -transport.height / 2 - 5, transport.width - 18, 7);
  ctx.fillStyle = "#e4f2ff";
  ctx.fillRect(-transport.width / 2 + 13, -4, 10, 8);
  ctx.fillRect(-5, -4, 10, 8);
  ctx.fillRect(transport.width / 2 - 23, -4, 10, 8);
  ctx.fillStyle = "#ff9b58";
  ctx.fillRect(-transport.width / 2 - 4, -7, 4, 14);
  ctx.fillRect(transport.width / 2, -7, 4, 14);
  ctx.fillStyle = "#d9ecff";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("CIVILIAN TRANSPORT", 0, transport.height / 2 + 13);
  ctx.restore();
}

function drawRadar() {
  if (radar.hidden) return;
  const width = radarCanvas.width;
  const height = radarCanvas.height;
  const padding = 12;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  radarCtx.clearRect(0, 0, width, height);
  radarCtx.fillStyle = "#08151a";
  radarCtx.fillRect(0, 0, width, height);
  radarCtx.strokeStyle = "rgba(101, 229, 211, 0.22)";
  radarCtx.lineWidth = 1;
  radarCtx.beginPath();
  radarCtx.moveTo(padding, height / 2);
  radarCtx.lineTo(width - padding, height / 2);
  radarCtx.moveTo(width / 2, padding);
  radarCtx.lineTo(width / 2, height - padding);
  radarCtx.arc(width / 2, height / 2, Math.min(plotWidth, plotHeight) * 0.42, 0, Math.PI * 2);
  radarCtx.stroke();

  const sweepAngle = elapsed * 1.3;
  radarCtx.strokeStyle = "rgba(101, 229, 211, 0.55)";
  radarCtx.beginPath();
  radarCtx.moveTo(width / 2, height / 2);
  radarCtx.lineTo(width / 2 + Math.cos(sweepAngle) * plotWidth / 2, height / 2 + Math.sin(sweepAngle) * plotHeight / 2);
  radarCtx.stroke();

  for (const enemy of enemies) {
    const x = padding + enemy.x / WIDTH * plotWidth;
    const y = padding + Math.max(0, Math.min(HEIGHT, enemy.y)) / HEIGHT * plotHeight;
    radarCtx.fillStyle = "#ff4055";
    radarCtx.beginPath();
    radarCtx.arc(x, y, enemy.tough ? 3 : 2, 0, Math.PI * 2);
    radarCtx.fill();
  }
  if (transport) {
    const x = padding + transport.x / WIDTH * plotWidth;
    const y = padding + transport.y / HEIGHT * plotHeight;
    radarCtx.fillStyle = "#8fc7ff";
    radarCtx.fillRect(x - 3, y - 2, 6, 4);
  }
  radarCtx.fillStyle = "#4e9bff";
  for (const ally of allies) {
    const x = padding + ally.x / WIDTH * plotWidth;
    const y = padding + ally.y / HEIGHT * plotHeight;
    radarCtx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  radarCtx.fillStyle = "#d9ecff";
  radarCtx.beginPath();
  radarCtx.arc(padding + ship.x / WIDTH * plotWidth, padding + ship.y / HEIGHT * plotHeight, 2.5, 0, Math.PI * 2);
  radarCtx.fill();
  radarCount.textContent = String(enemies.length).padStart(2, "0");
}

function frame(now) {
  if (state !== "playing") return;
  const delta = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;
  update(delta);
  draw();
  if (state === "playing") requestAnimationFrame(frame);
}

document.addEventListener("keydown", (event) => {
  if (state !== "playing") {
    if (event.key === "Escape" && state !== "menu") setState("menu");
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "1") selectWeapon("laser");
  if (key === "2") selectWeapon("missile");
  if (key === "3") selectWeapon("spread");
  if (key === "4") selectWeapon("plasma");
  if (["arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
  keys.add(key);
});
document.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

overlay.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "play" || action === "retry") startGame();
  else if (action === "settings" || action === "shop" || action === "menu") setState(action);
});
hullList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-hull]");
  if (button) purchaseOrEquip(button.dataset.hull);
});
weaponList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-buy-weapon]");
  if (button) purchaseOrSelectWeapon(button.dataset.buyWeapon);
});
weaponSelector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-weapon]");
  if (button) selectWeapon(button.dataset.weapon);
});

soundSetting.checked = soundEnabled;
soundSetting.addEventListener("change", () => {
  soundEnabled = soundSetting.checked;
  writeStore("starfall-sound", String(soundEnabled));
  if (soundEnabled) playTone(520, 0.08, "sine", 0.04);
});
const savedThreat = readStore("starfall-difficulty", "standard");
difficultySetting.value = Object.hasOwn(threatLevels, savedThreat) ? savedThreat : "standard";
difficultySetting.addEventListener("change", () => writeStore("starfall-difficulty", difficultySetting.value));

document.querySelectorAll("[data-control]").forEach((button) => {
  const control = `touch-${button.dataset.control}`;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    keys.add(control);
  });
  const release = () => keys.delete(control);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

updateHud();
renderWeaponSelector();
setState("menu");
draw();