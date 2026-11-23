// Missions and side work. Vera Solano, a fixer out of a Southside garage,
// runs Jax through five jobs — a stolen car, a dock pickup, a rival courier,
// a bank job and a last run to the airstrip — and any taxi can earn fares on
// the side. Cash stashes hide around the city for whoever looks.
import { dist } from './utils.js';
import { collideCarWithCity, createCar, stepCarPhysics } from './vehicles.js';

export const CASH_STASHES = [
  { x: 1300, y: 1300, amount: 100 },
  { x: 3900, y: 1300, amount: 150 },
  { x: 1300, y: 3900, amount: 100 },
  { x: 3900, y: 3900, amount: 200 },
  { x: 2600, y: 2600, amount: 120 },
  { x: 700, y: 2600, amount: 80 },
  { x: 4550, y: 2600, amount: 150 },
  { x: 2600, y: 700, amount: 90 },
];

const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    start: 'safehouse',
    brief: 'Vera: "Welcome to Solmar, Jax. No wheels, no work. Take any car on the street — I won\'t ask how — and bring it to my garage."',
    reward: 300,
    steps: [
      { type: 'getCar', text: 'Steal a car — any car will do' },
      { type: 'goto', at: 'garage', radius: 90, text: "Drive to Vera's Garage" },
    ],
  },
  {
    id: 'the-pickup',
    title: 'The Pickup',
    start: 'garage',
    brief: 'Vera: "A package is waiting at the Docks. The harbour crew won\'t hand it over nicely — bring something that argues back."',
    reward: 500,
    steps: [
      { type: 'goto', at: 'docks', radius: 110, text: 'Go to the Docks' },
      { type: 'kill', count: 3, spawn: 'docks', text: 'Deal with the harbour crew (0/3)' },
      { type: 'goto', at: 'garage', radius: 90, text: 'Bring the package back to Vera' },
    ],
  },
  {
    id: 'hot-pursuit',
    title: 'Hot Pursuit',
    start: 'garage',
    brief: 'Vera: "A rival courier is running my routes. Find his car, run it off the road, and don\'t let the cops pin it on you."',
    reward: 700,
    steps: [
      { type: 'destroy', text: 'Destroy the rival courier\'s car' },
      { type: 'escape', text: 'Lose the cops' },
    ],
  },
  {
    id: 'bank-job',
    title: 'Bank Job',
    start: 'bank',
    brief: 'Vera: "Solmar Bank, noon. The vault takes forty seconds. Hold the street, grab the cash, and get home clean."',
    reward: 1200,
    steps: [
      { type: 'goto', at: 'bank', radius: 110, text: 'Get to Solmar Bank' },
      { type: 'survive', seconds: 40, spawn: 'bank', text: 'Hold the street while the vault opens' },
      { type: 'goto', at: 'safehouse', radius: 90, text: 'Get home — lose the heat on the way' },
    ],
  },
  {
    id: 'the-last-run',
    title: 'The Last Run',
    start: 'safehouse',
    brief: 'Vera: "One last run, Jax. The Marina crew wants us gone — clear them out, then drive to the airstrip. The plane leaves with or without you."',
    reward: 2000,
    steps: [
      { type: 'goto', at: 'marina', radius: 120, text: 'Go to the Marina' },
      { type: 'kill', count: 5, spawn: 'marina', text: 'Clear the Marina crew (0/5)' },
      { type: 'goto', at: 'airstrip', radius: 110, text: 'Drive to the airstrip' },
    ],
  },
];

export class MissionManager {
  constructor(world) {
    this.world = world;
    this.index = 0; // next mission to start
    this.active = false;
    this.stepIndex = 0;
    this.kills = 0;
    this.stepTimer = 0;
    this.spawnTimer = 0;
    this.rivalCar = null;
    this.marker = null; // { x, y, color, label } the HUD and minimap show
    this.objective = '';
    this.briefing = null; // mission shown on the briefing overlay
    this.briefingCooldown = 4; // the first offer waits a few seconds after spawn
    this.completedCount = 0;
  }

  get current() {
    return MISSIONS[this.index] || null;
  }

  get storyComplete() {
    return this.index >= MISSIONS.length;
  }

  get step() {
    if (!this.active || !this.current) return null;
    return this.current.steps[this.stepIndex];
  }

  landmarkPoint(name) {
    const lm = this.world.city.landmarks[name];
    return { x: lm.x, y: lm.y };
  }

  startMarker() {
    const mission = this.current;
    if (!mission) return null;
    const p = this.landmarkPoint(mission.start);
    return { x: p.x, y: p.y, color: '#c58af2', label: mission.title };
  }

  /** Offer the next mission when the player reaches its start marker. */
  update(dt) {
    const world = this.world;
    const player = world.player;
    if (!player.alive) return;

    if (!this.active) {
      if (this.storyComplete) {
        this.marker = null;
        this.objective = 'Story complete — Solmar Bay is yours. Free roam, take fares, find the stashes.';
        return;
      }
      this.marker = this.startMarker();
      this.objective = `Go to the purple marker: ${this.current.title}`;
      this.briefingCooldown = Math.max(0, this.briefingCooldown - dt);
      const m = this.marker;
      if (this.briefingCooldown <= 0 && dist(player.x, player.y, m.x, m.y) < 90) {
        this.briefing = this.current;
        world.message(`Mission: ${this.current.title}`, '#c58af2');
      }
      return;
    }

    const step = this.step;
    if (!step) return;
    const lm = (name) => this.landmarkPoint(name);

    if (step.type === 'getCar') {
      this.marker = null;
      this.objective = step.text;
      if (player.inCar) this.advance();
    } else if (step.type === 'goto') {
      const p = lm(step.at);
      this.marker = { x: p.x, y: p.y, color: '#e8b13c', label: step.text };
      this.objective = step.text;
      if (dist(player.x, player.y, p.x, p.y) < step.radius) this.advance();
    } else if (step.type === 'kill') {
      this.objective = step.text.replace(/\(\d+\/\d+\)/, `(${this.kills}/${step.count})`);
      const p = lm(step.spawn);
      this.marker = { x: p.x, y: p.y, color: '#e5534b', label: step.text };
      if (this.kills >= step.count) this.advance();
    } else if (step.type === 'destroy') {
      if (!this.rivalCar || this.rivalCar.dead) {
        if (this.rivalCar && this.rivalCar.dead) this.advance();
        return;
      }
      this.marker = { x: this.rivalCar.x, y: this.rivalCar.y, color: '#e5534b', label: 'Rival courier' };
      this.objective = step.text;
      this.driveRival(dt);
    } else if (step.type === 'survive') {
      this.stepTimer -= dt;
      this.objective = `${step.text} — ${Math.max(0, Math.ceil(this.stepTimer))}s`;
      const p = lm(step.spawn);
      this.marker = { x: p.x, y: p.y, color: '#e5534b', label: 'Hold the bank' };
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 6;
        const alive = world.combat.enemies.filter((e) => !e.dead).length;
        if (alive < 4) {
          world.combat.spawnEnemy(p.x + (Math.random() - 0.5) * 300, p.y + (Math.random() - 0.5) * 300, 60);
        }
      }
      if (this.stepTimer <= 0) this.advance();
    } else if (step.type === 'escape') {
      this.marker = null;
      this.objective = step.text;
      if (world.police.stars === 0) this.advance();
    }
  }

  /** The briefing overlay's accept button calls this. */
  beginBriefed() {
    const mission = this.briefing;
    if (!mission) return;
    this.briefing = null;
    this.active = true;
    this.stepIndex = 0;
    this.kills = 0;
    this.world.message(`Mission started: ${mission.title}`, '#c58af2');
    this.setupStep();
  }

  dismissBriefing() {
    this.briefing = null;
    this.briefingCooldown = 10;
  }

  setupStep() {
    const step = this.step;
    if (!step) return;
    const world = this.world;
    if (step.type === 'kill') {
      this.kills = 0;
      const p = this.landmarkPoint(step.spawn);
      for (let i = 0; i < step.count; i += 1) {
        world.combat.spawnEnemy(p.x + (Math.random() - 0.5) * 260, p.y + (Math.random() - 0.5) * 260, 60);
      }
      world.message('Hostiles on site — watch your back', '#e5534b');
    } else if (step.type === 'destroy') {
      const p = world.player;
      const car = createCar(p.x + 500, p.y - 260, Math.PI / 2, 'sports', '#c94f43');
      car.driver = 'rival';
      car.health = 60;
      car.maxHealth = 60;
      this.rivalCar = car;
      world.looseCars.push(car);
      world.message('The courier spotted you — run him down!', '#e5534b');
    } else if (step.type === 'survive') {
      this.stepTimer = step.seconds;
      this.spawnTimer = 0;
      world.police.addHeat(420, 'bank robbery');
      world.message('The alarm is up — 3 stars and climbing', '#e5534b');
    }
  }

  /** The rival courier flees down the roads, weaving away from the player. */
  driveRival(dt) {
    const car = this.rivalCar;
    const world = this.world;
    const p = world.player;
    const away = Math.atan2(car.y - p.y, car.x - p.x);
    const dx = Math.cos(away);
    const dy = Math.sin(away);
    // Steer along the road grid: pick the axis that points away fastest.
    const wantAngle = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : Math.PI) : (dy > 0 ? Math.PI / 2 : -Math.PI / 2);
    const turn = ((wantAngle - car.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const steer = Math.max(-1, Math.min(1, turn * 2));
    const sharp = Math.abs(turn) > 0.9 && Math.abs(car.speed) > 300;
    stepCarPhysics(car, { throttle: 1, steer, handbrake: sharp }, dt);
    collideCarWithCity(car, world.city);
  }

  advance() {
    const mission = this.current;
    this.stepIndex += 1;
    if (this.stepIndex >= mission.steps.length) {
      this.completeMission();
      return;
    }
    this.world.audio.click();
    this.setupStep();
  }

  completeMission() {
    const mission = this.current;
    const world = this.world;
    this.active = false;
    this.marker = null;
    this.completedCount += 1;
    this.index += 1;
    world.player.earn(mission.reward);
    world.audio.missionDone();
    world.message(`Mission complete: ${mission.title}  +$${mission.reward}`, '#7dd069');
    world.missionFlash = { text: `MISSION PASSED  +$${mission.reward}`, timer: 3.5 };
    if (this.storyComplete) {
      world.storyComplete = true;
      world.message('Story complete — you own Solmar Bay now.', '#7dd069');
    }
    world.saveGame();
  }

  failMission(reason) {
    if (!this.active) return;
    this.active = false;
    this.marker = null;
    this.rivalCar = null;
    this.world.message(`Mission failed: ${reason}`, '#e5534b');
  }

  onEnemyKilled() {
    if (this.active && this.step && this.step.type === 'kill') this.kills += 1;
  }

  /** The state a save file keeps. */
  serialize() {
    return { index: this.index, completedCount: this.completedCount };
  }

  restore(data) {
    if (!data) return;
    this.index = data.index || 0;
    this.completedCount = data.completedCount || 0;
    this.active = false;
    this.stepIndex = 0;
  }
}

/**
 * Taxi fares: get behind the wheel of a taxi and a fare appears — pick the
 * passenger up at the yellow marker, drop them at their destination, get
 * paid by the distance.
 */
export class TaxiJob {
  constructor(world) {
    this.world = world;
    this.state = 'idle'; // 'idle' | 'pickup' | 'dropoff'
    this.passenger = null;
    this.destination = null;
    this.fare = 0;
    this.offerTimer = 0;
  }

  update(dt) {
    const world = this.world;
    const player = world.player;
    if (!player.alive) return;
    const inTaxi = player.inCar && player.car && player.car.model === 'taxi';

    if (this.state === 'idle') {
      if (!inTaxi) return;
      this.offerTimer -= dt;
      if (this.offerTimer > 0) return;
      this.offerTimer = 2;
      const spots = Object.values(world.city.landmarks);
      const from = spots[Math.floor(Math.random() * spots.length)];
      const to = spots[Math.floor(Math.random() * spots.length)];
      if (from === to) return;
      this.passenger = { x: from.x, y: from.y, label: from.label };
      this.destination = { x: to.x, y: to.y, label: to.label };
      this.fare = Math.round(40 + dist(from.x, from.y, to.x, to.y) * 0.06);
      this.state = 'pickup';
      world.message(`Taxi fare: pick up at ${from.label} — $${this.fare}`, '#f2c230');
      return;
    }

    if (!inTaxi) {
      if (this.state !== 'idle') {
        this.state = 'idle';
        this.passenger = null;
        this.destination = null;
        world.message('Fare lost — the passenger walked away', '#e8b13c');
      }
      return;
    }

    if (this.state === 'pickup') {
      if (dist(player.x, player.y, this.passenger.x, this.passenger.y) < 70) {
        this.state = 'dropoff';
        world.message(`Passenger aboard — take them to ${this.destination.label}`, '#f2c230');
      }
    } else if (this.state === 'dropoff') {
      if (dist(player.x, player.y, this.destination.x, this.destination.y) < 80) {
        player.earn(this.fare);
        world.audio.missionDone();
        world.message(`Fare complete  +$${this.fare}`, '#7dd069');
        this.state = 'idle';
        this.passenger = null;
        this.destination = null;
        this.offerTimer = 4;
      }
    }
  }

  get marker() {
    if (this.state === 'pickup' && this.passenger) return { x: this.passenger.x, y: this.passenger.y, color: '#f2c230', label: 'Passenger' };
    if (this.state === 'dropoff' && this.destination) return { x: this.destination.x, y: this.destination.y, color: '#f2c230', label: 'Destination' };
    return null;
  }
}
