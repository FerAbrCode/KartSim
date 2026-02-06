import { Game } from "./game";

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Missing canvas#game");

const game = new Game(canvas);
game.run();
