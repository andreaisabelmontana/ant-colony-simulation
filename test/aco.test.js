import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mulberry32,
  transitionProbabilities,
  sampleIndex,
  PheromoneField,
  AntSystem,
} from "../src/aco.js";

// ---------------------------------------------------------------------------
// Seeded PRNG determinism
// ---------------------------------------------------------------------------

test("mulberry32 is deterministic and in [0,1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());          // same seed -> same stream
    assert.ok(x >= 0 && x < 1);    // in range
  }
  // Different seed -> different stream.
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

// ---------------------------------------------------------------------------
// Evaporation: every cell multiplied by (1 - rho) each step (exact)
// ---------------------------------------------------------------------------

test("evaporation multiplies trails by (1 - rho) exactly", () => {
  const rho = 0.25;
  const field = new PheromoneField(2, 2, rho);
  field.deposit(0, 0, 100);
  field.deposit(1, 1, 40);

  field.evaporate();
  assert.equal(field.get(0, 0), 100 * (1 - rho)); // 75
  assert.equal(field.get(1, 1), 40 * (1 - rho));  // 30

  field.evaporate();
  assert.equal(field.get(0, 0), 100 * (1 - rho) * (1 - rho)); // 56.25
  assert.equal(field.get(1, 1), 40 * (1 - rho) * (1 - rho));  // 22.5
});

test("evaporation over many steps equals (1 - rho)^n", () => {
  const rho = 0.1;
  const field = new PheromoneField(1, 1, rho);
  field.deposit(0, 0, 1000);
  const steps = 20;
  for (let i = 0; i < steps; i++) field.evaporate();
  const expected = 1000 * Math.pow(1 - rho, steps);
  // Float32 storage, so compare with a relative tolerance rather than exact.
  assert.ok(Math.abs(field.get(0, 0) - expected) / expected < 1e-5);
});

// ---------------------------------------------------------------------------
// Deposit adds the expected amount (Q / length on a graph edge)
// ---------------------------------------------------------------------------

test("grid deposit adds exactly the requested amount", () => {
  const field = new PheromoneField(3, 3, 0.1);
  field.deposit(1, 1, 7);
  assert.equal(field.get(1, 1), 7);
  field.deposit(1, 1, 3);
  assert.equal(field.get(1, 1), 10);
  // Off-grid deposits are a no-op and do not throw.
  field.deposit(-1, 0, 999);
  field.deposit(0, 99, 999);
  assert.equal(field.total(), 10);
});

test("graph deposit adds Q / length to each edge on the tour (symmetric)", () => {
  // 3-node line graph; deposit on a tour 0->1->2 with a known length.
  const dist = [
    [0, 2, 6],
    [2, 0, 3],
    [6, 3, 0],
  ];
  const Q = 12;
  const as = new AntSystem(dist, { Q, tau0: 0, rho: 0, seed: 1 });
  const path = [0, 1, 2];
  const length = 2 + 3; // 5
  as.depositTour(path, length);

  const add = Q / length; // 2.4
  assert.equal(as.tau[0][1], add);
  assert.equal(as.tau[1][0], add); // symmetric
  assert.equal(as.tau[1][2], add);
  assert.equal(as.tau[2][1], add);
  // Edge 0-2 was not used by the tour.
  assert.equal(as.tau[0][2], 0);
});

// ---------------------------------------------------------------------------
// Transition probabilities: sum to 1, and favour stronger/closer options
// ---------------------------------------------------------------------------

test("transition probabilities sum to 1", () => {
  const probs = transitionProbabilities([1, 3, 2], [0.5, 0.2, 0.9], 1, 2);
  const sum = probs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(probs.every((p) => p >= 0));
});

test("higher pheromone -> higher probability (heuristics equal)", () => {
  // Equal heuristic so only pheromone differentiates the two options.
  const probs = transitionProbabilities([1, 4], [1, 1], 1, 2);
  assert.ok(probs[1] > probs[0]);
  // With alpha = 1 the ratio is exactly the pheromone ratio: 4:1 -> 0.8 / 0.2.
  assert.ok(Math.abs(probs[1] / probs[0] - 4) < 1e-9);
});

test("closer option (higher heuristic) -> higher probability (pheromone equal)", () => {
  // eta = 1/distance: option 0 is at distance 1, option 1 at distance 5.
  const probs = transitionProbabilities([1, 1], [1 / 1, 1 / 5], 1, 2);
  assert.ok(probs[0] > probs[1]);
});

test("transition falls back to uniform when there is no information", () => {
  const probs = transitionProbabilities([0, 0, 0], [0, 0, 0]);
  for (const p of probs) assert.ok(Math.abs(p - 1 / 3) < 1e-12);
});

test("sampleIndex respects the distribution boundaries", () => {
  const probs = [0.2, 0.5, 0.3];
  assert.equal(sampleIndex(probs, 0.0), 0);
  assert.equal(sampleIndex(probs, 0.19), 0);
  assert.equal(sampleIndex(probs, 0.2), 1);
  assert.equal(sampleIndex(probs, 0.69), 1);
  assert.equal(sampleIndex(probs, 0.7), 2);
  assert.equal(sampleIndex(probs, 0.999), 2);
});

// ---------------------------------------------------------------------------
// Emergent shortest path: pheromone concentrates on the shorter route
// ---------------------------------------------------------------------------

// Double-bridge graph: two node-disjoint routes from SOURCE (0) to TARGET (3).
//   short: 0 -> 1 -> 3   (1 + 1 = 2)
//   long:  0 -> 2 -> 3   (1 + 5 = 6)
// Ants forage from 0 to 3 (buildPath). The short route deposits Q / 2 per pass,
// the long route only Q / 6, so positive feedback should drive the colony onto
// the short route — the emergent shortest path, with no node knowing the answer.
function doubleBridge() {
  const INF = Infinity;
  return [
    //        0    1    2    3
    /* 0 */ [INF, 1, 1, INF],
    /* 1 */ [1, INF, INF, 1],
    /* 2 */ [1, INF, INF, 5],
    /* 3 */ [INF, 1, 5, INF],
  ];
}

const SHORT_BRANCH = 1; // first hop on the short route
const LONG_BRANCH = 2;  // first hop on the long route

test("colony concentrates pheromone on the shorter route (emergent shortest path)", () => {
  const as = new AntSystem(doubleBridge(), {
    alpha: 1,
    beta: 2,
    rho: 0.5,
    Q: 1,
    tau0: 1,
    seed: 12345,
  });

  // Sanity: before learning, both first-hop branches are equally baited.
  const before = as.stepProbabilities(0, [true, false, false, false]);
  const pShortBefore = before.probs[before.candidates.indexOf(SHORT_BRANCH)];
  const pLongBefore = before.probs[before.candidates.indexOf(LONG_BRANCH)];
  assert.ok(Math.abs(pShortBefore - pLongBefore) < 1e-12);

  // Forage from 0 -> 3 for many iterations; feedback reinforces the short edge.
  as.runPaths(200, 0, 3, 20);

  // tau[0][1] is the short branch, tau[0][2] the long branch.
  assert.ok(
    as.tau[0][SHORT_BRANCH] > as.tau[0][LONG_BRANCH],
    `expected short branch tau ${as.tau[0][SHORT_BRANCH]} > long branch tau ${as.tau[0][LONG_BRANCH]}`,
  );
  // And the bias should be strong, not marginal.
  assert.ok(as.tau[0][SHORT_BRANCH] > 3 * as.tau[0][LONG_BRANCH]);
});

test("the short route is chosen far more often after convergence", () => {
  const as = new AntSystem(doubleBridge(), {
    alpha: 1,
    beta: 2,
    rho: 0.5,
    Q: 1,
    tau0: 1,
    seed: 999,
  });
  as.runPaths(200, 0, 3, 20);

  // Sample fresh foraging paths under the converged pheromone field.
  let short = 0, long = 0;
  for (let i = 0; i < 500; i++) {
    const { path } = as.buildPath(0, 3);
    if (path[1] === SHORT_BRANCH) short++;
    else if (path[1] === LONG_BRANCH) long++;
  }
  assert.ok(short > long, `short ${short} should exceed long ${long}`);
  assert.ok(
    short > 0.8 * (short + long),
    `short fraction ${short / (short + long)} should exceed 0.8`,
  );
});

test("the best foraging path found is the genuinely shortest one", () => {
  const as = new AntSystem(doubleBridge(), { seed: 7, rho: 0.5, Q: 1, tau0: 1 });
  const best = as.runPaths(100, 0, 3, 20);
  // Shortest 0 -> 3 path is 0 -> 1 -> 3, length 2.
  assert.deepEqual(best.path, [0, 1, 3]);
  assert.equal(best.length, 2);
});

// ---------------------------------------------------------------------------
// Determinism end-to-end
// ---------------------------------------------------------------------------

test("same seed -> identical converged pheromone matrix", () => {
  const a = new AntSystem(doubleBridge(), { seed: 2024, rho: 0.5, Q: 1, tau0: 1 });
  const b = new AntSystem(doubleBridge(), { seed: 2024, rho: 0.5, Q: 1, tau0: 1 });
  a.runPaths(50, 0, 3, 10);
  b.runPaths(50, 0, 3, 10);
  assert.deepEqual(a.tau, b.tau);
});
