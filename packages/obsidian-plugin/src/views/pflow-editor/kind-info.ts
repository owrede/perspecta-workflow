import type { NodeKind } from "@perspecta/core";

/** Per-kind presentation metadata shared by the node card and the inspector:
 *  a Lucide icon path (viewBox 0 0 24 24), an Obsidian colour variable for the
 *  accent, a short title, and a one-line description of what the kind does. */
export interface KindInfo {
  /** Lucide path data (one or more subpaths). */
  icon: string;
  /** CSS expression for the kind's accent colour (Obsidian colour variable). */
  color: string;
  title: string;
  description: string;
}

/** Generic box icon for unknown kinds. */
export const FALLBACK_ICON =
  "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z";

export const KIND_INFO: Record<NodeKind, KindInfo> = {
  input: {
    icon: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3",
    color: "var(--color-green, #4caf50)",
    title: "Input",
    description: "An entry point: a value supplied when the workflow runs.",
  },
  output: {
    icon: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
    color: "var(--color-red, #e05252)",
    title: "Output",
    description: "An exit point: the value the workflow returns.",
  },
  agent: {
    icon: "M12 8V4H8 M2 14h2 M20 14h2 M15 13v2 M9 13v2 M4 8h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1Z",
    color: "var(--color-purple, #9c6ade)",
    title: "Agent",
    description: "An LLM step that processes its wired inputs.",
  },
  split: {
    icon: "M16 3h5v5 M8 3H3v5 M21 3l-7.5 7.5a2.83 2.83 0 0 0-.83 2v6.5 M3 3l7.5 7.5a2.83 2.83 0 0 1 .83 2V19",
    color: "var(--color-yellow, #d9a334)",
    title: "Split",
    description: "Fans an array out to run the next steps per item.",
  },
  join: {
    icon: "M8 3H3v5 M16 21h5v-5 M3 3l7.5 7.5a2.83 2.83 0 0 1 .83 2V19 M21 16l-7.5-7.5a2.83 2.83 0 0 1-.83-2V3",
    color: "var(--color-yellow, #d9a334)",
    title: "Join",
    description: "Collects the per-item results from a split back into a list.",
  },
  loop: {
    icon: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5",
    color: "var(--color-orange, #d9772e)",
    title: "Loop",
    description: "Repeats its upstream span until a sentinel condition is met.",
  },
  verify: {
    icon: "M21.801 10A10 10 0 1 1 17 3.335 M9 11l3 3L22 4",
    color: "var(--color-cyan, #2e9bd9)",
    title: "Verify",
    description: "Checks its input and records a pass/fail verdict (non-blocking).",
  },
  synthesize: {
    icon: "M10 18H5a3 3 0 0 1-3-3v-1 M14 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M20 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2 M7 21l3-3-3-3",
    color: "var(--color-cyan, #2e9bd9)",
    title: "Synthesize",
    description: "Merges several inputs into one result.",
  },
  branch: {
    icon: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M15 6a9 9 0 0 0-9 9",
    color: "var(--color-cyan, #2e9bd9)",
    title: "Branch",
    description: "Routes to one of several paths based on an LLM decision.",
  },
  mcp: {
    icon: "M9 2v6 M15 2v6 M6 8h12v3a6 6 0 0 1-12 0V8Z M12 17v5",
    color: "var(--color-blue, #3b82f6)",
    title: "MCP Connector",
    description: "Reaches an external service (an MCP server) and returns its result.",
  },
  script: {
    icon: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
    color: "var(--text-faint, #888)",
    title: "Script",
    description: "A terminal escape hatch: hand-written workflow code.",
  },
};

/** Icon path for a kind, falling back to a generic box for unknown values. */
export function iconForKind(kind: string): string {
  return KIND_INFO[kind as NodeKind]?.icon ?? FALLBACK_ICON;
}

/** Accent colour expression for a kind. */
export function colorForKind(kind: string): string {
  return KIND_INFO[kind as NodeKind]?.color ?? "var(--text-muted)";
}

/** Kinds that carry a free-text prompt (so the inspector shows a Prompt field). */
export const PROMPT_KINDS: NodeKind[] = ["agent", "verify", "synthesize", "loop", "branch", "mcp"];
