// Jax Marlowe, the player: on foot with a pistol or an SMG, or behind the
// wheel of whatever car they just took. On foot the mouse aims; in a car the
// keys drive. E gets in and out of the nearest car.
import {
  KEYS,
  PLAYER_MAX_ARMOR,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  PLAYER_RUN_SPEED,
  PLAYER_WALK_SPEED,
  START_MONEY,
} from './config.js';
import { clamp, dist2 } from './utils.js';
import { nearestCar, stepCarPhysics } from './vehicles.js';

export const WEAPONS = {
  pistol: { name: 'Pistol', damage: 34, rate: 0.28, spread: 0.03, bulletSpeed: 1100, range: 620, ammo: Infinity },
  smg: { name: 'SMG', damage: 22, rate: 0.09, spread: 0.09, bulletSpeed: 1200, range: 560, ammo: 0 },
};

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.angle = -Math.PI / 2; // facing north, toward the street
    this.health = PLAYER_MAX_HEALTH;
    this.armor = 0;
    this.money = START_MONEY;
    this.inCar = false;
    this.car = null;
    this.weapon = 'pistol';
    this.ammo = { pistol: Infinity, smg: 0 };
    this.hasSmg = false;
    this.fireTimer = 0;
    this.moving = false;
    this.sprinting = false;
    this.wasted = false;
    this.busted = false;
    this.bustedTimer = 0;
    this.walkCycle = 0;
  }

  get alive() {
    return this.health > 0 && !this.wasted && !this.busted;
  }

  get weaponSpec() {
    return WEAPONS[this.weapon];
  }

  takeDamage(amount) {
    if (!this.alive) return;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, rest * 0.6);
      this.armor -= absorbed;
      rest -= absorbed;
    }
    this.health = Math.max(0, this.health - rest);
    if (this.health <= 0) this.wasted = true;
  }

  heal(amount) {
    this.health = Math.min(PLAYER_MAX_HEALTH, this.health + amount);
  }

  addArmor(amount) {
    this.armor = Math.min(PLAYER_MAX_ARMOR, this.armor + amount);
  }

  earn(amount) {
    this.money += amount;
  }

  spend(amount) {
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  }

  /** Step on foot or behind the wheel, from the frame's input. */
  update(dt, input, world) {
    if (!this.alive) return;
    this.fireTimer -= dt;

    if (input.pressed(KEYS.weapon1)) this.weapon = 'pistol';
    if (input.pressed(KEYS.weapon2) && this.hasSmg) this.weapon = 'smg';

    if (this.inCar && this.car) {
      this.updateDriving(dt, input, world);
      return;
    }

    // On foot: WASD moves, Shift sprints, the mouse aims.
    const mx = (input.isDown(KEYS.right) ? 1 : 0) - (input.isDown(KEYS.left) ? 1 : 0);
    const my = (input.isDown(KEYS.down) ? 1 : 0) - (input.isDown(KEYS.up) ? 1 : 0);
    this.sprinting = input.isDown(KEYS.sprint) || input.isDown(KEYS.sprintRight);
    const speed = this.sprinting ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
    this.moving = mx !== 0 || my !== 0;
    if (this.moving) {
      const len = Math.hypot(mx, my);
      const nx = this.x + (mx / len) * speed * dt;
      const ny = this.y + (my / len) * speed * dt;
      if (!world.city.blocked(nx, this.y, PLAYER_RADIUS)) this.x = nx;
      if (!world.city.blocked(this.x, ny, PLAYER_RADIUS)) this.y = ny;
      this.walkCycle += dt * (this.sprinting ? 13 : 9);
    }

    // Aim at the mouse; click or hold to fire.
    const aim = world.mouseWorld;
    if (aim) this.angle = Math.atan2(aim.y - this.y, aim.x - this.x);
    if (input.mouseDown && this.fireTimer <= 0) this.tryFire(world);

    // E: get into the nearest car.
    if (input.pressed(KEYS.enterCar)) {
      const car = nearestCar(world.allCars(), this.x, this.y, 70);
      if (car && car.driver !== 'player') this.enterCar(car, world);
    }
  }

  tryFire(world) {
    const spec = this.weaponSpec;
    if (this.weapon === 'smg' && this.ammo.smg <= 0) {
      this.weapon = 'pistol';
      world.message('SMG out of ammo — back to the pistol', '#e8b13c');
      return;
    }
    this.fireTimer = spec.rate;
    if (this.weapon === 'smg') this.ammo.smg -= 1;
    const gx = this.x + Math.cos(this.angle) * 22;
    const gy = this.y + Math.sin(this.angle) * 22;
    world.combat.shoot(gx, gy, this.angle + (Math.random() - 0.5) * spec.spread * 2, spec, 'player');
    world.audio.gunshot(false);
    world.police.addHeat(6, 'gunfire');
    world.peds.scare(this.x, this.y, 420);
  }

  enterCar(car, world) {
    // Taking a car its driver still owns is a crime the law notices.
    const stolen = car.driver === 'traffic' || car.driver === 'police';
    if (car.driver === 'traffic') {
      world.traffic.cars = world.traffic.cars.filter((c) => c !== car);
      world.message('Car jacked!', '#e8b13c');
    } else if (car.driver === 'police') {
      world.police.copCars = world.police.copCars.filter((c) => c !== car);
      world.message('Stole a police car!', '#e8b13c');
    } else {
      world.traffic.parked = world.traffic.parked.filter((c) => c !== car);
      world.looseCars = world.looseCars.filter((c) => c !== car);
    }
    car.driver = 'player';
    this.inCar = true;
    this.car = car;
    this.x = car.x;
    this.y = car.y;
    if (stolen) world.police.addHeat(45, 'car theft');
    world.audio.carDoor();
  }

  exitCar(world) {
    if (!this.car) return;
    const car = this.car;
    car.driver = 'none';
    car.vx *= 0.2;
    car.vy *= 0.2;
    car.speed *= 0.2;
    // Step out on the driver's side, clear of the body.
    const side = car.angle + Math.PI / 2;
    const px = car.x + Math.cos(side) * 34;
    const py = car.y + Math.sin(side) * 34;
    this.x = world.city.blocked(px, py, PLAYER_RADIUS) ? car.x - Math.cos(side) * 34 : px;
    this.y = world.city.blocked(px, py, PLAYER_RADIUS) ? car.y - Math.sin(side) * 34 : py;
    this.angle = car.angle;
    this.inCar = false;
    this.car = null;
    world.looseCars.push(car);
    world.audio.carDoor();
  }

  updateDriving(dt, input, world) {
    const car = this.car;
    const throttle = (input.isDown(KEYS.up) ? 1 : 0) - (input.isDown(KEYS.down) ? 1 : 0);
    const steer = (input.isDown(KEYS.right) ? 1 : 0) - (input.isDown(KEYS.left) ? 1 : 0);
    const handbrake = input.isDown(KEYS.handbrake);
    stepCarPhysics(car, { throttle, steer, handbrake }, dt);
    this.x = car.x;
    this.y = car.y;
    this.angle = car.angle;
    if (car.sliding) world.particles.addSkid(car.x, car.y, car.angle);
    if (input.pressed(KEYS.horn)) world.audio.horn();
    if (input.pressed(KEYS.enterCar) && Math.abs(car.speed) < 60) this.exitCar(world);
    if (car.health <= 0 && !car.dead) world.destroyCar(car, 'player car');
  }

  /** The nearest car the player could take right now, for the prompt. */
  carInReach(world) {
    if (this.inCar) return null;
    return nearestCar(world.allCars(), this.x, this.y, 70);
  }

  distanceTo(x, y) {
    return Math.sqrt(dist2(this.x, this.y, x, y));
  }
}
