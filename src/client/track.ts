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
      { x: -1040, y: -140 },
      { x: -920, y: -520 },
      { x: -560, y: -760 },
      { x: -120, y: -820 },
      { x: 300, y: -720 },
      { x: 640, y: -440 },
      { x: 860, y: -80 },
      { x: 820, y: 300 },
      { x: 560, y: 600 },
      { x: 180, y: 720 },
      { x: -220, y: 680 },
      { x: -560, y: 460 },
      { x: -820, y: 160 },
      { x: -860, y: -40 },
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
      { x: -980, y: -520 },
      { x: -420, y: -660 },
      { x: 120, y: -660 },
      { x: 620, y: -540 },
      { x: 940, y: -240 },
      { x: 1000, y: 120 },
      { x: 820, y: 420 },
      { x: 460, y: 660 },
      { x: 40, y: 740 },
      { x: -360, y: 680 },
      { x: -740, y: 460 },
      { x: -960, y: 140 },
      { x: -900, y: -180 },
      { x: -660, y: -360 },
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
      { x: -1120, y: -60 },
      { x: -920, y: -540 },
      { x: -520, y: -840 },
      { x: -40, y: -900 },
      { x: 380, y: -800 },
      { x: 680, y: -540 },
      { x: 820, y: -220 },
      { x: 760, y: 140 },
      { x: 560, y: 460 },
      { x: 240, y: 700 },
      { x: -120, y: 820 },
      { x: -520, y: 780 },
      { x: -840, y: 560 },
      { x: -980, y: 240 },
      { x: -980, y: 20 },
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
