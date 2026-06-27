# Ant Colony Simulation

An **ant-colony foraging** simulation. No ant knows where the food is and there's no central planner — yet the colony reliably discovers near-shortest paths to food, then re-routes when a pile runs out. All of it emerges from evaporating pheromone trails and positive feedback.

**▶ Live:** https://andreaisabelmontana.github.io/ant-colony-simulation/

> **Not an original idea.** This recreates the concept of an existing project — I didn't invent it. I rebuilt it from scratch, my own way, out of curiosity about how it actually works.

## What's here

- **`src/aco.js`** — the framework-free Ant Colony Optimization core. No canvas, no DOM. This is the part that's tested.
- **`src/main.js`** — the canvas demo. It drives the same pheromone deposit + evaporation math from the core.
- **`test/aco.test.js`** — real tests via Node's built-in runner (`node:test` + `node:assert`, no dependencies).

## The ACO math

The core has two pieces that share one pheromone model.

### 1. Pheromone field (the demo's grid)

Ants deposit pheromone into grid cells and it **evaporates** every step:

```
deposit:     τ(cell) += amount
evaporate:   τ(cell) *= (1 − ρ)        for every cell, every step
```

`ρ` (rho) is the evaporation rate. Evaporation is what lets stale routes fade so the network can adapt when food moves or runs out.

### 2. Probabilistic transition rule

When an ant at node *i* chooses where to go next, each candidate *j* gets a weight combining how much pheromone is on the edge (τ) and a heuristic desirability (η, typically `1/distance` — shorter is better):

```
            τ(i,j)^α · η(i,j)^β
P(i→j) = ─────────────────────────
          Σ_k  τ(i,k)^α · η(i,k)^β
```

- `α` weights pheromone (the colony's memory), `β` weights the local heuristic.
- The denominator normalizes, so **the distribution over candidate moves always sums to 1**.
- Higher pheromone → higher probability; closer/shorter options → higher probability.

### 3. Reinforcement (deposit ∝ 1/length)

After every ant has built a route from source to target, each edge it used is reinforced by

```
Δτ = Q / L          (L = length of that route)
```

Shorter routes have smaller `L`, so they deposit **more** pheromone per pass. Combined with evaporation, this positive feedback is what makes the shortest route win.

## The emergent property (and how it's tested)

The headline claim — *the shorter route emerges with no central planner* — is tested directly on a **double-bridge** graph: two node-disjoint routes from source to target, one of length 2 and one of length 6. Ants forage from source to target; the short route deposits `Q/2` per pass and the long route only `Q/6`.

The tests assert that, after many iterations (with a seeded PRNG for determinism):

- pheromone **evaporation** multiplies every trail by exactly `(1 − ρ)` each step;
- the **transition distribution sums to 1** and assigns higher probability to higher-pheromone and closer options;
- **deposit** adds exactly `Q / length` to each edge of a route;
- the colony **concentrates pheromone on the shorter route** (its first edge ends with > 3× the pheromone of the long route's, and the short route is then chosen for > 80% of fresh foraging runs);
- the best route found is the **genuinely shortest** one.

A small seeded generator (`mulberry32`) lives in the core so every run is reproducible.

## Run it

**Demo** — it's a single static page, no build step:

```
# open index.html directly, or serve the folder:
python -m http.server      # then visit http://localhost:8000
```

**Tests** — Node 18+ (developed on Node 24), no npm install needed:

```
node --test
```

Real output:

```
✔ mulberry32 is deterministic and in [0,1)
✔ evaporation multiplies trails by (1 - rho) exactly
✔ evaporation over many steps equals (1 - rho)^n
✔ grid deposit adds exactly the requested amount
✔ graph deposit adds Q / length to each edge on the tour (symmetric)
✔ transition probabilities sum to 1
✔ higher pheromone -> higher probability (heuristics equal)
✔ closer option (higher heuristic) -> higher probability (pheromone equal)
✔ transition falls back to uniform when there is no information
✔ sampleIndex respects the distribution boundaries
✔ colony concentrates pheromone on the shorter route (emergent shortest path)
✔ the short route is chosen far more often after convergence
✔ the best foraging path found is the genuinely shortest one
✔ same seed -> identical converged pheromone matrix
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

## Demo controls

- **Ants** (50–1200), **evaporation**, **deposit** strength, **sensor angle**, **wander** — all live
- **Click / drag** on the field to drop new food piles and watch trails re-form
- Toggle the pheromone heatmap on/off; **Reset colony** to start fresh

In the demo, each ant alternates between *searching* (follow the to-food field, lay to-home) and *returning* (follow to-home, lay to-food). Deposit strength decays the longer it's been since an ant touched the nest or food, so shorter round-trips lay stronger trails — the grid analogue of `Δτ ∝ 1/length`.

## Tech

Vanilla JS + Canvas 2D, ES modules, no dependencies. Pheromones live in two `PheromoneField` grids (`Float32Array`) rendered as a heatmap via an offscreen `ImageData`; ants are stored struct-of-arrays for speed.

```
index.html
styles.css
src/aco.js     # tested ACO core: PheromoneField, transition rule, Ant System
src/main.js    # canvas demo, drives the core's deposit + evaporation
test/aco.test.js
```

## License

MIT — see [LICENSE](LICENSE).
