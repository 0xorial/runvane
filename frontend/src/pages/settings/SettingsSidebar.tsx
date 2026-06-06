import type { NavigateFunction } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./helpers";

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  navigate: NavigateFunction;
  settingsSearch?: string;
};

const navBtn =
  "mb-1.5 w-full cursor-pointer rounded-[10px] border border-transparent px-2.5 py-2.5 text-left text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.07]";

const navBtnActive = "border-primary/40 bg-primary/10 hover:bg-primary/10";

const NAV_ITEMS: ReadonlyArray<{ section: SettingsSection; label: string }> = [
  { section: "model-providers", label: "Model Providers" },
  { section: "model-presets", label: "Model Presets" },
  { section: "model-pricing", label: "Model Pricing" },
  { section: "tools", label: "Tools" },
  { section: "skills", label: "Skills" },
  { section: "agents", label: "Agents" },
];

export function SettingsSidebar({ activeSection, navigate, settingsSearch = "" }: SettingsSidebarProps) {
  function go(section: SettingsSection) {
    navigate({ pathname: `/settings/${section}`, search: settingsSearch || "" });
  }

  return (
    <aside className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-3">
      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">WORKSPACE</div>
        {NAV_ITEMS.map(({ section, label }) => (
          <button
            key={section}
            type="button"
            className={cn(navBtn, activeSection === section && navBtnActive)}
            onClick={() => go(section)}
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}
