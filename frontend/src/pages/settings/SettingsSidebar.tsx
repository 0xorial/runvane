import type { NavigateFunction } from "react-router-dom";
import { cn } from "@/lib/utils";

type SettingsSidebarProps = {
  activeSection: string;
  navigate: NavigateFunction;
  settingsSearch?: string;
};

const navBtn =
  "mb-1.5 w-full cursor-pointer rounded-[10px] border border-transparent px-2.5 py-2.5 text-left text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.07]";

const navBtnActive =
  "border-primary/40 bg-primary/10 hover:bg-primary/10";

export function SettingsSidebar({
  activeSection,
  navigate,
  settingsSearch = "",
}: SettingsSidebarProps) {
  function go(pathname: string) {
    navigate({ pathname, search: settingsSearch || "" });
  }

  return (
    <aside className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-3">
      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          WORKSPACE
        </div>
        <button
          type="button"
          className={cn(navBtn, activeSection === "model_provider" && navBtnActive)}
          onClick={() => go("/settings/model-providers")}
        >
          Model Providers
        </button>
        <button
          type="button"
          className={cn(navBtn, activeSection === "model_presets" && navBtnActive)}
          onClick={() => go("/settings/model-presets")}
        >
          Model Presets
        </button>
        <button
          type="button"
          className={cn(navBtn, activeSection === "tools" && navBtnActive)}
          onClick={() => go("/settings/tools")}
        >
          Tools
        </button>
        <button
          type="button"
          className={cn(navBtn, activeSection === "skills" && navBtnActive)}
          onClick={() => go("/settings/skills")}
        >
          Skills
        </button>
        <button
          type="button"
          className={cn(navBtn, activeSection === "agents" && navBtnActive)}
          onClick={() => go("/settings/agents")}
        >
          Agents
        </button>
      </div>
    </aside>
  );
}
