import type { PortSchema } from "./schema.js";

/** Shallow M1 port-compatibility. `any` joins anything; scalars must match
 *  exactly; arrays must agree on item type (missing items === any); objects
 *  join objects without deep property subtyping. */
export function schemaCompatible(from: PortSchema, to: PortSchema): boolean {
  if (from.type === "any" || to.type === "any") return true;
  if (from.type !== to.type) return false;
  if (from.type === "array" && to.type === "array") {
    const fi = from.items ?? { type: "any" as const };
    const ti = to.items ?? { type: "any" as const };
    return schemaCompatible(fi, ti);
  }
  return true;
}
