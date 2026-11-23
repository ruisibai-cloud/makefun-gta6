// Solmar Bay itself: a seeded grid city. Ten roads run each way, the blocks
// between them hold one to three buildings, the east edge is a beach and the
// sea, and a few blocks stay open as parks. Landmarks (safehouse, gun shop,
// spray shop, bank, docks, marina, Vera's garage) sit at fixed road corners
// so missions can always reach them.
import {
  BEACH_X,
  COLORS,
  ROAD_SPACING,
  ROAD_WIDTH,
  SEA_X,
  SIDEWALK,
  WORLD_SIZE,
  districtAt,
  roofsFor,
} from './config.js';
import { createRng } from './rng.js';
import { circleHitsRect } from './utils.js';

export const CITY_SEED = 20261121;

// Blocks left open as parks (block column, row).
const PARKS = [[4, 4], [1, 6], [7, 2]];

function roadLines() {
  const lines = [];
  for (let i = 0; i < 10; i += 1) lines.push(260 + i * ROAD_SPACING);
  return lines;
}

function isPark(col, row) {
  return PARKS.some(([c, r]) => c === col && r === row);
}

export function generateCity(seed) {
  const rng = createRng(seed);
  const roadsX = roadLines();
  const roadsY = roadLines();
  const buildings = [];
  const trees = [];
  const halfRoad = ROAD_WIDTH / 2;

  // Buildings, one block at a time.
  for (let col = 0; col < 9; col += 1) {
    for (let row = 0; row < 9; row += 1) {
      const bx = roadsX[col] + halfRoad + SIDEWALK;
      const by = roadsY[row] + halfRoad + SIDEWALK;
      const bw = roadsX[col + 1] - halfRoad - SIDEWALK - bx;
      const bh = roadsY[row + 1] - halfRoad - SIDEWALK - by;
      const district = districtAt(bx + bw / 2, by + bh / 2);
      const roofs = roofsFor(district.palette);
      if (isPark(col, row)) {
        const count = rng.int(6, 10);
        for (let i = 0; i < count; i += 1) {
          trees.push({ x: rng.range(bx + 20, bx + bw - 20), y: rng.range(by + 20, by + bh - 20), palm: rng.chance(0.6) });
        }
        continue;
      }
      const downtown = district.palette === 'downtown';
      const count = downtown ? rng.int(1, 2) : rng.int(2, 3);
      for (let i = 0; i < count; i += 1) {
        // A few tries each: a rejected spot gets another roll instead of an empty block.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const w = rng.range(downtown ? 170 : 110, downtown ? 280 : 200);
          const h = rng.range(downtown ? 170 : 110, downtown ? 280 : 200);
          const x = rng.range(bx + 8, bx + bw - w - 8);
          const y = rng.range(by + 8, by + bh - h - 8);
          const candidate = { x, y, w, h, roof: rng.pick(roofs), wall: rng.pick(COLORS.wall), height: downtown ? rng.range(26, 60) : rng.range(10, 26) };
          let overlaps = false;
          for (const other of buildings) {
            if (candidate.x < other.x + other.w + 14 && candidate.x + candidate.w + 14 > other.x &&
                candidate.y < other.y + other.h + 14 && candidate.y + candidate.h + 14 > other.y) {
              overlaps = true;
              break;
            }
          }
          if (!overlaps) {
            buildings.push(candidate);
            break;
          }
        }
      }
      // A tree or two on most blocks.
      if (rng.chance(0.7)) {
        trees.push({ x: rng.range(bx + 16, bx + bw - 16), y: rng.range(by + 16, by + bh - 16), palm: rng.chance(0.5) });
      }
    }
  }

  // Palm row along the beach, and a few palms down Ocean Drive.
  for (let y = 120; y < WORLD_SIZE - 100; y += 130) {
    trees.push({ x: BEACH_X - 24 + rng.range(-8, 8), y: y + rng.range(-20, 20), palm: true });
  }
  for (let y = 300; y < WORLD_SIZE - 300; y += 260) {
    trees.push({ x: 4680 - 66, y, palm: true });
    trees.push({ x: 4680 + 66, y: y + 130, palm: true });
  }

  // Landmarks sit just off a road corner so cars and feet can both reach them.
  const landmarks = {
    safehouse: { x: 780, y: 700, label: 'Safehouse', color: '#7dd069' },
    gunShop: { x: 2340, y: 780, label: 'Gun Shop', color: '#e8b13c' },
    sprayShop: { x: 2860, y: 2860, label: 'Spray Shop', color: '#4fc3f7' },
    bank: { x: 1820, y: 1300, label: 'Solmar Bank', color: '#e8b13c' },
    docks: { x: 780, y: 4420, label: 'The Docks', color: '#e8b13c' },
    marina: { x: 4420, y: 780, label: 'Marina', color: '#4fc3f7' },
    garage: { x: 2860, y: 4420, label: "Vera's Garage", color: '#c58af2' },
    hospital: { x: 2340, y: 2340, label: 'Hospital', color: '#ffffff' },
    airstrip: { x: 4420, y: 4420, label: 'Airstrip', color: '#e8b13c' },
    plaza: { x: 2860, y: 1820, label: 'Plaza', color: '#e8b13c' },
  };

  function isRoad(x, y) {
    for (const rx of roadsX) if (Math.abs(x - rx) <= halfRoad) return true;
    for (const ry of roadsY) if (Math.abs(y - ry) <= halfRoad) return true;
    return false;
  }

  function buildingAt(x, y, margin) {
    const m = margin || 0;
    for (const b of buildings) {
      if (x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m) return b;
    }
    return null;
  }

  /** True when a circle of radius r at (x, y) hits a building, the sea or the map edge. */
  function blocked(x, y, r) {
    if (x < r || y < r || x > WORLD_SIZE - r || y > WORLD_SIZE - r) return true;
    if (x + r > SEA_X) return true;
    for (const b of buildings) {
      if (circleHitsRect(x, y, r, b)) return true;
    }
    return false;
  }

  function randomRoadPoint(rngInstance) {
    if (rngInstance.chance(0.5)) {
      return { x: rngInstance.pick(roadsX), y: rngInstance.range(140, WORLD_SIZE - 140) };
    }
    return { x: rngInstance.range(140, WORLD_SIZE - 140), y: rngInstance.pick(roadsY) };
  }

  function nearestRoadPoint(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const rx of roadsX) {
      const d = Math.abs(x - rx);
      if (d < bestD) { bestD = d; best = { x: rx, y }; }
    }
    for (const ry of roadsY) {
      const d = Math.abs(y - ry);
      if (d < bestD) { bestD = d; best = { x, y: ry }; }
    }
    return best;
  }

  return {
    seed,
    size: WORLD_SIZE,
    roadsX,
    roadsY,
    buildings,
    trees,
    landmarks,
    isRoad,
    buildingAt,
    blocked,
    randomRoadPoint,
    nearestRoadPoint,
  };
}
