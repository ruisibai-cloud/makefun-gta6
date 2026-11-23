// Pedestrians: the people on the sidewalks. They stroll from corner to
// corner, pause at crossings, and run when gunfire, a speeding car or a
// police chase comes near them. Run one over or shoot one and the wanted
// level notices.
import { ROAD_WIDTH, SIDEWALK, WORLD_SIZE } from './config.js';
import { clamp, dist, dist2 } from './utils.js';

const SHIRTS = ['#d95f4b', '#4b8fd9', '#e8c33c', '#7bc96f', '#b06fd9', '#e08ab0', '#5fc9c2', '#e8e4da', '#c97b3c'];
const PANTS = ['#2e3440', '#4a5568', '#6b5d4f', '#374a3a', '#5a3a4a'];

export class Pedestrians {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.list = [];
    this.spawnTimer = 0;
  }

  spawnInitial(x, y) {
    for (let i = 0; i < 34; i += 1) this.spawnNear(x, y);
  }

  spawnNear(x, y) {
    const spot = this.city.randomRoadPoint(this.rng);
    const onVertical = this.rng.chance(0.5);
    const side = this.rng.chance(0.5) ? 1 : -1;
    const off = ROAD_WIDTH / 2 + SIDEWALK / 2 + this.rng.range(-6, 6);
    const px = onVertical ? spot.x + off * side : spot.x;
    const py = onVertical ? spot.y : spot.y + off * side;
    if (px < 20 || py < 20 || px > WORLD_SIZE - 20 || py > WORLD_SIZE - 20) return;
    if (dist2(px, py, x, y) > 1500 * 1500 || dist2(px, py, x, y) < 140 * 140) return;
    if (this.city.blocked(px, py, 12)) return;
    this.list.push({
      x: px,
      y: py,
      angle: this.rng.range(0, Math.PI * 2),
      speed: this.rng.range(42, 72),
      shirt: this.rng.pick(SHIRTS),
      pants: this.rng.pick(PANTS),
      skin: this.rng.pick(['#f2c9a0', '#d9a06b', '#a06b3c', '#8a5a2e', '#f7d7b5']),
      state: 'walk', // 'walk' | 'flee' | 'down'
      tx: px,
      ty: py,
      pause: 0,
      down: 0,
      dead: false,
      panic: 0,
    });
  }

  /** Place one pedestrian at an exact spot (screenshot staging). */
  spawnAt(x, y) {
    const ped = {
      x, y,
      angle: this.rng.range(0, Math.PI * 2),
      speed: this.rng.range(42, 72),
      shirt: this.rng.pick(SHIRTS),
      pants: this.rng.pick(PANTS),
      skin: this.rng.pick(['#f2c9a0', '#d9a06b', '#a06b3c', '#8a5a2e', '#f7d7b5']),
      state: 'walk',
      tx: x, ty: y,
      pause: 0, down: 0, dead: false, panic: 0,
    };
    this.pickTarget(ped);
    this.list.push(ped);
    return ped;
  }

  /** The nearest sidewalk point in a random direction: the next stroll target. */
  pickTarget(ped) {
    const roads = this.rng.chance(0.5) ? this.city.roadsX : this.city.roadsY;
    const line = this.rng.pick(roads);
    const off = ROAD_WIDTH / 2 + SIDEWALK / 2;
    const side = this.rng.chance(0.5) ? 1 : -1;
    if (roads === this.city.roadsX) {
      ped.tx = line + off * side;
      ped.ty = clamp(ped.y + this.rng.range(-700, 700), 40, WORLD_SIZE - 40);
    } else {
      ped.tx = clamp(ped.x + this.rng.range(-700, 700), 40, WORLD_SIZE - 40);
      ped.ty = line + off * side;
    }
  }

  scare(x, y, radius) {
    for (const ped of this.list) {
      if (ped.dead) continue;
      if (dist2(ped.x, ped.y, x, y) < radius * radius) {
        ped.state = 'flee';
        ped.panic = 3 + Math.random() * 2;
        ped.tx = ped.x + (ped.x - x) * 2;
        ped.ty = ped.y + (ped.y - y) * 2;
      }
    }
  }

  update(dt, world) {
    const player = world.player;
    this.list = this.list.filter((p) => !(p.dead && p.down > 25) && dist2(p.x, p.y, player.x, player.y) < 1900 * 1900);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.8;
      const alive = this.list.filter((p) => !p.dead).length;
      if (alive < 34) this.spawnNear(player.x, player.y);
    }

    for (const ped of this.list) {
      if (ped.dead) {
        ped.down += dt;
        continue;
      }
      if (ped.state === 'flee') {
        ped.panic -= dt;
        if (ped.panic <= 0) {
          ped.state = 'walk';
          this.pickTarget(ped);
        }
      }
      if (ped.pause > 0) {
        ped.pause -= dt;
        continue;
      }
      const d = dist(ped.x, ped.y, ped.tx, ped.ty);
      if (d < 24) {
        if (ped.state === 'flee') {
          ped.state = 'walk';
          this.pickTarget(ped);
        } else {
          this.pickTarget(ped);
          if (this.rng.chance(0.25)) ped.pause = this.rng.range(0.5, 2.5);
        }
        continue;
      }
      const speed = ped.state === 'flee' ? ped.speed * 2.6 : ped.speed;
      const want = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
      ped.angle = want;
      const nx = ped.x + Math.cos(want) * speed * dt;
      const ny = ped.y + Math.sin(want) * speed * dt;
      // Peds walk around buildings rather than through them.
      if (!this.city.blocked(nx, ped.y, 10)) ped.x = nx;
      if (!this.city.blocked(ped.x, ny, 10)) ped.y = ny;

      // A fast car bearing down scares them off the road.
      if (ped.state === 'walk') {
        for (const car of world.allCars()) {
          if (car.dead || Math.abs(car.speed) < 260) continue;
          if (dist2(ped.x, ped.y, car.x, car.y) < 150 * 150) {
            ped.state = 'flee';
            ped.panic = 2;
            ped.tx = ped.x + (ped.x - car.x) * 3;
            ped.ty = ped.y + (ped.y - car.y) * 3;
            break;
          }
        }
      }

      // Run over by a car: down, and the law notices when the player did it.
      for (const car of world.allCars()) {
        if (car.dead || Math.abs(car.speed) < 60) continue;
        if (dist2(ped.x, ped.y, car.x, car.y) < 34 * 34) {
          ped.dead = true;
          ped.down = 0;
          world.onPedKilled(ped, car.driver === 'player');
          break;
        }
      }
    }
  }
}
