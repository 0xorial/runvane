import type { HTMLInputTypeAttribute } from "react";

type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  showClearButton?: boolean;
  clearButtonClassName?: string;
  clearAriaLabel?: string;
  type?: HTMLInputTypeAttribute;
};

export function TextInput({
  value,
  onChange,
  placeholder = "",
  className = "",
  wrapperClassName = "",
  showClearButton = false,
  clearButtonClassName = "",
  clearAriaLabel = "Clear input",
  type = "text",
}: TextInputProps) {
  const hasValue = String(value || "").length > 0;

  if (!showClearButton) {
    return (
      <input
        type={type}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className={wrapperClassName}>
      <input
        type={type}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hasValue ? (
        <button
          type="button"
          className={clearButtonClassName}
          onClick={() => onChange("")}
          aria-label={clearAriaLabel}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
