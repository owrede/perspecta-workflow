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

/** Full node vocabulary (spec section 4). */
export const NODE_KINDS = [
  "input", "output", "agent",
  "split", "join",
  "loop", "verify", "synthesize", "branch",
  "script",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const PortZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  schema: PortSchemaZ,
  required: z.boolean().optional(),
  /** True when the port is no longer declared by its node's prompt tokens but is
   *  still referenced by a wire — kept so the wire survives as a dashed
   *  (inactive) edge until the user clears it. */
  orphan: z.boolean().optional(),
});
export type Port = z.infer<typeof PortZ>;

export const PflowNodeZ = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(NODE_KINDS),
  label: z.string(),
  prompt: z.string().optional(),
  inputs: z.array(PortZ),
  outputs: z.array(PortZ),
  phase: z.string().optional(),
  log: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type PflowNode = z.infer<typeof PflowNodeZ>;

export const WireZ = z.object({
  from: z.object({ nodeId: z.string(), portId: z.string() }),
  to: z.object({ nodeId: z.string(), portId: z.string() }),
});
export type Wire = z.infer<typeof WireZ>;

export const PflowDocumentZ = z.object({
  pflowFormatVersion: z.literal(1),
  workflow: z.object({
    name: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
    description: z.string(),
    args: PortSchemaZ.optional(),
  }),
  nodes: z.array(PflowNodeZ),
  wires: z.array(WireZ),
  editor: z
    .object({
      viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
      nodePositions: z.array(
        z.object({
          nodeId: z.string(),
          x: z.number(),
          y: z.number(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
      inspectorWidth: z.number().optional(),
    })
    .optional(),
});
export type PflowDocument = z.infer<typeof PflowDocumentZ>;

/** Parse + validate a .pflow file's JSON text. Throws ZodError / SyntaxError. */
export function parsePflow(text: string): PflowDocument {
  return PflowDocumentZ.parse(JSON.parse(text));
}
