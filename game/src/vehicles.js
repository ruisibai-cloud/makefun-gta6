// Cars: the models, arcade driving physics (forward drive plus a lateral
// slide the handbrake loosens), the traffic that fills the roads, parked cars
// to steal, and car-to-car and car-to-building collisions.
import { ROAD_WIDTH, WORLD_SIZE } from './config.js';
import { clamp, dist2 } from './utils.js';

export const CAR_MODELS = {
  sedan: { len: 66, wid: 32, accel: 430, top: 570, grip: 8.5 },
  coupe: { len: 62, wid: 30, accel: 540, top: 660, grip: 9 },
  sports: { len: 64, wid: 31, accel: 720, top: 800, grip: 9.5 },
  taxi: { len: 66, wid: 32, accel: 430, top: 570, grip: 8.5 },
  van: { len: 74, wid: 34, accel: 330, top: 470, grip: 7.5 },
  truck: { len: 88, wid: 36, accel: 290, top: 430, grip: 7 },
  police: { len: 66, wid: 32, accel: 640, top: 730, grip: 9.5 },
};

export const CAR_COLORS = [
  '#c94f43', '#4f7ec9', '#d8d3c8', '#3a3f46', '#7fae5a', '#c9a13c',
  '#8a5fc9', '#d97ba6', '#5aa8a0', '#e07830', '#9fb2bd', '#6b7f59',
];

export function createCar(x, y, angle, model, color) {
  const spec = CAR_MODELS[model] || CAR_MODELS.sedan;
  return {
    x, y, angle,
    vx: 0, vy: 0,
    speed: 0, // signed speed along the heading
    model,
    len: spec.len,
    wid: spec.wid,
    accel: spec.accel,
    top: spec.top,
    grip: spec.grip,
    color: color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    driver: 'none', // 'player' | 'traffic' | 'police' | 'none'
    health: 100,
    maxHealth: 100,
    smoking: false,
    burning: false,
    siren: false,
    sirenPhase: 0,
    brake: false,
    horn: 0,
    dead: false,
  };
}

export function carSpeedKmh(car) {
  return Math.abs(car.speed) * 0.22;
}

/** The two circles a car collides as: front and rear, along its heading. */
export function carCircles(car) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const off = car.len * 0.27;
  const r = car.wid * 0.62;
  return [
    { x: car.x + fx * off, y: car.y + fy * off, r },
    { x: car.x - fx * off, y: car.y - fy * off, r },
  ];
}

/**
 * One physics step. `drive` is { throttle (-1..1), steer (-1..1), handbrake }.
 * Velocity splits into a forward part the engine drives and a lateral part
 * the tyres scrub away; the handbrake loosens the grip so the car slides.
 */
export function stepCarPhysics(car, drive, dt) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const px = -fy;
  const py = fx;
  let forward = car.vx * fx + car.vy * fy;
  let lateral = car.vx * px + car.vy * py;

  forward += drive.throttle * car.accel * dt;
  forward -= forward * 0.35 * dt; // rolling drag
  if (drive.handbrake) forward -= forward * 2.2 * dt;
  const top = drive.throttle < 0 ? car.top * 0.45 : car.top;
  forward = clamp(forward, -car.top * 0.45, top);

  const grip = drive.handbrake ? 2.2 : car.grip;
  lateral -= lateral * Math.min(1, grip * dt);

  const steerAuthority = clamp(Math.abs(forward) / 90, 0, 1) * (forward < 0 ? -1 : 1);
  car.angle += drive.steer * 2.6 * steerAuthority * dt * (1 - Math.min(0.45, Math.abs(forward) / car.top * 0.45));

  const nfx = Math.cos(car.angle);
  const nfy = Math.sin(car.angle);
  const npx = -nfy;
  const npy = nfx;
  car.vx = nfx * forward + npx * lateral;
  car.vy = nfy * forward + npy * lateral;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.speed = forward;
  car.brake = drive.throttle < 0 || drive.handbrake;

  // Skid smoke while the back end steps out.
  car.sliding = Math.abs(lateral) > 130;
}

/** Push cars out of buildings and the sea; returns true when it hit something hard. */
export function collideCarWithCity(car, city) {
  let hard = false;
  for (const c of carCircles(car)) {
    if (!city.blocked(c.x, c.y, c.r)) continue;
    // Back the car out along its velocity and kill most of its speed.
    car.x -= car.vx * 0.03;
    car.y -= car.vy * 0.03;
    const impact = Math.hypot(car.vx, car.vy);
    car.vx *= -0.25;
    car.vy *= -0.25;
    car.speed *= -0.25;
    if (impact > 220) {
      car.health -= (impact - 220) * 0.03;
      hard = true;
    }
  }
  car.x = clamp(car.x, 20, WORLD_SIZE - 20);
  car.y = clamp(car.y, 20, WORLD_SIZE - 20);
  return hard;
}

/** Pairwise car collisions: push apart, trade speed, damage by impact. */
export function collideCars(cars, onCrash) {
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    if (a.dead) continue;
    const ac = carCircles(a);
    for (let j = i + 1; j < cars.length; j += 1) {
      const b = cars[j];
      if (b.dead) continue;
      const bc = carCircles(b);
      for (const ca of ac) {
        for (const cb of bc) {
          const dx = cb.x - ca.x;
          const dy = cb.y - ca.y;
          const rr = ca.r + cb.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const push = (rr - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          const rel = Math.abs((b.vx - a.vx) * nx + (b.vy - a.vy) * ny);
          const swap = rel * 0.5;
          a.vx -= nx * swap * 0.4;
          a.vy -= ny * swap * 0.4;
          b.vx += nx * swap * 0.4;
          b.vy += ny * swap * 0.4;
          if (rel > 120) {
            a.health -= (rel - 120) * 0.02;
            b.health -= (rel - 120) * 0.02;
            if (onCrash) onCrash((ca.x + cb.x) / 2, (ca.y + cb.y) / 2, rel);
          }
        }
      }
    }
  }
}

export function nearestCar(cars, x, y, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const car of cars) {
    if (car.dead) continue;
    const d = dist2(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

const TRAFFIC_MODELS = ['sedan', 'sedan', 'coupe', 'van', 'taxi', 'truck', 'sports'];
const LANE = 24; // right-hand lane offset from the road centre

/**
 * Traffic: cars that drive the road grid, turn at intersections, slow for the
 * car ahead, and respawn around the player so the streets always feel busy.
 */
export class TrafficManager {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.cars = [];
    this.parked = [];
    this.spawnTimer = 0;
  }

  spawnInitial(x, y) {
    for (let i = 0; i < 14; i += 1) this.spawnTrafficNear(x, y);
    for (let i = 0; i < 10; i += 1) this.spawnParkedNear(x, y);
  }

  makeTrafficCar(x, y) {
    const model = this.rng.pick(TRAFFIC_MODELS);
    const vertical = this.rng.chance(0.5);
    const road = vertical ? this.rng.pick(this.city.roadsX) : this.rng.pick(this.city.roadsY);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const along = this.rng.range(140, WORLD_SIZE - 140);
    const car = createCar(0, 0, 0, model, model === 'taxi' ? '#f2c230' : this.rng.pick(CAR_COLORS));
    car.driver = 'traffic';
    car.axis = vertical ? 'v' : 'h';
    car.road = road;
    car.dir = dir;
    car.along = along;
    car.targetSpeed = this.rng.range(200, 320);
    car.wait = 0;
    this.placeOnRoad(car);
    return car;
  }

  placeOnRoad(car) {
    if (car.axis === 'v') {
      car.x = car.road + (car.dir > 0 ? LANE : -LANE);
      car.y = car.along;
      car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.x = car.along;
      car.y = car.road + (car.dir > 0 ? LANE : -LANE);
      car.angle = car.dir > 0 ? 0 : Math.PI;
    }
  }

  spawnTrafficNear(x, y) {
    const car = this.makeTrafficCar(x, y);
    // Keep new traffic near the player but not on top of them.
    let tries = 0;
    while (dist2(car.x, car.y, x, y) > 1500 * 1500 && tries < 8) {
      tries += 1;
      car.along = this.rng.range(Math.max(140, (car.axis === 'v' ? y : x) - 1200), Math.min(WORLD_SIZE - 140, (car.axis === 'v' ? y : x) + 1200));
      this.placeOnRoad(car);
    }
    if (dist2(car.x, car.y, x, y) < 200 * 200) return;
    this.cars.push(car);
  }

  spawnParkedNear(x, y) {
    const spot = this.city.randomRoadPoint(this.rng);
    const vertical = this.rng.chance(0.5);
    const angle = vertical ? Math.PI / 2 : 0;
    const offset = ROAD_WIDTH / 2 - 16;
    const px = vertical ? spot.x + offset : spot.x;
    const py = vertical ? spot.y : spot.y + offset;
    if (dist2(px, py, x, y) > 1400 * 1400 || dist2(px, py, x, y) < 120 * 120) return;
    if (this.city.blocked(px, py, 30)) return;
    const car = createCar(px, py, angle, this.rng.pick(TRAFFIC_MODELS), this.rng.pick(CAR_COLORS));
    car.driver = 'none';
    this.parked.push(car);
  }

  update(dt, world) {
    const player = world.player;
    const px = player.x;
    const py = player.y;

    // Despawn far traffic, keep the streets populated near the player.
    this.cars = this.cars.filter((c) => !c.dead && dist2(c.x, c.y, px, py) < 1900 * 1900);
    this.parked = this.parked.filter((c) => !c.dead && dist2(c.x, c.y, px, py) < 1900 * 1900);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.2;
      if (this.cars.length < 14) this.spawnTrafficNear(px, py);
      if (this.parked.length < 10) this.spawnParkedNear(px, py);
    }

    const all = world.allCars();
    for (const car of this.cars) {
      if (car.wait > 0) {
        car.wait -= dt;
        stepCarPhysics(car, { throttle: 0, steer: 0, handbrake: true }, dt);
        continue;
      }
      // Slow for anything ahead on the same road.
      let blockedAhead = false;
      const look = 110;
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      for (const other of all) {
        if (other === car || other.dead) continue;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const ahead = dx * fx + dy * fy;
        const side = Math.abs(dx * -fy + dy * fx);
        if (ahead > 0 && ahead < look && side < 34) {
          blockedAhead = true;
          break;
        }
      }
      // And for pedestrians crossing right in front.
      if (!blockedAhead) {
        for (const ped of world.peds.list) {
          if (ped.dead) continue;
          const dx = ped.x - car.x;
          const dy = ped.y - car.y;
          const ahead = dx * fx + dy * fy;
          const side = Math.abs(dx * -fy + dy * fx);
          if (ahead > 0 && ahead < 90 && side < 30) {
            blockedAhead = true;
            break;
          }
        }
      }
      const speed = Math.abs(car.speed);
      const throttle = blockedAhead ? (speed > 20 ? -0.6 : 0) : (speed < car.targetSpeed ? 0.7 : 0);
      stepCarPhysics(car, { throttle, steer: 0, handbrake: false }, dt);
      // Re-anchor to the lane: traffic follows the grid, physics only moves it along.
      if (car.axis === 'v') {
        car.along = car.y;
        car.x += (car.road + (car.dir > 0 ? LANE : -LANE) - car.x) * Math.min(1, 4 * dt);
        car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.along = car.x;
        car.y += (car.road + (car.dir > 0 ? LANE : -LANE) - car.y) * Math.min(1, 4 * dt);
        car.angle = car.dir > 0 ? 0 : Math.PI;
      }
      // At an intersection, sometimes turn onto the crossing road.
      const cross = car.axis === 'v' ? this.city.roadsY : this.city.roadsX;
      for (const line of cross) {
        if (Math.abs(car.along - line) < 30 && this.rng.chance(0.012)) {
          car.axis = car.axis === 'v' ? 'h' : 'v';
          car.road = line;
          car.dir = this.rng.chance(0.5) ? 1 : -1;
          car.along = car.axis === 'v' ? car.y : car.x;
          this.placeOnRoad(car);
          break;
        }
      }
      // Turn around at the map edge instead of driving into the sea.
      if (car.along < 150 || car.along > WORLD_SIZE - 150) {
        car.dir *= -1;
        this.placeOnRoad(car);
      }
      if (car.health <= 0 && !car.dead) world.destroyCar(car, 'crash');
    }
  }
}
