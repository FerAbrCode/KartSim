export type Key =
  | "KeyW"
  | "KeyA"
  | "KeyS"
  | "KeyD"
  | "Space"
  | "Escape";

type MouseState = {
  down: boolean;
  justPressed: boolean;
  justReleased: boolean;
  x: number;
  y: number;
};

type KeyState = {
  down: boolean;
  pressedAtMs: number | null;
  justPressed: boolean;
  justReleased: boolean;
};

export class Input {
  private readonly keys = new Map<Key, KeyState>();
  private readonly mouse: MouseState = {
    down: false,
    justPressed: false,
    justReleased: false,
    x: 0,
    y: 0,
  };

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

    this.target.addEventListener("pointermove", this.onPointerMove, { passive: true });
    this.target.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    this.target.addEventListener("pointerup", this.onPointerUp, { passive: true });
    this.target.addEventListener("contextmenu", this.onContextMenu, { passive: false });
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);

    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
  }

  beginFrame(): void {
    for (const state of this.keys.values()) {
      state.justPressed = false;
      state.justReleased = false;
    }

    this.mouse.justPressed = false;
    this.mouse.justReleased = false;
  }

  mouseWasPressed(): boolean {
    return this.mouse.justPressed;
  }

  mouseIsDown(): boolean {
    return this.mouse.down;
  }

  mousePos(): { x: number; y: number } {
    return { x: this.mouse.x, y: this.mouse.y };
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

  private readonly onPointerMove = (e: PointerEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Prevent text selection / drag interactions over the canvas,
    // but don't interfere with UI controls.
    const t = e.target as unknown;
    const el = t instanceof HTMLElement ? t : null;
    if (!el?.closest?.("#ui")) e.preventDefault();
    if (!this.mouse.down) {
      this.mouse.down = true;
      this.mouse.justPressed = true;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.mouse.down) {
      this.mouse.down = false;
      this.mouse.justReleased = true;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    // avoid right-click menu popping up over the game
    e.preventDefault();
  };
}
