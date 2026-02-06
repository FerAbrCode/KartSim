export type Key =
  | "KeyW"
  | "KeyA"
  | "KeyS"
  | "KeyD"
  | "Space"
  | "Escape";

type KeyState = {
  down: boolean;
  pressedAtMs: number | null;
  justPressed: boolean;
  justReleased: boolean;
};

export class Input {
  private readonly keys = new Map<Key, KeyState>();

  constructor(private readonly target: Window) {
    const init = (code: Key) => {
      this.keys.set(code, {
        down: false,
        pressedAtMs: null,
        justPressed: false,
        justReleased: false,
      });
    };

    init("KeyW");
    init("KeyA");
    init("KeyS");
    init("KeyD");
    init("Space");
    init("Escape");

    this.target.addEventListener("keydown", this.onKeyDown, { passive: false });
    this.target.addEventListener("keyup", this.onKeyUp, { passive: false });
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
  }

  beginFrame(): void {
    for (const state of this.keys.values()) {
      state.justPressed = false;
      state.justReleased = false;
    }
  }

  isDown(code: Key): boolean {
    return this.keys.get(code)?.down ?? false;
  }

  wasPressed(code: Key): boolean {
    return this.keys.get(code)?.justPressed ?? false;
  }

  wasReleased(code: Key): boolean {
    return this.keys.get(code)?.justReleased ?? false;
  }

  heldMs(code: Key, nowMs: number): number {
    const st = this.keys.get(code);
    if (!st?.down || st.pressedAtMs == null) return 0;
    return Math.max(0, nowMs - st.pressedAtMs);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const code = e.code as Key;
    const st = this.keys.get(code);
    if (!st) return;

    if (code === "Space") e.preventDefault();

    if (!st.down) {
      st.down = true;
      st.justPressed = true;
      st.pressedAtMs = performance.now();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    const code = e.code as Key;
    const st = this.keys.get(code);
    if (!st) return;

    if (st.down) {
      st.down = false;
      st.justReleased = true;
      st.pressedAtMs = null;
    }
  };
}
