# Antfarm

An **ant-colony foraging** simulation. No ant knows where the food is and there's no central planner — yet the colony reliably discovers near-shortest paths to food, then re-routes when a pile runs out. All of it emerges from two evaporating pheromone fields.

**▶ Live:** https://andreaisabelmontana.github.io/antfarm/

> **Not an original idea.** This recreates the concept of an existing project — I didn't invent it. I rebuilt it from scratch, my own way, out of curiosity about how it actually works (and tried to make it a little better along the way).

## How it works

Each ant alternates between two jobs:

- **Searching** — follow the *to-food* pheromone, while laying *to-home* pheromone behind it
- **Returning** (carrying food) — follow the *to-home* pheromone, while laying *to-food* pheromone

The trick that produces *short* paths: an ant's deposit strength **decays** the longer it's been since it last touched the nest or a food pile. Shorter round-trips lay stronger trails, so they out-reinforce longer detours. Pheromones constantly evaporate, so stale routes fade and the network adapts.

## Controls

- **Ants** (50–1200), **evaporation**, **deposit** strength, **sensor angle**, and **wander** — all live
- **Click / drag** on the field to drop new food piles and watch trails re-form
- Toggle the pheromone heatmap on/off to see the bare ants
- **Reset colony** to start fresh

## Tech

Vanilla JS + Canvas 2D. Pheromones live in two `Float32Array` grids rendered as a heatmap via an offscreen `ImageData`; ants are stored struct-of-arrays for speed. No build step, no dependencies.

```
index.html
styles.css
src/main.js   # grid fields, ant sensing/steering, deposit + evaporation, render
```

## License

MIT — see [LICENSE](LICENSE).
