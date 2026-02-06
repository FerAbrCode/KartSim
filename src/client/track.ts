import { clamp, v2, type Vec2 } from "./math";

export type Track = {
  id: string;
  name: string;
  // closed loop control points in world coords
  center: Vec2[];
  roadWidth: number;
  // Used for rendering/background
  grassColor: string;
  roadColor: string;
  borderColor: string;
};

export type TrackSample = {
  s: number; // distance along track [0, total)
  total: number;
  point: Vec2;
  tangent: Vec2;
  normal: Vec2;
  distToCenter: number;
};

type SegInfo = {
  a: Vec2;
  b: Vec2;
  ab: Vec2;
  len: number;
  s0: number;
};

export class TrackQuery {
  readonly track: Track;
  readonly total: number;
  private readonly segs: SegInfo[];
  private readonly polyline: Vec2[];

  constructor(track: Track) {
    if (track.center.length < 3) throw new Error("Track needs >= 3 points");
    this.track = track;

    // Smooth and resample so curves are softer and distance queries are stable.
    const smoothed = chaikinClosed(track.center, 2);
    const resampled = resampleClosed(smoothed, 60);
    this.polyline = resampled;

    const pts = this.polyline;
    const segs: SegInfo[] = [];
    let s0 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ab = v2.sub(b, a);
      const len = v2.len(ab);
      segs.push({ a, b, ab, len, s0 });
      s0 += len;
    }
    this.segs = segs;
    this.total = s0;
  }

  getPolyline(): readonly Vec2[] {
    return this.polyline;
  }

  sampleAtS(s: number): { point: Vec2; tangent: Vec2; normal: Vec2 } {
    const ss = ((s % this.total) + this.total) % this.total;

    for (const seg of this.segs) {
      if (ss >= seg.s0 && ss <= seg.s0 + seg.len) {
        const t = seg.len <= 1e-6 ? 0 : (ss - seg.s0) / seg.len;
        const point = v2.add(seg.a, v2.mul(seg.ab, t));
        const tangent = seg.len <= 1e-6 ? v2.make(1, 0) : v2.norm(seg.ab);
        const normal = v2.perp(tangent);
        return { point, tangent, normal };
      }
    }

    // fallback
    const first = this.segs[0];
    const tangent = first.len <= 1e-6 ? v2.make(1, 0) : v2.norm(first.ab);
    return { point: first.a, tangent, normal: v2.perp(tangent) };
  }

  nearest(pos: Vec2): TrackSample {
    let bestDistSq = Number.POSITIVE_INFINITY;
    let best: { s: number; point: Vec2; tangent: Vec2; normal: Vec2 } | null =
      null;

    for (const seg of this.segs) {
      const ap = v2.sub(pos, seg.a);
      const t = seg.len <= 1e-6 ? 0 : clamp(v2.dot(ap, seg.ab) / (seg.len * seg.len), 0, 1);
      const point = v2.add(seg.a, v2.mul(seg.ab, t));
      const d = v2.sub(pos, point);
      const distSq = v2.lenSq(d);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        const s = seg.s0 + t * seg.len;
        const tangent = seg.len <= 1e-6 ? v2.make(1, 0) : v2.norm(seg.ab);
        const normal = v2.perp(tangent);
        best = { s, point, tangent, normal };
      }
    }

    if (!best) {
      const s0 = 0;
      const { point, tangent, normal } = this.sampleAtS(s0);
      return {
        s: s0,
        total: this.total,
        point,
        tangent,
        normal,
        distToCenter: v2.len(v2.sub(pos, point)),
      };
    }

    return {
      s: best.s,
      total: this.total,
      point: best.point,
      tangent: best.tangent,
      normal: best.normal,
      distToCenter: Math.sqrt(bestDistSq),
    };
  }
}

export function createTracks(): Track[] {
  // All tracks are designed around world scale ~ 2000x1400
  const t1: Track = {
    id: "meadow",
    name: "Meadow Ring",
    center: [
      { x: -700, y: -250 },
      { x: -350, y: -520 },
      { x: 80, y: -560 },
      { x: 520, y: -380 },
      { x: 720, y: 0 },
      { x: 580, y: 420 },
      { x: 160, y: 560 },
      { x: -260, y: 480 },
      { x: -620, y: 220 },
    ],
    roadWidth: 170,
    grassColor: "#1b4a20",
    roadColor: "#405061",
    borderColor: "rgba(255,255,255,0.18)",
  };

  const t2: Track = {
    id: "city",
    name: "Neon Blocks",
    center: [
      { x: -820, y: -420 },
      { x: -200, y: -520 },
      { x: 420, y: -520 },
      { x: 820, y: -220 },
      { x: 820, y: 280 },
      { x: 420, y: 560 },
      { x: -220, y: 520 },
      { x: -820, y: 320 },
    ],
    roadWidth: 160,
    grassColor: "#0a1426",
    roadColor: "#2a2f44",
    borderColor: "rgba(124,219,124,0.22)",
  };

  const t3: Track = {
    id: "canyon",
    name: "Canyon Curves",
    center: [
      { x: -760, y: -120 },
      { x: -520, y: -520 },
      { x: -40, y: -600 },
      { x: 420, y: -460 },
      { x: 680, y: -120 },
      { x: 620, y: 260 },
      { x: 320, y: 560 },
      { x: -120, y: 620 },
      { x: -520, y: 420 },
      { x: -720, y: 140 },
    ],
    roadWidth: 150,
    grassColor: "#3a2a1e",
    roadColor: "#4b3f39",
    borderColor: "rgba(255,255,255,0.16)",
  };

  return [t1, t2, t3];
}

function chaikinClosed(points: Vec2[], iterations: number): Vec2[] {
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      // Q = 0.75A + 0.25B, R = 0.25A + 0.75B
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

function resampleClosed(points: Vec2[], step: number): Vec2[] {
  // Build cumulative distances
  const pts = points.slice();
  const dists: number[] = [0];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += v2.len(v2.sub(b, a));
    dists.push(total);
  }

  const out: Vec2[] = [];
  const count = Math.max(32, Math.floor(total / step));
  for (let i = 0; i < count; i++) {
    const s = (i / count) * total;
    out.push(sampleOnClosedPolyline(pts, dists, s));
  }
  return out;
}

function sampleOnClosedPolyline(pts: Vec2[], dists: number[], s: number): Vec2 {
  const total = dists[dists.length - 1] ?? 1;
  const ss = ((s % total) + total) % total;

  // find segment
  for (let i = 0; i < pts.length; i++) {
    const s0 = dists[i] ?? 0;
    const s1 = dists[i + 1] ?? total;
    if (ss >= s0 && ss <= s1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.max(1e-6, s1 - s0);
      const t = (ss - s0) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return { ...pts[0] };
}
