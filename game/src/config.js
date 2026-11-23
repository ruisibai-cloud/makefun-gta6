// Solmar Bay: every tuning number, colour and key binding in one place.
// The city is a 5200 x 5200 top-down grid; roads run every 520 px, the sea
// borders the east edge, and nine districts give each corner its own look.
export const WORLD_SIZE = 5200;
export const ROAD_SPACING = 520;
export const ROAD_WIDTH = 100;
export const SIDEWALK = 28;
export const BEACH_X = 4910; // sand starts here
export const SEA_X = 5020; // east of this line is open water (impassable)

export const STEP = 1 / 60; // fixed simulation step, seconds
export const SAVE_KEY = 'solmar-bay-save-v1';

export const PLAYER_WALK_SPEED = 195;
export const PLAYER_RUN_SPEED = 310;
export const PLAYER_RADIUS = 13;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_ARMOR = 100;

export const WANTED_HEAT_MAX = 1000;
export const WANTED_STAR_HEAT = [0, 70, 200, 400, 640, 880];
export const WANTED_DECAY_PER_SECOND = 16; // while no officer can see the player
export const WANTED_SIGHT_RANGE = 640;

export const START_MONEY = 150;
export const SPRAY_SHOP_PRICE = 120;
export const SMG_PRICE = 450;
export const AMMO_PRICE = 70;

export const COLORS = {
  grass: '#79a854',
  grassDark: '#6d9c4a',
  sand: '#e9d49c',
  sea: '#2f7f9d',
  seaDeep: '#23667f',
  road: '#3b4048',
  roadEdge: '#2b2f36',
  lane: '#e6d24d',
  sidewalk: '#cbbfa7',
  curb: '#a89a7e',
  roofOld: ['#e7dbc2', '#d8c7a5', '#cdbb9c', '#e2c89f'],
  roofDowntown: ['#7d99b1', '#9db4c6', '#6e8ba2', '#b1c2cf'],
  roofLatin: ['#d99a6c', '#e8b48a', '#c9855f', '#e5c98f'],
  roofDocks: ['#8f9aa3', '#a8b2b8', '#7d8891', '#b9c0c4'],
  wall: ['#b3a17f', '#a08e6d', '#c0ad8b', '#97825f'],
  palm: '#3e7c39',
  palmDark: '#356b31',
  trunk: '#8a6a44',
};

// Late-afternoon sun: long soft shadows fall north-west.
export const SUN = { dx: -0.42, dy: -0.34, shadowAlpha: 0.22 };

export const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  enterCar: 'KeyE',
  interact: 'KeyE',
  handbrake: 'Space',
  sprint: 'ShiftLeft',
  sprintRight: 'ShiftRight',
  reload: 'KeyR',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  pause: 'Escape',
  mute: 'KeyM',
  horn: 'KeyH',
  confirm: 'Enter',
};

export const DISTRICTS = [
  { name: 'Old Town', x: 0, y: 0, w: 1560, h: 1560, palette: 'old' },
  { name: 'Downtown', x: 1560, y: 0, w: 2080, h: 2080, palette: 'downtown' },
  { name: 'Marina Bay', x: 3640, y: 0, w: 1560, h: 1560, palette: 'marina' },
  { name: 'Little Havana', x: 0, y: 1560, w: 1560, h: 2080, palette: 'latin' },
  { name: 'Midtown', x: 1560, y: 2080, w: 2080, h: 1560, palette: 'mid' },
  { name: 'Ocean Drive', x: 3640, y: 1560, w: 1560, h: 2080, palette: 'beach' },
  { name: 'The Docks', x: 0, y: 3640, w: 2080, h: 1560, palette: 'docks' },
  { name: 'Southside', x: 2080, y: 3640, w: 1560, h: 1560, palette: 'south' },
  { name: 'Coral Heights', x: 3640, y: 3640, w: 1560, h: 1560, palette: 'heights' },
];

export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d;
  }
  return DISTRICTS[4];
}

export function roofsFor(palette) {
  if (palette === 'downtown' || palette === 'marina') return COLORS.roofDowntown;
  if (palette === 'latin') return COLORS.roofLatin;
  if (palette === 'docks') return COLORS.roofDocks;
  return COLORS.roofOld;
}
