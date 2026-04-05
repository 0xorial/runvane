import { TextInput } from "../../components/ui/TextInput";
import styles from "./SettingsHeader.module.css";

function titleForSection(activeSection: string): string {
  if (activeSection === "model_provider") return "Model Provider";
  if (activeSection === "agents") return "Agents";
  return activeSection
    .replaceAll("_", " ")
    .replaceAll("skills", "Skills")
    .replaceAll("tools", "Tools");
}

type SettingsHeaderProps = {
  activeSection: string;
  search: string;
  setSearch: (s: string) => void;
};

export function SettingsHeader({
  activeSection,
  search,
  setSearch,
}: SettingsHeaderProps) {
  return (
    <div className={styles.settingsContentHeader}>
      <div className={styles.settingsContentTitle}>
        {titleForSection(activeSection)}
      </div>
      <div>
        {activeSection === "model_provider" ? (
          <div className={styles.settingsSearch}>
            <TextInput
              placeholder="Search providers or ids"
              value={search}
              onChange={setSearch}
              showClearButton
              clearButtonClassName={styles.settingsSearchClear}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
