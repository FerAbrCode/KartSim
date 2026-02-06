import { extname, join } from "node:path";

const publicDir = join(import.meta.dir, "public");

const mimeByExt: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".mp3": "audio/mpeg",
};

function withMime(file: ReturnType<typeof Bun.file>, path: string): Response {
  const ext = extname(path).toLowerCase();
  const mime = mimeByExt[ext] ?? "application/octet-stream";
  return new Response(file, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
    },
  });
}

Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  fetch(req: Request) {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);

    const safePath = pathname.replace(/\\/g, "/");

    // Convenience: allow soundtrack.mp3 to live either in public/ or in the repo root.
    if (safePath === "/soundtrack.mp3") {
      const inPublic = Bun.file(join(publicDir, "soundtrack.mp3"));
      if (inPublic.size > 0) return withMime(inPublic, "/soundtrack.mp3");

      const inRoot = Bun.file(join(import.meta.dir, "soundtrack.mp3"));
      if (inRoot.size > 0) return withMime(inRoot, "/soundtrack.mp3");
    }

    const rel = safePath === "/" ? "/index.html" : safePath;
    const diskPath = join(publicDir, rel);

    const file = Bun.file(diskPath);
    if (file.size > 0) return withMime(file, rel);

    // SPA fallback to menu/game
    const index = Bun.file(join(publicDir, "index.html"));
    return withMime(index, "/index.html");
  },
});

console.log("KartSim running on http://localhost:" + (Bun.env.PORT ?? 3000));
