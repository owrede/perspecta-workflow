import { z } from "zod";

/** JSON-Schema-like description of a port value. Recursive. Reused verbatim as
 *  the agent({ schema }) argument at codegen time. */
export type PortSchema =
  | { type: "string" | "number" | "boolean" | "any" }
  | { type: "array"; items?: PortSchema }
  | { type: "object"; properties?: Record<string, PortSchema>; required?: string[] };

export const PortSchemaZ: z.ZodType<PortSchema> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(["string", "number", "boolean", "any"]) }),
    z.object({ type: z.literal("array"), items: PortSchemaZ.optional() }),
    z.object({
      type: z.literal("object"),
      properties: z.record(z.string(), PortSchemaZ).optional(),
      required: z.array(z.string()).optional(),
    }),
  ]),
);
