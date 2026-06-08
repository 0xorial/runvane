import type { Page } from "@playwright/test";

// Headless Chromium video shows neither the OS cursor nor keystrokes, so we
// inject our own: a gliding cursor, a click ripple, and a keystroke HUD that
// pops for meaningful keys (Enter, ⇧↵ send, ⌘↵ steer). Plain typing is skipped
// in the HUD since it's already visible in the input field.
export async function installDemoOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ready = () => {
      if (!document.body) return void requestAnimationFrame(ready);

      const style = document.createElement("style");
      style.textContent = `
        #__demo_cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .12s ease-out;will-change:transform}
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

      const move = (x: number, y: number) => {
        cursor.style.transform = `translate(${x - 2}px,${y - 2}px)`;
      };
      addEventListener("pointermove", (e) => move(e.clientX, e.clientY), true);
      addEventListener(
        "pointerdown",
        (e) => {
          move(e.clientX, e.clientY);
          const r = document.createElement("div");
          r.className = "__demo_ripple";
          r.style.left = `${e.clientX}px`;
          r.style.top = `${e.clientY}px`;
          document.body.appendChild(r);
          setTimeout(() => r.remove(), 520);
        },
        true,
      );

      const GLYPH: Record<string, string> = {
        Enter: "↵", Backspace: "⌫", Escape: "esc", Tab: "⇥",
        ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      };
      addEventListener(
        "keydown",
        (e) => {
          if (["Shift", "Meta", "Control", "Alt"].includes(e.key)) return; // bare modifier
          const mods: string[] = [];
          if (e.metaKey) mods.push("⌘");
          if (e.ctrlKey) mods.push("⌃");
          if (e.altKey) mods.push("⌥");
          if (e.shiftKey) mods.push("⇧");
          const special = GLYPH[e.key];
          if (!mods.length && !special) return; // plain typing — already shown in the field
          const el = document.createElement("div");
          el.className = "__demo_key";
          el.textContent = mods.join("") + (special ?? e.key);
          keys.appendChild(el);
          setTimeout(() => el.remove(), 1000);
          while (keys.children.length > 4) keys.firstChild?.remove();
        },
        true,
      );
    };
    ready();
  });
}
