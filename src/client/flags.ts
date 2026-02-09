export function flagToTwemojiHex(flag: string): string | null {
  // Works for regional indicator flags (e.g. 🇺🇸) and other single-emoji flags.
  // Twemoji uses lowercase hex codepoints joined by '-'.
  if (!flag) return null;

  const cps: number[] = [];
  for (const ch of flag) cps.push(ch.codePointAt(0) ?? 0);
  if (cps.length === 0) return null;
  return cps.map((cp) => cp.toString(16)).join("-");
}

export function twemojiLocalPngUrl(hex: string): string {
  return `/twemoji/72x72/${hex}.png`;
}

export function twemojiRemotePngUrl(hex: string): string {
  // PNG is the most compatible choice for Canvas drawImage.
  return `https://twemoji.maxcdn.com/v/latest/72x72/${hex}.png`;
}

export function flagToTwemojiUrl(flag: string): string | null {
  // Primary URL: local (lets us work reliably even if the remote CDN is blocked).
  const hex = flagToTwemojiHex(flag);
  return hex ? twemojiLocalPngUrl(hex) : null;
}

export function flagToTwemojiFallbackUrl(flag: string): string | null {
  const hex = flagToTwemojiHex(flag);
  return hex ? twemojiRemotePngUrl(hex) : null;
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
    const primaryUrl = flagToTwemojiUrl(flag);
    if (!primaryUrl) return;
    const fallbackUrl = flagToTwemojiFallbackUrl(flag);

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    // Do not set crossOrigin here; many CDNs serve without CORS headers.
    // We don't read pixels from the canvas, so tainting is fine.

    const entry: IconEntry = { img, ready: false };
    this.cache.set(flag, entry);

    img.onload = () => {
      entry.ready = true;
    };
    img.onerror = () => {
      if (!fallbackUrl || img.src === fallbackUrl) {
        // leave as not-ready; we will fall back to text
        return;
      }
      img.src = fallbackUrl;
    };

    img.src = primaryUrl;
  }
}
