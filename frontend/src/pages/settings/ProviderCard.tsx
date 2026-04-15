import type { Dispatch, SetStateAction } from "react";
import { AsyncButton } from "../../components/ui/AsyncButton";
import { TextInput } from "../../components/ui/TextInput";
import { normalizeSearchToken } from "./helpers";
import type { LlmSettings, ProviderRow } from "../../types/llmSettings";
import { cn } from "@/lib/utils";
import { providerGhostBtn } from "./settingsClasses";

type Provider = ProviderRow & Record<string, unknown>;

function enabledModelSetForProvider(provider: Provider): Set<string> {
  const explicit = Array.isArray(provider.quick_access_models)
    ? provider.quick_access_models
    : Array.isArray(provider.enabled_models)
      ? provider.enabled_models
      : null;
  const initialModels = explicit ?? provider.models ?? [];
  return new Set(initialModels as string[]);
}

type ProviderCardProps = {
  provider: Provider;
  settings: LlmSettings;
  setSettings: Dispatch<SetStateAction<LlmSettings | null>>;
  testConnection: (p: Provider) => Promise<boolean>;
  modelFilters: Record<string, string>;
  setModelFilters: Dispatch<SetStateAction<Record<string, string>>>;
  collapsedModels: Record<string, boolean>;
  setCollapsedModels: Dispatch<SetStateAction<Record<string, boolean>>>;
};

const advancedInput = "input control rounded-[10px] border-input bg-muted/50";

export function ProviderCard({
  provider,
  settings: _settings,
  setSettings,
  testConnection,
  modelFilters,
  setModelFilters,
  collapsedModels,
  setCollapsedModels,
}: ProviderCardProps) {
  void _settings;
  const providerKey = String(provider.id);

  function mutProviders(fn: (providers: Provider[], i: number) => void): void {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const i = next.providers.findIndex((x) => x.id === provider.id);
      if (i < 0) return prev;
      fn(next.providers as Provider[], i);
      return next;
    });
  }

  const enabledSet = enabledModelSetForProvider(provider);
  const allModels = provider.models_verified ? provider.models || [] : [];
  const sortedModels = [...allModels].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
  );
  const modelFilter = (modelFilters[String(provider.id)] || "").trim().toLowerCase();
  const normalizedModelFilter = normalizeSearchToken(modelFilter);
  const visibleModels = modelFilter
    ? sortedModels.filter((m) => {
        const raw = String(m).toLowerCase();
        if (raw.includes(modelFilter)) return true;
        return normalizeSearchToken(raw).includes(normalizedModelFilter);
      })
    : sortedModels;
  const isCollapsed = collapsedModels[providerKey] ?? true;
  const settingsSpec = Array.isArray(provider.settings_spec) ? provider.settings_spec : [];

  return (
    <div className="rounded-lg border border-border bg-card p-3.5" key={String(provider.id)}>
      <div className="flex justify-between gap-3">
        <div>
          <div className="text-sm font-black">{String(provider.label ?? "")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{String(provider.id)}</div>
        </div>
        <div>
          <AsyncButton className={providerGhostBtn} onClickAsync={() => testConnection(provider)}>
            Test connection
          </AsyncButton>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mt-3.5">
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-[13px] [&_label]:font-bold [&_label]:text-muted-foreground">
            <label>
              Provider id
              <input
                className={`input control ${advancedInput}`}
                value={String(provider.id ?? "")}
                onChange={(e) => {
                  mutProviders((arr, i) => {
                    arr[i].id = e.target.value;
                  });
                }}
              />
            </label>
            <label>
              Label
              <input
                className={`input control ${advancedInput}`}
                value={String(provider.label ?? "")}
                onChange={(e) => {
                  mutProviders((arr, i) => {
                    arr[i].label = e.target.value;
                  });
                }}
              />
            </label>
            {settingsSpec.map((opt) => {
              const key = opt?.key;
              if (!key) return null;
              const label = opt?.label || key;
              const value =
                (provider.settings?.[key] as string | undefined) ??
                (opt?.placeholder != null ? String(opt.placeholder) : "");
              return (
                <label key={key}>
                  {label}
                  <input
                    type="text"
                    className={`input control ${advancedInput}`}
                    value={value}
                    onChange={(e) => {
                      mutProviders((arr, i) => {
                        const cur = arr[i] as Provider;
                        cur.settings = {
                          ...(cur.settings || {}),
                          [key]: e.target.value,
                        };
                      });
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="mb-3 mt-2.5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-black text-muted-foreground"
            onClick={() =>
              setCollapsedModels((prev) => ({
                ...prev,
                [providerKey]: !(prev[providerKey] ?? true),
              }))
            }
          >
            {allModels.length} Models
            <span className={cn("inline-block transition-transform duration-150", isCollapsed && "-rotate-90")}>⌄</span>
          </button>
          <TextInput
            className={`input control min-w-[180px] rounded-md border-0 bg-muted/40 pl-2 pr-8`}
            placeholder="Filter models"
            value={modelFilters[providerKey] || ""}
            onChange={(value) => {
              setModelFilters((prev) => ({
                ...prev,
                [providerKey]: value,
              }));
              if (value.trim()) {
                setCollapsedModels((prev) => ({
                  ...prev,
                  [providerKey]: false,
                }));
              }
            }}
            showClearButton
            wrapperClassName="relative inline-flex items-center"
            clearButtonClassName="absolute right-1.5 top-1/2 flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background p-0 leading-none text-muted-foreground"
            clearAriaLabel="Clear model filter"
          />
        </div>

        {isCollapsed ? null : (
          <div className="flex flex-col gap-0.5">
            {visibleModels.map((m) => {
              const enabled = enabledSet.has(m);
              return (
                <label
                  key={String(m)}
                  className={cn(
                    "flex cursor-pointer select-none items-center gap-3 border-0 border-b border-border bg-transparent py-2 pl-0.5 last:border-b-0",
                    !enabled && "opacity-55",
                  )}
                >
                  <span className="font-mono text-[13px]">{m}</span>
                  <input
                    type="checkbox"
                    className="ml-auto size-4 accent-primary"
                    checked={enabled}
                    onChange={(e) => {
                      mutProviders((arr, i) => {
                        const current = arr[i] as Provider;
                        const explicit = Array.isArray(current.quick_access_models)
                          ? current.quick_access_models
                          : Array.isArray(current.enabled_models)
                            ? current.enabled_models
                            : null;
                        const initial = explicit ?? current.models ?? [];
                        const set = new Set(initial);
                        if (e.target.checked) set.add(m);
                        else set.delete(m);
                        current.quick_access_models = Array.from(set);
                      });
                    }}
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
