import { createTracks, type Track } from "./track";
import { flagToTwemojiFallbackUrl, flagToTwemojiUrl } from "./flags";

export type MenuSelection = {
  name: string;
  flag: string;
  trackId: string;
  rpgReloadMs: number;
  rpgImpact: number;
};

export type LeaderboardEntry = {
  name: string;
  flag: string;
  timeMs: number;
};

export type MusicSettings = {
  muted: boolean;
  intensity: number; // 0..1
  volume: number; // 0..1
};

const FLAGS: { code: string; label: string }[] = [
  { code: "🇺🇸", label: "USA" },
  { code: "🇬🇧", label: "UK" },
  { code: "🇨🇦", label: "Canada" },
  { code: "🇩🇪", label: "Germany" },
  { code: "🇫🇷", label: "France" },
  { code: "🇪🇸", label: "Spain" },
  { code: "🇮🇹", label: "Italy" },
  { code: "🇳🇱", label: "Netherlands" },
  { code: "🇸🇪", label: "Sweden" },
  { code: "🇳🇴", label: "Norway" },
  { code: "🇫🇮", label: "Finland" },
  { code: "🇯🇵", label: "Japan" },
  { code: "🇰🇷", label: "Korea" },
  { code: "🇦🇺", label: "Australia" },
  { code: "🇧🇷", label: "Brazil" },
  { code: "🇲🇽", label: "Mexico" },
  { code: "🇮🇳", label: "India" },
  { code: "🇹🇷", label: "Turkey" },
];

export class UI {
  readonly tracks: Track[];

  private readonly elMenu = document.getElementById("menu") as HTMLDivElement;
  private readonly elHud = document.getElementById("hud") as HTMLDivElement;
  private readonly elResults = document.getElementById("results") as HTMLDivElement;
  private readonly elPause = document.getElementById("pause") as HTMLDivElement;

  private readonly elName = document.getElementById("playerName") as HTMLInputElement;
  private readonly elFlag = document.getElementById("playerFlag") as HTMLSelectElement;
  private readonly elMap = document.getElementById("mapSelect") as HTMLSelectElement;

  private readonly elStart = document.getElementById("startBtn") as HTMLButtonElement;
  private readonly elBack = document.getElementById("backBtn") as HTMLButtonElement;

  private readonly elResume = document.getElementById("resumeBtn") as HTMLButtonElement;
  private readonly elExit = document.getElementById("exitBtn") as HTMLButtonElement;
  private readonly elPauseMute = document.getElementById("pauseMute") as HTMLInputElement;
  private readonly elPauseIntensity = document.getElementById("pauseIntensity") as HTMLInputElement;
  private readonly elPauseVolume = document.getElementById("pauseVolume") as HTMLInputElement;

  private readonly elLap = document.getElementById("lapText") as HTMLDivElement;
  private readonly elPos = document.getElementById("posText") as HTMLDivElement;
  private readonly elSpeed = document.getElementById("speedText") as HTMLDivElement;
  private readonly elFlagPreviewText = document.getElementById("flagPreviewText") as HTMLSpanElement;
  private readonly elFlagPreviewImg = document.getElementById("flagPreviewImg") as HTMLImageElement;

  private readonly elHudFlagImg = document.createElement("img");
  private readonly elHudName = document.createElement("span");
  private readonly elHudPlayer = document.createElement("div");

  private readonly elLeaderboard = document.getElementById("leaderboard") as HTMLOListElement;

  private readonly elToast = document.getElementById("toast") as HTMLDivElement;
  private toastT = 0;

  private readonly elMusicMute = document.getElementById("musicMute") as HTMLInputElement;
  private readonly elMusicIntensity = document.getElementById(
    "musicIntensity",
  ) as HTMLInputElement;
  private readonly elMusicVolume = document.getElementById("musicVolume") as HTMLInputElement;
  private readonly elRpgReload = document.getElementById("rpgReload") as HTMLInputElement;
  private readonly elRpgImpact = document.getElementById("rpgImpact") as HTMLInputElement;

  private musicCb: ((s: MusicSettings) => void) | null = null;
  private pauseResumeCb: (() => void) | null = null;
  private pauseExitCb: (() => void) | null = null;

  private syncingMusicUi = false;

  constructor() {
    this.tracks = createTracks();

    for (const f of FLAGS) {
      const opt = document.createElement("option");
      opt.value = f.code;
      opt.textContent = `${f.code} ${f.label}`;
      this.elFlag.appendChild(opt);
    }

    for (const t of this.tracks) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      this.elMap.appendChild(opt);
    }

    this.elName.value = "Player";
    this.elFlag.value = "🇺🇸";
    this.elMap.value = this.tracks[0]?.id ?? "meadow";

    this.updateFlagPreview(this.elFlag.value);
    this.elFlag.addEventListener("change", () => {
      this.updateFlagPreview(this.elFlag.value);
    });

    // music settings (persisted)
    const saved = this.loadMusicSettings();
    this.elMusicMute.checked = saved.muted;
    this.elMusicIntensity.value = String(Math.round(saved.intensity * 100));
    this.elMusicVolume.value = String(Math.round(saved.volume * 100));
    this.elPauseMute.checked = saved.muted;
    this.elPauseIntensity.value = String(Math.round(saved.intensity * 100));
    this.elPauseVolume.value = String(Math.round(saved.volume * 100));

    const emit = () => {
      const s = this.getMusicSettings();
      this.saveMusicSettings(s);
      this.musicCb?.(s);
    };
    // rpg settings (persisted)
    const rpg = this.loadRpgSettings();
    this.elRpgReload.value = String(rpg.reload);
    this.elRpgImpact.value = String(rpg.impact);

    const emitRpg = () => {
      this.saveRpgSettings(this.getRpgSettings());
    };
    this.elRpgReload.addEventListener("input", emitRpg);
    this.elRpgImpact.addEventListener("input", emitRpg);

    const syncIntensityUi = (value: string) => {
      if (this.syncingMusicUi) return;
      this.syncingMusicUi = true;
      try {
        if (this.elMusicIntensity.value !== value) this.elMusicIntensity.value = value;
        if (this.elPauseIntensity.value !== value) this.elPauseIntensity.value = value;
      } finally {
        this.syncingMusicUi = false;
      }
    };

    const syncVolumeUi = (value: string) => {
      if (this.syncingMusicUi) return;
      this.syncingMusicUi = true;
      try {
        if (this.elMusicVolume.value !== value) this.elMusicVolume.value = value;
        if (this.elPauseVolume.value !== value) this.elPauseVolume.value = value;
      } finally {
        this.syncingMusicUi = false;
      }
    };

    this.elMusicMute.addEventListener("change", emit);
    this.elMusicIntensity.addEventListener("input", () => {
      syncIntensityUi(this.elMusicIntensity.value);
      emit();
    });
    this.elMusicVolume.addEventListener("input", () => {
      syncVolumeUi(this.elMusicVolume.value);
      emit();
    });

    this.elPauseMute.addEventListener("change", () => {
      this.setMusicMuted(this.elPauseMute.checked);
    });

    this.elPauseIntensity.addEventListener("input", () => {
      syncIntensityUi(this.elPauseIntensity.value);
      emit();
    });

    this.elPauseVolume.addEventListener("input", () => {
      syncVolumeUi(this.elPauseVolume.value);
      emit();
    });

    this.elResume.addEventListener("click", () => this.pauseResumeCb?.());
    this.elExit.addEventListener("click", () => this.pauseExitCb?.());

    // show player tag in HUD (top-left)
    this.elHudPlayer.style.marginTop = "6px";
    this.elHudPlayer.style.opacity = "0.9";

    this.elHudFlagImg.width = 16;
    this.elHudFlagImg.height = 16;
    this.elHudFlagImg.style.verticalAlign = "-3px";
    this.elHudFlagImg.style.marginRight = "6px";
    this.elHudFlagImg.style.display = "none";

    this.elHudPlayer.appendChild(this.elHudFlagImg);
    this.elHudPlayer.appendChild(this.elHudName);

    (document.getElementById("hudLeft") as HTMLDivElement).appendChild(this.elHudPlayer);
  }

  private updateFlagPreview(flag: string): void {
    this.elFlagPreviewText.textContent = flag;
    const primaryUrl = flagToTwemojiUrl(flag);
    const fallbackUrl = flagToTwemojiFallbackUrl(flag);
    if (!primaryUrl) {
      this.elFlagPreviewImg.style.display = "none";
      this.elFlagPreviewText.style.display = "block";
      return;
    }

    this.elFlagPreviewImg.onload = () => {
      this.elFlagPreviewImg.style.display = "block";
      this.elFlagPreviewText.style.display = "none";
    };
    this.elFlagPreviewImg.onerror = () => {
      if (fallbackUrl && this.elFlagPreviewImg.src !== fallbackUrl) {
        this.elFlagPreviewImg.src = fallbackUrl;
        return;
      }
      this.elFlagPreviewImg.style.display = "none";
      this.elFlagPreviewText.style.display = "block";
    };
    this.elFlagPreviewImg.src = primaryUrl;
  }

  onMusicChange(cb: (s: MusicSettings) => void): void {
    this.musicCb = cb;
    cb(this.getMusicSettings());
  }

  setMusicMuted(muted: boolean): void {
    this.elMusicMute.checked = muted;
    this.elPauseMute.checked = muted;
    const s = this.getMusicSettings();
    this.saveMusicSettings(s);
    this.musicCb?.(s);
  }

  onPauseResume(cb: () => void): void {
    this.pauseResumeCb = cb;
  }

  onPauseExit(cb: () => void): void {
    this.pauseExitCb = cb;
  }

  getMusicSettings(): MusicSettings {
    const muted = this.elMusicMute.checked;
    const intensity = Math.max(0, Math.min(1, Number(this.elMusicIntensity.value) / 100));
    const volume = Math.max(0, Math.min(1, Number(this.elMusicVolume.value) / 100));
    return { muted, intensity, volume };
  }

  private loadMusicSettings(): MusicSettings {
    try {
      const raw = localStorage.getItem("kartsim:music");
      if (!raw) return { muted: false, intensity: 0.6, volume: 0.7 };
      const v = JSON.parse(raw) as Partial<MusicSettings>;
      return {
        muted: Boolean(v.muted),
        intensity: typeof v.intensity === "number" ? Math.max(0, Math.min(1, v.intensity)) : 0.6,
        volume: typeof v.volume === "number" ? Math.max(0, Math.min(1, v.volume)) : 0.7,
      };
    } catch {
      return { muted: false, intensity: 0.6, volume: 0.7 };
    }
  }

  private saveMusicSettings(s: MusicSettings): void {
    try {
      localStorage.setItem("kartsim:music", JSON.stringify(s));
    } catch {
      // ignore
    }
  }

  onStart(cb: (sel: MenuSelection) => void): void {
    this.elStart.addEventListener("click", () => {
      cb(this.getSelection());
    });
  }

  onBack(cb: () => void): void {
    this.elBack.addEventListener("click", cb);
  }

  showMenu(): void {
    this.elMenu.classList.remove("hidden");
    this.elHud.classList.add("hidden");
    this.elResults.classList.add("hidden");
    this.elPause.classList.add("hidden");
  }

  showRaceHud(): void {
    this.elMenu.classList.add("hidden");
    this.elHud.classList.remove("hidden");
    this.elResults.classList.add("hidden");
    this.elPause.classList.add("hidden");
  }

  showResults(entries: LeaderboardEntry[]): void {
    this.elMenu.classList.add("hidden");
    this.elHud.classList.add("hidden");
    this.elResults.classList.remove("hidden");
    this.elPause.classList.add("hidden");

    this.elLeaderboard.innerHTML = "";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const li = document.createElement("li");

      const row = document.createElement("span");
      row.className = "leaderRow";

      const url = flagToTwemojiUrl(e.flag);
      const fallbackUrl = flagToTwemojiFallbackUrl(e.flag);

      if (url) {
        const img = document.createElement("img");
        img.className = "leaderFlag";
        img.alt = e.flag;
        img.onload = () => {
          /* ok */
        };
        img.onerror = () => {
          if (fallbackUrl && img.src !== fallbackUrl) {
            img.src = fallbackUrl;
          }
        };
        img.src = url;
        row.appendChild(img);
      } else {
        const t = document.createElement("span");
        t.textContent = e.flag;
        row.appendChild(t);
      }

      const name = document.createElement("span");
      name.textContent = e.name;
      row.appendChild(name);

      const time = document.createElement("span");
      time.textContent = `— ${formatTime(e.timeMs)}`;
      row.appendChild(time);

      if (i === 0) {
        const trophy = document.createElement("span");
        trophy.className = "leaderTrophy";
        trophy.textContent = "🏆";
        row.appendChild(trophy);
      }

      li.appendChild(row);
      this.elLeaderboard.appendChild(li);
    }
  }

  showPause(muted: boolean): void {
    this.elPauseMute.checked = muted;
    // keep intensity slider synced for when pause is opened mid-race
    const s = this.getMusicSettings();
    const v = String(Math.round(s.intensity * 100));
    if (this.elPauseIntensity.value !== v) this.elPauseIntensity.value = v;
    const vv = String(Math.round(s.volume * 100));
    if (this.elPauseVolume.value !== vv) this.elPauseVolume.value = vv;
    this.elPause.classList.remove("hidden");
  }

  hidePause(): void {
    this.elPause.classList.add("hidden");
  }

  getSelection(): MenuSelection {
    const name = this.elName.value.trim() || "Player";
    const flag = this.elFlag.value;
    const trackId = this.elMap.value;
    const rpg = this.getRpgSettings();
    return { name: name.slice(0, 16), flag, trackId, rpgReloadMs: rpg.reloadMs, rpgImpact: rpg.impactValue };
  }

  private reloadMsFromSlider(v: number): number {
    // Inverted: higher slider => smaller reload time.
    // More sensitive at extremes using a curve.
    const t = Math.max(0, Math.min(1, v / 100));
    const minMs = 140;
    const maxMs = 2000;
    const curved = Math.pow(t, 1.8);
    return Math.round(maxMs - curved * (maxMs - minMs));
  }

  private impactFromSlider(v: number): number {
    const t = Math.max(0, Math.min(1, v / 100));
    const minI = 120;
    const maxI = 460;
    const curved = Math.pow(t, 1.2);
    return Math.round(minI + curved * (maxI - minI));
  }

  private getRpgSettings(): { reload: number; impact: number; reloadMs: number; impactValue: number } {
    const reload = Math.max(0, Math.min(100, Number(this.elRpgReload.value) || 55));
    const impact = Math.max(0, Math.min(100, Number(this.elRpgImpact.value) || 50));
    return {
      reload,
      impact,
      reloadMs: this.reloadMsFromSlider(reload),
      impactValue: this.impactFromSlider(impact),
    };
  }

  private loadRpgSettings(): { reload: number; impact: number } {
    try {
      const raw = localStorage.getItem("kartsim:rpg");
      if (!raw) return { reload: 55, impact: 50 };

      const v = JSON.parse(raw) as Partial<{ reload: number; impact: number; reloadMs: number }>;
      if (
        typeof v.reload === "number" &&
        typeof v.impact === "number" &&
        v.reload >= 0 &&
        v.reload <= 100 &&
        v.impact >= 0 &&
        v.impact <= 100
      ) {
        return {
          reload: Math.max(0, Math.min(100, v.reload)),
          impact: Math.max(0, Math.min(100, v.impact)),
        };
      }

      // migration: old schema stored reloadMs/impactValue
      const oldReloadMs = typeof (v as any).reloadMs === "number" ? (v as any).reloadMs : 520;
      const oldImpact = typeof (v as any).impact === "number" ? (v as any).impact : 260;

      const bestReload = this.approxReloadSliderFromMs(oldReloadMs);
      const bestImpact = this.approxImpactSliderFromValue(oldImpact);
      return { reload: bestReload, impact: bestImpact };
    } catch {
      return { reload: 55, impact: 50 };
    }
  }

  private approxReloadSliderFromMs(ms: number): number {
    let best = 55;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let v = 0; v <= 100; v++) {
      const r = this.reloadMsFromSlider(v);
      const err = Math.abs(r - ms);
      if (err < bestErr) {
        bestErr = err;
        best = v;
      }
    }
    return best;
  }

  private approxImpactSliderFromValue(val: number): number {
    let best = 50;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let v = 0; v <= 100; v++) {
      const r = this.impactFromSlider(v);
      const err = Math.abs(r - val);
      if (err < bestErr) {
        bestErr = err;
        best = v;
      }
    }
    return best;
  }

  private saveRpgSettings(s: { reload: number; impact: number; reloadMs: number; impactValue: number }): void {
    try {
      localStorage.setItem(
        "kartsim:rpg",
        JSON.stringify({ reload: s.reload, impact: s.impact, reloadMs: s.reloadMs, impactValue: s.impactValue }),
      );
    } catch {
      // ignore
    }
  }

  updateHud(
    lap: number,
    lapsTotal: number,
    pos: number,
    total: number,
    speed: number,
    playerTag?: string,
  ): void {
    this.elLap.textContent = `Lap ${Math.min(lap + 1, lapsTotal)}/${lapsTotal}`;
    this.elPos.textContent = `Position ${pos}/${total}`;
    this.elSpeed.textContent = `${Math.round(speed)}`;
    if (playerTag) {
      // playerTag comes as "<flag> <name>"
      const firstSpace = playerTag.indexOf(" ");
      const flag = firstSpace > 0 ? playerTag.slice(0, firstSpace) : "";
      const name = firstSpace > 0 ? playerTag.slice(firstSpace + 1) : playerTag;

      const primaryUrl = flagToTwemojiUrl(flag);
      const fallbackUrl = flagToTwemojiFallbackUrl(flag);
      this.elHudName.textContent = primaryUrl ? name : playerTag;
      if (primaryUrl) {
        this.elHudFlagImg.onload = () => {
          this.elHudFlagImg.style.display = "inline-block";
        };
        this.elHudFlagImg.onerror = () => {
          if (fallbackUrl && this.elHudFlagImg.src !== fallbackUrl) {
            this.elHudFlagImg.src = fallbackUrl;
            return;
          }
          this.elHudFlagImg.style.display = "none";
        };
        if (this.elHudFlagImg.src !== primaryUrl) this.elHudFlagImg.src = primaryUrl;
      } else {
        this.elHudFlagImg.style.display = "none";
      }
    }
  }

  toast(text: string, seconds = 1.4): void {
    this.elToast.textContent = text;
    this.elToast.classList.remove("hidden");
    this.toastT = seconds;
  }

  tick(dt: number): void {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) {
        this.elToast.classList.add("hidden");
      }
    }
  }
}

export function formatTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const ss = s - m * 60;
  return `${m}:${ss.toFixed(2).padStart(5, "0")}`;
}
