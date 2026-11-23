// Drawing only: the world's state and the current screen in, pixels out.
// The camera follows the player with a speed-sensitive zoom; the HUD (health,
// cash, wanted stars, minimap, objective) and the screens (title, pause,
// briefing, game over) are drawn on top of the same canvas.
import {
  BEACH_X,
  COLORS,
  PLAYER_MAX_ARMOR,
  PLAYER_MAX_HEALTH,
  ROAD_WIDTH,
  SEA_X,
  SIDEWALK,
  SUN,
  WORLD_SIZE,
  districtAt,
} from './config.js';
import { clamp, dist, formatMoney, formatTime } from './utils.js';
import { carSpeedKmh } from './vehicles.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BUSTED = 'busted';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 1280, h: 720, dpr: 1 };
  const fonts = new Map();

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.dpr = dpr;
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
  }

  function font(size, weight) {
    const key = `${weight || 400}:${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight || 400} ${size}px ${FONT}`);
    return fonts.get(key);
  }

  function text(value, x, y, size, color, align, weight) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function textShadowed(value, x, y, size, color, align, weight) {
    ctx.font = font(size, weight);
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(value, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  /** Screen (CSS px) to world coordinates through the camera. */
  function screenToWorld(mx, my, world) {
    const cam = world.camera;
    return {
      x: cam.x + (mx - view.w / 2) / cam.zoom,
      y: cam.y + (my - view.h / 2) / cam.zoom,
    };
  }

  function drawGround(world) {
    const cam = world.camera;
    const x0 = cam.x - view.w / 2 / cam.zoom - 60;
    const y0 = cam.y - view.h / 2 / cam.zoom - 60;
    const x1 = cam.x + view.w / 2 / cam.zoom + 60;
    const y1 = cam.y + view.h / 2 / cam.zoom + 60;
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Mown checker on the grass, deterministic per 260 px tile.
    ctx.fillStyle = COLORS.grassDark;
    const tile = 260;
    for (let tx = Math.floor(x0 / tile) * tile; tx < x1; tx += tile) {
      for (let ty = Math.floor(y0 / tile) * tile; ty < y1; ty += tile) {
        if (hash2(tx, ty) < 0.5) ctx.fillRect(tx, ty, tile, tile);
      }
    }
    // Sand, then the sea with slow wave lines.
    if (x1 > BEACH_X) {
      ctx.fillStyle = COLORS.sand;
      ctx.fillRect(Math.max(x0, BEACH_X), y0, Math.min(x1, SEA_X) - Math.max(x0, BEACH_X), y1 - y0);
    }
    if (x1 > SEA_X) {
      ctx.fillStyle = COLORS.sea;
      ctx.fillRect(Math.max(x0, SEA_X), y0, x1 - Math.max(x0, SEA_X), y1 - y0);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      const t = world.time;
      for (let wy = Math.floor(y0 / 90) * 90; wy < y1; wy += 90) {
        ctx.beginPath();
        for (let wx = SEA_X + 10; wx < x1; wx += 40) {
          const wave = Math.sin(wx * 0.01 + t * 1.4 + wy) * 6;
          if (wx === SEA_X + 10) ctx.moveTo(wx, wy + wave);
          else ctx.lineTo(wx, wy + wave);
        }
        ctx.stroke();
      }
      ctx.fillStyle = COLORS.seaDeep;
      ctx.fillRect(Math.max(x0, SEA_X + 260), y0, x1 - Math.max(x0, SEA_X + 260), y1 - y0);
    }
  }

  function drawRoads(world) {
    const cam = world.camera;
    const x0 = cam.x - view.w / 2 / cam.zoom - 120;
    const y0 = cam.y - view.h / 2 / cam.zoom - 120;
    const x1 = cam.x + view.w / 2 / cam.zoom + 120;
    const y1 = cam.y + view.h / 2 / cam.zoom + 120;
    const half = ROAD_WIDTH / 2;
    // Sidewalks: a pale frame around every road.
    ctx.fillStyle = COLORS.sidewalk;
    for (const rx of world.city.roadsX) {
      if (rx < x0 - half - SIDEWALK || rx > x1 + half + SIDEWALK) continue;
      ctx.fillRect(rx - half - SIDEWALK, y0, (half + SIDEWALK) * 2, y1 - y0);
    }
    for (const ry of world.city.roadsY) {
      if (ry < y0 - half - SIDEWALK || ry > y1 + half + SIDEWALK) continue;
      ctx.fillRect(x0, ry - half - SIDEWALK, x1 - x0, (half + SIDEWALK) * 2);
    }
    // Asphalt.
    ctx.fillStyle = COLORS.road;
    for (const rx of world.city.roadsX) {
      if (rx < x0 - half || rx > x1 + half) continue;
      ctx.fillRect(rx - half, y0, ROAD_WIDTH, y1 - y0);
    }
    for (const ry of world.city.roadsY) {
      if (ry < y0 - half || ry > y1 + half) continue;
      ctx.fillRect(x0, ry - half, x1 - x0, ROAD_WIDTH);
    }
    // Dashed centre lines, skipping the intersections.
    ctx.strokeStyle = COLORS.lane;
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 30]);
    ctx.beginPath();
    for (const rx of world.city.roadsX) {
      if (rx < x0 - half || rx > x1 + half) continue;
      ctx.moveTo(rx, y0);
      ctx.lineTo(rx, y1);
    }
    for (const ry of world.city.roadsY) {
      if (ry < y0 - half || ry > y1 + half) continue;
      ctx.moveTo(x0, ry);
      ctx.lineTo(x1, ry);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Crosswalks at intersections in view.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const rx of world.city.roadsX) {
      for (const ry of world.city.roadsY) {
        if (rx < x0 || rx > x1 || ry < y0 || ry > y1) continue;
        for (let i = -2; i <= 2; i += 1) {
          ctx.fillRect(rx + i * 18 - 6, ry - half - 16, 12, 10);
          ctx.fillRect(rx + i * 18 - 6, ry + half + 6, 12, 10);
        }
      }
    }
  }

  function drawBuildings(world) {
    const cam = world.camera;
    const x0 = cam.x - view.w / 2 / cam.zoom - 120;
    const y0 = cam.y - view.h / 2 / cam.zoom - 120;
    const x1 = cam.x + view.w / 2 / cam.zoom + 120;
    const y1 = cam.y + view.h / 2 / cam.zoom + 120;
    for (const b of world.city.buildings) {
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      const shx = SUN.dx * b.height;
      const shy = SUN.dy * b.height;
      ctx.fillStyle = `rgba(20, 26, 18, ${SUN.shadowAlpha})`;
      ctx.fillRect(b.x + shx, b.y + shy, b.w, b.h);
      ctx.fillStyle = b.wall;
      ctx.fillRect(b.x, b.y + 6, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // Roof furniture: a unit and a skylight, placed by hash.
      const h = hash2(b.x, b.y);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(b.x + b.w * (0.15 + h * 0.3), b.y + b.h * 0.2, Math.min(26, b.w * 0.2), Math.min(18, b.h * 0.16));
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(b.x + b.w * (0.55 + h * 0.15), b.y + b.h * 0.55, Math.min(34, b.w * 0.26), Math.min(22, b.h * 0.2));
    }
  }

  function drawTrees(world) {
    const cam = world.camera;
    const x0 = cam.x - view.w / 2 / cam.zoom - 60;
    const y0 = cam.y - view.h / 2 / cam.zoom - 60;
    const x1 = cam.x + view.w / 2 / cam.zoom + 60;
    const y1 = cam.y + view.h / 2 / cam.zoom + 60;
    for (const t of world.city.trees) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      ctx.fillStyle = 'rgba(20, 26, 18, 0.2)';
      ctx.beginPath();
      ctx.ellipse(t.x - 8, t.y - 6, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.trunk;
      ctx.fillRect(t.x - 2, t.y - 2, 4, 4);
      if (t.palm) {
        ctx.fillStyle = COLORS.palm;
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * Math.PI * 2 + t.x;
          ctx.beginPath();
          ctx.ellipse(t.x + Math.cos(a) * 8, t.y + Math.sin(a) * 8, 11, 5, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = COLORS.palmDark;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = COLORS.palm;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.palmDark;
        ctx.beginPath();
        ctx.arc(t.x - 4, t.y - 4, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPickups(world) {
    for (const p of world.combat.pickups) {
      const bob = Math.sin(p.bob) * 3;
      const y = p.y + bob;
      ctx.fillStyle = 'rgba(20, 26, 18, 0.25)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 8, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (p.kind === 'cash') {
        ctx.fillStyle = '#7dd069';
        ctx.fillRect(p.x - 11, y - 7, 22, 14);
        ctx.fillStyle = '#2f7a2c';
        ctx.font = font(11, 800);
        ctx.textAlign = 'center';
        ctx.fillText('$', p.x, y + 4);
      } else if (p.kind === 'health') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(p.x - 9, y - 9, 18, 18);
        ctx.fillStyle = '#e5534b';
        ctx.fillRect(p.x - 3, y - 7, 6, 14);
        ctx.fillRect(p.x - 7, y - 3, 14, 6);
      } else if (p.kind === 'armor') {
        ctx.fillStyle = '#4fc3f7';
        ctx.beginPath();
        ctx.arc(p.x, y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = font(11, 800);
        ctx.textAlign = 'center';
        ctx.fillText('A', p.x, y + 4);
      } else {
        ctx.fillStyle = '#e8b13c';
        ctx.fillRect(p.x - 9, y - 6, 18, 12);
        ctx.fillStyle = '#5a3c00';
        ctx.font = font(9, 800);
        ctx.textAlign = 'center';
        ctx.fillText('AMMO', p.x, y + 3);
      }
    }
  }

  function drawCar(car, world) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const l = car.len;
    const w = car.wid;
    ctx.fillStyle = 'rgba(20, 26, 18, 0.28)';
    roundRectPath(ctx, -l / 2 + 5, -w / 2 + 6, l, w, 8);
    ctx.fill();
    // Wheels.
    ctx.fillStyle = '#14161a';
    const ww = 12;
    const wh = 6;
    ctx.fillRect(-l / 2 + 8, -w / 2 - 2, ww, wh);
    ctx.fillRect(-l / 2 + 8, w / 2 - 4, ww, wh);
    ctx.fillRect(l / 2 - 20, -w / 2 - 2, ww, wh);
    ctx.fillRect(l / 2 - 20, w / 2 - 4, ww, wh);
    // Body.
    ctx.fillStyle = car.color;
    roundRectPath(ctx, -l / 2, -w / 2, l, w, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Cabin glass and roof.
    ctx.fillStyle = 'rgba(30, 44, 58, 0.9)';
    roundRectPath(ctx, l * 0.08, -w / 2 + 4, l * 0.2, w - 8, 3);
    ctx.fill();
    roundRectPath(ctx, -l * 0.3, -w / 2 + 4, l * 0.18, w - 8, 3);
    ctx.fill();
    ctx.fillStyle = car.color === '#f2f2f2' ? '#20242a' : shade(car.color, -18);
    roundRectPath(ctx, -l * 0.12, -w / 2 + 5, l * 0.2, w - 10, 3);
    ctx.fill();
    if (car.model === 'taxi') {
      ctx.fillStyle = '#20242a';
      ctx.fillRect(-6, -5, 12, 10);
      ctx.fillStyle = '#f2c230';
      ctx.font = font(8, 800);
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', 0, 3);
    }
    if (car.model === 'truck') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-l / 2 + 4, -w / 2 + 4, l * 0.4, w - 8);
    }
    // Brake lights.
    if (car.brake) {
      ctx.fillStyle = '#ff2e2e';
      ctx.fillRect(-l / 2 - 1, -w / 2 + 3, 3, 6);
      ctx.fillRect(-l / 2 - 1, w / 2 - 9, 3, 6);
    } else {
      ctx.fillStyle = 'rgba(255,80,80,0.5)';
      ctx.fillRect(-l / 2 - 1, -w / 2 + 3, 3, 6);
      ctx.fillRect(-l / 2 - 1, w / 2 - 9, 3, 6);
    }
    // Headlights.
    ctx.fillStyle = '#fff6c9';
    ctx.fillRect(l / 2 - 2, -w / 2 + 3, 3, 6);
    ctx.fillRect(l / 2 - 2, w / 2 - 9, 3, 6);
    // Police light bar: red and blue alternate with the siren phase.
    if (car.siren) {
      const phase = Math.floor(car.sirenPhase * 4) % 2 === 0;
      ctx.fillStyle = phase ? '#ff2e2e' : '#2e7bff';
      ctx.fillRect(-8, -w / 2 + 2, 16, 7);
      ctx.fillStyle = phase ? '#2e7bff' : '#ff2e2e';
      ctx.fillRect(-8, w / 2 - 9, 16, 7);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = phase ? '#ff2e2e' : '#2e7bff';
      ctx.beginPath();
      ctx.arc(0, 0, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Damage: smoke wisps and a darkened hood.
    if (car.health < 55) {
      ctx.fillStyle = 'rgba(20,20,20,0.35)';
      roundRectPath(ctx, l * 0.2, -w / 2 + 2, l * 0.28, w - 4, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amount, 0, 255);
    const g = clamp(((n >> 8) & 255) + amount, 0, 255);
    const b = clamp((n & 255) + amount, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function drawPerson(x, y, angle, shirt, pants, skin, opts) {
    const o = opts || {};
    ctx.save();
    ctx.translate(x, y);
    if (o.down) {
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = 'rgba(20, 26, 18, 0.25)';
      ctx.beginPath();
      ctx.ellipse(2, 3, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shirt;
      roundRectPath(ctx, -14, -6, 28, 12, 6);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(16, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const bob = o.bob || 0;
    ctx.fillStyle = 'rgba(20, 26, 18, 0.25)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);
    // Legs swing with the walk cycle.
    const swing = o.moving ? Math.sin(o.cycle || 0) * 4 : 0;
    ctx.fillStyle = pants;
    ctx.fillRect(-4, -8, 10, 5);
    ctx.fillRect(-4 + swing * 0.4, 3, 10, 5);
    // Body and head.
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(4, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    if (o.gun) {
      ctx.fillStyle = '#22262c';
      ctx.fillRect(6, -1.5, 13, 3);
    }
    if (o.hat) {
      ctx.fillStyle = o.hat;
      ctx.beginPath();
      ctx.arc(4, 0, 6.5, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();
    }
    ctx.restore();
    void bob;
  }

  function drawMarkerBeam(marker, world) {
    const pulse = 0.6 + Math.sin(world.time * 4) * 0.4;
    ctx.save();
    ctx.globalAlpha = 0.25 * pulse + 0.15;
    ctx.fillStyle = marker.color;
    ctx.fillRect(marker.x - 14, marker.y - 260, 28, 260);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 26 + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = marker.color;
    ctx.save();
    ctx.translate(marker.x, marker.y - 34 - Math.sin(world.time * 3) * 6);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-9, -9, 18, 18);
    ctx.restore();
    ctx.restore();
  }

  function drawWorld(world) {
    const cam = world.camera;
    const shakeX = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake : 0;
    const shakeY = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake : 0;
    ctx.save();
    ctx.scale(view.dpr, view.dpr);
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x + shakeX, -cam.y + shakeY);
    drawGround(world);
    drawRoads(world);
    drawBuildings(world);
    drawTrees(world);
    world.particles.draw(ctx);
    drawPickups(world);
    // Mission and taxi markers rise above the street.
    const marker = world.missions.marker || world.taxi.marker;
    if (marker) drawMarkerBeam(marker, world);
    for (const car of world.allCars()) {
      if (!car.dead) drawCar(car, world);
    }
    for (const ped of world.peds.list) {
      drawPerson(ped.x, ped.y, ped.angle, ped.shirt, ped.pants, ped.skin, {
        down: ped.dead,
        moving: ped.state !== 'walk' || true,
        cycle: ped.x * 0.05 + ped.y * 0.05,
      });
    }
    for (const cop of world.police.footCops) {
      drawPerson(cop.x, cop.y, cop.angle, '#2e5f9e', '#1d2733', '#d9a06b', { gun: true, hat: '#1d2733', moving: true, cycle: world.time * 10 });
    }
    for (const enemy of world.combat.enemies) {
      drawPerson(enemy.x, enemy.y, enemy.angle, '#3a3f46', '#22262c', '#d9a06b', { down: enemy.dead, gun: !enemy.dead, moving: true, cycle: world.time * 9 });
    }
    const player = world.player;
    if (!player.inCar && player.alive) {
      drawPerson(player.x, player.y, player.angle, '#2fa8a0', '#2e3440', '#f2c9a0', {
        gun: true,
        hat: '#c94f43',
        moving: player.moving,
        cycle: player.walkCycle,
      });
      // Aim line, faint, toward the mouse.
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(player.angle) * 24, player.y + Math.sin(player.angle) * 24);
      ctx.lineTo(player.x + Math.cos(player.angle) * 52, player.y + Math.sin(player.angle) * 52);
      ctx.stroke();
    }
    // Bullets as short tracers.
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 2.5;
    for (const b of world.combat.bullets) {
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function panel(x, y, w, h, alpha) {
    ctx.fillStyle = `rgba(12, 14, 18, ${alpha === undefined ? 0.72 : alpha})`;
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawHud(world, ui) {
    const player = world.player;
    const w = view.w;
    const h = view.h;

    // Cash and wanted stars, top right.
    textShadowed(formatMoney(player.money), w - 24, 40, 30, '#7dd069', 'right', 800);
    const stars = world.police.stars;
    for (let i = 0; i < 5; i += 1) {
      const sx = w - 36 - (4 - i) * 34;
      const sy = 74;
      starPath(ctx, sx, sy, 13);
      if (i < stars) {
        ctx.fillStyle = '#ffd94d';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fill();
      }
    }
    if (world.police.heat > 0 && stars === 0) {
      textShadowed('heat cooling…', w - 24, 104, 13, '#e8b13c', 'right');
    }

    // Objective, top centre.
    const objective = world.missions.objective || '';
    if (objective) {
      ctx.font = font(17, 700);
      const ow = ctx.measureText(objective).width + 36;
      panel(w / 2 - ow / 2, 14, ow, 38, 0.66);
      text(objective, w / 2, 39, 17, '#ffffff', 'center', 700);
    }

    // Mission and district banners.
    if (world.missionFlash && world.missionFlash.timer > 0) {
      const a = Math.min(1, world.missionFlash.timer);
      ctx.globalAlpha = a;
      textShadowed(world.missionFlash.text, w / 2, h * 0.3, 40, '#7dd069', 'center', 900);
      ctx.globalAlpha = 1;
    }
    if (world.districtBanner && world.districtBanner.timer > 0) {
      const a = Math.min(1, world.districtBanner.timer);
      ctx.globalAlpha = a;
      textShadowed(world.districtBanner.name, 28, 108, 32, '#ffffff', 'left', 800);
      textShadowed('Solmar Bay', 28, 134, 15, '#e8e4da', 'left');
      ctx.globalAlpha = 1;
    }

    // Messages, left edge above the minimap.
    let my = h - 260;
    ctx.font = font(15, 600);
    for (let i = world.messages.length - 1; i >= 0; i -= 1) {
      const m = world.messages[i];
      const a = Math.min(1, m.timer);
      ctx.globalAlpha = a;
      textShadowed(m.text, 28, my, 15, m.color, 'left', 600);
      ctx.globalAlpha = 1;
      my -= 24;
    }

    // Health and armour bars, bottom right.
    const bw = 210;
    const bx = w - bw - 24;
    const by = h - 88;
    textShadowed('HEALTH', bx, by - 6, 12, '#e8e4da', 'left', 700);
    panel(bx, by, bw, 14, 0.6);
    ctx.fillStyle = player.health > 30 ? '#7dd069' : '#e5534b';
    ctx.fillRect(bx + 2, by + 2, (bw - 4) * clamp(player.health / PLAYER_MAX_HEALTH, 0, 1), 10);
    textShadowed('ARMOUR', bx, by + 34, 12, '#e8e4da', 'left', 700);
    panel(bx, by + 40, bw, 14, 0.6);
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(bx + 2, by + 42, (bw - 4) * clamp(player.armor / PLAYER_MAX_ARMOR, 0, 1), 10);

    // Weapon and ammo, above the bars.
    const spec = player.weaponSpec;
    const ammoText = player.weapon === 'smg' ? `${player.ammo.smg} rounds` : '∞';
    textShadowed(`${spec.name}  ·  ${ammoText}`, bx, by - 22, 15, '#ffffff', 'left', 700);

    // Speedometer while driving (top right, under the stars), with the car's
    // condition as a thin bar along the bottom of the health stack.
    if (player.inCar && player.car) {
      textShadowed(`${Math.round(carSpeedKmh(player.car))} km/h`, w - 24, 134, 22, '#ffffff', 'right', 800);
      const hp = clamp(player.car.health / player.car.maxHealth, 0, 1);
      textShadowed('CAR', bx, h - 11, 12, '#e8e4da', 'left', 700);
      panel(bx + 36, h - 19, bw - 36, 8, 0.6);
      ctx.fillStyle = hp > 0.4 ? '#e8b13c' : '#e5534b';
      ctx.fillRect(bx + 38, h - 17, (bw - 40) * hp, 4);
    } else {
      textShadowed(`Missions ${world.missions.completedCount}/5  ·  ${formatTime(world.time)}`, w - 24, h - 24, 14, '#e8e4da', 'right');
    }

    drawMinimap(world);

    // Context prompt, bottom centre.
    if (world.prompt) {
      ctx.font = font(16, 700);
      const pw = ctx.measureText(world.prompt).width + 32;
      panel(w / 2 - pw / 2, h - 52, pw, 34, 0.7);
      text(world.prompt, w / 2, h - 29, 16, '#ffffff', 'center', 700);
    } else if (!player.inCar) {
      textShadowed('WASD move · Mouse aim · Click shoot · E enter car · Esc pause', w / 2, h - 18, 13, 'rgba(255,255,255,0.75)', 'center');
    } else {
      textShadowed('WASD drive · Space handbrake · H horn · E exit car · Esc pause', w / 2, h - 18, 13, 'rgba(255,255,255,0.75)', 'center');
    }

    if (ui.muted) textShadowed('MUTED (M)', 24, 30, 13, '#e8b13c', 'left', 700);
  }

  function drawMinimap(world) {
    const size = 196;
    const x = 24;
    const y = view.h - size - 24;
    const scale = size / WORLD_SIZE;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    panel(x - 4, y - 4, size + 8, size + 8, 0.85);
    ctx.fillStyle = '#55763c';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#2f7f9d';
    ctx.fillRect(x + SEA_X * scale, y, size - SEA_X * scale, size);
    ctx.fillStyle = '#e9d49c';
    ctx.fillRect(x + BEACH_X * scale, y, (SEA_X - BEACH_X) * scale, size);
    ctx.strokeStyle = 'rgba(230,230,230,0.75)';
    ctx.lineWidth = 2;
    for (const rx of world.city.roadsX) {
      ctx.beginPath();
      ctx.moveTo(x + rx * scale, y);
      ctx.lineTo(x + rx * scale, y + size);
      ctx.stroke();
    }
    for (const ry of world.city.roadsY) {
      ctx.beginPath();
      ctx.moveTo(x, y + ry * scale);
      ctx.lineTo(x + size, y + ry * scale);
      ctx.stroke();
    }
    // Landmarks as dots.
    for (const lm of Object.values(world.city.landmarks)) {
      ctx.fillStyle = lm.color;
      ctx.beginPath();
      ctx.arc(x + lm.x * scale, y + lm.y * scale, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Police blips.
    for (const car of world.police.copCars) {
      if (car.dead) continue;
      ctx.fillStyle = Math.floor(world.time * 3) % 2 === 0 ? '#ff2e2e' : '#2e7bff';
      ctx.beginPath();
      ctx.arc(x + car.x * scale, y + car.y * scale, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mission and taxi markers.
    const marker = world.missions.marker || world.taxi.marker;
    if (marker) {
      const pulse = 4 + Math.sin(world.time * 5) * 1.5;
      ctx.fillStyle = marker.color;
      ctx.beginPath();
      ctx.arc(x + marker.x * scale, y + marker.y * scale, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // The player: a white arrow that turns with them.
    const p = world.player;
    ctx.save();
    ctx.translate(x + p.x * scale, y + p.y * scale);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#22262c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    // Ring and the district name.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.stroke();
    textShadowed(districtAt(p.x, p.y).name, x + size / 2, y + size + 20, 13, '#ffffff', 'center', 700);
  }

  function buttonRect(cx, cy, w, h) {
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function drawButton(rect, label, hot) {
    ctx.fillStyle = hot ? '#e8b13c' : 'rgba(255,255,255,0.12)';
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fill();
    ctx.strokeStyle = hot ? '#e8b13c' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 7, 19, hot ? '#1c1a12' : '#ffffff', 'center', 700);
  }

  function titleButtons(hasSave) {
    const cx = view.w / 2;
    const buttons = [
      { id: 'new', ...buttonRect(cx, view.h * 0.62, 300, 48), label: 'New Game' },
    ];
    if (hasSave) buttons.push({ id: 'continue', ...buttonRect(cx, view.h * 0.62 + 60, 300, 48), label: 'Continue' });
    buttons.push({ id: 'help', ...buttonRect(cx, view.h * 0.62 + (hasSave ? 120 : 60), 300, 48), label: 'How to Play' });
    return buttons;
  }

  function pauseButtons() {
    const cx = view.w / 2;
    const cy = view.h / 2;
    return [
      { id: 'resume', ...buttonRect(cx, cy + 10, 280, 46), label: 'Resume' },
      { id: 'save-quit', ...buttonRect(cx, cy + 66, 280, 46), label: 'Save & Quit to Title' },
      { id: 'restart', ...buttonRect(cx, cy + 122, 280, 46), label: 'Restart Story' },
    ];
  }

  function drawTitle(world, ui) {
    // A slow drift over the live city behind the menu.
    drawWorld(world);
    const grad = ctx.createLinearGradient(0, 0, 0, view.h);
    grad.addColorStop(0, 'rgba(10, 14, 22, 0.55)');
    grad.addColorStop(0.55, 'rgba(10, 14, 22, 0.35)');
    grad.addColorStop(1, 'rgba(10, 14, 22, 0.78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, view.w, view.h);
    textShadowed('SOLMAR BAY', view.w / 2, view.h * 0.32, 84, '#ffd94d', 'center', 900);
    textShadowed('an open-world crime story', view.w / 2, view.h * 0.32 + 44, 24, '#ffffff', 'center', 400);
    textShadowed('Steal cars. Outrun the law. Run five jobs for Vera — and own the city.', view.w / 2, view.h * 0.32 + 78, 17, '#e8e4da', 'center');
    const buttons = titleButtons(ui.hasSave);
    for (const b of buttons) drawButton(b, b.label, ui.hover === b.id);
    if (ui.showHelp) {
      const hw = 620;
      const hh = 330;
      panel(view.w / 2 - hw / 2, view.h / 2 - hh / 2, hw, hh, 0.94);
      text('HOW TO PLAY', view.w / 2, view.h / 2 - hh / 2 + 44, 26, '#ffd94d', 'center', 800);
      const lines = [
        'Move / drive: WASD or arrows — Shift sprints on foot, Space is the handbrake',
        'Aim with the mouse, click to shoot — 1 pistol, 2 SMG (buy it at the Gun Shop)',
        'E: get in or out of a car, accept missions, use shops',
        'Purple marker: Vera\'s next job. Yellow: taxi fares. Red: trouble.',
        'Wanted stars bring the police — hide until the heat cools, or pay the Spray Shop',
        'Your progress saves automatically. M mutes, Esc pauses.',
      ];
      lines.forEach((line, i) => text(line, view.w / 2, view.h / 2 - hh / 2 + 88 + i * 32, 16, '#ffffff', 'center'));
      text('Click anywhere or press H to close', view.w / 2, view.h / 2 + hh / 2 - 22, 14, '#e8b13c', 'center');
    } else {
      textShadowed('Enter — New Game · C — Continue · H — How to Play', view.w / 2, view.h - 28, 15, 'rgba(255,255,255,0.8)', 'center');
    }
  }

  function drawPaused(world, ui) {
    drawWorld(world);
    ctx.fillStyle = 'rgba(10, 14, 22, 0.6)';
    ctx.fillRect(0, 0, view.w, view.h);
    textShadowed('PAUSED', view.w / 2, view.h / 2 - 120, 52, '#ffffff', 'center', 900);
    const p = world.player;
    textShadowed(`${formatMoney(p.money)}  ·  Missions ${world.missions.completedCount}/5  ·  ${formatTime(world.time)} played`, view.w / 2, view.h / 2 - 76, 17, '#e8e4da', 'center');
    for (const b of pauseButtons()) drawButton(b, b.label, ui.hover === b.id);
    textShadowed('Esc resumes', view.w / 2, view.h / 2 + 186, 14, 'rgba(255,255,255,0.7)', 'center');
  }

  function drawOver(world, busted) {
    drawWorld(world);
    ctx.fillStyle = busted ? 'rgba(20, 30, 60, 0.72)' : 'rgba(40, 8, 8, 0.72)';
    ctx.fillRect(0, 0, view.w, view.h);
    textShadowed(busted ? 'BUSTED' : 'WASTED', view.w / 2, view.h * 0.42, 76, busted ? '#7fb2ff' : '#ff5a4d', 'center', 900);
    textShadowed(
      busted ? 'The Solmar Bay police took you in. Bail and the impound cost you $200.' : 'Jax went down in the streets of Solmar Bay. The hospital bill is $200.',
      view.w / 2, view.h * 0.42 + 46, 18, '#ffffff', 'center',
    );
    const b = buttonRect(view.w / 2, view.h * 0.58, 300, 48);
    drawButton(b, 'Back on the Street', false);
    textShadowed('Press Enter or click', view.w / 2, view.h * 0.58 + 52, 14, 'rgba(255,255,255,0.7)', 'center');
    return { id: 'respawn', ...b, label: 'Back on the Street' };
  }

  function drawBriefing(world) {
    const m = world.missions.briefing;
    if (!m) return null;
    const bw = 640;
    const bh = 300;
    const x = view.w / 2 - bw / 2;
    const y = view.h / 2 - bh / 2;
    ctx.fillStyle = 'rgba(10, 14, 22, 0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    panel(x, y, bw, bh, 0.95);
    text('NEW MISSION', x + 32, y + 44, 15, '#c58af2', 'left', 800);
    text(m.title, x + 32, y + 84, 34, '#ffffff', 'left', 900);
    text(`Reward: ${formatMoney(m.reward)}`, x + 32, y + 116, 17, '#7dd069', 'left', 700);
    // Wrap the brief to the panel width.
    ctx.font = font(17, 400);
    const words = m.brief.split(' ');
    const lines = [''];
    for (const word of words) {
      const test = lines[lines.length - 1] + (lines[lines.length - 1] ? ' ' : '') + word;
      if (ctx.measureText(test).width > bw - 64) lines.push(word);
      else lines[lines.length - 1] = test;
    }
    lines.forEach((line, i) => text(line, x + 32, y + 152 + i * 26, 17, '#e8e4da', 'left'));
    const accept = { id: 'accept', ...buttonRect(view.w / 2 - 110, y + bh - 44, 200, 44), label: 'Accept (E)' };
    const decline = { id: 'decline', ...buttonRect(view.w / 2 + 110, y + bh - 44, 200, 44), label: 'Not Now (Esc)' };
    drawButton(accept, accept.label, false);
    drawButton(decline, decline.label, false);
    return [accept, decline];
  }

  function drawShop(world) {
    const shop = world.shopOpen;
    if (!shop) return null;
    const items = shop === 'gun'
      ? [
          { id: 'smg', name: 'SMG', desc: 'Full-auto, 90 rounds a minute of argument', price: 450, owned: world.player.hasSmg },
          { id: 'ammo', name: 'SMG Ammo', desc: '+120 rounds', price: 70, owned: false },
          { id: 'armor', name: 'Body Armour', desc: '+50 armour', price: 100, owned: false },
        ]
      : [
          { id: 'respray', name: 'Respray & Repair', desc: 'New paint, new plates — the heat is gone', price: 120, owned: false },
        ];
    const bw = 560;
    const bh = 150 + items.length * 64;
    const x = view.w / 2 - bw / 2;
    const y = view.h / 2 - bh / 2;
    panel(x, y, bw, bh, 0.95);
    text(shop === 'gun' ? 'GUN SHOP' : 'SPRAY SHOP', x + 28, y + 42, 24, '#e8b13c', 'left', 900);
    text(formatMoney(world.player.money), x + bw - 28, y + 42, 22, '#7dd069', 'right', 800);
    const buttons = [];
    items.forEach((item, i) => {
      const iy = y + 70 + i * 64;
      panel(x + 20, iy, bw - 40, 52, 0.5);
      text(item.name, x + 36, iy + 24, 18, '#ffffff', 'left', 700);
      text(item.desc, x + 36, iy + 44, 13, '#c9c2b2', 'left');
      const label = item.owned ? 'OWNED' : formatMoney(item.price);
      const b = { id: item.id, x: x + bw - 140, y: iy + 8, w: 104, h: 36, label };
      drawButton(b, label, false);
      buttons.push(b);
    });
    text('Esc closes', view.w / 2, y + bh - 16, 13, 'rgba(255,255,255,0.7)', 'center');
    return buttons;
  }

  /** Paint one frame: the world, the HUD, then the screen's panels. */
  function draw(world, screen, ui) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#11141b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (screen === SCREEN_TITLE) {
      drawTitle(world, ui);
      return { buttons: titleButtons(ui.hasSave) };
    }
    drawWorld(world);
    if (screen === SCREEN_PLAY) {
      drawHud(world, ui);
      let buttons = [];
      const briefing = drawBriefing(world);
      if (briefing) buttons = briefing;
      const shop = drawShop(world);
      if (shop) buttons = shop;
      return { buttons };
    }
    if (screen === SCREEN_PAUSED) {
      drawPaused(world, ui);
      return { buttons: pauseButtons() };
    }
    if (screen === SCREEN_OVER || screen === SCREEN_BUSTED) {
      const b = drawOver(world, screen === SCREEN_BUSTED);
      return { buttons: [b] };
    }
    drawHud(world, ui);
    return { buttons: [] };
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, screenToWorld, titleButtons, pauseButtons, view };
}
