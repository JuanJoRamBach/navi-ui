// forgotten-animations/deadFairies.ts
//
// RIP. The original Chat Canvas ambient system — drifting orbs, edge
// swirl, dust particles, and a breathing margin-dwelling fairy for
// Research mode. Disabled 2026-08-31 (JuanJo's call, moving toward a
// soberer visual direction) and left commented out in App.tsx ever
// since — never deleted, just never drawn. Relocated here 2026-09-05
// to make room for the real replacement: DeepSeek's grid-walking
// snake-fairies. Kept intact and real (uncommented) rather than as a
// comment block, so it's still genuinely revivable if anyone ever
// wants this exact look back — just isn't wired into anything.
//
// Everything below is data-only / pure functions — no refs, no React —
// so reviving it means owning your own refs and calling these the same
// way App.tsx used to.

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  alpha: number;
  hue: number;
  life: number;
  maxLife: number;
}

export interface Orb {
  x: number; y: number;
  radius: number;
  alpha: number;
  hue: number;
  dx: number; dy: number;
}

// Edge swirl node — a point that travels along the screen perimeter.
export interface SwirlNode {
  t: number;       // 0–1 normalized perimeter position
  speed: number;
  hue: number;
  alpha: number;
  size: number;
}

// The original Research-mode fairy — idle/breathing only, confined to a
// left/right margin band. Renamed Fairy -> DeadFairy (2026-09-05) once
// the new snake-fairies needed the plain "Fairy" name for themselves.
// An "investigate on send/reply" mechanic (converge on the message,
// float, drift to a new spot) was tried across several iterations back
// when this was alive and dropped — too fast, and inherently
// distracting from the chat itself.
export interface DeadFairy {
  side: "left" | "right";
  bandT: number;   // 0–1 across the margin band's width
  bandDx: number;  // signed drift speed, reverses at the band edges
  yT: number;      // 0–1 down the screen height
  yDx: number;
  radius: number;
  alphaBase: number;
  hueJitter: number;
  bobPhase: number;
  flickerSeed: number;
}

export function initOrbs(w: number, h: number, hueBase: number, hueRange: number): Orb[] {
  return Array.from({ length: 7 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    radius: 70 + Math.random() * 130,
    alpha: 0.18 + Math.random() * 0.16, // much brighter — should read as the dominant background glow now
    hue: hueBase + Math.random() * hueRange,
    dx: (Math.random() - 0.5) * 0.3,
    dy: (Math.random() - 0.5) * 0.3,
  }));
}

// 10 fairies, split evenly left/right. Positions are stored as 0–1
// fractions (band position + vertical), not absolute pixels, so they
// never need re-seeding on resize (same fix as the orb-teleport bug).
// bandDx/yDx are the drift speed — 4x the original read as too fast;
// settled at ~1.8x, between imperceptible and rushed.
export function initDeadFairies(): DeadFairy[] {
  return Array.from({ length: 10 }, (_, i) => ({
    side: i % 2 === 0 ? "left" : "right",
    bandT: Math.random(),
    bandDx: (Math.random() - 0.5) * 0.0045,
    yT: Math.random(),
    yDx: (Math.random() - 0.5) * 0.0027,
    radius: 8 + Math.random() * 12,
    alphaBase: 0.6 + Math.random() * 0.3,
    hueJitter: (Math.random() - 0.5) * 16,
    bobPhase: Math.random() * Math.PI * 2,
    flickerSeed: Math.random() * Math.PI * 2,
  }));
}

export function initSwirl(): SwirlNode[] {
  return Array.from({ length: 18 }, (_, i) => ({
    t: i / 18,
    speed: 0.0006 + Math.random() * 0.0008,
    hue: 240 + Math.random() * 60, // blue → purple
    alpha: 0.18 + Math.random() * 0.28,
    size: 8 + Math.random() * 14,
  }));
}

// Convert perimeter t (0–1) to {x, y} — travels clockwise.
export function perimeterPoint(t: number, w: number, h: number): { x: number; y: number } {
  const perim = 2 * (w + h);
  const d = t * perim;
  if (d < w) return { x: d, y: 0 };
  if (d < w + h) return { x: w, y: d - w };
  if (d < 2 * w + h) return { x: w - (d - w - h), y: h };
  return { x: 0, y: h - (d - 2 * w - h) };
}

export function spawnVortexRing(particles: Particle[], cx: number, cy: number, w: number, h: number): void {
  const count = 18 + Math.floor(Math.random() * 12);
  const spawnR = Math.max(w, h) * (0.42 + Math.random() * 0.38);
  const hueBase = 220 + Math.random() * 60; // blue(220) → purple(280)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.35;
    const ox = (Math.random() - 0.5) * 50;
    const oy = (Math.random() - 0.5) * 50;
    const sx = cx + Math.cos(angle) * spawnR + ox;
    const sy = cy + Math.sin(angle) * spawnR + oy;
    const dist = Math.hypot(cx - sx, cy - sy) || 1;
    const speed = 0.6 + Math.random() * 1.2; // slow
    const maxLife = 130 + Math.floor(Math.random() * 90); // longer life = slower feel
    particles.push({
      x: sx, y: sy,
      vx: ((cx - sx) / dist) * speed,
      vy: ((cy - sy) / dist) * speed,
      radius: 3 + Math.random() * 10,
      alpha: 0.14 + Math.random() * 0.18,
      hue: hueBase + Math.random() * 55,
      life: maxLife, maxLife,
    });
  }
}

// The full draw pass, exactly as it last ran before 2026-08-31 —
// orbs+dust+swirl+dead-fairies in "ambient" mode, the converging-particle
// vortex in "vortex" mode. Takes everything it needs as parameters
// rather than closing over refs, so reviving this means owning your own
// state and calling this once per frame with it.
export function drawLegacyAmbient(params: {
  ctx: CanvasRenderingContext2D;
  w: number; h: number; t: number; ft: number;
  mode: "ambient" | "vortex";
  chatMode: string;
  orbs: Orb[]; swirl: SwirlNode[]; particles: Particle[]; deadFairies: DeadFairy[];
  celebrating: boolean;
  themeHueBase: number; themeHueRange: number;
  particleLifeBase: number; particleLifeRange: number;
  particleAlphaBase: number; particleAlphaRange: number;
}): void {
  const {
    ctx, w, h, t, ft, mode, chatMode, orbs, swirl, particles, deadFairies, celebrating,
    themeHueBase, themeHueRange, particleLifeBase, particleLifeRange, particleAlphaBase, particleAlphaRange,
  } = params;
  const cx = w / 2, cy = h / 2;

  if (mode === "vortex") {
    for (const node of swirl) {
      node.t = (node.t + node.speed) % 1;
      const pt = perimeterPoint(node.t, w, h);
      const ex = Math.max(0, Math.min(w, pt.x));
      const ey = Math.max(0, Math.min(h, pt.y));
      const pulseMod = 0.6 + 0.4 * Math.sin(t * 0.04 + node.t * Math.PI * 6);
      const a = node.alpha * pulseMod;
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, node.size);
      g.addColorStop(0, `hsla(${node.hue}, 80%, 65%, ${a})`);
      g.addColorStop(0.5, `hsla(${node.hue + 18}, 75%, 45%, ${a * 0.45})`);
      g.addColorStop(1, `hsla(${node.hue + 36}, 70%, 35%, 0)`);
      ctx.beginPath();
      ctx.arc(ex, ey, node.size, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  if (mode === "ambient") {
    for (const orb of orbs) {
      orb.x += orb.dx; orb.y += orb.dy;
      if (orb.x < -orb.radius) orb.x = w + orb.radius;
      if (orb.x > w + orb.radius) orb.x = -orb.radius;
      if (orb.y < -orb.radius) orb.y = h + orb.radius;
      if (orb.y > h + orb.radius) orb.y = -orb.radius;

      const pulse = 0.5 + 0.5 * Math.sin(t * 0.007 + orb.hue);
      const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
      g.addColorStop(0, `hsla(${orb.hue}, 50%, 55%, ${orb.alpha * (0.8 + 0.4 * pulse)})`);
      g.addColorStop(0.5, `hsla(${orb.hue + 20}, 44%, 40%, ${orb.alpha * 0.38})`);
      g.addColorStop(1, `hsla(${orb.hue + 40}, 36%, 25%, 0)`);
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    if (t % 3 === 0) {
      const spawnPt = perimeterPoint(Math.random(), w, h);
      const ddx = cx - spawnPt.x;
      const ddy = cy - spawnPt.y;
      const ddist = Math.hypot(ddx, ddy) || 1;
      const speed = 0.2 + Math.random() * 0.5;
      const maxLife = particleLifeBase + particleLifeRange;
      particles.push({
        x: spawnPt.x, y: spawnPt.y,
        vx: (ddx / ddist) * speed,
        vy: (ddy / ddist) * speed,
        radius: 1 + Math.random() * 2,
        alpha: particleAlphaBase + Math.random() * particleAlphaRange,
        hue: themeHueBase + Math.random() * themeHueRange,
        life: particleLifeBase + Math.floor(Math.random() * particleLifeRange),
        maxLife,
      });
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      const a = p.alpha * (p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 65%, 72%, ${a})`;
      ctx.fill();
      p.life -= 1;
    }

    if (chatMode === "research") {
      const marginW = w * 0.18;
      const speedMul = celebrating ? 0.4 : 1;
      for (const f of deadFairies) {
        f.bandT += f.bandDx * speedMul;
        if (f.bandT < 0 || f.bandT > 1) { f.bandDx *= -1; f.bandT = Math.max(0, Math.min(1, f.bandT)); }
        f.yT += f.yDx * speedMul;
        if (f.yT < 0 || f.yT > 1) { f.yDx *= -1; f.yT = Math.max(0, Math.min(1, f.yT)); }

        const fx = f.side === "left" ? f.bandT * marginW : w - marginW + f.bandT * marginW;
        const fy = f.yT * h + Math.sin(ft * 0.02 + f.bobPhase) * 6;

        const breathe = 0.5 + 0.5 * Math.sin(ft * 0.006 + f.bobPhase);
        const flicker = 0.88 + 0.12 * Math.sin(ft * 0.03 + f.flickerSeed);
        const breatheWeight = celebrating ? 0.6 : 0.35;
        const a = f.alphaBase * ((1 - breatheWeight) + breatheWeight * breathe) * flicker;
        const radius = celebrating ? f.radius * (1 + 0.3 * breathe) : f.radius;
        const hue = 165 + f.hueJitter;

        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, radius);
        g.addColorStop(0, `hsla(${hue}, 10%, 99%, 0.95)`);
        g.addColorStop(0.13, `hsla(${hue}, 15%, 97%, 0.95)`);
        g.addColorStop(0.55, `hsla(${hue}, 85%, 65%, ${a * 0.85})`);
        g.addColorStop(1, `hsla(${hue}, 80%, 45%, 0)`);
        ctx.beginPath();
        ctx.arc(fx, fy, radius, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  } else {
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (const p of particles) {
      const dist = Math.hypot(cx - p.x, cy - p.y);
      if (dist > 5) {
        const progress = 1 - p.life / p.maxLife;
        const accel = 1 + progress * 1.0;
        p.vx *= Math.min(accel, 1.018);
        p.vy *= Math.min(accel, 1.018);
        p.x += p.vx;
        p.y += p.vy;
      }
      const fadeProx = Math.min(1, dist / 130);
      const fadeLife = p.life / p.maxLife < 0.14 ? (p.life / p.maxLife) / 0.14 : 1;
      const a = p.alpha * fadeProx * fadeLife;

      const hue = 220 + (p.hue - 220);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      g.addColorStop(0, `hsla(${hue}, 85%, 70%, ${a})`);
      g.addColorStop(0.5, `hsla(${hue + 22}, 80%, 50%, ${a * 0.5})`);
      g.addColorStop(1, `hsla(${hue + 44}, 75%, 32%, 0)`);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      p.life -= 1;
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * 0.06);
    const coreRadius = 10 + pulse * 6;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
    cg.addColorStop(0, `rgba(140, 80, 255, ${0.12 + pulse * 0.08})`);
    cg.addColorStop(0.45, `rgba(90, 40, 200, ${0.05 * (0.5 + pulse * 0.5)})`);
    cg.addColorStop(1, "rgba(50, 10, 140, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
  }
}
