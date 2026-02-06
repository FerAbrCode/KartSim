import { createTracks, type Track } from "./track";
import { flagToTwemojiUrl } from "./flags";

export type MenuSelection = {
  name: string;
  flag: string;
  trackId: string;
};

export type LeaderboardEntry = {
  name: string;
  flag: string;
  timeMs: number;
};

export type MusicSettings = {
  muted: boolean;
  intensity: number; // 0..1
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

  private readonly elName = document.getElementById("playerName") as HTMLInputElement;
  private readonly elFlag = document.getElementById("playerFlag") as HTMLSelectElement;
  private readonly elMap = document.getElementById("mapSelect") as HTMLSelectElement;

  private readonly elStart = document.getElementById("startBtn") as HTMLButtonElement;
  private readonly elBack = document.getElementById("backBtn") as HTMLButtonElement;

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

  private musicCb: ((s: MusicSettings) => void) | null = null;

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

    const emit = () => {
      const s = this.getMusicSettings();
      this.saveMusicSettings(s);
      this.musicCb?.(s);
    };
    this.elMusicMute.addEventListener("change", emit);
    this.elMusicIntensity.addEventListener("input", emit);

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
    const url = flagToTwemojiUrl(flag);
    if (!url) {
      this.elFlagPreviewImg.style.display = "none";
      return;
    }

    this.elFlagPreviewImg.onload = () => {
      this.elFlagPreviewImg.style.display = "block";
    };
    this.elFlagPreviewImg.onerror = () => {
      this.elFlagPreviewImg.style.display = "none";
    };
    this.elFlagPreviewImg.src = url;
  }

  onMusicChange(cb: (s: MusicSettings) => void): void {
    this.musicCb = cb;
    cb(this.getMusicSettings());
  }

  getMusicSettings(): MusicSettings {
    const muted = this.elMusicMute.checked;
    const intensity = Math.max(0, Math.min(1, Number(this.elMusicIntensity.value) / 100));
    return { muted, intensity };
  }

  private loadMusicSettings(): MusicSettings {
    try {
      const raw = localStorage.getItem("kartsim:music");
      if (!raw) return { muted: false, intensity: 0.6 };
      const v = JSON.parse(raw) as Partial<MusicSettings>;
      return {
        muted: Boolean(v.muted),
        intensity: typeof v.intensity === "number" ? Math.max(0, Math.min(1, v.intensity)) : 0.6,
      };
    } catch {
      return { muted: false, intensity: 0.6 };
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
  }

  showRaceHud(): void {
    this.elMenu.classList.add("hidden");
    this.elHud.classList.remove("hidden");
    this.elResults.classList.add("hidden");
  }

  showResults(entries: LeaderboardEntry[]): void {
    this.elMenu.classList.add("hidden");
    this.elHud.classList.add("hidden");
    this.elResults.classList.remove("hidden");

    this.elLeaderboard.innerHTML = "";
    for (const e of entries) {
      const li = document.createElement("li");
      li.textContent = `${e.flag} ${e.name} — ${formatTime(e.timeMs)}`;
      this.elLeaderboard.appendChild(li);
    }
  }

  getSelection(): MenuSelection {
    const name = this.elName.value.trim() || "Player";
    const flag = this.elFlag.value;
    const trackId = this.elMap.value;
    return { name: name.slice(0, 16), flag, trackId };
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

      const url = flagToTwemojiUrl(flag);
      this.elHudName.textContent = url ? name : playerTag;
      if (url) {
        this.elHudFlagImg.onload = () => {
          this.elHudFlagImg.style.display = "inline-block";
        };
        this.elHudFlagImg.onerror = () => {
          this.elHudFlagImg.style.display = "none";
        };
        if (this.elHudFlagImg.src !== url) this.elHudFlagImg.src = url;
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
