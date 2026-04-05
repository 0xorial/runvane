import type { NavigateFunction } from "react-router-dom";
import { cx } from "../../utils/cx";
import styles from "./SettingsSidebar.module.css";

type SettingsSidebarProps = {
  activeSection: string;
  navigate: NavigateFunction;
  settingsSearch?: string;
};

export function SettingsSidebar({
  activeSection,
  navigate,
  settingsSearch = "",
}: SettingsSidebarProps) {
  function go(pathname: string) {
    navigate({ pathname, search: settingsSearch || "" });
  }

  return (
    <aside className={styles.settingsSidebar}>
      <div>
        <div className={styles.settingsGroupTitle}>WORKSPACE</div>
        <button
          type="button"
          className={cx(
            styles.settingsNavItem,
            activeSection === "model_provider" && styles.settingsNavItemActive,
          )}
          onClick={() => go("/settings/model-providers")}
        >
          Model Providers
        </button>

        <button
          type="button"
          className={cx(
            styles.settingsNavItem,
            activeSection === "model_presets" && styles.settingsNavItemActive,
          )}
          onClick={() => go("/settings/model-presets")}
        >
          Model Presets
        </button>

        <button
          type="button"
          className={cx(
            styles.settingsNavItem,
            activeSection === "tools" && styles.settingsNavItemActive,
          )}
          onClick={() => go("/settings/tools")}
        >
          Tools
        </button>

        <button
          type="button"
          className={cx(
            styles.settingsNavItem,
            activeSection === "skills" && styles.settingsNavItemActive,
          )}
          onClick={() => go("/settings/skills")}
        >
          Skills
        </button>

        <button
          type="button"
          className={cx(
            styles.settingsNavItem,
            activeSection === "agents" && styles.settingsNavItemActive,
          )}
          onClick={() => go("/settings/agents")}
        >
          Agents
        </button>
      </div>
    </aside>
  );
}
