import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function flagToHex(flag: string): string {
  const cps: number[] = [];
  for (const ch of flag) cps.push(ch.codePointAt(0) ?? 0);
  return cps.map((cp) => cp.toString(16)).join("-");
}

const FLAGS: string[] = [
  "🇺🇸",
  "🇬🇧",
  "🇨🇦",
  "🇩🇪",
  "🇫🇷",
  "🇪🇸",
  "🇮🇹",
  "🇳🇱",
  "🇸🇪",
  "🇳🇴",
  "🇫🇮",
  "🇯🇵",
  "🇰🇷",
  "🇦🇺",
  "🇧🇷",
  "🇲🇽",
  "🇮🇳",
  "🇹🇷",
];

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(repoRoot, "public", "twemoji", "72x72");

await mkdir(outDir, { recursive: true });

let ok = 0;
let skipped = 0;
let failed = 0;

for (const flag of FLAGS) {
  const hex = flagToHex(flag);
  const outPath = join(outDir, `${hex}.png`);
  if (existsSync(outPath)) {
    skipped++;
    continue;
  }

  const url = `https://twemoji.maxcdn.com/v/latest/72x72/${hex}.png`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    await Bun.write(outPath, buf);
    ok++;
  } catch (e) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`Failed: ${flag} (${hex}) from ${url}:`, e);
  }
}

// eslint-disable-next-line no-console
console.log(`Twemoji flags: downloaded=${ok}, skipped=${skipped}, failed=${failed}`);
