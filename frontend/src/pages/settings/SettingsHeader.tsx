import { TextInput } from "../../components/ui/TextInput";

function titleForSection(activeSection: string): string {
  if (activeSection === "model_provider") return "Model Provider";
  if (activeSection === "agents") return "Agents";
  return activeSection.replaceAll("_", " ").replaceAll("skills", "Skills").replaceAll("tools", "Tools");
}

type SettingsHeaderProps = {
  activeSection: string;
  search: string;
  setSearch: (s: string) => void;
};

export function SettingsHeader({ activeSection, search, setSearch }: SettingsHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-3 md:px-3.5">
      <div className="text-sm font-extrabold">{titleForSection(activeSection)}</div>
      <div>
        {activeSection === "model_provider" ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-border bg-muted/40 px-2.5 py-2">
            <TextInput
              placeholder="Search providers or ids"
              value={search}
              onChange={setSearch}
              showClearButton
              clearButtonClassName="cursor-pointer border-0 bg-transparent text-sm leading-none text-muted-foreground"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
