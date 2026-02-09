import { Input } from "./input";
import { BotController, readPlayerControls } from "./bot";
import {
  DEFAULT_TUNING,
  createKart,
  estimateRaceOrderKey,
  type Kart,
  type KartControls,
  updateKart,
} from "./kart";
import { clamp, randRange, v2, type Vec2 } from "./math";
import { TrackQuery, createTracks, type Track } from "./track";
import { type LeaderboardEntry, type MenuSelection, UI } from "./ui";
import { drawDecor, drawGrassDetails, generateDecor, type Decor } from "./decor";
import { AudioManager } from "./audio";
import { FlagIconCache } from "./flags";

const LAPS_TOTAL = 3;
const PLAYERS_TOTAL = 5;

type Phase = "menu" | "racing" | "results";

type Camera = { pos: Vec2; zoom: number };

type Skid = { a: Vec2; b: Vec2; life: number; color: string; w: number };

type Smoke = { pos: Vec2; vel: Vec2; life: number; maxLife: number; size: number };

type Spark = {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type Shockwave = {
  pos: Vec2;
  t: number;
  maxT: number;
  r0: number;
  r1: number;
};

type Rocket = {
  pos: Vec2;
  vel: Vec2;
  ownerId: string;
  life: number;
  radius: number;
};

type DroneStrike = {
  pos: Vec2;
  t: number;
  dir: Vec2;
  fired: boolean;
};

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ui: UI;
  private readonly input: Input;
  private readonly audio: AudioManager;
  private readonly flagIcons = new FlagIconCache();

  private phase: Phase = "menu";
  private paused = false;

  private track: Track;
  private trackQ: TrackQuery;

  private playerId = "p1";
  private karts: Kart[] = [];
  private bots = new Map<string, BotController>();

  private camera: Camera = { pos: v2.make(0, 0), zoom: 1 };

  private decor: Decor[] = [];
  private skids: Skid[] = [];
  private smoke: Smoke[] = [];
  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private shockwaves: Shockwave[] = [];

  private droneStrikes: DroneStrike[] = [];
  private lastDroneStrikeMs = -1e9;
  private readonly droneCooldownMs = 9000;

  private shake = 0;

  private startMs = 0;
  private lastFrameMs = 0;

  private readonly rocketSpeed = 560;
  private rocketCooldownMs = 520;
  private rocketImpact = 260;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    this.ctx = ctx;

    this.ui = new UI();
    this.input = new Input(window);
    this.audio = new AudioManager();

    const tracks = createTracks();
    this.track = tracks[0];
    this.trackQ = new TrackQuery(this.track);

    this.ui.onStart((sel) => this.startRace(sel));
    this.ui.onBack(() => this.toMenu());

    this.ui.onPauseResume(() => this.setPaused(false));
    this.ui.onPauseExit(() => {
      this.setPaused(false);
      this.toMenu();
    });

    this.ui.onMusicChange((s) => {
      this.audio.setSettings(s);
    });

    this.toMenu();

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  run(): void {
    this.lastFrameMs = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = clamp((now - this.lastFrameMs) / 1000, 0, 1 / 20);
      this.lastFrameMs = now;

      this.update(dt, now);
      this.render(dt, now);

      // Clear per-frame edge flags AFTER consuming them.
      // Events can arrive between animation frames; clearing at frame start
      // would drop them and make ESC/click feel unreliable.
      this.input.beginFrame();

      this.audio.tick();

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private toMenu(): void {
    this.phase = "menu";
    this.paused = false;
    this.ui.hidePause();
    this.ui.showMenu();
    this.karts = [];
    this.bots.clear();
    this.ui.toast("Pick a map and start!", 1.2);
  }

  private startRace(sel: MenuSelection): void {
    // Start audio on user gesture (Start button)
    void this.audio.ensureStarted();
    const chosen = this.ui.tracks.find((t) => t.id === sel.trackId);
    if (chosen) {
      this.track = chosen;
      this.trackQ = new TrackQuery(this.track);
    }

    this.decor = generateDecor(this.trackQ);
    this.skids = [];
    this.smoke = [];
    this.rockets = [];
    this.sparks = [];
    this.shockwaves = [];
    this.droneStrikes = [];
    this.lastDroneStrikeMs = -1e9;
    this.rocketCooldownMs = sel.rpgReloadMs;
    this.rocketImpact = sel.rpgImpact;
    this.shake = 0;

    // spawn behind start line so nobody starts by instantly crossing
    const startLine = this.trackQ.sampleAtS(0);
    const midLine = this.trackQ.sampleAtS(this.trackQ.total * 0.5);
    const spawn = this.trackQ.sampleAtS(-160);
    const basePos = spawn.point;
    const normal = spawn.normal;
    const angle = Math.atan2(spawn.tangent.y, spawn.tangent.x);

    const colors = [
      "#7cdb7c",
      "#69b3ff",
      "#ffcf5a",
      "#ff6b6b",
      "#c18bff",
    ];

    const names = [sel.name, "Bot-2", "Bot-3", "Bot-4", "Bot-5"];
    const flags = [sel.flag, "🇯🇵", "🇩🇪", "🇧🇷", "🇬🇧"];

    this.karts = [];
    this.bots.clear();

    const nowMs = performance.now();

    for (let i = 0; i < PLAYERS_TOTAL; i++) {
      const laneOffset = (i - (PLAYERS_TOTAL - 1) / 2) * 38;
      const backOffset = -26 * i;
      const pos = v2.add(
        v2.add(basePos, v2.mul(normal, laneOffset)),
        v2.mul(spawn.tangent, backOffset),
      );
      const id = i === 0 ? this.playerId : `b${i}`;
      const kart = createKart({
        id,
        name: names[i] ?? `Bot-${i + 1}`,
        flag: flags[i] ?? "🏁",
        color: colors[i] ?? "#ffffff",
        spawnPos: pos,
        spawnAngle: angle,
      });
      // initialize lap-crossing state
      const near0 = this.trackQ.nearest(kart.pos);
      kart.lastS = near0.s;
      kart.passedHalf = false;
      kart.prevStartD = v2.dot(v2.sub(kart.pos, startLine.point), startLine.tangent);
      kart.prevMidD = v2.dot(v2.sub(kart.pos, midLine.point), midLine.tangent);
      // tiny random initial nudge so they separate
      kart.vel = v2.mul(spawn.tangent, randRange(0, 10));

      kart.crashCount = 0;
      kart.onFire = false;
      kart.lastCrashMs = -1e9;
      kart.lastShotMs = -1e9;
      // bots will fire occasionally; player fires via mouse
      kart.nextShotMs = nowMs + 900 + Math.random() * 1600;
      this.karts.push(kart);

      this.flagIcons.preload(kart.flag);

      if (id !== this.playerId) this.bots.set(id, new BotController());
    }

    this.phase = "racing";
    this.paused = false;
    this.ui.hidePause();
    this.ui.showRaceHud();
    this.ui.toast(`${this.track.name} — ${LAPS_TOTAL} laps`, 1.6);

    this.startMs = performance.now();
  }

  private update(dt: number, nowMs: number): void {
    this.ui.tick(dt);

    if (this.phase === "menu") return;

    if (this.phase === "racing") {
      if (this.input.wasPressed("Escape")) {
        this.setPaused(!this.paused);
      }

      if (this.paused) {
        return;
      }

      const player = this.karts.find((k) => k.id === this.playerId);
      if (!player) return;

      // controls
      const playerControls = readPlayerControls(this.input, nowMs);

      const controlsById = new Map<string, KartControls>();
      controlsById.set(this.playerId, playerControls);

      for (const [id, bot] of this.bots) {
        const k = this.karts.find((kk) => kk.id === id);
        if (!k) continue;
        controlsById.set(id, bot.update(k, this.trackQ, dt));
      }

      // update karts
      for (const k of this.karts) {
        const c = controlsById.get(k.id) ?? {
          throttle: 0,
          steer: 0,
          jumpTap: false,
          driftHeld: false,
        };
        updateKart(k, c, DEFAULT_TUNING, this.trackQ, dt, nowMs, LAPS_TOTAL);
      }

      this.resolveKartCollisions(nowMs);

      this.updateRockets(dt, nowMs);
      this.updateSmoke(dt);
      this.updateSparks(dt);
      this.updateShockwaves(dt);
      this.updateDroneStrikes(dt, nowMs);

      // camera shake decay
      this.shake = Math.max(0, this.shake - dt * 2.6);

      // Fire RPG (player)
      if (this.input.mouseWasPressed()) {
        this.tryFireRocket(player, nowMs);
      }

      // Drone strike (player)
      if (this.input.wasPressed("KeyE")) {
        this.tryCallDroneStrike(player, nowMs);
      }

      // Fire RPG (bots)
      for (const k of this.karts) {
        if (k.id === this.playerId) continue;
        if (k.finished) continue;
        if (nowMs < k.nextShotMs) continue;

        const target = this.pickBotRocketTarget(k);
        if (target) {
          const dir = v2.norm(v2.sub(target.pos, k.pos));
          this.spawnRocket(k, dir, nowMs);
          k.nextShotMs = nowMs + this.rocketCooldownMs * (0.8 + Math.random() * 1.6);
        } else {
          // if nobody is reasonably in front, hold fire a bit
          k.nextShotMs = nowMs + this.rocketCooldownMs * (0.4 + Math.random() * 0.8);
        }
      }

      // skid marks
      for (const k of this.karts) {
        this.addSkidMarksForKart(k, dt);
      }

      // smoke for burning karts
      for (const k of this.karts) {
        if (!k.onFire) continue;
        this.emitSmokeForKart(k, dt);
      }

      // keep marks for the whole race, but cap count
      const cap = 6000;
      if (this.skids.length > cap) this.skids.splice(0, this.skids.length - cap);

      // camera follow player
      this.camera.pos = { ...player.pos };
      const spd = v2.len(player.vel);
      this.camera.zoom = clamp(1.15 - spd / 900, 0.82, 1.15);

      // HUD position
      const order = this.getRaceOrder();
      const pos = order.findIndex((k) => k.id === this.playerId) + 1;
      this.ui.updateHud(player.lap, LAPS_TOTAL, pos, PLAYERS_TOTAL, spd, `${player.flag} ${player.name}`);

      // finish check
      const allFinished = this.karts.every((k) => k.finished);
      if (allFinished) {
        this.phase = "results";
        const entries = this.getLeaderboard();
        this.ui.showResults(entries);
      }
    }
  }

  private getRaceOrder(): Kart[] {
    const sorted = [...this.karts];
    sorted.sort((a, b) => {
      const ka = estimateRaceOrderKey(a, this.trackQ, LAPS_TOTAL);
      const kb = estimateRaceOrderKey(b, this.trackQ, LAPS_TOTAL);
      return kb - ka;
    });
    return sorted;
  }

  private getLeaderboard(): LeaderboardEntry[] {
    const t0 = this.startMs;
    const finished = [...this.karts];
    finished.sort((a, b) => {
      const ta = a.finishTimeMs ?? Number.POSITIVE_INFINITY;
      const tb = b.finishTimeMs ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    return finished.map((k) => ({
      name: k.name,
      flag: k.flag,
      timeMs: (k.finishTimeMs ?? performance.now()) - t0,
    }));
  }

  private resize(): void {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private render(_dt: number, _nowMs: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);

    // background
    ctx.fillStyle = this.track.grassColor;
    ctx.fillRect(0, 0, w, h);

    if (this.phase === "menu") {
      // subtle animated background map preview
      this.drawTrackPreview(ctx, w, h);
      return;
    }

    // world transform
    ctx.save();
    ctx.translate(w / 2, h / 2);

    // screen-space camera shake
    if (this.shake > 0) {
      const s = this.shake * this.shake;
      const amp = 7 * s;
      const sx = Math.sin(_nowMs * 0.028) * amp + Math.sin(_nowMs * 0.071) * amp * 0.35;
      const sy = Math.cos(_nowMs * 0.031) * amp + Math.cos(_nowMs * 0.083) * amp * 0.35;
      ctx.translate(sx, sy);
    }

    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.pos.x, -this.camera.pos.y);

    // grass detail + props (in world space)
    const viewHalfW = (w / this.camera.zoom) * 0.6;
    const viewHalfH = (h / this.camera.zoom) * 0.6;
    drawGrassDetails(
      ctx,
      { x: this.camera.pos.x - viewHalfW, y: this.camera.pos.y - viewHalfH },
      { x: this.camera.pos.x + viewHalfW, y: this.camera.pos.y + viewHalfH },
    );

    drawDecor(ctx, this.decor);

    this.drawTrack(ctx);
    this.drawStartLine(ctx);
    this.drawDroneStrikes(ctx);

    this.drawSkids(ctx);
    this.drawShockwaves(ctx);
    this.drawSparks(ctx);
    this.drawSmoke(ctx);
    this.drawRockets(ctx);

    // draw karts
    for (const k of this.karts) {
      this.drawKart(ctx, k);
    }

    ctx.restore();
  }

  private tryCallDroneStrike(player: Kart, nowMs: number): void {
    const since = nowMs - this.lastDroneStrikeMs;
    if (since < this.droneCooldownMs) {
      const remain = Math.max(0, this.droneCooldownMs - since);
      this.ui.toast(`Drone reloading (${(remain / 1000).toFixed(1)}s)`, 0.7);
      return;
    }

    const mp = this.input.mousePos();
    const target = this.screenToWorld(mp.x, mp.y);
    let dir = v2.norm(v2.sub(target, player.pos));
    if (v2.lenSq(dir) <= 1e-8) {
      dir = v2.make(Math.cos(player.angle), Math.sin(player.angle));
    }

    this.lastDroneStrikeMs = nowMs;
    this.droneStrikes.push({ pos: target, t: 0, dir, fired: false });
    this.ui.toast("Drone strike inbound!", 0.85);
  }

  private updateDroneStrikes(dt: number, nowMs: number): void {
    if (this.droneStrikes.length === 0) return;

    const keep: DroneStrike[] = [];
    for (const s of this.droneStrikes) {
      s.t += dt;
      if (!s.fired && s.t >= 0.95) {
        s.fired = true;
        this.fireDroneStrike(s, nowMs);
      }
      if (s.t < 1.35) keep.push(s);
    }
    this.droneStrikes = keep;
  }

  private fireDroneStrike(s: DroneStrike, nowMs: number): void {
    const dir = v2.lenSq(s.dir) <= 1e-8 ? v2.make(1, 0) : v2.norm(s.dir);
    const right = v2.perp(dir);
    const count = 5;
    const spacing = 58;
    const impact = this.rocketImpact * 1.25;

    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * spacing;
      const side = randRange(-36, 36);
      const at = v2.add(s.pos, v2.add(v2.mul(dir, along), v2.mul(right, side)));
      this.explodeRocket(at, dir, nowMs, impact);
    }
  }

  private drawDroneStrikes(ctx: CanvasRenderingContext2D): void {
    if (this.droneStrikes.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const s of this.droneStrikes) {
      const t = clamp(s.t / 0.95, 0, 1);
      const a = (1 - t) * 0.75;
      const r = 26 + 18 * t;
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(255, 80, 80, 1)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.pos.x - r, s.pos.y);
      ctx.lineTo(s.pos.x - r * 0.55, s.pos.y);
      ctx.moveTo(s.pos.x + r, s.pos.y);
      ctx.lineTo(s.pos.x + r * 0.55, s.pos.y);
      ctx.moveTo(s.pos.x, s.pos.y - r);
      ctx.lineTo(s.pos.x, s.pos.y - r * 0.55);
      ctx.moveTo(s.pos.x, s.pos.y + r);
      ctx.lineTo(s.pos.x, s.pos.y + r * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTrackPreview(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.translate(w / 2, h / 2);
    ctx.scale(0.35, 0.35);
    this.drawTrack(ctx);
    ctx.restore();
  }

  private drawTrack(ctx: CanvasRenderingContext2D): void {
    const pts = this.trackQ.getPolyline();

    // road
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = this.track.borderColor;
    ctx.lineWidth = this.track.roadWidth + 16;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = this.track.roadColor;
    ctx.lineWidth = this.track.roadWidth;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();

    // lane hints
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    ctx.setLineDash([22, 20]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawStartLine(ctx: CanvasRenderingContext2D): void {
    const s = this.trackQ.sampleAtS(0);
    const p = s.point;
    const n = s.normal;
    const half = this.track.roadWidth * 0.52;

    // checkered line
    ctx.save();
    ctx.translate(p.x, p.y);
    // Perpendicular to travel direction (across the road)
    ctx.rotate(Math.atan2(s.tangent.y, s.tangent.x) + Math.PI / 2);
    const height = this.track.roadWidth * 0.12;

    const tiles = 10;
    const tileW = (half * 2) / tiles;
    for (let i = 0; i < tiles; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
      ctx.fillRect(-half + i * tileW, -height / 2, tileW, height);
    }
    ctx.restore();

    // subtle post markers
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    const left = v2.add(p, v2.mul(n, -half));
    const right = v2.add(p, v2.mul(n, half));
    ctx.beginPath();
    ctx.arc(left.x, left.y, 7, 0, Math.PI * 2);
    ctx.arc(right.x, right.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawKart(ctx: CanvasRenderingContext2D, k: Kart): void {
    const speed = v2.len(k.vel);
    const bodyW = 26;
    const bodyH = 16;

    ctx.save();
    ctx.translate(k.pos.x, k.pos.y);
    ctx.rotate(k.angle);

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW * 0.7, bodyH * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // hop effect
    const hop = k.hopT > 0 ? (1 - k.hopT / 0.18) : 0;
    const yOff = k.hopT > 0 ? -6 * Math.sin(hop * Math.PI) : 0;
    ctx.translate(0, yOff);

    ctx.globalAlpha = 1;

    // kart body
    ctx.fillStyle = k.color;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH, 6);
    ctx.fill();
    ctx.stroke();

    // nose
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundRect(ctx, bodyW * 0.06, -bodyH * 0.18, bodyW * 0.22, bodyH * 0.36, 4);
    ctx.fill();

    // drift sparks
    if (k.drifting && speed > 220) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = k.driftT > 0.85 ? "#ffd066" : "#9ce3ff";
      ctx.beginPath();
      ctx.arc(-bodyW / 2 - 4, bodyH / 2 + 2, 3, 0, Math.PI * 2);
      ctx.arc(-bodyW / 2 - 6, -bodyH / 2 - 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // on-fire effect
    if (k.onFire) {
      const t = performance.now() * 0.02;
      const flick = 0.75 + 0.35 * Math.sin(t + k.pos.x * 0.01);
      ctx.save();
      // flames from rear
      ctx.translate(-bodyW * 0.48, 0);

      // glow
      const glow = ctx.createRadialGradient(-10, 0, 2, -10, 0, 22);
      glow.addColorStop(0, "rgba(255, 200, 80, 0.55)");
      glow.addColorStop(1, "rgba(255, 120, 20, 0)");
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(-10, 0, 22, 0, Math.PI * 2);
      ctx.fill();

      // flame tongues
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(255, 190, 70, 0.95)";
      ctx.beginPath();
      ctx.ellipse(-8, 0, 12 * flick, 7 * flick, 0, 0, Math.PI * 2);
      ctx.ellipse(-16, -5, 9 * flick, 6 * flick, 0.1, 0, Math.PI * 2);
      ctx.ellipse(-16, 5, 9 * flick, 6 * flick, -0.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 70, 35, 0.9)";
      ctx.beginPath();
      ctx.ellipse(-12, 0, 9 * flick, 5.5 * flick, 0, 0, Math.PI * 2);
      ctx.ellipse(-20, -4, 7 * flick, 4.8 * flick, 0, 0, Math.PI * 2);
      ctx.ellipse(-20, 4, 7 * flick, 4.8 * flick, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // name tag
    ctx.rotate(-k.angle);
    ctx.font =
      '12px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", ui-sans-serif, system-ui';
    ctx.textAlign = "center";
    const labelY = -27;
    const name = k.name;

    const icon = this.flagIcons.get(k.flag);
    const labelText = icon ? name : `${k.flag} ${name}`;
    const textW = ctx.measureText(labelText).width;
    const iconSize = 14;
    const iconGap = 5;
    const totalW = (icon ? iconSize + iconGap : 0) + textW;
    const leftX = -totalW / 2;

    if (icon) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(icon, leftX, labelY - iconSize + 2, iconSize, iconSize);
    }

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillText(
      labelText,
      leftX + (icon ? iconSize + iconGap : 0) + textW / 2 + 1,
      labelY + 1,
    );
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(labelText, leftX + (icon ? iconSize + iconGap : 0) + textW / 2, labelY);

    ctx.restore();
  }

  private drawSkids(ctx: CanvasRenderingContext2D): void {
    if (this.skids.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of this.skids) {
      // permanent for the race
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private updateSmoke(dt: number): void {
    if (this.smoke.length === 0) return;
    for (const p of this.smoke) {
      p.life -= dt;
      p.pos = v2.add(p.pos, v2.mul(p.vel, dt));
      // gentle drift + damping
      p.vel = v2.mul(p.vel, 0.985);
      p.vel = v2.add(p.vel, v2.make(0, -6 * dt));
    }
    // prune
    this.smoke = this.smoke.filter((p) => p.life > 0);
    const cap = 1400;
    if (this.smoke.length > cap) this.smoke.splice(0, this.smoke.length - cap);
  }

  private emitSmokeForKart(k: Kart, dt: number): void {
    // particles per second
    const speed = v2.len(k.vel);
    const rate = 40 + Math.min(45, speed * 0.08);
    const count = Math.max(0, Math.floor(rate * dt + Math.random()));
    if (count === 0) return;

    const forward = v2.make(Math.cos(k.angle), Math.sin(k.angle));
    const rear = v2.add(k.pos, v2.mul(forward, -14));

    for (let i = 0; i < count; i++) {
      const jitter = v2.make((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      const pos = v2.add(rear, jitter);

      const base = v2.mul(k.vel, -0.22);
      const rise = v2.make((Math.random() - 0.5) * 26, -45 - Math.random() * 35);
      const vel = v2.add(base, rise);

      const maxLife = 1.35 + Math.random() * 1.35;
      const size = 9 + Math.random() * 14;
      this.smoke.push({ pos, vel, life: maxLife, maxLife, size });
    }
  }

  private setPaused(p: boolean): void {
    if (this.phase !== "racing") return;
    this.paused = p;
    if (this.paused) {
      const muted = this.ui.getMusicSettings().muted;
      this.ui.showPause(muted);
      this.ui.toast("Paused", 0.8);
    } else {
      this.ui.hidePause();
    }
  }

  private pickBotRocketTarget(bot: Kart): Kart | null {
    const myKey = estimateRaceOrderKey(bot, this.trackQ, LAPS_TOTAL);
    const forward = v2.make(Math.cos(bot.angle), Math.sin(bot.angle));

    let best: Kart | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const other of this.karts) {
      if (other.id === bot.id) continue;
      if (other.finished) continue;
      const ok = estimateRaceOrderKey(other, this.trackQ, LAPS_TOTAL);
      if (ok <= myKey + 14) continue; // must be ahead (not just side-by-side)

      const to = v2.sub(other.pos, bot.pos);
      const dist = v2.len(to);
      if (dist > 720) continue;
      const dir = dist <= 1e-6 ? v2.make(1, 0) : v2.mul(to, 1 / dist);
      const inFront = v2.dot(forward, dir);
      if (inFront < 0.22) continue;

      if (dist < bestDist) {
        bestDist = dist;
        best = other;
      }
    }

    if (best) return best;

    // fallback: shoot at current race leader if nobody is clearly ahead/in-front
    let leader: Kart | null = null;
    let leaderKey = -1;
    for (const other of this.karts) {
      if (other.id === bot.id) continue;
      if (other.finished) continue;
      const ok = estimateRaceOrderKey(other, this.trackQ, LAPS_TOTAL);
      if (ok > leaderKey) {
        leaderKey = ok;
        leader = other;
      }
    }
    if (!leader || leader.id === bot.id) return null;

    const d = v2.sub(leader.pos, bot.pos);
    if (v2.len(d) > 900) return null;
    return leader;
  }

  private drawSmoke(ctx: CanvasRenderingContext2D): void {
    if (this.smoke.length === 0) return;
    ctx.save();
    for (const p of this.smoke) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      const a = (1 - t) * 0.05 + t * 0.22;
      ctx.fillStyle = `rgba(140, 140, 140, ${a})`;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size * (1 + (1 - t) * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRockets(ctx: CanvasRenderingContext2D): void {
    if (this.rockets.length === 0) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const r of this.rockets) {
      const dir = v2.norm(r.vel);
      const a = Math.atan2(dir.y, dir.x);
      ctx.save();
      ctx.translate(r.pos.x, r.pos.y);
      ctx.rotate(a);

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(220, 230, 255, 0.9)";
      roundRect(ctx, -10, -3, 18, 6, 3);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "rgba(255, 170, 60, 0.9)";
      ctx.beginPath();
      ctx.arc(-12, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private screenToWorld(x: number, y: number): Vec2 {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const wx = this.camera.pos.x + (x - w / 2) / this.camera.zoom;
    const wy = this.camera.pos.y + (y - h / 2) / this.camera.zoom;
    return { x: wx, y: wy };
  }

  private tryFireRocket(player: Kart, nowMs: number): void {
    if (nowMs - player.lastShotMs < this.rocketCooldownMs) return;

    const mp = this.input.mousePos();
    const aim = this.screenToWorld(mp.x, mp.y);
    let dir = v2.norm(v2.sub(aim, player.pos));
    if (v2.lenSq(dir) <= 1e-8) {
      dir = v2.make(Math.cos(player.angle), Math.sin(player.angle));
    }

    this.spawnRocket(player, dir, nowMs);
  }

  private spawnRocket(owner: Kart, dir: Vec2, nowMs: number): void {
    owner.lastShotMs = nowMs;

    const muzzle = v2.add(owner.pos, v2.mul(dir, 18));
    const vel = v2.add(v2.mul(dir, this.rocketSpeed), v2.mul(owner.vel, 0.2));
    this.rockets.push({ pos: muzzle, vel, ownerId: owner.id, life: 2.6, radius: 7 });
  }

  private updateRockets(dt: number, nowMs: number): void {
    if (this.rockets.length === 0) return;

    const roadHalf = this.track.roadWidth * 0.5;

    const next: Rocket[] = [];
    for (const r of this.rockets) {
      r.life -= dt;
      if (r.life <= 0) continue;

      r.pos = v2.add(r.pos, v2.mul(r.vel, dt));

      // trail
      if (Math.random() < Math.min(0.9, dt * 32)) {
        const back = v2.norm(v2.mul(r.vel, -1));
        const at = v2.add(r.pos, v2.mul(back, 10));
        this.puffSmoke(at, 1);
        this.sparks.push({
          pos: { ...at },
          vel: v2.add(v2.mul(back, 220 + Math.random() * 260), v2.make((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120)),
          life: 0.18 + Math.random() * 0.14,
          maxLife: 0.32,
          size: 1.5 + Math.random() * 1.6,
          color: "rgba(255, 190, 80, 1)",
        });
      }

      // wall hit
      const near = this.trackQ.nearest(r.pos);
      if (near.distToCenter > roadHalf * 0.98) {
        this.explodeRocket(r.pos, v2.norm(r.vel), nowMs, this.rocketImpact);
        continue;
      }

      // kart hit
      let hit = false;
      for (const k of this.karts) {
        if (k.finished) continue;
        if (k.id === r.ownerId) continue;
        const d = v2.sub(k.pos, r.pos);
        const dist = Math.hypot(d.x, d.y);
        if (dist > 14 + r.radius) continue;

        const dir = v2.norm(r.vel);
        const impulse = this.rocketImpact * 0.9;
        k.vel = v2.add(k.vel, v2.mul(dir, impulse));
        k.vel = v2.mul(k.vel, 0.96);
        this.registerCrash(k, this.rocketImpact, nowMs);
        this.explodeRocket(r.pos, dir, nowMs, this.rocketImpact);
        hit = true;
        break;
      }
      if (hit) continue;

      next.push(r);
    }

    this.rockets = next;
  }

  private explodeRocket(at: Vec2, dir: Vec2, nowMs: number, impact: number): void {
    const mag = clamp(impact / 260, 0.5, 2.2);
    // shake
    this.shake = Math.min(0.9, this.shake + 0.35 * mag);

    // shockwave
    this.shockwaves.push({ pos: { ...at }, t: 0, maxT: 0.52, r0: 10 * mag, r1: 170 * mag });

    // smoke + sparks
    this.puffSmoke(at, Math.round(26 * mag + 14));
    for (let i = 0; i < Math.round(70 * mag + 30); i++) {
      const ang = Math.random() * Math.PI * 2;
      const u = Math.random();
      const sp = (240 + u * 880) * mag;
      const v = v2.make(Math.cos(ang) * sp, Math.sin(ang) * sp);
      // bias a bit forward
      const vel = v2.add(v, v2.mul(dir, 180 * mag));
      const maxLife = 0.22 + Math.random() * 0.36;
      const color =
        Math.random() < 0.22
          ? "rgba(255, 250, 220, 1)"
          : Math.random() < 0.65
            ? "rgba(255, 180, 70, 1)"
            : "rgba(255, 110, 60, 1)";
      const pos = v2.add(at, v2.make((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10));
      this.sparks.push({ pos, vel, life: maxLife, maxLife, size: 1.6 + Math.random() * 3.2 * mag, color });
    }

    // area knockback
    const radius = 145 * mag + 35;
    for (const k of this.karts) {
      if (k.finished) continue;
      const d = v2.sub(k.pos, at);
      const dist = v2.len(d);
      if (dist > radius) continue;

      const n = dist <= 1e-4 ? v2.norm(v2.make(Math.random() - 0.5, Math.random() - 0.5)) : v2.mul(d, 1 / dist);
      const fall = 1 - dist / radius;
      const impulse = (520 * fall + 90) * mag;
      k.vel = v2.add(k.vel, v2.mul(n, impulse));
      k.vel = v2.mul(k.vel, 0.975);

      const crashI = (220 + fall * 240) * mag;
      this.registerCrash(k, crashI, nowMs);
    }
  }

  private updateSparks(dt: number): void {
    if (this.sparks.length === 0) return;
    for (const p of this.sparks) {
      p.life -= dt;
      p.pos = v2.add(p.pos, v2.mul(p.vel, dt));
      p.vel = v2.mul(p.vel, 0.94);
      // slight drift
      p.vel = v2.add(p.vel, v2.make(0, -12 * dt));
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    const cap = 1800;
    if (this.sparks.length > cap) this.sparks.splice(0, this.sparks.length - cap);
  }

  private updateShockwaves(dt: number): void {
    if (this.shockwaves.length === 0) return;
    for (const w of this.shockwaves) w.t += dt;
    this.shockwaves = this.shockwaves.filter((w) => w.t < w.maxT);
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    if (this.sparks.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of this.sparks) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      const a = 0.12 + t * 0.7;
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;

      const v = p.vel;
      const dir = v2.lenSq(v) <= 1e-8 ? v2.make(1, 0) : v2.norm(v);
      const len = 8 + (1 - t) * 18;
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.lineTo(p.pos.x - dir.x * len, p.pos.y - dir.y * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D): void {
    if (this.shockwaves.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const w of this.shockwaves) {
      const t = clamp(w.t / w.maxT, 0, 1);
      const r = w.r0 + (w.r1 - w.r0) * t;
      const a = (1 - t) * 0.55;

      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(255, 210, 120, 1)";
      ctx.lineWidth = 6 * (1 - t) + 2;
      ctx.beginPath();
      ctx.arc(w.pos.x, w.pos.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = "rgba(255, 255, 255, 1)";
      ctx.lineWidth = 2 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(w.pos.x, w.pos.y, r * 0.86, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private puffSmoke(at: Vec2, amount: number): void {
    for (let i = 0; i < amount; i++) {
      const vel = v2.make((Math.random() - 0.5) * 90, -25 - Math.random() * 70);
      const maxLife = 0.65 + Math.random() * 0.8;
      const size = 5 + Math.random() * 9;
      const pos = v2.add(at, v2.make((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10));
      this.smoke.push({ pos, vel, life: maxLife, maxLife, size });
    }
  }

  private spawnExplosionFx(pos: Vec2, dir: Vec2, impact: number): void {
    const mag = clamp(impact / 260, 0.5, 2.2);

    // shockwave ring
    this.shockwaves.push({ pos: { ...pos }, t: 0, maxT: 0.35, r0: 18 * mag, r1: 70 * mag });

    // sparks
    const count = Math.round(10 + 12 * mag);
    for (let i = 0; i < count; i++) {
      const a = (Math.random() - 0.5) * Math.PI * 0.9;
      const d = v2.rot(dir, a);
      const speed = (120 + Math.random() * 260) * mag;
      const vel = v2.add(v2.mul(d, speed), v2.make((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80));
      const maxLife = 0.35 + Math.random() * 0.35;
      const size = 1.6 + Math.random() * 2.2;
      const color = Math.random() < 0.6 ? "#ffd066" : "#ff7a45";
      this.sparks.push({ pos: { ...pos }, vel, life: maxLife, maxLife, size, color });
    }

    // extra smoke puff
    this.puffSmoke(pos, Math.round(6 + 10 * mag));
  }

  private registerCrash(k: Kart, intensity: number, nowMs: number): void {
    if (intensity < 210) return;
    if (nowMs - k.lastCrashMs < 420) return;
    k.lastCrashMs = nowMs;
    k.crashCount += 1;
    if (k.crashCount >= 3) k.onFire = true;
  }

  private addSkidMarksForKart(k: Kart, dt: number): void {
    // only when actively drifting at decent speed
    const speed = v2.len(k.vel);
    if (!k.drifting || speed < 170) return;

    const forward = v2.make(Math.cos(k.angle), Math.sin(k.angle));
    const right = v2.perp(forward);

    const rear = v2.add(k.pos, v2.mul(forward, -10));
    const wheelSep = 8;
    const left = v2.add(rear, v2.mul(right, -wheelSep));
    const rightW = v2.add(rear, v2.mul(right, wheelSep));

    const len = Math.min(16, 6 + speed * 0.02);
    const back = v2.mul(forward, -len);

    // add a couple segments per second
    const rate = 18;
    const addChance = Math.min(1, dt * rate);
    if (Math.random() > addChance) return;

    const life = 2.2;
    const color = "rgba(10,10,10,1)";
    this.skids.push({ a: left, b: v2.add(left, back), life, color, w: 2.4 });
    this.skids.push({ a: rightW, b: v2.add(rightW, back), life, color, w: 2.4 });
  }

  private resolveKartCollisions(nowMs: number): void {
    // simple circle collisions between karts
    const r = 14;
    const r2 = r * 2;
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i]!;
        const b = this.karts[j]!;
        if (a.finished && b.finished) continue;

        const d = v2.sub(b.pos, a.pos);
        const dist = Math.hypot(d.x, d.y);
        if (dist <= 1e-6 || dist >= r2) continue;

        const n = { x: d.x / dist, y: d.y / dist };
        const penetration = r2 - dist;

        // separate
        const push = penetration * 0.5;
        a.pos = v2.add(a.pos, v2.mul(n, -push));
        b.pos = v2.add(b.pos, v2.mul(n, push));

        // damp relative velocity along normal (soft "bump")
        const relV = v2.sub(b.vel, a.vel);
        const relAlong = relV.x * n.x + relV.y * n.y;
        if (relAlong < 0) {
          const restitution = 0.12;
          const impulse = -(1 + restitution) * relAlong * 0.5;
          const imp = v2.mul(n, impulse);
          a.vel = v2.sub(a.vel, imp);
          b.vel = v2.add(b.vel, imp);

          // count hard bumps as crashes
          const impact = -relAlong;
          if (impact > 220) {
            this.registerCrash(a, impact, nowMs);
            this.registerCrash(b, impact, nowMs);
          }
        }

        a.vel = v2.mul(a.vel, 0.995);
        b.vel = v2.mul(b.vel, 0.995);
      }
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
