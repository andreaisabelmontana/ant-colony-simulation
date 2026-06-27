// Ant Colony Optimization — framework-free core.
//
// No canvas, no DOM. Two independent pieces share the same pheromone math:
//
//   1. PheromoneField — the grid model the live demo runs on: deposit into
//      cells, then evaporate every cell by (1 - rho) each step.
//
//   2. AntSystem — the classic Ant System solver over a small weighted graph.
//      It makes the headline property ("the shorter route accumulates more
//      pheromone, with no central planner") directly testable: ants build
//      tours using the probabilistic transition rule, then reinforce the edges
//      they used by Q / tourLength, so shorter tours deposit more.
//
// A seeded PRNG (mulberry32) keeps everything deterministic for tests.

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

// mulberry32: small, fast, good-enough uniform [0,1) generator from a 32-bit seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Transition rule (shared)
// ---------------------------------------------------------------------------

// Ant System transition weights: w_i = tau_i^alpha * eta_i^beta, where eta is a
// heuristic desirability (typically 1/distance — closer/shorter is better).
// Returns the *normalized* probability distribution over the candidates, which
// by construction sums to 1.
//
//   pheromone : array of tau values for each candidate
//   heuristic : array of eta values for each candidate (same length)
export function transitionProbabilities(pheromone, heuristic, alpha = 1, beta = 2) {
  const n = pheromone.length;
  if (n !== heuristic.length) {
    throw new Error("pheromone and heuristic must have equal length");
  }
  const weights = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(pheromone[i], alpha) * Math.pow(heuristic[i], beta);
    weights[i] = w;
    total += w;
  }
  const probs = new Array(n);
  if (total === 0) {
    // Degenerate: no information at all — fall back to uniform.
    for (let i = 0; i < n; i++) probs[i] = 1 / n;
    return probs;
  }
  for (let i = 0; i < n; i++) probs[i] = weights[i] / total;
  return probs;
}

// Sample one index from a probability distribution using a uniform draw u in [0,1).
export function sampleIndex(probs, u) {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (u < acc) return i;
  }
  return probs.length - 1; // guard against fp drift on the last bucket
}

// ---------------------------------------------------------------------------
// Grid pheromone field (the demo's model)
// ---------------------------------------------------------------------------

export class PheromoneField {
  // rho is the evaporation rate per step; each cell is multiplied by (1 - rho).
  constructor(cols, rows, rho = 0.1) {
    this.cols = cols;
    this.rows = rows;
    this.rho = rho;
    this.grid = new Float32Array(cols * rows);
  }

  index(cx, cy) {
    return cy * this.cols + cx;
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  get(cx, cy) {
    return this.inBounds(cx, cy) ? this.grid[this.index(cx, cy)] : 0;
  }

  // Add `amount` of pheromone at a cell (clamped no-op if off-grid).
  deposit(cx, cy, amount) {
    if (this.inBounds(cx, cy)) this.grid[this.index(cx, cy)] += amount;
  }

  // Multiply every cell by (1 - rho). This is exactly the evaporation step.
  evaporate() {
    const k = 1 - this.rho;
    const g = this.grid;
    for (let i = 0; i < g.length; i++) g[i] *= k;
  }

  // Sum of pheromone over a 3x3 neighbourhood centred on (cx, cy) — the
  // smoothed reading an ant's sensor sees in the demo.
  senseNeighborhood(cx, cy) {
    let s = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        s += this.get(cx + ox, cy + oy);
      }
    }
    return s;
  }

  total() {
    let s = 0;
    for (let i = 0; i < this.grid.length; i++) s += this.grid[i];
    return s;
  }
}

// ---------------------------------------------------------------------------
// Ant System over a small weighted graph
// ---------------------------------------------------------------------------

// Graph: nodes 0..n-1, with a symmetric distance matrix `dist` (dist[i][j]).
// Use Infinity (or 0 on the diagonal) for "no edge"; only finite, positive,
// off-diagonal distances are treated as edges.
export class AntSystem {
  constructor(dist, opts = {}) {
    this.n = dist.length;
    this.dist = dist;
    this.alpha = opts.alpha ?? 1; // pheromone exponent
    this.beta = opts.beta ?? 2;   // heuristic exponent
    this.rho = opts.rho ?? 0.5;   // evaporation rate
    this.Q = opts.Q ?? 1;         // deposit constant: an edge on a tour of
                                  // length L gets Q / L of pheromone
    this.tau0 = opts.tau0 ?? 1;   // initial pheromone on every edge
    this.rng = opts.rng ?? mulberry32(opts.seed ?? 1);

    // Pheromone matrix, symmetric.
    this.tau = [];
    for (let i = 0; i < this.n; i++) {
      this.tau.push(new Array(this.n).fill(this.tau0));
    }
  }

  // Heuristic desirability of edge i->j: 1 / distance (shorter = more desirable).
  heuristic(i, j) {
    const d = this.dist[i][j];
    return d > 0 && Number.isFinite(d) ? 1 / d : 0;
  }

  // Candidate next nodes from `current`, excluding already-visited nodes.
  candidates(current, visited) {
    const out = [];
    for (let j = 0; j < this.n; j++) {
      if (j === current || visited[j]) continue;
      const d = this.dist[current][j];
      if (d > 0 && Number.isFinite(d)) out.push(j);
    }
    return out;
  }

  // Probability distribution over the candidate next nodes from `current`.
  stepProbabilities(current, visited) {
    const cands = this.candidates(current, visited);
    const pher = cands.map((j) => this.tau[current][j]);
    const heur = cands.map((j) => this.heuristic(current, j));
    const probs = transitionProbabilities(pher, heur, this.alpha, this.beta);
    return { candidates: cands, probs };
  }

  // Build one tour visiting every node once, starting at `start`.
  // Returns { path: number[], length: number } (length = Infinity if it dead-ends).
  buildTour(start = 0) {
    const visited = new Array(this.n).fill(false);
    const path = [start];
    visited[start] = true;
    let current = start;
    let length = 0;

    for (let k = 1; k < this.n; k++) {
      const { candidates, probs } = this.stepProbabilities(current, visited);
      if (candidates.length === 0) return { path, length: Infinity };
      const choice = candidates[sampleIndex(probs, this.rng())];
      length += this.dist[current][choice];
      visited[choice] = true;
      path.push(choice);
      current = choice;
    }
    return { path, length };
  }

  // Build one source -> goal path (the foraging model: nest -> food). The ant
  // takes probabilistic steps, never revisiting a node, until it reaches `goal`
  // or dead-ends. This is the model in which a genuinely shorter route can win.
  // Returns { path, length } with length = Infinity if the goal is unreachable.
  buildPath(start, goal, maxSteps = this.n * 4) {
    const visited = new Array(this.n).fill(false);
    const path = [start];
    visited[start] = true;
    let current = start;
    let length = 0;

    for (let step = 0; step < maxSteps; step++) {
      if (current === goal) return { path, length };
      const { candidates, probs } = this.stepProbabilities(current, visited);
      if (candidates.length === 0) return { path, length: Infinity };
      const choice = candidates[sampleIndex(probs, this.rng())];
      length += this.dist[current][choice];
      visited[choice] = true;
      path.push(choice);
      current = choice;
    }
    return current === goal ? { path, length } : { path, length: Infinity };
  }

  // Evaporate every edge: tau *= (1 - rho).
  evaporate() {
    const k = 1 - this.rho;
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) this.tau[i][j] *= k;
    }
  }

  // Deposit Q / length along the edges of a tour (symmetric).
  depositTour(path, length) {
    if (!Number.isFinite(length) || length <= 0) return;
    const add = this.Q / length;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1];
      this.tau[a][b] += add;
      this.tau[b][a] += add;
    }
  }

  // One iteration: every ant builds a tour, then evaporate once, then all ants
  // deposit. Returns the best (shortest) tour found this iteration.
  iterate(numAnts = this.n, start = 0) {
    const tours = [];
    let best = { path: null, length: Infinity };
    for (let a = 0; a < numAnts; a++) {
      const tour = this.buildTour(start);
      tours.push(tour);
      if (tour.length < best.length) best = tour;
    }
    this.evaporate();
    for (const t of tours) this.depositTour(t.path, t.length);
    return best;
  }

  // Run `iters` iterations; returns the best tour seen overall.
  run(iters, numAnts = this.n, start = 0) {
    let best = { path: null, length: Infinity };
    for (let it = 0; it < iters; it++) {
      const b = this.iterate(numAnts, start);
      if (b.length < best.length) best = b;
    }
    return best;
  }

  // Foraging variant: every ant searches for a path from `start` to `goal`,
  // then evaporate once, then ants that reached the goal deposit Q / length.
  // Returns the best (shortest) successful path this iteration.
  iteratePaths(start, goal, numAnts) {
    const ants = numAnts ?? this.n;
    const paths = [];
    let best = { path: null, length: Infinity };
    for (let a = 0; a < ants; a++) {
      const p = this.buildPath(start, goal);
      paths.push(p);
      if (p.length < best.length) best = p;
    }
    this.evaporate();
    for (const p of paths) this.depositTour(p.path, p.length);
    return best;
  }

  // Run `iters` foraging iterations from `start` to `goal`.
  runPaths(iters, start, goal, numAnts) {
    let best = { path: null, length: Infinity };
    for (let it = 0; it < iters; it++) {
      const b = this.iteratePaths(start, goal, numAnts);
      if (b.length < best.length) best = b;
    }
    return best;
  }
}
