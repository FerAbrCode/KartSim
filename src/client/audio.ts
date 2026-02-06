export type AudioSettings = {
  muted: boolean;
  intensity: number; // 0..1
};

type Note = { step: number; midi: number; durSteps: number; vel: number };

const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  intensity: 0.6,
};

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export class AudioManager {
  private fileEl: HTMLAudioElement | null = null;
  private usingFile = false;
  private fileStatus: "unknown" | "missing" | "ok" = "unknown";
  private lastFileError: string | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  private settings: AudioSettings = { ...DEFAULT_SETTINGS };

  private nextTime = 0;
  private step = 0;

  // patterns
  private readonly bass: Note[] = [
    { step: 0, midi: 40, durSteps: 2, vel: 0.9 },
    { step: 2, midi: 43, durSteps: 2, vel: 0.85 },
    { step: 4, midi: 45, durSteps: 2, vel: 0.9 },
    { step: 6, midi: 43, durSteps: 2, vel: 0.8 },
    { step: 8, midi: 38, durSteps: 2, vel: 0.9 },
    { step: 10, midi: 43, durSteps: 2, vel: 0.85 },
    { step: 12, midi: 45, durSteps: 2, vel: 0.9 },
    { step: 14, midi: 47, durSteps: 2, vel: 0.75 },
  ];

  private readonly lead: Note[] = [
    { step: 1, midi: 64, durSteps: 1, vel: 0.45 },
    { step: 3, midi: 67, durSteps: 1, vel: 0.5 },
    { step: 5, midi: 69, durSteps: 1, vel: 0.55 },
    { step: 7, midi: 67, durSteps: 1, vel: 0.5 },
    { step: 9, midi: 64, durSteps: 1, vel: 0.45 },
    { step: 11, midi: 71, durSteps: 1, vel: 0.55 },
    { step: 13, midi: 69, durSteps: 1, vel: 0.52 },
    { step: 15, midi: 67, durSteps: 1, vel: 0.48 },
  ];

  // 16-step drums
  private readonly kickSteps = new Set([0, 4, 8, 12]);
  private readonly hatSteps = new Set([2, 6, 10, 14]);

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  setSettings(next: Partial<AudioSettings>): void {
    this.settings = {
      ...this.settings,
      ...next,
      intensity: next.intensity == null ? this.settings.intensity : clamp(next.intensity, 0, 1),
    };

    this.applyMix();
  }

  getSoundtrackStatus(): { status: "unknown" | "missing" | "ok"; usingFile: boolean; error: string | null } {
    return { status: this.fileStatus, usingFile: this.usingFile, error: this.lastFileError };
  }

  private async checkSoundtrackAvailable(): Promise<boolean> {
    if (this.fileStatus === "ok") return true;
    if (this.fileStatus === "missing") return false;

    try {
      const res = await fetch("/soundtrack.mp3", { method: "HEAD", cache: "no-store" });
      if (!res.ok) {
        this.fileStatus = "missing";
        this.lastFileError = `HTTP ${res.status}`;
        return false;
      }
      this.fileStatus = "ok";
      this.lastFileError = null;
      return true;
    } catch (e) {
      // If HEAD isn't supported or fetch fails, we'll still try to play();
      // keep status unknown so play() can decide.
      this.lastFileError = e instanceof Error ? e.message : String(e);
      return true;
    }
  }

  async ensureStarted(): Promise<void> {
    // Prefer the provided soundtrack.mp3 if present.
    if (!this.fileEl) {
      const el = new Audio();
      el.src = "/soundtrack.mp3";
      el.loop = true;
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      this.fileEl = el;
    }

    if (this.fileEl && !this.usingFile) {
      const canTryFile = await this.checkSoundtrackAvailable();
      if (!canTryFile) {
        this.usingFile = false;
      } else {
      try {
        // If the file doesn't exist, this may reject.
        await this.fileEl.play();
        this.usingFile = true;
        this.fileStatus = "ok";
        this.lastFileError = null;
        this.applyMix();
        return;
      } catch (e) {
        // fall back to synth
        this.usingFile = false;
        // In practice browsers throw a NotSupportedError or AbortError for missing/blocked media.
        this.fileStatus = "missing";
        this.lastFileError = e instanceof Error ? e.message : String(e);
      }
      }
    }

    if (this.ctx) {
      if (this.ctx.state !== "running") await this.ctx.resume();
      return;
    }

    // Create context on user gesture.
    const ctx = new AudioContext();

    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;

    filter.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.filter = filter;

    this.nextTime = ctx.currentTime + 0.05;
    this.step = 0;

    this.applyMix();
  }

  tick(): void {
    // File-based soundtrack doesn't need scheduler ticks.
    if (this.usingFile) return;

    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;

    const intensity = this.settings.intensity;
    const bpm = 92 + intensity * 48; // 92..140
    const stepDur = (60 / bpm) / 4; // 16th note

    const scheduleAhead = 0.18;
    while (this.nextTime < ctx.currentTime + scheduleAhead) {
      this.scheduleStep(this.step, this.nextTime, stepDur);
      this.step = (this.step + 1) % 16;
      this.nextTime += stepDur;
    }
  }

  private applyMix(): void {
    if (this.fileEl && this.usingFile) {
      const intensity = this.settings.intensity;
      const baseVol = 0.35;
      this.fileEl.volume = this.settings.muted ? 0 : baseVol * (0.25 + intensity * 0.75);
      this.fileEl.playbackRate = 0.9 + intensity * 0.25;
      if (!this.settings.muted) {
        // keep it running if it was paused by the browser
        void this.fileEl.play().catch(() => {
          /* ignore */
        });
      }
      return;
    }

    const ctx = this.ctx;
    const master = this.master;
    const filter = this.filter;
    if (!ctx || !master || !filter) return;

    const intensity = this.settings.intensity;

    const base = 0.22;
    master.gain.setTargetAtTime(this.settings.muted ? 0 : base, ctx.currentTime, 0.03);

    const cutoff = 650 + intensity * 1750; // 650..2400
    filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.05);
  }

  private scheduleStep(step: number, t: number, stepDur: number): void {
    const ctx = this.ctx;
    const filter = this.filter;
    if (!ctx || !filter) return;

    const intensity = this.settings.intensity;

    // bass
    for (const n of this.bass) {
      if (n.step !== step) continue;
      this.pluck(filter, t, midiToHz(n.midi), stepDur * n.durSteps, 0.14 + intensity * 0.12, n.vel);
    }

    // lead
    for (const n of this.lead) {
      if (n.step !== step) continue;
      this.sineLead(filter, t, midiToHz(n.midi), stepDur * n.durSteps, 0.06 + intensity * 0.08, n.vel);
    }

    // kick
    if (this.kickSteps.has(step)) {
      this.kick(filter, t, 0.11, 0.9 * (0.6 + intensity * 0.6));
    }

    // hat
    if (this.hatSteps.has(step)) {
      this.hat(filter, t, 0.05, 0.4 * (0.4 + intensity * 0.9));
    }
  }

  private pluck(dest: AudioNode, t: number, hz: number, dur: number, gain: number, vel: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(hz, t);

    const g = ctx.createGain();
    const a = gain * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(a, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.04, dur * 0.9));

    // a little chorus/detune
    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(hz * 0.5, t);

    osc.connect(g);
    osc2.connect(g);
    g.connect(dest);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + dur + 0.05);
    osc2.stop(t + dur + 0.05);
  }

  private sineLead(dest: AudioNode, t: number, hz: number, dur: number, gain: number, vel: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(hz, t);

    const g = ctx.createGain();
    const a = gain * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(a, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur * 0.75));

    osc.connect(g);
    g.connect(dest);

    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private kick(dest: AudioNode, t: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g);
    g.connect(dest);

    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hat(dest: AudioNode, t: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5500;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(dest);

    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
