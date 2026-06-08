/** Eval node modes (v1). Each mode is a prompt template the inspector pre-fills;
 *  ports derive from the template's {{in:}}/{{out:}} tokens, so the templates are
 *  the single source of truth for an eval node's shape. */
export const EVAL_MODES = ["criteria", "comparison", "threshold"] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

const CRITERIA = `Evaluate {{in:candidate}} against these criteria:
- <criterion 1>
- <criterion 2>

Emit a verdict line exactly: EVAL: pass  (if all criteria are met)  OR  EVAL: fail
Then route to {{out:pass}} or {{out:fail}}.`;

const COMPARISON = `Compare {{in:candidate}} against the reference {{in:reference}}.

Emit a verdict line exactly: EVAL: pass  (if the candidate matches/meets the reference)  OR  EVAL: fail
Briefly explain the decisive difference, then route to {{out:pass}} or {{out:fail}}.`;

const THRESHOLD = `Score {{in:candidate}} on <dimension> from 1 to 10.

Emit a verdict line exactly: EVAL: pass  (if the score >= 7)  OR  EVAL: fail
State the score you assigned, then route to {{out:pass}} or {{out:fail}}.`;

const TEMPLATES: Record<EvalMode, string> = {
  criteria: CRITERIA,
  comparison: COMPARISON,
  threshold: THRESHOLD,
};

/** The pre-populated prompt template for a mode. */
export function templateForMode(mode: EvalMode): string {
  return TEMPLATES[mode];
}

/** The default mode for a freshly added eval node. */
export const DEFAULT_EVAL_MODE: EvalMode = "criteria";
