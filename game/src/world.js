// The world: owns the city, the player, traffic, pedestrians, police,
// combat, missions, the taxi job and the camera, and runs one fixed step of
// all of them per frame. It also holds the save game and the shop logic.
import { CITY_SEED, generateCity } from './city.js';
import { createRng } from './rng.js';
import {
  AMMO_PRICE,
  KEYS,
  PLAYER_MAX_HEALTH,
  SAVE_KEY,
  SMG_PRICE,
  SPRAY_SHOP_PRICE,
  districtAt,
} from './config.js';
import { clamp, dist } from './utils.js';
import { Player } from './player.js';
import { TrafficManager, carSpeedKmh, collideCarWithCity, collideCars, createCar } from './vehicles.js';
import { Pedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { CASH_STASHES, MissionManager, TaxiJob } from './missions.js';
import { Particles } from './particles.js';
import { AudioEngine } from './audio.js';

export class World {
  constructor() {
    this.audio = new AudioEngine();
    this.particles = new Particles();
    this.messages = [];
    this.districtBanner = null;
    this.missionFlash = null;
    this.currentDistrict = '';
    this.shopOpen = null; // 'gun' | 'spray' | null
    this.time = 0;
    this.storyComplete = false;
    this.camera = { x: 2600, y: 1300, zoom: 1.1, shake: 0 };
    this.mouseWorld = { x: 0, y: 0 };
    this.prompt = '';
    this.titleDrift = 0;
    this.reset(CITY_SEED);
    this.police.onStarsUp = (stars) => {
      this.message(`Wanted level: ${'★'.repeat(stars)}`, '#e5534b');
    };
  }

  reset(seed) {
    this.rng = createRng(seed);
    this.city = generateCity(seed);
    const home = this.city.landmarks.safehouse;
    this.player = new Player(home.x, home.y + 60);
    this.traffic = new TrafficManager(this.city, this.rng);
    this.peds = new Pedestrians(this.city, this.rng);
    this.police = new Police(this.city, this.rng);
    this.combat = new Combat(this.city, this.rng);
    this.missions = new MissionManager(this);
    this.taxi = new TaxiJob(this);
    this.looseCars = [];
    this.traffic.spawnInitial(home.x, home.y);
    this.peds.spawnInitial(home.x, home.y);
    for (const stash of CASH_STASHES) this.combat.spawnPickup(stash.x, stash.y, 'cash', stash.amount);
    // Health and armour pickups near the hospital and the safehouse.
    this.combat.spawnPickup(2340, 2260, 'health', 50);
    this.combat.spawnPickup(780, 620, 'armor', 50);
    this.combat.spawnPickup(4420, 700, 'health', 50);
    this.particles.clear();
    this.messages.length = 0;
    this.time = 0;
    this.storyComplete = false;
    this.shopOpen = null;
    this.missionFlash = null;
    this.currentDistrict = districtAt(home.x, home.y).name;
    this.districtBanner = { name: this.currentDistrict, timer: 2.5 };
    this.camera.x = home.x;
    this.camera.y = home.y + 60;
    this.camera.zoom = 1.12;
    this.camera.shake = 0;
    this.police.onStarsUp = (stars) => {
      this.message(`Wanted level: ${'★'.repeat(stars)}`, '#e5534b');
    };
    // A starter car parked outside the safehouse.
    const starter = createCar(home.x + 70, home.y + 40, 0, 'sedan', '#5aa87b');
    starter.driver = 'none';
    this.looseCars.push(starter);
  }

  allCars() {
    const cars = this.traffic.cars.concat(this.traffic.parked, this.police.copCars, this.looseCars);
    if (this.player.inCar && this.player.car) cars.push(this.player.car);
    if (this.missions.rivalCar && !this.missions.rivalCar.dead) {
      if (!cars.includes(this.missions.rivalCar)) cars.push(this.missions.rivalCar);
    }
    return cars;
  }

  message(text, color) {
    this.messages.push({ text, color: color || '#ffffff', timer: 5 });
    if (this.messages.length > 5) this.messages.shift();
  }

  onPedKilled(ped, byPlayer) {
    if (byPlayer) {
      this.police.addHeat(70, 'pedestrian killed');
      this.message('You killed a pedestrian — the law noticed', '#e5534b');
    }
    this.peds.scare(ped.x, ped.y, 380);
  }

  destroyCar(car, cause) {
    if (car.dead) return;
    car.dead = true;
    car.siren = false;
    const wasPlayerCar = this.player.inCar && this.player.car === car;
    if (wasPlayerCar) {
      this.player.inCar = false;
      this.player.car = null;
      this.player.x = car.x + 40;
      this.player.y = car.y;
      this.player.takeDamage(25);
      this.message('Your car blew up!', '#e5534b');
    }
    this.combat.explode(car.x, car.y, this);
    void cause;
  }

  /** One fixed step of live play. */
  step(dt, input) {
    this.time += dt;
    const player = this.player;

    if (player.wasted || player.busted) {
      if (this.missions.active) this.missions.failMission(player.busted ? 'busted' : 'wasted');
      this.updateCamera(dt);
      this.particles.update(dt);
      return;
    }

    // Shops: E opens them, Esc closes them.
    if (this.shopOpen) {
      if (input.pressed(KEYS.pause) || input.pressed(KEYS.enterCar)) this.shopOpen = null;
      this.updateCamera(dt);
      return;
    }
    this.updatePromptAndShops(input);

    player.update(dt, input, this);
    if (player.inCar && player.car) collideCarWithCity(player.car, this.city);
    this.traffic.update(dt, this);
    this.peds.update(dt, this);
    this.police.update(dt, this);
    this.combat.update(dt, this);
    if (!this.missions.briefing) this.missions.update(dt);
    this.taxi.update(dt);

    // Car-on-car crashes, then smoke and fire for the battered ones.
    collideCars(this.allCars(), (x, y, rel) => {
      this.particles.sparks(x, y, Math.min(8, Math.floor(rel / 60)));
      if (rel > 320) this.audio.noise(0.15, 700, 0.2);
    });
    this.looseCars = this.looseCars.filter((c) => !c.dead);
    for (const car of this.allCars()) {
      if (car.dead) continue;
      if (car.health < 55 && Math.random() < dt * 6) {
        const fx = car.x + Math.cos(car.angle) * car.len * 0.3;
        const fy = car.y + Math.sin(car.angle) * car.len * 0.3;
        this.particles.smoke(fx, fy, car.health < 25);
      }
      if (car.health < 25) {
        car.health -= 3 * dt;
        if (Math.random() < dt * 8) this.particles.sparks(car.x, car.y, 2);
        if (car.health <= 0) this.destroyCar(car, 'fire');
      }
    }

    // District banners, message timers, the mission flash.
    const district = districtAt(player.x, player.y).name;
    if (district !== this.currentDistrict) {
      this.currentDistrict = district;
      this.districtBanner = { name: district, timer: 2.6 };
    }
    if (this.districtBanner) {
      this.districtBanner.timer -= dt;
      if (this.districtBanner.timer <= 0) this.districtBanner = null;
    }
    if (this.missionFlash) {
      this.missionFlash.timer -= dt;
      if (this.missionFlash.timer <= 0) this.missionFlash = null;
    }
    for (const m of this.messages) m.timer -= dt;
    this.messages = this.messages.filter((m) => m.timer > 0);

    this.particles.update(dt);
    this.updateCamera(dt);
    this.audio.setEngine(player.inCar && player.car ? clamp(Math.abs(player.car.speed) / 800, 0, 1) : 0, player.inCar);
    this.audio.update(dt, true);
  }

  /** The title screen's backdrop: traffic and pedestrians live, camera drifts. */
  stepTitle(dt) {
    this.time += dt;
    this.titleDrift += dt * 0.03;
    const cx = 2600 + Math.cos(this.titleDrift) * 900;
    const cy = 1300 + Math.sin(this.titleDrift * 0.7) * 700;
    this.camera.x += (cx - this.camera.x) * Math.min(1, dt * 0.6);
    this.camera.y += (cy - this.camera.y) * Math.min(1, dt * 0.6);
    this.camera.zoom += (0.9 - this.camera.zoom) * Math.min(1, dt);
    this.traffic.update(dt, this);
    this.peds.update(dt, this);
    this.particles.update(dt);
    collideCars(this.allCars(), null);
    this.audio.update(dt, false);
  }

  updateCamera(dt) {
    const player = this.player;
    const speed01 = player.inCar && player.car ? clamp(Math.abs(player.car.speed) / 800, 0, 1) : 0;
    // Look ahead in the direction of travel; more of it at speed.
    const look = player.inCar ? 50 + speed01 * 70 : 30;
    const tx = player.x + Math.cos(player.angle) * look;
    const ty = player.y + Math.sin(player.angle) * look;
    const stiffness = player.inCar ? 4.5 : 6;
    this.camera.x += (tx - this.camera.x) * Math.min(1, stiffness * dt);
    this.camera.y += (ty - this.camera.y) * Math.min(1, stiffness * dt);
    const targetZoom = player.inCar ? 1.08 - speed01 * 0.22 : 1.12;
    this.camera.zoom += (targetZoom - this.camera.zoom) * Math.min(1, 2.5 * dt);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 30);
  }

  updatePromptAndShops(input) {
    const player = this.player;
    this.prompt = '';
    const gun = this.city.landmarks.gunShop;
    const spray = this.city.landmarks.sprayShop;
    if (!player.inCar && dist(player.x, player.y, gun.x, gun.y) < 80) {
      this.prompt = 'E — Gun Shop';
      if (input.pressed(KEYS.interact)) {
        this.shopOpen = 'gun';
        this.audio.click();
      }
      return;
    }
    if (player.inCar && dist(player.x, player.y, spray.x, spray.y) < 90) {
      this.prompt = `E — Spray Shop: respray & repair ${'$' + SPRAY_SHOP_PRICE}`;
      if (input.pressed(KEYS.interact)) {
        this.shopOpen = 'spray';
        this.audio.click();
      }
      return;
    }
    if (!player.inCar) {
      const car = player.carInReach(this);
      if (car) this.prompt = car.driver === 'none' ? 'E — Get in the car' : 'E — Steal the car (wanted +)';
    } else if (Math.abs(player.car.speed) < 60) {
      this.prompt = 'E — Get out of the car';
    }
  }

  buyShopItem(id) {
    const player = this.player;
    if (this.shopOpen === 'gun') {
      if (id === 'smg') {
        if (player.hasSmg) return;
        if (!player.spend(SMG_PRICE)) {
          this.message('Not enough cash for the SMG', '#e5534b');
          return;
        }
        player.hasSmg = true;
        player.ammo.smg += 120;
        player.weapon = 'smg';
        this.message('Bought the SMG — 120 rounds included', '#7dd069');
      } else if (id === 'ammo') {
        if (!player.hasSmg) {
          this.message('Buy the SMG first', '#e8b13c');
          return;
        }
        if (!player.spend(AMMO_PRICE)) {
          this.message('Not enough cash for ammo', '#e5534b');
          return;
        }
        player.ammo.smg += 120;
        this.message('SMG ammo +120', '#7dd069');
      } else if (id === 'armor') {
        if (!player.spend(100)) {
          this.message('Not enough cash for armour', '#e5534b');
          return;
        }
        player.addArmor(50);
        this.message('Armour +50', '#7dd069');
      }
    } else if (this.shopOpen === 'spray' && id === 'respray') {
      if (!player.spend(SPRAY_SHOP_PRICE)) {
        this.message('Not enough cash for a respray', '#e5534b');
        return;
      }
      this.police.clearWanted();
      if (player.car) player.car.health = player.car.maxHealth;
      this.message('Fresh paint, clean plates — the heat is gone', '#7dd069');
      this.shopOpen = null;
    }
    this.audio.pickup();
  }

  respawnAfterIncident() {
    const player = this.player;
    player.money = Math.max(0, player.money - 200);
    player.health = PLAYER_MAX_HEALTH;
    player.armor = 0;
    player.wasted = false;
    player.busted = false;
    player.bustedTimer = 0;
    if (player.inCar && player.car) {
      player.car.driver = 'none';
      this.looseCars.push(player.car);
      player.inCar = false;
      player.car = null;
    }
    this.police.clearWanted();
    this.police.copCars = [];
    this.police.footCops = [];
    const spot = this.city.landmarks.hospital;
    player.x = spot.x;
    player.y = spot.y;
    this.camera.x = player.x;
    this.camera.y = player.y;
    this.message('Back on the street — $200 poorer', '#e8b13c');
  }

  saveGame() {
    try {
      const data = {
        money: this.player.money,
        health: this.player.health,
        armor: this.player.armor,
        hasSmg: this.player.hasSmg,
        ammoSmg: this.player.ammo.smg,
        x: this.player.x,
        y: this.player.y,
        time: this.time,
        missions: this.missions.serialize(),
        storyComplete: this.storyComplete,
      };
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be off: the game still plays, it just does not persist.
    }
  }

  static readSave() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  restoreSave(data) {
    if (!data) return;
    this.player.money = data.money ?? 150;
    this.player.health = data.health ?? PLAYER_MAX_HEALTH;
    this.player.armor = data.armor ?? 0;
    this.player.hasSmg = !!data.hasSmg;
    this.player.ammo.smg = data.ammoSmg ?? 0;
    if (typeof data.x === 'number' && typeof data.y === 'number' && !this.city.blocked(data.x, data.y, 16)) {
      this.player.x = data.x;
      this.player.y = data.y;
    }
    this.time = data.time ?? 0;
    this.missions.restore(data.missions);
    this.storyComplete = !!data.storyComplete;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.currentDistrict = districtAt(this.player.x, this.player.y).name;
  }
}
