// The screenshot scenes behind ?shot=title|chase|street|mission. Each one
// plays the real rules forward from a fresh world for a few seconds, steered
// by a scripted input (drive, aim, fire), so the frame is what a short game
// really looks like and the same seed always gives the same frame.
import { STEP } from './config.js';
import { createCar } from './vehicles.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

function scriptedInput(held, mouseDown) {
  return {
    isDown(codes) {
      if (typeof codes === 'string') return held.has(codes);
      return codes.some((c) => held.has(c));
    },
    pressed() {
      return false;
    },
    get mouseDown() {
      return mouseDown;
    },
  };
}

function repopulate(world, x, y) {
  world.traffic.cars = [];
  world.traffic.parked = [];
  world.peds.list = [];
  world.traffic.spawnInitial(x, y);
  world.peds.spawnInitial(x, y);
  world.camera.x = x;
  world.camera.y = y;
}

function putPlayerInCar(world, x, y, angle, model, color) {
  const car = createCar(x, y, angle, model, color);
  car.driver = 'player';
  world.player.inCar = true;
  world.player.car = car;
  world.player.x = x;
  world.player.y = y;
  world.player.angle = angle;
  return car;
}

function stageChase(world) {
  world.reset();
  const px = 2340;
  const py = 1040;
  const car = putPlayerInCar(world, px, py, Math.PI / 2, 'sports', '#c94f43');
  // A staged chase car shrugs off the scripted drive's bumps.
  car.health = 1000;
  car.maxHealth = 1000;
  repopulate(world, px, py);
  // Keep pedestrians off the drive corridor so the chase stays clean.
  world.peds.list = world.peds.list.filter((p) => Math.abs(p.x - px) > 120 || p.y < py - 100 || p.y > py + 2200);
  // Three stars and two pursuit cars already closing in.
  world.police.addHeat(400, 'staged');
  for (let i = 0; i < 2; i += 1) {
    const cop = createCar(px + (i === 0 ? 24 : -24), py - 170 - i * 150, Math.PI / 2, 'police', '#f2f2f2');
    cop.driver = 'police';
    cop.siren = true;
    cop.speed = 420;
    cop.vx = 0;
    cop.vy = 420;
    world.police.copCars.push(cop);
  }
  // Mission 3 in progress: the rival courier flees ahead.
  world.missions.index = 2;
  world.missions.active = true;
  world.missions.stepIndex = 0;
  world.missions.setupStep();
  // Drive south briefly; the chase forms up behind without outrunning the frame.
  const drive = scriptedInput(new Set(['KeyW']), false);
  for (let i = 0; i < 2.2 / STEP; i += 1) world.step(STEP, drive);
  return { screen: SCREEN_PLAY };
}

function stageStreet(world) {
  world.reset();
  const px = 2340;
  const py = 830;
  world.player.x = px;
  world.player.y = py;
  world.player.angle = Math.PI / 2;
  world.player.hasSmg = true;
  world.player.ammo.smg = 120;
  world.player.weapon = 'smg';
  repopulate(world, px, py);
  // A few pedestrians on the sidewalks around the player.
  world.peds.spawnAt(2280, 700);
  world.peds.spawnAt(2420, 950);
  world.peds.spawnAt(2210, 1000);
  world.peds.spawnAt(2510, 760);
  world.message('Downtown Solmar — the Gun Shop is right here', '#ffffff');
  const idle = scriptedInput(new Set(), false);
  world.mouseWorld = { x: px + 200, y: py + 120 };
  for (let i = 0; i < 3 / STEP; i += 1) world.step(STEP, idle);
  return { screen: SCREEN_PLAY };
}

function stageMission(world) {
  world.reset();
  const px = 780;
  const py = 4280;
  world.player.x = px;
  world.player.y = py;
  world.player.hasSmg = true;
  world.player.ammo.smg = 120;
  world.player.weapon = 'smg';
  world.player.money = 640;
  repopulate(world, px, py);
  // Mission 2, kill step: three rivals guard the package at the Docks.
  world.missions.index = 1;
  world.missions.active = true;
  world.missions.stepIndex = 1;
  world.missions.setupStep();
  world.police.addHeat(200, 'staged');
  // Fire at the nearest living rival, re-aiming as they move — long enough
  // to drop one or two, short enough that the fight is still on.
  const firing = scriptedInput(new Set(), true);
  for (let chunk = 0; chunk < 5; chunk += 1) {
    const alive = world.combat.enemies.filter((e) => !e.dead);
    let target = null;
    let bestD = Infinity;
    for (const e of alive) {
      const d = (e.x - world.player.x) ** 2 + (e.y - world.player.y) ** 2;
      if (d < bestD) {
        bestD = d;
        target = e;
      }
    }
    if (!target) break;
    world.mouseWorld = { x: target.x, y: target.y };
    for (let i = 0; i < 0.25 / STEP; i += 1) world.step(STEP, firing);
  }
  return { screen: SCREEN_PLAY };
}

function stageTitle(world) {
  world.reset();
  for (let i = 0; i < 6 / STEP; i += 1) world.stepTitle(STEP);
  return { screen: SCREEN_TITLE };
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * Any unknown name stages the title.
 */
export function stageShot(name, world) {
  if (name === 'chase') return stageChase(world);
  if (name === 'street') return stageStreet(world);
  if (name === 'mission') return stageMission(world);
  return stageTitle(world);
}
