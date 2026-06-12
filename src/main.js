// Ant Colony Simulation — ant-colony foraging.
//
// No ant knows where the food is. Each one wanders, and:
//   • while SEARCHING it follows the "to-food" pheromone and lays "to-home"
//   • while RETURNING it follows the "to-home" pheromone and lays "to-food"
// Deposit strength decays the longer an ant has been away from its last goal,
// so shorter round-trips reinforce their trail more — the colony converges on
// near-shortest paths to food with no central planner. Trails evaporate, so
// when a pile is eaten the network re-routes to the next one.

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const CELL = 5; // pheromone grid resolution (px)
let W, H, cols, rows;
let pherFood, pherHome; // Float32Array fields
let field; // offscreen canvas for the heatmap

const off = document.createElement("canvas");
const offCtx = off.getContext("2d");

const cfg = {
  ants: 350, evap: 0.30, deposit: 60, sensorAngle: 35 * Math.PI / 180,
  wander: 0.30, showPher: true,
};

const SENSOR_DIST = 9;
const SPEED = 1.1;
const TURN = 0.5;

let nest = { x: 0, y: 0, r: 16 };
let foods = []; // {x, y, amount}
// ant state (struct-of-arrays)
let ax, ay, aang, acarry, adep;

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL);
  pherFood = new Float32Array(cols * rows);
  pherHome = new Float32Array(cols * rows);
  off.width = cols; off.height = rows;
  field = offCtx.createImageData(cols, rows);
  nest = { x: W * 0.2, y: H * 0.5, r: 16 };
}

function seedFoods() {
  foods = [
    { x: W * 0.78, y: H * 0.30, amount: 4000 },
    { x: W * 0.72, y: H * 0.74, amount: 4000 },
  ];
}

function spawnAnts() {
  const n = cfg.ants;
  ax = new Float32Array(n); ay = new Float32Array(n);
  aang = new Float32Array(n); acarry = new Uint8Array(n); adep = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ax[i] = nest.x; ay[i] = nest.y;
    aang[i] = Math.random() * Math.PI * 2;
    acarry[i] = 0; adep[i] = 1;
  }
}

function reset() {
  resize();
  pherFood.fill(0); pherHome.fill(0);
  seedFoods();
  spawnAnts();
}

function idx(cx, cy) { return cy * cols + cx; }

function sense(field, x, y, ang) {
  const sx = x + Math.cos(ang) * SENSOR_DIST;
  const sy = y + Math.sin(ang) * SENSOR_DIST;
  const cx = Math.floor(sx / CELL), cy = Math.floor(sy / CELL);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1; // off-grid: avoid
  // 3x3 sum for a smoother gradient
  let s = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const nx = cx + ox, ny = cy + oy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) s += field[idx(nx, ny)];
  }
  return s;
}

function depositAt(field, x, y, amt) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const nx = cx + ox, ny = cy + oy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) {
      const w = (ox === 0 && oy === 0) ? 1 : 0.4;
      field[idx(nx, ny)] += amt * w;
    }
  }
}

function step() {
  const n = ax.length;
  const sa = cfg.sensorAngle;

  for (let i = 0; i < n; i++) {
    const searching = acarry[i] === 0;
    const followF = searching ? pherFood : pherHome;
    const layF = searching ? pherHome : pherFood;

    // sense left / center / right
    const c = sense(followF, ax[i], ay[i], aang[i]);
    const l = sense(followF, ax[i], ay[i], aang[i] - sa);
    const r = sense(followF, ax[i], ay[i], aang[i] + sa);

    if (l < 0 || r < 0 || c < 0) {
      // near a wall — steer back toward center of the world
      aang[i] = Math.atan2(H / 2 - ay[i], W / 2 - ax[i]) + (Math.random() - 0.5);
    } else if (c >= l && c >= r) {
      aang[i] += (Math.random() - 0.5) * cfg.wander; // keep course, jitter
    } else if (l > r) {
      aang[i] -= TURN * (0.5 + Math.random() * 0.5);
    } else {
      aang[i] += TURN * (0.5 + Math.random() * 0.5);
    }
    aang[i] += (Math.random() - 0.5) * cfg.wander * 0.6;

    // move
    ax[i] += Math.cos(aang[i]) * SPEED;
    ay[i] += Math.sin(aang[i]) * SPEED;

    // walls: clamp + reflect heading
    if (ax[i] < 1) { ax[i] = 1; aang[i] = Math.PI - aang[i]; }
    else if (ax[i] > W - 1) { ax[i] = W - 1; aang[i] = Math.PI - aang[i]; }
    if (ay[i] < 1) { ay[i] = 1; aang[i] = -aang[i]; }
    else if (ay[i] > H - 1) { ay[i] = H - 1; aang[i] = -aang[i]; }

    // deposit on the opposite field, weakening over time since last goal
    adep[i] *= 0.9965;
    depositAt(layF, ax[i], ay[i], cfg.deposit * adep[i]);

    // reaching food / nest
    if (searching) {
      for (const f of foods) {
        if (f.amount > 0) {
          const dx = ax[i] - f.x, dy = ay[i] - f.y;
          if (dx * dx + dy * dy < 12 * 12) {
            acarry[i] = 1; f.amount -= 1; adep[i] = 1;
            aang[i] += Math.PI; // turn around
            break;
          }
        }
      }
    } else {
      const dx = ax[i] - nest.x, dy = ay[i] - nest.y;
      if (dx * dx + dy * dy < nest.r * nest.r) {
        acarry[i] = 0; adep[i] = 1; aang[i] += Math.PI;
      }
    }
  }

  // evaporate
  const k = 1 - cfg.evap * 0.02;
  for (let i = 0; i < pherFood.length; i++) {
    pherFood[i] *= k;
    pherHome[i] *= k;
  }
}

function render() {
  ctx.fillStyle = "#0c0a06";
  ctx.fillRect(0, 0, W, H);

  if (cfg.showPher) {
    const d = field.data;
    for (let i = 0; i < pherFood.length; i++) {
      const f = Math.min(255, pherFood[i] * 0.7);
      const h = Math.min(255, pherHome[i] * 0.7);
      const o = i * 4;
      d[o] = h * 0.4;            // home → cool blue-violet
      d[o + 1] = f * 0.8 + h * 0.2; // food → green
      d[o + 2] = h * 0.9 + f * 0.2;
      d[o + 3] = Math.min(235, (f + h) * 1.4);
    }
    offCtx.putImageData(field, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(off, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // food piles
  for (const f of foods) {
    if (f.amount <= 0) continue;
    const r = 6 + Math.sqrt(f.amount) * 0.18;
    ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#7CFF8A"; ctx.shadowColor = "#7CFF8A"; ctx.shadowBlur = 16;
    ctx.fill(); ctx.shadowBlur = 0;
  }

  // nest
  ctx.beginPath(); ctx.arc(nest.x, nest.y, nest.r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffb454"; ctx.shadowColor = "#ffb454"; ctx.shadowBlur = 20;
  ctx.fill(); ctx.shadowBlur = 0;

  // ants
  for (let i = 0; i < ax.length; i++) {
    ctx.fillStyle = acarry[i] ? "#eafff0" : "#d8c39a";
    ctx.fillRect(ax[i] - 1, ay[i] - 1, 2.2, 2.2);
  }
}

let running = true;
function frame() {
  if (running) step();
  render();
  requestAnimationFrame(frame);
}

// ---- controls ----
const ui = {
  ants: document.getElementById("ants"), evap: document.getElementById("evap"),
  dep: document.getElementById("dep"), ang: document.getElementById("ang"),
  wan: document.getElementById("wan"), showpher: document.getElementById("showpher"),
};
const out = (k) => document.querySelector(`[data-out="${k}"]`);
function sync(changedCount) {
  cfg.evap = +ui.evap.value;
  cfg.deposit = +ui.dep.value;
  cfg.sensorAngle = (+ui.ang.value) * Math.PI / 180;
  cfg.wander = +ui.wan.value;
  cfg.showPher = ui.showpher.checked;
  out("evap").textContent = (+ui.evap.value).toFixed(2);
  out("dep").textContent = ui.dep.value;
  out("ang").textContent = ui.ang.value;
  out("wan").textContent = (+ui.wan.value).toFixed(2);
  out("ants").textContent = ui.ants.value;
  if (changedCount && +ui.ants.value !== cfg.ants) { cfg.ants = +ui.ants.value; spawnAnts(); }
}
ui.ants.addEventListener("input", () => sync(true));
[ui.evap, ui.dep, ui.ang, ui.wan, ui.showpher].forEach((el) => el.addEventListener("input", () => sync(false)));

document.getElementById("collapse").addEventListener("click", () =>
  document.getElementById("panel").classList.toggle("hidden"));
document.getElementById("reset").addEventListener("click", () => { reset(); sync(false); });

// drop food by clicking / dragging
let dropping = false;
function dropFood(e) {
  const t = e.touches ? e.touches[0] : e;
  const x = t.clientX, y = t.clientY;
  // merge into a nearby pile or create a new one
  const near = foods.find((f) => (f.x - x) ** 2 + (f.y - y) ** 2 < 30 * 30);
  if (near) near.amount += 1500; else foods.push({ x, y, amount: 2500 });
}
canvas.addEventListener("mousedown", (e) => { dropping = true; dropFood(e); });
canvas.addEventListener("mousemove", (e) => { if (dropping) dropFood(e); });
window.addEventListener("mouseup", () => (dropping = false));
canvas.addEventListener("touchstart", (e) => { dropFood(e); }, { passive: true });

window.addEventListener("resize", () => { reset(); sync(false); });

reset();
sync(false);
cfg.ants = +ui.ants.value;
frame();

// debug hook for deterministic testing
window.__antfarm = {
  step, render, reset, cfg,
  get foods() { return foods; },
  get dims() { return { W, H, cols, rows }; },
  get pher() { let s = 0; for (let i = 0; i < pherHome.length; i++) s += pherHome[i] + pherFood[i]; return s; },
  get counts() { let c = 0; for (let i = 0; i < acarry.length; i++) c += acarry[i]; return { carrying: c, total: acarry.length }; },
};
