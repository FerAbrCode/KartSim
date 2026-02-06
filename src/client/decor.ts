import { randRange, v2, type Vec2 } from "./math";
import { type TrackQuery } from "./track";

export type DecorType = "tree" | "house" | "tires";

export type Decor = {
  type: DecorType;
  pos: Vec2;
  angle: number;
  scale: number;
  colorA: string;
  colorB: string;
};

function seededRng(seed: number): () => number {
  // Mulberry32
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateDecor(trackQ: TrackQuery): Decor[] {
  const rng = seededRng(hashString(trackQ.track.id));
  const out: Decor[] = [];

  const total = trackQ.total;
  const roadHalf = trackQ.track.roadWidth * 0.5;

  const spacing = 220;
  const count = Math.max(18, Math.floor(total / spacing));

  for (let i = 0; i < count; i++) {
    const s = (i / count) * total;
    const sample = trackQ.sampleAtS(s);
    const side = rng() < 0.5 ? -1 : 1;

    const offset = roadHalf + 70 + rng() * 160;
    const pos = v2.add(sample.point, v2.mul(sample.normal, offset * side));

    const r = rng();
    let type: DecorType = "tree";
    if (r < 0.14) type = "house";
    else if (r < 0.28) type = "tires";

    const angle = Math.atan2(sample.tangent.y, sample.tangent.x) + (rng() - 0.5) * 0.6;
    const scale = 0.85 + rng() * 0.5;

    let colorA = "#2f7d2f";
    let colorB = "#1f5a1f";
    if (type === "house") {
      colorA = "#d7c6a2";
      colorB = "#7a4b3a";
    }
    if (type === "tires") {
      colorA = "#1b1f28";
      colorB = "#2a3040";
    }

    out.push({ type, pos, angle, scale, colorA, colorB });
  }

  return out;
}

export function drawDecor(ctx: CanvasRenderingContext2D, decor: readonly Decor[]): void {
  for (const d of decor) {
    ctx.save();
    ctx.translate(d.pos.x, d.pos.y);
    ctx.rotate(d.angle);
    ctx.scale(d.scale, d.scale);

    if (d.type === "tree") drawTree(ctx, d.colorA, d.colorB);
    else if (d.type === "house") drawHouse(ctx, d.colorA, d.colorB);
    else drawTires(ctx, d.colorA, d.colorB);

    ctx.restore();
  }
}

function drawTree(ctx: CanvasRenderingContext2D, leaf: string, trunk: string): void {
  ctx.globalAlpha = 0.95;
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 18, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // trunk
  ctx.fillStyle = trunk;
  ctx.fillRect(-4, 0, 8, 18);

  // leaves
  ctx.fillStyle = leaf;
  ctx.beginPath();
  ctx.arc(0, -2, 16, 0, Math.PI * 2);
  ctx.arc(-10, 4, 12, 0, Math.PI * 2);
  ctx.arc(10, 4, 12, 0, Math.PI * 2);
  ctx.fill();
}

function drawHouse(ctx: CanvasRenderingContext2D, wall: string, roof: string): void {
  ctx.globalAlpha = 0.95;
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 26, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // walls
  ctx.fillStyle = wall;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-18, -6, 36, 26);
  ctx.fill();
  ctx.stroke();

  // roof
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(-22, -6);
  ctx.lineTo(0, -22);
  ctx.lineTo(22, -6);
  ctx.closePath();
  ctx.fill();
}

function drawTires(ctx: CanvasRenderingContext2D, a: string, b: string): void {
  ctx.globalAlpha = 0.95;
  const stack = 3;
  for (let i = 0; i < stack; i++) {
    const y = i * 8;
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.beginPath();
    ctx.roundRect(-14, y, 28, 7, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.stroke();
  }
}

export function drawGrassDetails(ctx: CanvasRenderingContext2D, worldMin: Vec2, worldMax: Vec2): void {
  // lightweight procedural dots/flowers; deterministic-ish by grid
  const cell = 90;
  const minX = Math.floor(worldMin.x / cell) * cell;
  const minY = Math.floor(worldMin.y / cell) * cell;

  for (let y = minY; y <= worldMax.y; y += cell) {
    for (let x = minX; x <= worldMax.x; x += cell) {
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const r = (h % 1000) / 1000;
      const dx = ((h >>> 10) % 1000) / 1000;
      const dy = ((h >>> 20) % 1000) / 1000;
      const px = x + dx * cell;
      const py = y + dy * cell;

      // small blades
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = r < 0.5 ? "#2f7f32" : "#2a6f2c";
      ctx.beginPath();
      ctx.arc(px, py, 8 + r * 10, 0, Math.PI * 2);
      ctx.fill();

      // occasional flowers
      if (r > 0.92) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#ffd066";
        ctx.beginPath();
        ctx.arc(px + 6, py - 4, 3, 0, Math.PI * 2);
        ctx.arc(px - 5, py + 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.globalAlpha = 1;
}
