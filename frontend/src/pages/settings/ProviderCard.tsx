import type { Dispatch, SetStateAction } from "react";
import { AsyncButton } from "../../components/ui/AsyncButton";
import { TextInput } from "../../components/ui/TextInput";
import { normalizeSearchToken } from "./helpers";
import type { LlmSettings, ProviderRow } from "../../types/llmSettings";
import { cx } from "../../utils/cx";
import styles from "./ProviderCard.module.css";

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

  function mutProviders(
    fn: (providers: Provider[], i: number) => void,
  ): void {
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
  const modelFilter = (modelFilters[String(provider.id)] || "")
    .trim()
    .toLowerCase();
  const normalizedModelFilter = normalizeSearchToken(modelFilter);
  const visibleModels = modelFilter
    ? sortedModels.filter((m) => {
        const raw = String(m).toLowerCase();
        if (raw.includes(modelFilter)) return true;
        return normalizeSearchToken(raw).includes(normalizedModelFilter);
      })
    : sortedModels;
  const isCollapsed = collapsedModels[providerKey] ?? true;
  const settingsSpec = Array.isArray(provider.settings_spec)
    ? provider.settings_spec
    : [];

  return (
    <div className={styles.difyProviderCard} key={String(provider.id)}>
      <div className={styles.difyProviderTop}>
        <div>
          <div className={styles.difyProviderName}>
            {String(provider.label ?? "")}
          </div>
          <div className={styles.difyProviderId}>{String(provider.id)}</div>
        </div>
        <div>
          <AsyncButton
            className={styles.difyGhostBtn}
            onClickAsync={() => testConnection(provider)}
          >
            Test connection
          </AsyncButton>
        </div>
      </div>

      <div className={styles.difyModels}>
        <div className={styles.difyAdvanced}>
          <div className={styles.difyAdvancedGrid}>
            <label>
              Provider id
              <input
                className={`input control ${styles.difyAdvancedInput}`}
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
                className={`input control ${styles.difyAdvancedInput}`}
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
                    className={`input control ${styles.difyAdvancedInput}`}
                    value={value}
                    onChange={(e) => {
                      mutProviders((arr, i) => {
                        const cur = arr[i] as Provider;
                        cur.settings = { ...(cur.settings || {}), [key]: e.target.value };
                      });
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className={styles.difyModelsHeader}>
          <button
            type="button"
            className={styles.difyModelsLabel}
            onClick={() =>
              setCollapsedModels((prev) => ({
                ...prev,
                [providerKey]: !(prev[providerKey] ?? true),
              }))
            }
          >
            {allModels.length} Models
            <span
              className={cx(
                styles.difyModelsChevron,
                isCollapsed && styles.difyModelsChevronCollapsed,
              )}
            >
              ⌄
            </span>
          </button>
          <TextInput
            className={`input control ${styles.difyModelFilter}`}
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
            wrapperClassName={styles.difyModelFilterWrap}
            clearButtonClassName={styles.difyModelFilterClear}
            clearAriaLabel="Clear model filter"
          />
        </div>

        {isCollapsed ? null : (
          <div className={styles.difyModelList}>
            {visibleModels.map((m) => {
              const enabled = enabledSet.has(m);
              return (
                <label
                  key={String(m)}
                  className={cx(
                    styles.difyModelItem,
                    !enabled && styles.difyModelItemDisabled,
                  )}
                >
                  <span className={styles.difyModelName}>{m}</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => {
                      mutProviders((arr, i) => {
                        const current = arr[i] as Provider;
                        const explicit = Array.isArray(
                          current.quick_access_models,
                        )
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
