import type { Locator, Page } from "@playwright/test";

export const DEMO_PRE_ACTION_MS = 100;
export const DEMO_GLIDE_MS = 320;
/** How long the shortcut HUD is visible before the key is sent. */
export const DEMO_SHORTCUT_PREVIEW_MS = 300;

/** Glide + ripple pause for one demo action (type focus or click). */
export function demoActionOverheadMs(): number {
  return DEMO_GLIDE_MS + DEMO_PRE_ACTION_MS;
}

export function demoShortcutOverheadMs(): number {
  return DEMO_SHORTCUT_PREVIEW_MS;
}

declare global {
  interface Window {
    __demo?: {
      preAction(x: number, y: number, glideMs: number, pauseMs: number): Promise<void>;
      showShortcut(label: string, holdMs: number): Promise<void>;
    };
  }
}

// Headless Chromium video shows neither the OS cursor nor keystrokes, so we
// inject our own: animated cursor glide, anticipatory click ripple, keystroke HUD.
export async function installDemoOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ready = () => {
      if (!document.body) return void requestAnimationFrame(ready);

      const style = document.createElement("style");
      style.textContent = `
        #__demo_cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;will-change:transform}
        #__demo_cursor svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
        .__demo_ripple{position:fixed;z-index:2147483646;width:34px;height:34px;pointer-events:none;border-radius:50%;border:2px solid rgba(56,189,248,.95);background:rgba(56,189,248,.28);transform:translate(-50%,-50%) scale(.2);animation:__demo_r .5s ease-out forwards}
        @keyframes __demo_r{to{transform:translate(-50%,-50%) scale(2.3);opacity:0}}
        #__demo_keys{position:fixed;z-index:2147483647;left:50%;bottom:92px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none}
        .__demo_key{font:600 15px/1 ui-monospace,SFMono-Regular,monospace;color:#e5f6ff;background:rgba(15,23,42,.93);border:1px solid rgba(148,163,184,.55);border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.45);animation:__demo_k 1s ease-out forwards}
        @keyframes __demo_k{0%{opacity:0;transform:translateY(6px) scale(.9)}12%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
      `;
      document.head.appendChild(style);

      const cursor = document.createElement("div");
      cursor.id = "__demo_cursor";
      cursor.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l6 16 2.4-6.4L18 9.2z" fill="#fff" stroke="#0f172a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.body.appendChild(cursor);

      const keys = document.createElement("div");
      keys.id = "__demo_keys";
      document.body.appendChild(keys);

      let cursorX = window.innerWidth * 0.5;
      let cursorY = window.innerHeight * 0.55;
      let gliding = false;

      const place = (x: number, y: number) => {
        cursorX = x;
        cursorY = y;
        cursor.style.transform = `translate(${x - 2}px,${y - 2}px)`;
      };
      place(cursorX, cursorY);

      const glideTo = (x: number, y: number, ms: number) =>
        new Promise<void>((resolve) => {
          gliding = true;
          const x0 = cursorX;
          const y0 = cursorY;
          const t0 = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - t0) / ms);
            const e = 1 - (1 - t) ** 3;
            place(x0 + (x - x0) * e, y0 + (y - y0) * e);
            if (t < 1) requestAnimationFrame(step);
            else {
              gliding = false;
              resolve();
            }
          };
          requestAnimationFrame(step);
        });

      const rippleAt = (x: number, y: number) => {
        const r = document.createElement("div");
        r.className = "__demo_ripple";
        r.style.left = `${x}px`;
        r.style.top = `${y}px`;
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 520);
      };

      const GLYPH: Record<string, string> = {
        Enter: "↵",
        Backspace: "⌫",
        Escape: "esc",
        Tab: "⇥",
        ArrowUp: "↑",
        ArrowDown: "↓",
        ArrowLeft: "←",
        ArrowRight: "→",
      };

      let lastPreviewLabel = "";
      let lastPreviewAt = 0;

      const flashShortcut = (label: string) => {
        const el = document.createElement("div");
        el.className = "__demo_key";
        el.textContent = label;
        keys.appendChild(el);
        setTimeout(() => el.remove(), 1000);
        while (keys.children.length > 4) keys.firstChild?.remove();
      };

      window.__demo = {
        async preAction(x: number, y: number, glideMs: number, pauseMs: number) {
          await glideTo(x, y, glideMs);
          rippleAt(x, y);
          await new Promise((r) => setTimeout(r, pauseMs));
        },
        async showShortcut(label: string, holdMs: number) {
          lastPreviewLabel = label;
          lastPreviewAt = performance.now();
          flashShortcut(label);
          await new Promise((r) => setTimeout(r, holdMs));
        },
      };

      addEventListener(
        "pointermove",
        (e) => {
          if (!gliding) place(e.clientX, e.clientY);
        },
        true,
      );

      addEventListener(
        "keydown",
        (e) => {
          if (["Shift", "Meta", "Control", "Alt"].includes(e.key)) return;
          const mods: string[] = [];
          if (e.metaKey) mods.push("⌘");
          if (e.ctrlKey) mods.push("⌃");
          if (e.altKey) mods.push("⌥");
          if (e.shiftKey) mods.push("⇧");
          const special = GLYPH[e.key];
          if (!mods.length && !special) return;
          const label = mods.join("") + (special ?? e.key);
          if (label === lastPreviewLabel && performance.now() - lastPreviewAt < 600) return;
          flashShortcut(label);
        },
        true,
      );
    };
    ready();
  });
}

async function centerOf(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("demo overlay: element not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const MOD_LABEL: Record<string, string> = {
  Meta: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

const KEY_LABEL: Record<string, string> = {
  Enter: "↵",
  Backspace: "⌫",
  Escape: "esc",
  Tab: "⇥",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

function demoShortcutLabel(key: string): string {
  return key
    .split("+")
    .map((part) => MOD_LABEL[part] ?? KEY_LABEL[part] ?? part)
    .join("");
}

async function preActionOn(
  page: Page,
  loc: Locator,
  opts: { glideMs?: number; pauseMs?: number } = {},
): Promise<void> {
  const { x, y } = await centerOf(loc);
  await page.evaluate(
    ({ x, y, glideMs, pauseMs }) => window.__demo!.preAction(x, y, glideMs, pauseMs),
    { x, y, glideMs: opts.glideMs ?? DEMO_GLIDE_MS, pauseMs: opts.pauseMs ?? DEMO_PRE_ACTION_MS },
  );
}

async function previewShortcut(
  page: Page,
  key: string,
  previewMs: number = DEMO_SHORTCUT_PREVIEW_MS,
): Promise<void> {
  await page.evaluate(
    ({ label, holdMs }) => window.__demo!.showShortcut(label, holdMs),
    { label: demoShortcutLabel(key), holdMs: previewMs },
  );
}

export async function demoClick(page: Page, loc: Locator): Promise<void> {
  await preActionOn(page, loc);
  await loc.click();
}

/** Type into a focused field — no cursor glide (composer already focused). */
export async function demoTypeOnly(loc: Locator, text: string, delayMs: number): Promise<void> {
  await loc.focus();
  await loc.pressSequentially(text, { delay: delayMs });
}

/** Glide to element, then type. */
export async function demoTypeInto(loc: Locator, text: string, delayMs: number): Promise<void> {
  const page = loc.page();
  await preActionOn(page, loc);
  await loc.focus();
  await loc.pressSequentially(text, { delay: delayMs });
}

type DemoShortcutOpts = { previewMs?: number };

/** Key press with cursor glide to target first. */
export async function demoKeyOn(
  page: Page,
  loc: Locator,
  key: string,
  opts: DemoShortcutOpts = {},
): Promise<void> {
  await preActionOn(page, loc);
  await loc.focus();
  await previewShortcut(page, key, opts.previewMs);
  await page.keyboard.press(key);
}

/** Key press only — no cursor movement. */
export async function demoKeyOnly(page: Page, key: string, opts: DemoShortcutOpts = {}): Promise<void> {
  await previewShortcut(page, key, opts.previewMs);
  await page.keyboard.press(key);
}

export function demoSteerShortcut(): string {
  return process.platform === "darwin" ? "Meta+Enter" : "Control+Enter";
}
