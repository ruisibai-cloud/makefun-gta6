// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. The game moves
// between five screens: title, play, paused, wasted and busted. Progress
// saves to localStorage on mission completion, on pause and on quitting.
//
// ?shot=title|chase|street|mission (with &seed=N) stages that scene instead
// of running the loop, paints it twice and sets window.__shotReady.
import { KEYS, STEP } from './config.js';
import { World } from './world.js';
import { createInput } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261121;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = new World();
const renderer = createRenderer(canvas);

function announce(message) {
  status.textContent = message;
}

function runShot(name) {
  const scene = stageShot(name, world);
  const ui = { hasSave: false, showHelp: false, muted: false, hover: null };
  let painted = 0;
  function paint() {
    renderer.draw(world, scene.screen, ui);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let save = World.readSave();
  let showHelp = false;
  let muted = false;
  let buttons = [];
  let accumulator = 0;
  let last = performance.now();

  function ui() {
    return { hasSave: !!save, showHelp, muted, hover: hoverId() };
  }

  function hoverId() {
    const mx = input.mouse.x;
    const my = input.mouse.y;
    for (const b of buttons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b.id;
    }
    return null;
  }

  function clickedButton() {
    if (!input.mousePressed) return null;
    const mx = input.mouse.x;
    const my = input.mouse.y;
    for (const b of buttons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b.id;
    }
    return null;
  }

  function startGame(fromSave) {
    world.reset(seed);
    if (fromSave && save) world.restoreSave(save);
    screen = SCREEN_PLAY;
    accumulator = 0;
    world.audio.ensure();
    announce(fromSave ? 'Continuing in Solmar Bay.' : 'New game in Solmar Bay. Steal a car and find Vera.');
  }

  function quitToTitle() {
    world.saveGame();
    save = World.readSave();
    screen = SCREEN_TITLE;
    showHelp = false;
    announce('Saved. Back at the title screen.');
  }

  function respawn() {
    world.respawnAfterIncident();
    screen = SCREEN_PLAY;
    announce('Back on the street.');
  }

  function handleTitle() {
    const clicked = clickedButton();
    if (showHelp) {
      if (input.pressed('KeyH') || input.mousePressed) showHelp = false;
      return;
    }
    if (input.pressed(KEYS.confirm) || clicked === 'new') startGame(false);
    else if ((input.pressed('KeyC') || clicked === 'continue') && save) startGame(true);
    else if (input.pressed('KeyH') || clicked === 'help') showHelp = true;
  }

  function handlePlay() {
    // The briefing overlay pauses the world until it is answered.
    if (world.missions.briefing) {
      const clicked = clickedButton();
      if (input.pressed(KEYS.interact) || input.pressed(KEYS.confirm) || clicked === 'accept') {
        world.missions.beginBriefed();
        world.audio.ensure();
      } else if (input.pressed(KEYS.pause) || clicked === 'decline') {
        world.missions.dismissBriefing();
      }
      return;
    }
    // Shop number keys buy; the panel's buttons are clicked.
    if (world.shopOpen) {
      const clicked = clickedButton();
      if (clicked) world.buyShopItem(clicked);
      const ids = world.shopOpen === 'gun' ? ['smg', 'ammo', 'armor'] : ['respray'];
      const codes = ['Digit1', 'Digit2', 'Digit3'];
      for (let i = 0; i < ids.length; i += 1) {
        if (input.pressed(codes[i])) world.buyShopItem(ids[i]);
      }
      return;
    }
    if (input.pressed(KEYS.pause)) {
      screen = SCREEN_PAUSED;
      world.saveGame();
      save = World.readSave();
      announce('Paused. Progress saved.');
    }
  }

  function handlePaused() {
    const clicked = clickedButton();
    if (input.pressed(KEYS.pause) || input.pressed(KEYS.confirm) || clicked === 'resume') {
      screen = SCREEN_PLAY;
      announce('Playing.');
    } else if (clicked === 'save-quit') {
      quitToTitle();
    } else if (clicked === 'restart') {
      save = null;
      try {
        window.localStorage.removeItem('solmar-bay-save-v1');
      } catch {
        // Storage off: nothing to clear.
      }
      startGame(false);
    }
  }

  function handleOver() {
    const clicked = clickedButton();
    if (input.pressed(KEYS.confirm) || input.pressed(KEYS.interact) || clicked === 'respawn') respawn();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    // The mouse aims in world coordinates.
    world.mouseWorld = renderer.screenToWorld(input.mouse.x, input.mouse.y, world);

    if (input.pressed(KEYS.mute)) {
      muted = world.audio.toggleMute();
      announce(muted ? 'Muted.' : 'Sound on.');
    }
    if (input.mousePressed) world.audio.ensure();

    if (screen === SCREEN_TITLE) {
      handleTitle();
      while (accumulator >= STEP) {
        world.stepTitle(STEP);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      handlePlay();
      if (!world.missions.briefing) {
        while (accumulator >= STEP && screen === SCREEN_PLAY) {
          world.step(STEP, input);
          accumulator -= STEP;
        }
      } else {
        accumulator = 0;
      }
      if (world.player.wasted) {
        screen = SCREEN_OVER;
        announce('Wasted. The hospital bill is $200.');
      } else if (world.player.busted) {
        screen = SCREEN_BUSTED;
        announce('Busted. Bail and the impound cost $200.');
      }
    } else if (screen === SCREEN_PAUSED) {
      handlePaused();
      accumulator = 0;
    } else {
      handleOver();
      accumulator = 0;
    }

    const drawn = renderer.draw(world, screen, ui());
    buttons = drawn.buttons || [];
    input.endFrame();
  }

  // Leaving the tab pauses a running game rather than letting the city run on.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      world.saveGame();
      save = World.readSave();
      announce('Paused.');
    }
  });

  announce('Solmar Bay. Press Enter for a new game, or C to continue.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
