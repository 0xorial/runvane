import { Link } from "react-router-dom";
import type { ModelGroup } from "../../pages/settings/helpers";
import { ModelDropdown } from "./ModelDropdown";

type ModelSelectorProps = {
  value: string;
  onChange: (model: string, providerId?: string) => void;
  modelGroups: ModelGroup[];
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
};

export function ModelSelector({
  value,
  onChange,
  modelGroups,
  disabled = false,
  placeholder = "Select model",
  searchPlaceholder = "Search model",
}: ModelSelectorProps) {
  return (
    <ModelDropdown
      value={value}
      onChange={onChange}
      groups={modelGroups}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      footer={<Link to="/settings/model-presets">Model configurations ↗</Link>}
    />
  );
}
