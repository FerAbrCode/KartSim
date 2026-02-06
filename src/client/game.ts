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

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ui: UI;
  private readonly input: Input;
  private readonly audio: AudioManager;
  private readonly flagIcons = new FlagIconCache();

  private phase: Phase = "menu";

  private track: Track;
  private trackQ: TrackQuery;

  private playerId = "p1";
  private karts: Kart[] = [];
  private bots = new Map<string, BotController>();

  private camera: Camera = { pos: v2.make(0, 0), zoom: 1 };

  private decor: Decor[] = [];
  private skids: Skid[] = [];

  private startMs = 0;
  private lastFrameMs = 0;

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

      this.input.beginFrame();

      this.update(dt, now);
      this.render(dt, now);

      this.audio.tick();

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private toMenu(): void {
    this.phase = "menu";
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
      this.karts.push(kart);

      this.flagIcons.preload(kart.flag);

      if (id !== this.playerId) this.bots.set(id, new BotController());
    }

    this.phase = "racing";
    this.ui.showRaceHud();
    this.ui.toast(`${this.track.name} — ${LAPS_TOTAL} laps`, 1.6);

    this.startMs = performance.now();
  }

  private update(dt: number, nowMs: number): void {
    this.ui.tick(dt);

    if (this.phase === "menu") return;

    if (this.phase === "racing") {
      if (this.input.wasPressed("Escape")) {
        this.toMenu();
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

      this.resolveKartCollisions();

      // skid marks
      for (const k of this.karts) {
        this.addSkidMarksForKart(k, dt);
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

    this.drawSkids(ctx);

    // draw karts
    for (const k of this.karts) {
      this.drawKart(ctx, k);
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

  private resolveKartCollisions(): void {
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
