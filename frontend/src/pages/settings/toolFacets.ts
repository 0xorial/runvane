// Derives the "clear view" of a tool — how it works — from its catalog data:
// the params JSON-Schema and the effective rules values. Pure functions, so the
// rendering component stays dumb and this stays testable. No per-tool authoring:
// operations + params come from the schema; safety vs limits split by field-name
// convention; effect tags from the operation/name vocabulary.

export type ToolParam = { name: string; type: string; required: boolean; description: string };
export type ToolSignature = { operations: string[]; params: ToolParam[] };
export type RulesField = { key: string; value: string; attention: boolean };
export type RulesFacets = { safety: RulesField[]; limits: RulesField[] };
export type EffectTagKind = "read" | "write" | "delete" | "exec" | "network";
export type EffectTag = { kind: EffectTagKind; label: string; muted: boolean };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const TYPE_LABEL: Record<string, string> = {
  string: "string",
  integer: "int",
  number: "num",
  boolean: "bool",
  object: "obj",
  array: "list",
};

function typeLabel(prop: Record<string, unknown>): string {
  if (Array.isArray(prop.enum)) return "enum";
  const t = typeof prop.type === "string" ? prop.type : "";
  return TYPE_LABEL[t] ?? "any";
}

/** operations (the `operation` enum) + the remaining params as typed fields. */
export function deriveSignature(paramsSchema: unknown): ToolSignature {
  const schema = asRecord(paramsSchema);
  const props = asRecord(schema.properties);
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : [],
  );
  const opProp = asRecord(props.operation);
  const operations = Array.isArray(opProp.enum)
    ? opProp.enum.filter((x): x is string => typeof x === "string")
    : [];
  const params: ToolParam[] = [];
  for (const [name, rawProp] of Object.entries(props)) {
    if (name === "operation") continue;
    const prop = asRecord(rawProp);
    params.push({
      name,
      type: typeLabel(prop),
      required: required.has(name),
      description: typeof prop.description === "string" ? prop.description : "",
    });
  }
  return { operations, params };
}

// A limit is a scalar you bump; anything else in the rules is a boundary/gate.
const LIMIT_RE = /^(max_|min_)|_(ms|bytes|results|entries)$|timeout/;

function formatValue(value: unknown): { text: string; attention: boolean } {
  if (Array.isArray(value)) {
    return value.length === 0
      ? { text: "(none)", attention: true }
      : { text: value.map((v) => String(v)).join(", "), attention: false };
  }
  if (typeof value === "boolean") return { text: String(value), attention: value === false };
  if (typeof value === "number") return { text: value.toLocaleString(), attention: false };
  if (typeof value === "string") return value.length ? { text: value, attention: false } : { text: "(empty)", attention: false };
  return { text: String(value ?? ""), attention: false };
}

/** Split the effective rules into Safety (roots + gates) and Limits (scalars),
 *  by field-name convention. Empty roots / false gates flag for attention. */
export function classifyRules(effectiveRules: Record<string, unknown>): RulesFacets {
  const safety: RulesField[] = [];
  const limits: RulesField[] = [];
  for (const [key, value] of Object.entries(effectiveRules)) {
    const { text, attention } = formatValue(value);
    (LIMIT_RE.test(key) ? limits : safety).push({ key, value: text, attention });
  }
  // Roots before gates within Safety.
  safety.sort((a, b) => Number(b.key.endsWith("_roots")) - Number(a.key.endsWith("_roots")));
  return { safety, limits };
}

const KIND_KEYWORDS: [EffectTagKind, RegExp][] = [
  ["delete", /delete|remove|^rm$|drop/],
  ["exec", /exec|shell|command|terminal|^run$/],
  ["network", /curl|http|fetch|browse|request|^web/],
  ["write", /write|edit|replace|create|mkdir|update|move|insert|add|index/],
  ["read", /read|list|grep|find|stat|^get|query|describe/],
];

function kindOf(token: string): EffectTagKind | null {
  for (const [kind, re] of KIND_KEYWORDS) if (re.test(token)) return kind;
  return null;
}

const KIND_LABEL: Record<EffectTagKind, string> = {
  read: "reads",
  write: "writes",
  delete: "deletes",
  exec: "runs code",
  network: "network",
};

/**
 * Effect tags = the tool's blast radius at a glance. Derived from the operation
 * vocabulary; a target (sandbox) tool with no operations (exec, curl) also
 * matches on its name, so no-op harness tools stay untagged rather than guessed.
 * `delete` shows muted "off" while its `allow_delete` gate is false.
 */
export function deriveEffectTags(
  toolName: string,
  operations: string[],
  effectiveRules: Record<string, unknown>,
  location: string,
): EffectTag[] {
  const kinds = new Set<EffectTagKind>();
  for (const op of operations) {
    const k = kindOf(op.toLowerCase());
    if (k) kinds.add(k);
  }
  if (location === "target") {
    const k = kindOf(toolName.toLowerCase());
    if (k) kinds.add(k);
  }
  const order: EffectTagKind[] = ["read", "write", "delete", "exec", "network"];
  const tags: EffectTag[] = [];
  for (const kind of order) {
    if (!kinds.has(kind)) continue;
    const muted = kind === "delete" && effectiveRules.allow_delete !== true;
    tags.push({ kind, label: KIND_LABEL[kind] + (muted ? " off" : ""), muted });
  }
  return tags;
}
