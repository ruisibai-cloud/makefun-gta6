// Combat: bullets and what they hit, the pickups scattered around the city,
// car explosions, and the armed rivals missions send after the player.
import { dist2 } from './utils.js';
import { carCircles } from './vehicles.js';

export class Combat {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.bullets = [];
    this.pickups = [];
    this.enemies = [];
  }

  shoot(x, y, angle, spec, owner) {
    this.bullets.push({
      x, y,
      vx: Math.cos(angle) * spec.bulletSpeed,
      vy: Math.sin(angle) * spec.bulletSpeed,
      damage: spec.damage,
      owner,
      life: spec.range / spec.bulletSpeed,
    });
  }

  spawnPickup(x, y, kind, amount) {
    this.pickups.push({ x, y, kind, amount, bob: this.rng.range(0, Math.PI * 2) });
  }

  spawnEnemy(x, y, health) {
    const enemy = {
      x, y, angle: 0,
      health: health || 60,
      fireTimer: this.rng.range(0.4, 1.2),
      speed: 150,
      dead: false,
      down: 0,
      shirt: '#3a3f46',
      pants: '#22262c',
    };
    this.enemies.push(enemy);
    return enemy;
  }

  explode(x, y, world) {
    world.particles.explosion(x, y);
    world.audio.explosion();
    world.camera.shake = Math.min(26, world.camera.shake + 18);
    const radius = 150;
    for (const car of world.allCars()) {
      if (car.dead) continue;
      if (dist2(x, y, car.x, car.y) < radius * radius) {
        car.health -= 70;
        if (car.health <= 0) world.destroyCar(car, 'explosion');
      }
    }
    for (const ped of world.peds.list) {
      if (!ped.dead && dist2(x, y, ped.x, ped.y) < radius * radius) {
        ped.dead = true;
        ped.down = 0;
        world.onPedKilled(ped, false);
      }
    }
    const player = world.player;
    if (player.alive && dist2(x, y, player.x, player.y) < radius * radius) {
      player.takeDamage(45);
    }
    for (const enemy of this.enemies) {
      if (!enemy.dead && dist2(x, y, enemy.x, enemy.y) < radius * radius) {
        enemy.health -= 90;
        if (enemy.health <= 0) this.killEnemy(enemy, world);
      }
    }
  }

  killEnemy(enemy, world) {
    enemy.dead = true;
    enemy.down = 0;
    world.missions.onEnemyKilled(enemy);
    if (this.rng.chance(0.5)) this.spawnPickup(enemy.x, enemy.y, 'cash', this.rng.int(20, 60));
  }

  update(dt, world) {
    const player = world.player;

    // Bullets fly, then hit a wall, a car, a person, or nothing.
    for (const bullet of this.bullets) {
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.life <= 0) continue;
      if (this.city.blocked(bullet.x, bullet.y, 2)) {
        bullet.life = 0;
        world.particles.sparks(bullet.x, bullet.y, 3);
        continue;
      }
      let hit = false;
      for (const car of world.allCars()) {
        if (car.dead) continue;
        if (bullet.owner === 'player' && car.driver === 'player') continue;
        for (const c of carCircles(car)) {
          if (dist2(bullet.x, bullet.y, c.x, c.y) < c.r * c.r) {
            car.health -= bullet.damage;
            world.particles.sparks(bullet.x, bullet.y, 4);
            if (car.health <= 0) world.destroyCar(car, 'shot');
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) {
        bullet.life = 0;
        continue;
      }
      if (bullet.owner === 'player' || bullet.owner === 'police') {
        for (const ped of world.peds.list) {
          if (ped.dead) continue;
          if (dist2(bullet.x, bullet.y, ped.x, ped.y) < 16 * 16) {
            ped.dead = true;
            ped.down = 0;
            world.onPedKilled(ped, bullet.owner === 'player');
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        bullet.life = 0;
        continue;
      }
      if (bullet.owner === 'player') {
        for (const enemy of this.enemies) {
          if (enemy.dead) continue;
          if (dist2(bullet.x, bullet.y, enemy.x, enemy.y) < 17 * 17) {
            enemy.health -= bullet.damage;
            world.particles.sparks(bullet.x, bullet.y, 3);
            if (enemy.health <= 0) this.killEnemy(enemy, world);
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        bullet.life = 0;
        continue;
      }
      if ((bullet.owner === 'police' || bullet.owner === 'enemy') && player.alive && !player.inCar) {
        if (dist2(bullet.x, bullet.y, player.x, player.y) < 15 * 15) {
          player.takeDamage(bullet.damage);
          world.particles.sparks(bullet.x, bullet.y, 3);
          bullet.life = 0;
          continue;
        }
      }
      if ((bullet.owner === 'police' || bullet.owner === 'enemy') && player.alive && player.inCar && player.car) {
        // Shots at a driven car chip its health instead of the driver's.
        for (const c of carCircles(player.car)) {
          if (dist2(bullet.x, bullet.y, c.x, c.y) < c.r * c.r) {
            player.car.health -= bullet.damage * 0.5;
            if (player.car.health <= 0) world.destroyCar(player.car, 'shot');
            bullet.life = 0;
            break;
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    // Pickups bob, and the player collects them by walking over them.
    for (const pickup of this.pickups) {
      pickup.bob += dt * 3;
      if (!player.alive || player.inCar) continue;
      if (dist2(pickup.x, pickup.y, player.x, player.y) > 28 * 28) continue;
      pickup.taken = true;
      if (pickup.kind === 'cash') {
        player.earn(pickup.amount);
        world.message(`+$${pickup.amount}`, '#7dd069');
      } else if (pickup.kind === 'health') {
        player.heal(pickup.amount);
        world.message(`Health +${pickup.amount}`, '#7dd069');
      } else if (pickup.kind === 'armor') {
        player.addArmor(pickup.amount);
        world.message(`Armor +${pickup.amount}`, '#4fc3f7');
      } else if (pickup.kind === 'ammo') {
        player.ammo.smg += pickup.amount;
        world.message(`SMG ammo +${pickup.amount}`, '#e8b13c');
      }
      world.audio.pickup();
    }
    this.pickups = this.pickups.filter((p) => !p.taken);

    // Mission rivals: close in and shoot when the player is near.
    for (const enemy of this.enemies) {
      if (enemy.dead) {
        enemy.down += dt;
        continue;
      }
      const d2 = dist2(enemy.x, enemy.y, player.x, player.y);
      if (!player.alive) continue;
      enemy.angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      if (d2 > 260 * 260 && d2 < 900 * 900) {
        const d = Math.sqrt(d2);
        const nx = enemy.x + ((player.x - enemy.x) / d) * enemy.speed * dt;
        const ny = enemy.y + ((player.y - enemy.y) / d) * enemy.speed * dt;
        if (!this.city.blocked(nx, enemy.y, 12)) enemy.x = nx;
        if (!this.city.blocked(enemy.x, ny, 12)) enemy.y = ny;
      }
      enemy.fireTimer -= dt;
      if (d2 < 480 * 480 && enemy.fireTimer <= 0) {
        enemy.fireTimer = this.rng.range(0.8, 1.6);
        const spread = (Math.random() - 0.5) * 0.3;
        this.shoot(enemy.x, enemy.y, enemy.angle + spread, { damage: 7, bulletSpeed: 950, range: 520 }, 'enemy');
        world.audio.gunshot(true);
      }
    }
    this.enemies = this.enemies.filter((e) => !(e.dead && e.down > 20));
  }
}
