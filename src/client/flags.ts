export function flagToTwemojiUrl(flag: string): string | null {
  // Works for regional indicator flags (e.g. 🇺🇸) and other single-emoji flags.
  // Twemoji uses lowercase hex codepoints joined by '-'.
  if (!flag) return null;

  const cps: number[] = [];
  for (const ch of flag) cps.push(ch.codePointAt(0) ?? 0);
  if (cps.length === 0) return null;

  const hex = cps.map((cp) => cp.toString(16)).join("-");
  return `https://twemoji.maxcdn.com/v/latest/svg/${hex}.svg`;
}

type IconEntry = {
  img: HTMLImageElement;
  ready: boolean;
};

export class FlagIconCache {
  private readonly cache = new Map<string, IconEntry>();

  get(flag: string): HTMLImageElement | null {
    const e = this.cache.get(flag);
    if (!e) return null;
    return e.ready ? e.img : null;
  }

  preload(flag: string): void {
    if (!flag || this.cache.has(flag)) return;
    const url = flagToTwemojiUrl(flag);
    if (!url) return;

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.crossOrigin = "anonymous";

    const entry: IconEntry = { img, ready: false };
    this.cache.set(flag, entry);

    img.onload = () => {
      entry.ready = true;
    };
    img.onerror = () => {
      // leave as not-ready; we will fall back to text
    };

    img.src = url;
  }
}
