export type Vec2 = { x: number; y: number };

export const v2 = {
  make(x = 0, y = 0): Vec2 {
    return { x, y };
  },
  add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
  },
  sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
  },
  mul(a: Vec2, s: number): Vec2 {
    return { x: a.x * s, y: a.y * s };
  },
  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  },
  len(a: Vec2): number {
    return Math.hypot(a.x, a.y);
  },
  lenSq(a: Vec2): number {
    return a.x * a.x + a.y * a.y;
  },
  norm(a: Vec2): Vec2 {
    const l = Math.hypot(a.x, a.y);
    if (l <= 1e-9) return { x: 0, y: 0 };
    return { x: a.x / l, y: a.y / l };
  },
  perp(a: Vec2): Vec2 {
    return { x: -a.y, y: a.x };
  },
  rot(a: Vec2, radians: number): Vec2 {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
  },
  clampLen(a: Vec2, maxLen: number): Vec2 {
    const l = Math.hypot(a.x, a.y);
    if (l <= maxLen) return a;
    if (l <= 1e-9) return { x: 0, y: 0 };
    const s = maxLen / l;
    return { x: a.x * s, y: a.y * s };
  },
};

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(radians: number): number {
  // wrap to [-pi, pi)
  const twoPi = Math.PI * 2;
  let r = ((radians + Math.PI) % twoPi + twoPi) % twoPi;
  r -= Math.PI;
  return r;
}

export function angDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
