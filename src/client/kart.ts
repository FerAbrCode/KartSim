import { angDiff, clamp, v2, wrapAngle, type Vec2 } from "./math";
import { type TrackQuery } from "./track";

export type KartTuning = {
  accel: number;
  brake: number;
  maxSpeed: number;
  maxReverse: number;
  steerAtSpeed: (speed: number) => number; // radians/sec at current speed
  grip: number; // higher = more traction
  driftGrip: number; // lower = more slide
  driftSteerMult: number;
  offRoadFriction: number;
  boostSpeed: number;
};

export const DEFAULT_TUNING: KartTuning = {
  accel: 410,
  brake: 560,
  maxSpeed: 340,
  maxReverse: 185,
  steerAtSpeed: (speed) => {
    const s = Math.min(1, Math.abs(speed) / 420);
    // steer a bit less at very high speed
    return (1.8 - 0.55 * s) * (speed < 0 ? 0.7 : 1);
  },
  grip: 12.5,
  driftGrip: 6.0,
  driftSteerMult: 1.35,
  offRoadFriction: 3.2,
  boostSpeed: 85,
};

export type KartControls = {
  throttle: number; // [-1..1]
  steer: number; // [-1..1]
  jumpTap: boolean;
  driftHeld: boolean;
};

export type Kart = {
  id: string;
  name: string;
  flag: string;
  color: string;

  pos: Vec2;
  vel: Vec2;
  angle: number;

  // race
  lap: number; // 0..laps
  finished: boolean;
  finishTimeMs: number | null;

  // drift/jump state
  hopT: number;
  drifting: boolean;
  driftT: number;
  driftDir: -1 | 0 | 1;
  boostT: number;

  lastS: number;
  passedHalf: boolean;

  // robust lap-crossing
  prevStartD: number;
  prevMidD: number;

  // crashes / weapons
  crashCount: number;
  lastCrashMs: number;
  onFire: boolean;
  lastShotMs: number;
  nextShotMs: number;
};

export function createKart(params: {
  id: string;
  name: string;
  flag: string;
  color: string;
  spawnPos: Vec2;
  spawnAngle: number;
}): Kart {
  return {
    id: params.id,
    name: params.name,
    flag: params.flag,
    color: params.color,
    pos: { ...params.spawnPos },
    vel: v2.make(0, 0),
    angle: params.spawnAngle,
    lap: 0,
    finished: false,
    finishTimeMs: null,
    hopT: 0,
    drifting: false,
    driftT: 0,
    driftDir: 0,
    boostT: 0,
    lastS: 0,
    passedHalf: false,
    prevStartD: 0,
    prevMidD: 0,

    crashCount: 0,
    lastCrashMs: -1e9,
    onFire: false,
    lastShotMs: -1e9,
    nextShotMs: 0,
  };
}

export function updateKart(
  kart: Kart,
  controls: KartControls,
  tuning: KartTuning,
  track: TrackQuery,
  dt: number,
  nowMs: number,
  lapsToFinish: number,
): void {
  if (kart.finished) return;

  const nearBefore = track.nearest(kart.pos);

  // Determine forward/right vectors
  const forward = v2.make(Math.cos(kart.angle), Math.sin(kart.angle));
  const right = v2.perp(forward);

  // Jump tap gives a short hop (mostly cosmetic, but helps start drift)
  if (controls.jumpTap && kart.hopT <= 0) {
    kart.hopT = 0.18;
    // small upward impulse: slight speed bump
    kart.vel = v2.add(kart.vel, v2.mul(forward, 16));
  }
  kart.hopT = Math.max(0, kart.hopT - dt);

  // drift state
  const speedForward = v2.dot(kart.vel, forward);
  const wantsDrift = controls.driftHeld && Math.abs(speedForward) > 90;

  if (wantsDrift) {
    if (!kart.drifting) {
      kart.drifting = true;
      kart.driftT = 0;
      kart.driftDir = controls.steer < -0.15 ? -1 : controls.steer > 0.15 ? 1 : 0;
    }
  } else if (kart.drifting) {
    // drift release => boost if drifted long enough
    if (kart.driftT > 0.85) {
      kart.boostT = 0.45;
    }
    kart.drifting = false;
    kart.driftT = 0;
    kart.driftDir = 0;
  }

  if (kart.drifting) {
    kart.driftT += dt;
    if (kart.driftDir === 0) {
      kart.driftDir = controls.steer < -0.15 ? -1 : controls.steer > 0.15 ? 1 : 0;
    }
  }

  // steering
  const steerBase = tuning.steerAtSpeed(speedForward);
  const steerMult = kart.drifting ? tuning.driftSteerMult : 1;
  const steer = controls.steer * steerBase * steerMult;
  kart.angle = wrapAngle(kart.angle + steer * dt);

  // acceleration / braking
  const throttle = clamp(controls.throttle, -1, 1);
  if (throttle > 0.01) {
    kart.vel = v2.add(kart.vel, v2.mul(forward, tuning.accel * throttle * dt));
  } else if (throttle < -0.01) {
    kart.vel = v2.add(kart.vel, v2.mul(forward, tuning.brake * throttle * dt));
  }

  // boost
  if (kart.boostT > 0) {
    kart.boostT = Math.max(0, kart.boostT - dt);
    kart.vel = v2.add(kart.vel, v2.mul(forward, tuning.boostSpeed * dt));
  }

  // traction model: decompose velocity into forward+side
  const vF = v2.dot(kart.vel, forward);
  const vS = v2.dot(kart.vel, right);

  const grip = kart.drifting ? tuning.driftGrip : tuning.grip;
  const sideKill = clamp(grip * dt, 0, 1);
  const newVS = vS * (1 - sideKill);

  // mild rolling resistance
  const roll = clamp(0.7 * dt, 0, 1);
  const newVF = vF * (1 - roll);

  // drifting should cost a little speed, but not too harsh
  const driftSlow = kart.drifting ? clamp(0.9 * dt, 0, 0.05) : 0;
  const driftVF = newVF * (1 - driftSlow);

  kart.vel = v2.add(v2.mul(forward, driftVF), v2.mul(right, newVS));

  // speed caps
  const cappedVF = clamp(v2.dot(kart.vel, forward), -tuning.maxReverse, tuning.maxSpeed);
  const vfDelta = cappedVF - v2.dot(kart.vel, forward);
  kart.vel = v2.add(kart.vel, v2.mul(forward, vfDelta));

  // while drifting, cap forward speed to ~70% max
  if (kart.drifting) {
    const vf = v2.dot(kart.vel, forward);
    const ramp = clamp(kart.driftT / 0.6, 0, 1);
    const cap = tuning.maxSpeed * (1 - 0.3 * ramp);
    if (vf > cap) {
      kart.vel = v2.sub(kart.vel, v2.mul(forward, vf - cap));
    }
  }

  // off-road slows you down harder
  const near = track.nearest(kart.pos);
  const onRoad = near.distToCenter <= track.track.roadWidth * 0.5;
  if (!onRoad) {
    const fric = clamp(tuning.offRoadFriction * dt, 0, 1);
    kart.vel = v2.mul(kart.vel, 1 - fric);
  }

  // integrate
  kart.pos = v2.add(kart.pos, v2.mul(kart.vel, dt));

  // Impassable walls: clamp back inside the road boundary.
  const wallMargin = 10;
  const maxDist = track.track.roadWidth * 0.5 - wallMargin;
  // Clamp relative to the pre-step segment to avoid snapping to a different segment.
  const signedDist = v2.dot(v2.sub(kart.pos, nearBefore.point), nearBefore.normal);
  if (Math.abs(signedDist) > maxDist) {
    const side = Math.sign(signedDist) || 1;
    const outward = v2.mul(nearBefore.normal, side);
    kart.pos = v2.sub(kart.pos, v2.mul(outward, Math.abs(signedDist) - maxDist));

    // Remove outward velocity + small bounce back
    const outV = v2.dot(kart.vel, outward);
    const impact = Math.max(0, outV);
    if (outV > 0) {
      kart.vel = v2.sub(kart.vel, v2.mul(outward, outV * 1.15));
    }
    kart.vel = v2.mul(kart.vel, 0.92);

    // Crash counter (hard impacts only; cooldown to avoid multi-counting while sliding)
    if (impact > 135 && nowMs - kart.lastCrashMs > 420) {
      kart.lastCrashMs = nowMs;
      kart.crashCount += 1;
      if (kart.crashCount >= 3) kart.onFire = true;
    }
  }

  const nearAfter = track.nearest(kart.pos);

  // Lap counting: must traverse the track and pass the mid-point before a start-line wrap counts.
  const s = nearAfter.s;
  const total = nearAfter.total;
  const midS = total * 0.5;

  const roadHalf = track.track.roadWidth * 0.5;
  const onRoadEnough = nearAfter.distToCenter < roadHalf * 0.95;
  const speedAlong = v2.dot(kart.vel, nearAfter.tangent);

  // Become eligible after crossing midS in the forward direction (no wrap for this check).
  if (!kart.passedHalf && speedAlong > 8 && onRoadEnough) {
    const prevS = kart.lastS;
    if (prevS <= s) {
      if (prevS < midS && s >= midS) kart.passedHalf = true;
    } else {
      // wrapped; midS won't be crossed during a wrap at s~0
    }
  }

  const wrappedStart = kart.lastS > total * 0.85 && s < total * 0.15;
  const crossedStart = wrappedStart && speedAlong > 8 && onRoadEnough;

  if (crossedStart && kart.passedHalf) {
    kart.lap += 1;
    kart.passedHalf = false;
    if (kart.lap >= lapsToFinish) {
      kart.finished = true;
      kart.finishTimeMs = nowMs;
    }
  }

  kart.lastS = s;
}

export function estimateRaceOrderKey(kart: Kart, track: TrackQuery, lapsToFinish: number): number {
  const near = track.nearest(kart.pos);
  const lapClamped = Math.min(kart.lap, lapsToFinish);
  const progress = lapClamped * near.total + near.s;
  return progress;
}

export function faceTowards(kartAngle: number, desiredAngle: number): number {
  return angDiff(desiredAngle, kartAngle);
}
