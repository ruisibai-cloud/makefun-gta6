// Particles: smoke, sparks, muzzle flashes, explosion debris and the tyre
// marks a sliding car leaves behind. All cheap circles and short lines.
export class Particles {
  constructor() {
    this.list = [];
    this.skids = [];
  }

  clear() {
    this.list.length = 0;
    this.skids.length = 0;
  }

  add(p) {
    if (this.list.length > 420) this.list.shift();
    this.list.push(p);
  }

  smoke(x, y, big) {
    const n = big ? 5 : 2;
    for (let i = 0; i < n; i += 1) {
      this.add({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * 14,
        y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 30,
        life: 0.9 + Math.random() * 0.7,
        maxLife: 1.6,
        size: (big ? 14 : 9) + Math.random() * 8,
        color: '#55565a',
      });
    }
  }

  sparks(x, y, n) {
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 220;
      this.add({
        kind: 'spark',
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.25 + Math.random() * 0.25,
        maxLife: 0.5,
        size: 2 + Math.random() * 2,
        color: Math.random() < 0.5 ? '#ffd94d' : '#ff9a3c',
      });
    }
  }

  muzzle(x, y, angle) {
    this.add({
      kind: 'flash',
      x: x + Math.cos(angle) * 10,
      y: y + Math.sin(angle) * 10,
      vx: Math.cos(angle) * 60,
      vy: Math.sin(angle) * 60,
      life: 0.07,
      maxLife: 0.07,
      size: 12,
      color: '#ffe27a',
    });
  }

  explosion(x, y) {
    this.add({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.18, maxLife: 0.18, size: 70, color: '#ffdf6b' });
    this.add({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.3, maxLife: 0.3, size: 44, color: '#ff8a3c' });
    for (let i = 0; i < 22; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 320;
      this.add({
        kind: 'debris',
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.7,
        maxLife: 1.2,
        size: 3 + Math.random() * 5,
        color: ['#ff9a3c', '#ff5a3c', '#3a3f46', '#ffd94d'][Math.floor(Math.random() * 4)],
      });
    }
    this.smoke(x, y, true);
    this.smoke(x, y, true);
  }

  addSkid(x, y, angle) {
    if (this.skids.length > 260) this.skids.shift();
    const last = this.skids[this.skids.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 14) return;
    this.skids.push({ x, y, angle, life: 6 });
  }

  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
      if (p.kind === 'smoke') p.size += 14 * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
    for (const s of this.skids) s.life -= dt;
    this.skids = this.skids.filter((s) => s.life > 0);
  }

  draw(ctx) {
    for (const s of this.skids) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.globalAlpha = Math.min(0.5, s.life * 0.12);
      ctx.fillStyle = '#1c1e22';
      ctx.fillRect(-9, -13, 18, 5);
      ctx.fillRect(-9, 8, 18, 5);
      ctx.restore();
    }
    for (const p of this.list) {
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = p.kind === 'smoke' ? t * 0.5 : t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.kind === 'flash' ? t : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
