import { clamp, randRange, v2, type Vec2 } from "./math";
import { type Input } from "./input";
import { type Kart, type KartControls, faceTowards } from "./kart";
import { type TrackQuery } from "./track";

export class BotController {
  private wobbleT = randRange(0, 10);
  private aggression = randRange(0.92, 1.02);

  update(kart: Kart, track: TrackQuery, dt: number): KartControls {
    this.wobbleT += dt;

    const near = track.nearest(kart.pos);

    // aim a little ahead along the centerline
    const lookAhead = 120 + clamp(v2.len(kart.vel) * 0.35, 0, 240);
    const target = track.sampleAtS(near.s + lookAhead).point;

    // also bias back toward center when drifting out
    const centerBias = clamp(near.distToCenter / (track.track.roadWidth * 0.5), 0, 1);
    const toTarget = v2.sub(target, kart.pos);

    // wobble so bots don't stack perfectly
    const wobble = Math.sin(this.wobbleT * 1.3) * 0.15;

    const desiredAngle = Math.atan2(toTarget.y, toTarget.x);
    const diff = faceTowards(kart.angle, desiredAngle);

    let steer = clamp(diff * 0.85 + wobble, -1, 1);

    // If far off centerline, steer back in harder
    if (centerBias > 0.6) {
      steer = clamp(steer * (1 + centerBias * 0.55), -1, 1);
    }

    // target speed
    const speed = v2.len(kart.vel);
    const targetSpeed = (410 * this.aggression) * (1 - centerBias * 0.25);

    let throttle = 0;
    if (speed < targetSpeed - 20) throttle = 1;
    else if (speed > targetSpeed + 40) throttle = -0.25;

    // drift in sharper turns when moving fast
    const turningHard = Math.abs(diff) > 0.55;
    const driftHeld = turningHard && speed > 260;

    return {
      throttle,
      steer,
      jumpTap: false,
      driftHeld,
    };
  }
}

export function readPlayerControls(input: Input, nowMs: number): KartControls {
  const throttle = (input.isDown("KeyW") ? 1 : 0) + (input.isDown("KeyS") ? -1 : 0);
  const steer = (input.isDown("KeyD") ? 1 : 0) + (input.isDown("KeyA") ? -1 : 0);

  const spaceHeldMs = input.heldMs("Space", nowMs);
  const spaceDown = input.isDown("Space");
  const jumpTap = input.wasPressed("Space");
  const driftHeld = spaceDown && spaceHeldMs > 160;

  return {
    throttle: clamp(throttle, -1, 1),
    steer: clamp(steer, -1, 1),
    jumpTap,
    driftHeld,
  };
}
