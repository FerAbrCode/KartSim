# KartSim

If in-world flag icons don’t show (only the 2-letter fallback like "us"), download local Twemoji flag PNGs:

`bun run fetch:flags`

A small 2D Mario-Kart-like browser racer (1 player + 4 bots) built with TypeScript + Bun.

## Requirements

- Bun installed: https://bun.sh/

## Run

- Install deps: `bun install`
- Build client: `bun run build`
- Start server: `bun run dev` (same as `bun run dev:server`)
- Open: http://localhost:3000

## Dev (recommended)

Run these in two terminals:

- Terminal A: `bun run dev:client` (same as `bun run build:watch`)
- Terminal B: `bun run dev:server`

## Music

If you add a file at `public/soundtrack.mp3` (or `./soundtrack.mp3` in the repo root), the game will auto-play it (looped) once you click **Start Race**.
If the file is missing, it falls back to a small procedural soundtrack.

## Controls

- `W` / `S`: forward / reverse
- `A` / `D`: steer
- `Space` tap: jump (hop)
- `Space` hold: drift (tighter turns, boost on release)
- `Esc`: back to menu
