// The law: a heat meter that crimes feed and hiding drains, stars that set
// how hard the Solmar Bay police come after the player, pursuit cars that ram
// and foot officers who chase, shoot and — given a slow enough moment — bust.
import {
  WANTED_DECAY_PER_SECOND,
  WANTED_HEAT_MAX,
  WANTED_SIGHT_RANGE,
  WANTED_STAR_HEAT,
} from './config.js';
import { angleDiff, clamp, dist, dist2 } from './utils.js';
import { collideCarWithCity, createCar, stepCarPhysics } from './vehicles.js';

function starsForHeat(heat) {
  let stars = 0;
  for (let i = 1; i < WANTED_STAR_HEAT.length; i += 1) {
    if (heat >= WANTED_STAR_HEAT[i]) stars = i;
  }
  return stars;
}

export class Police {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.heat = 0;
    this.stars = 0;
    this.copCars = [];
    this.footCops = [];
    this.spawnTimer = 0;
    this.flashTimer = 0;
  }

  get wanted() {
    return this.stars;
  }

  addHeat(amount, reason) {
    const before = this.stars;
    this.heat = clamp(this.heat + amount, 0, WANTED_HEAT_MAX);
    this.stars = starsForHeat(this.heat);
    if (this.stars > before && this.onStarsUp) this.onStarsUp(this.stars, reason);
  }

  clearWanted() {
    this.heat = 0;
    this.stars = 0;
  }

  canSeePlayer(world) {
    const p = world.player;
    for (const car of this.copCars) {
      if (!car.dead && dist2(car.x, car.y, p.x, p.y) < WANTED_SIGHT_RANGE * WANTED_SIGHT_RANGE) return true;
    }
    for (const cop of this.footCops) {
      if (dist2(cop.x, cop.y, p.x, p.y) < WANTED_SIGHT_RANGE * WANTED_SIGHT_RANGE) return true;
    }
    return false;
  }

  spawnCopCarNear(world) {
    const p = world.player;
    const angle = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(750, 950);
    const spot = this.city.nearestRoadPoint(p.x + Math.cos(angle) * d, p.y + Math.sin(angle) * d);
    const car = createCar(spot.x, spot.y, Math.atan2(p.y - spot.y, p.x - spot.x), 'police', '#f2f2f2');
    car.driver = 'police';
    car.siren = true;
    this.copCars.push(car);
    return car;
  }

  spawnFootCopNear(world) {
    const p = world.player;
    const angle = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(420, 560);
    let x = p.x + Math.cos(angle) * d;
    let y = p.y + Math.sin(angle) * d;
    if (this.city.blocked(x, y, 14)) {
      const spot = this.city.nearestRoadPoint(x, y);
      x = spot.x;
      y = spot.y;
    }
    this.footCops.push({
      x, y, angle: 0,
      speed: 265,
      fireTimer: this.rng.range(0.3, 1),
      accuracy: 0.16,
    });
  }

  update(dt, world) {
    const player = world.player;
    this.flashTimer += dt;

    // Heat drains only while no officer can see the player.
    if (this.heat > 0 && !this.canSeePlayer(world)) {
      this.heat = Math.max(0, this.heat - WANTED_DECAY_PER_SECOND * dt);
      this.stars = starsForHeat(this.heat);
    }

    // The force scales with the stars.
    const wantCars = this.stars === 0 ? 0 : Math.min(5, this.stars + (this.stars >= 3 ? 1 : 0));
    const wantCops = this.stars >= 2 ? Math.min(4, this.stars) : 0;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.9;
      this.copCars = this.copCars.filter((c) => !c.dead);
      if (this.stars > 0 && this.copCars.length < wantCars) this.spawnCopCarNear(world);
      if (this.stars > 0 && this.footCops.length < wantCops) this.spawnFootCopNear(world);
    }
    // When the heat is gone, the police drift away.
    if (this.stars === 0) {
      this.copCars = this.copCars.filter((c) => dist2(c.x, c.y, player.x, player.y) < 900 * 900);
      this.footCops = this.footCops.filter((c) => dist2(c.x, c.y, player.x, player.y) < 700 * 700);
      if (this.copCars.length === 0 && this.footCops.length === 0) return;
    }

    // Pursuit cars: full throttle at the player, braking into sharp turns.
    for (const car of this.copCars) {
      if (car.dead) continue;
      car.sirenPhase += dt;
      const want = Math.atan2(player.y - car.y, player.x - car.x);
      const turn = angleDiff(car.angle, want);
      const steer = clamp(turn * 2.2, -1, 1);
      const sharp = Math.abs(turn) > 0.9 && Math.abs(car.speed) > 320;
      stepCarPhysics(car, { throttle: 1, steer, handbrake: sharp }, dt);
      collideCarWithCity(car, this.city);
      if (car.health <= 0) world.destroyCar(car, 'police');
    }

    // Foot officers: run the player down, shoot from mid-range at 2+ stars.
    for (const cop of this.footCops) {
      const d = dist(cop.x, cop.y, player.x, player.y);
      cop.angle = Math.atan2(player.y - cop.y, player.x - cop.x);
      if (d > 60) {
        const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
        const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
        if (!this.city.blocked(nx, cop.y, 12)) cop.x = nx;
        if (!this.city.blocked(cop.x, ny, 12)) cop.y = ny;
      }
      cop.fireTimer -= dt;
      if (this.stars >= 2 && d < 420 && d > 50 && cop.fireTimer <= 0 && player.alive) {
        cop.fireTimer = this.rng.range(0.7, 1.4);
        const spread = (Math.random() - 0.5) * cop.accuracy * 2;
        world.combat.shoot(cop.x, cop.y, cop.angle + spread, { damage: 8, bulletSpeed: 1000, range: 500 }, 'police');
        world.audio.gunshot(true);
      }
      // Caught on foot, slow and close: the bust timer runs.
      if (!player.inCar && d < 46 && player.alive) {
        player.bustedTimer += dt;
        if (player.bustedTimer > 1.1) player.busted = true;
      } else if (d > 120) {
        player.bustedTimer = Math.max(0, player.bustedTimer - dt * 2);
      }
    }

    world.audio.setSiren(this.copCars.length > 0 && this.stars > 0);
  }
}
