/**
 * Geometry for the new-chat layout map: computes every rect/text/path from the
 * current selection (agent, sandbox, knowledge sources) so the component is a
 * dumb renderer. All ids are stable across states — the component keys on them
 * and CSS-transitions geometry, so a selection change animates instead of
 * re-drawing.
 *
 * Coordinate system: 648-wide viewBox, machine column on the left, external
 * models column on the right. Layout invariants the routing relies on:
 *  - the web corridor is one straight vertical (its lane is kept clear of the
 *    local tool-host by construction),
 *  - the sandbox link is one straight vertical from a port on the harness
 *    bottom edge to the tool-host — inside the machine for `local`, crossing
 *    the machine border into the sandbox box for `ssh`.
 */

export type MapColor = "strong" | "soft" | "teal" | "amber" | "dot" | "text2" | "text3";
export type MapFill = "card" | "sub" | "none";

export type MapRect = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  fill: MapFill;
  stroke: MapColor;
  strokeWidth?: number;
  testid?: string;
};
export type MapSpan = { text: string; cls?: "r" | "v"; color?: MapColor };
export type MapText = {
  id: string;
  x: number;
  y: number;
  cls: "n" | "r" | "v" | "pl" | "lab";
  spans: MapSpan[];
  anchor?: "middle";
  baseline?: "central";
  color?: MapColor;
};
export type MapPath = {
  id: string;
  d: string;
  stroke: MapColor;
  strokeWidth?: number;
  markerEnd?: boolean;
  markerStart?: boolean;
};
export type MapDot = { id: string; x: number; y: number; r: number; color: MapColor };
export type MapGlyph = { id: string; kind: "wrench" | "cylinder" | "globe"; x: number; y: number; color?: MapColor };

export type MapLayout = {
  width: number;
  height: number;
  rects: MapRect[];
  glyphs: MapGlyph[];
  texts: MapText[];
  paths: MapPath[];
  dots: MapDot[];
};

export type LayoutMapInputs = {
  agentName: string;
  /** Harness-located enabled tools, minus the special knowledge/web tools. */
  plainTools: string[];
  /** The agent has the knowledge tool enabled. */
  ragOn: boolean;
  /** Enabled web tools (subset of web_search/web_browse). */
  webTools: string[];
  /** Selected knowledge source names (empty = none picked). */
  sources: string[];
  sandbox: {
    kind: "local" | "none" | "ssh";
    name: string;
    docker: boolean;
    mounts: { host: string; container: string; readonly?: boolean }[];
    sshHost?: string;
  } | null;
  /** Target-located enabled tools — what the tool-host serves. */
  hostTools: string[];
  models: { role: string; name: string; twoWay?: boolean }[];
};

const W = 648;
const LX = 40;
const LW = 400;
const RX = 470;
const CW = (LW - 16) / 2;
const COL_R = LX + CW + 16;
/** Local tool-host width — keeps the web corridor clear by construction. */
const TH_W = 250;

const CHAR_N = 6.6;
const CHAR_R = 6.0;
const CHAR_V = 6.7;

function plateW(label: string, role: string): number {
  return 16 + label.length * CHAR_N + (role ? role.length * CHAR_R + 6 : 0);
}
function plateCx(x: number, label: string, role: string): number {
  return x + 12 + plateW(label, role) / 2;
}

/** Pack tool names into rows that fit `width`; returns per-name positions. */
function packTools(names: string[], x: number, y: number, width: number): { items: { name: string; x: number; y: number }[]; height: number } {
  const items: { name: string; x: number; y: number }[] = [];
  let cx = x;
  let row = 0;
  let used = 0;
  for (const name of names) {
    const w = 15 + name.length * CHAR_V + 14;
    if (used + w > width && used > 0) {
      row += 1;
      cx = x;
      used = 0;
    }
    items.push({ name, x: cx, y: y + row * 18 });
    cx += w;
    used += w;
  }
  return { items, height: names.length === 0 ? 0 : (row + 1) * 18 };
}

function plate(out: MapLayout, id: string, x: number, y: number, label: string, role: string, color: MapColor, testid?: string): void {
  out.rects.push({ id: `${id}-pl`, x: x + 12, y: y - 9, w: plateW(label, role), h: 18, rx: 9, fill: "card", stroke: color, testid });
  const spans: MapSpan[] = [{ text: label }];
  if (role) spans.push({ text: ` ${role}`, cls: "r" });
  out.texts.push({ id: `${id}-pt`, x: x + 22, y, cls: "pl", baseline: "central", spans });
}

function toolChips(out: MapLayout, idPrefix: string, names: string[], x: number, y: number, width: number): number {
  const packed = packTools(names, x, y, width);
  for (const it of packed.items) {
    out.glyphs.push({ id: `${idPrefix}-w-${it.name}`, kind: "wrench", x: it.x, y: it.y - 4.5 });
    out.texts.push({ id: `${idPrefix}-t-${it.name}`, x: it.x + 13, y: it.y, cls: "v", baseline: "central", spans: [{ text: it.name }] });
  }
  return packed.height;
}

export function computeLayoutMap(inp: LayoutMapInputs): MapLayout {
  const out: MapLayout = { width: W, height: 0, rects: [], glyphs: [], texts: [], paths: [], dots: [] };
  const webOn = inp.webTools.length > 0;
  let y = 26;

  // ── you ────────────────────────────────────────────────────────────────
  out.rects.push({ id: "you", x: LX, y, w: 196, h: 42, rx: 10, fill: "card", stroke: "strong" });
  plate(out, "you", LX, y, "You", "· browser", "strong");
  out.dots.push({ id: "you-dot", x: LX + 22, y: y + 26, r: 3, color: "dot" });
  out.texts.push({ id: "you-here", x: LX + 32, y: y + 29, cls: "r", spans: [{ text: "you are here" }] });
  const youBottom = y + 42;
  y = youBottom + 30;
  const machineCx = plateCx(LX, "Your machine", "· app host");
  out.paths.push({ id: "you-link", d: `M${machineCx} ${youBottom}V${y - 9}`, stroke: "strong", markerEnd: true, markerStart: true });

  // ── app host ───────────────────────────────────────────────────────────
  const hostTop = y;
  const hTop = hostTop + 20;
  out.texts.push({
    id: "harness-h",
    x: LX + 26,
    y: hTop + 18,
    cls: "n",
    spans: [{ text: "harness " }, { text: `backend · ${inp.agentName}`, cls: "r" }],
  });
  const packedH = toolChips(out, "ht", inp.plainTools, LX + 26, hTop + 38 + 9, LW - 60);

  const subTop = hTop + 38 + packedH + 8;
  let subBottom = subTop - 8;
  let webBottom = 0;
  const xWeb = plateCx(COL_R, "browsing enabler", "");
  if (inp.ragOn) {
    // the tool, and its dynamic dependency as a separate block below it — both
    // inside the harness (index reads happen in the backend process, data
    // under .knowledge on this machine)
    const sx = LX + 26;
    const sw = 166;
    const scx = sx + sw / 2;
    const SUB_H = 30;
    out.rects.push({ id: "k-tool", x: sx, y: subTop, w: sw, h: SUB_H, rx: 6, fill: "sub", stroke: "soft", testid: "layout-map-knowledge" });
    out.glyphs.push({ id: "k-wrench", kind: "wrench", x: sx + 12, y: subTop + SUB_H / 2 - 4.5 });
    out.texts.push({ id: "k-name", x: sx + 25, y: subTop + SUB_H / 2, cls: "v", baseline: "central", spans: [{ text: "knowledge" }] });
    const idxTop = subTop + SUB_H + 26;
    const rows = Math.max(inp.sources.length, 1);
    const idxH = 30 + rows * 15;
    out.dots.push({ id: "k-port", x: scx, y: subTop + SUB_H, r: 2.5, color: "text2" });
    out.paths.push({ id: "k-link", d: `M${scx} ${subTop + SUB_H}V${idxTop - 4}`, stroke: "strong", markerEnd: true });
    out.rects.push({ id: "k-idx", x: sx, y: idxTop, w: sw, h: idxH, rx: 6, fill: "sub", stroke: "soft", testid: "layout-map-knowledge-index" });
    out.glyphs.push({ id: "k-cyl", kind: "cylinder", x: sx + 12, y: idxTop + 9 });
    out.texts.push({ id: "k-idx-h", x: sx + 29, y: idxTop + 18, cls: "r", spans: [{ text: "knowledge index" }] });
    inp.sources.forEach((name, i) => {
      out.texts.push({ id: `k-src-${name}`, x: sx + 12, y: idxTop + 36 + i * 15, cls: "v", spans: [{ text: name }] });
    });
    if (inp.sources.length === 0) {
      out.texts.push({ id: "k-src-none", x: sx + 12, y: idxTop + 36, cls: "v", color: "text3", spans: [{ text: "no source selected" }] });
    }
    subBottom = Math.max(subBottom, idxTop + idxH);
  }
  if (webOn) {
    // one wrench per tool; the pair shares one dependency (the enabler below)
    const wH = 20 + inp.webTools.length * 18 + 12;
    out.rects.push({ id: "web-tool", x: COL_R, y: subTop, w: 166, h: wH, rx: 6, fill: "sub", stroke: "soft", testid: "layout-map-web" });
    toolChips(out, "wt", inp.webTools, COL_R + 12, subTop + 16 + 9, 100);
    webBottom = subTop + wH;
    out.dots.push({ id: "web-port", x: xWeb, y: webBottom, r: 2.5, color: "text2" });
    subBottom = Math.max(subBottom, webBottom);
  }
  const harnessBottom = subBottom + 14;
  out.rects.unshift({
    id: "harness",
    x: LX + 14,
    y: hTop,
    w: LW - 28,
    h: harnessBottom - hTop,
    rx: 6,
    fill: "card",
    stroke: "strong",
    testid: "layout-map-harness",
  });
  let iy = harnessBottom + 14;

  const sandbox = inp.sandbox;
  const hostToolNames = inp.hostTools.length > 0 ? inp.hostTools : [];
  /** Sandbox lane: a fixed x that sits inside the tool-host / sandbox plates. */
  const xSandbox = LX + 40;
  if (sandbox?.kind === "local") {
    const tTop = iy;
    const chipH = Math.max(toolChips(out, "tht", hostToolNames, LX + 26, tTop + 38 + 9, TH_W - 24), 18);
    const thH = 38 + chipH + 14;
    out.rects.push({ id: "th", x: LX + 14, y: tTop, w: TH_W, h: thH, rx: 6, fill: "card", stroke: "strong", testid: "layout-map-toolhost" });
    out.texts.push({ id: "th-h", x: LX + 26, y: tTop + 18, cls: "n", spans: [{ text: "tool-host " }, { text: "on this machine", cls: "r" }] });
    if (hostToolNames.length === 0) {
      out.texts.push({ id: "th-none", x: LX + 26, y: tTop + 38 + 9, cls: "v", color: "text3", baseline: "central", spans: [{ text: "no target tools enabled" }] });
    }
    out.dots.push({ id: "sb-port", x: xSandbox, y: harnessBottom, r: 2.5, color: "text2" });
    out.paths.push({ id: "sb-link", d: `M${xSandbox} ${harnessBottom}V${tTop}`, stroke: "strong", markerEnd: true });
    iy = tTop + thH + 14;
  } else if (sandbox?.kind === "none") {
    out.texts.push({
      id: "sb-none",
      x: LX + 26,
      y: iy + 12,
      cls: "r",
      spans: [{ text: `no sandbox — ${hostToolNames.length > 0 ? hostToolNames.join(", ") : "target tools"} unavailable` }],
    });
    iy += 26;
  }

  const hostH = iy - hostTop;
  out.rects.push({ id: "machine", x: LX, y: hostTop, w: LW, h: hostH, rx: 12, fill: "none", stroke: "strong", testid: "layout-map-machine" });
  plate(out, "machine", LX, hostTop, "Your machine", "· app host", "strong");
  const hostBottom = hostTop + hostH;
  y = hostBottom;

  // ── below the machine: browsing enabler (external service) ─────────────
  if (webOn) {
    const colTop = y + 40;
    const eH = 56;
    out.rects.push({ id: "enab", x: COL_R, y: colTop, w: CW, h: eH, rx: 12, fill: "none", stroke: "strong", testid: "layout-map-enabler" });
    plate(out, "enab", COL_R, colTop, "browsing enabler", "", "strong");
    out.texts.push({
      id: "enab-l",
      x: COL_R + 14,
      y: colTop + 34,
      cls: "v",
      spans: [{ text: "enabler " }, { text: "·", color: "text3" }, { text: " exit node" }],
    });
    // one straight corridor from the tools' port through both borders: this
    // traffic leaves your machine
    out.paths.push({ id: "web-link", d: `M${xWeb} ${webBottom}V${colTop - 9}`, stroke: "strong", markerEnd: true });
    const gy = colTop + eH + 30;
    out.paths.push({ id: "globe-link", d: `M${COL_R + CW / 2} ${colTop + eH}V${gy - 14}`, stroke: "amber", markerEnd: true });
    out.glyphs.push({ id: "globe", kind: "globe", x: COL_R + CW / 2, y: gy, color: "amber" });
    out.texts.push({ id: "globe-l", x: COL_R + CW / 2, y: gy + 28, cls: "r", anchor: "middle", color: "amber", spans: [{ text: "open internet" }] });
    y = gy + 34;
  }

  // ── remote sandbox box ─────────────────────────────────────────────────
  if (sandbox && sandbox.kind === "ssh") {
    const cTop = y + 40;
    const role = sandbox.docker ? "· container" : "· ssh host";
    out.dots.push({ id: "sb-port", x: xSandbox, y: harnessBottom, r: 2.5, color: "text2" });
    out.paths.push({ id: "sb-link", d: `M${xSandbox} ${harnessBottom}V${cTop - 9}`, stroke: "teal", markerEnd: true });
    const pillY = (hostBottom + cTop - 9) / 2;
    out.rects.push({ id: "sb-pill", x: xSandbox - 22, y: pillY - 7.5, w: 44, h: 15, rx: 7.5, fill: "card", stroke: "teal" });
    out.texts.push({ id: "sb-pill-t", x: xSandbox, y: pillY, cls: "lab", anchor: "middle", baseline: "central", color: "teal", spans: [{ text: "ssh" }] });

    const chipY = cTop + 18 + 38 + 9;
    const innerH = 38 + Math.max(18, toolChips(out, "sbt", hostToolNames, LX + 26, chipY, LW - 60)) + 14;
    const extraLines: MapText[] = [];
    let ly = cTop + 18 + innerH + 20;
    if (sandbox.docker && sandbox.mounts.length > 0) {
      for (const [i, m] of sandbox.mounts.entries()) {
        const spans: MapSpan[] = [{ text: m.readonly ? "→ " : "⇄ ", color: "text3" }, { text: m.host }];
        if (m.container !== m.host) spans.push({ text: " → ", color: "text3" }, { text: m.container });
        spans.push({ text: m.readonly ? "  read-only" : "  rw", color: "text3" });
        extraLines.push({ id: `sb-mount-${i}`, x: LX + 14, y: ly, cls: "v", spans });
        ly += 16;
      }
    } else if (!sandbox.docker && sandbox.sshHost) {
      extraLines.push({
        id: "sb-host",
        x: LX + 14,
        y: ly,
        cls: "v",
        spans: [{ text: "host ", color: "text3" }, { text: sandbox.sshHost }],
      });
      ly += 16;
    }
    const cH = 18 + innerH + (extraLines.length > 0 ? (ly - (cTop + 18 + innerH)) - 4 : 0) + 14;
    out.rects.push({ id: "sb-box", x: LX, y: cTop, w: LW, h: cH, rx: 12, fill: "none", stroke: "teal", strokeWidth: 1.5, testid: "layout-map-sandbox" });
    plate(out, "sb", LX, cTop, sandbox.name, role, "teal");
    out.rects.push({ id: "sb-th", x: LX + 14, y: cTop + 18, w: LW - 28, h: innerH, rx: 6, fill: "card", stroke: "strong", testid: "layout-map-toolhost" });
    out.texts.push({
      id: "th-h",
      x: LX + 26,
      y: cTop + 36,
      cls: "n",
      spans: [{ text: "tool-host " }, { text: sandbox.docker ? "in the container" : "on the remote host", cls: "r" }],
    });
    if (hostToolNames.length === 0) {
      out.texts.push({ id: "th-none", x: LX + 26, y: chipY, cls: "v", color: "text3", baseline: "central", spans: [{ text: "no target tools enabled" }] });
    }
    out.texts.push(...extraLines);
    y = cTop + cH;
  }

  // ── external models (right column) ─────────────────────────────────────
  // Models hang off ONE trunk leaving the harness, so no other block can look
  // like the origin (the tool-host never calls an LLM).
  const modelTop = hTop + 24;
  const BUS = RX - 22;
  const port = { x: LX + LW - 14, y: Math.min(hTop + 40, harnessBottom - 14) };
  const lastY = modelTop + (inp.models.length - 1) * 44;
  out.paths.push({
    id: "model-trunk",
    d: `M${port.x} ${port.y}H${BUS}V${modelTop - 4}M${BUS} ${port.y}V${lastY - 4}`,
    stroke: "strong",
  });
  out.dots.push({ id: "model-port", x: port.x, y: port.y, r: 2.5, color: "text2" });
  let sysY = modelTop;
  inp.models.forEach((m, i) => {
    sysY = modelTop + i * 44;
    out.paths.push({ id: `model-a-${m.role}`, d: `M${BUS} ${sysY - 4}H${RX - 8}`, stroke: "strong", markerEnd: true, markerStart: m.twoWay });
    out.dots.push({ id: `model-d-${m.role}`, x: RX, y: sysY - 4, r: 2.5, color: "text2" });
    out.texts.push({ id: `model-r-${m.role}`, x: RX + 10, y: sysY, cls: "n", spans: [{ text: m.role }] });
    out.texts.push({ id: `model-m-${m.role}`, x: RX + 10, y: sysY + 15, cls: "v", spans: [{ text: m.name }] });
  });

  out.height = Math.max(y + 20, sysY + 40);
  return out;
}
