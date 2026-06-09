import { describe, it, expect } from "vitest";
import {
  jsonSchemaToPortSchema,
  parseContractInputs,
  parseContractOutputs,
  contractSnapshotFromDescribe,
} from "../../src/pflow/contract.js";

/** Literal fixture mirroring the real vm_meeting_prep inputSchema (captured
 *  from describe_contract against the INIM-VM-TEST vault, 2026-06-09). */
const MEETING_PREP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    vault: { type: "string", description: "Name des Vaults." },
    meeting_path: { type: "string", description: "Vault-relativer Pfad der Meeting-Notiz." },
    context_doc_ids: { type: "array", items: { type: "string" }, description: "DocIds des Kontexts." },
  },
  required: ["vault", "meeting_path", "context_doc_ids"],
  additionalProperties: false,
};

/** meeting-prep output_shape: steps.compiled.{ok,doc_id} — compiled is an
 *  OBJECT, so the 1-level projection emits no child for it. */
const MEETING_PREP_OUTPUT_SHAPE = {
  type: "object",
  properties: {
    steps: {
      type: "object",
      properties: {
        compiled: {
          type: "object",
          properties: { ok: { type: "boolean" }, doc_id: { type: "string" } },
          required: ["ok", "doc_id"],
        },
      },
      required: ["compiled"],
    },
  },
  required: ["steps"],
};

/** code-review-brief output_shape: opaque steps + write_back.doc_id (the
 *  design's canonical projection case). */
const CODE_REVIEW_BRIEF_OUTPUT_SHAPE = {
  type: "object",
  properties: {
    steps: { type: "object" },
    write_back: {
      type: "object",
      properties: { doc_id: { type: "string" } },
      required: ["doc_id"],
    },
  },
  required: ["write_back"],
};

describe("jsonSchemaToPortSchema", () => {
  it("maps scalar types through", () => {
    expect(jsonSchemaToPortSchema({ type: "string" })).toEqual({ type: "string" });
    expect(jsonSchemaToPortSchema({ type: "number" })).toEqual({ type: "number" });
    expect(jsonSchemaToPortSchema({ type: "boolean" })).toEqual({ type: "boolean" });
  });
  it("maps integer to number (PortSchema has no integer)", () => {
    expect(jsonSchemaToPortSchema({ type: "integer" })).toEqual({ type: "number" });
  });
  it("maps array with typed items", () => {
    expect(jsonSchemaToPortSchema({ type: "array", items: { type: "string" } })).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
  it("maps array without items", () => {
    expect(jsonSchemaToPortSchema({ type: "array" })).toEqual({ type: "array" });
  });
  it("maps a nested object with properties and required", () => {
    expect(
      jsonSchemaToPortSchema({
        type: "object",
        properties: { ok: { type: "boolean" }, ids: { type: "array", items: { type: "string" } } },
        required: ["ok"],
      }),
    ).toEqual({
      type: "object",
      properties: { ok: { type: "boolean" }, ids: { type: "array", items: { type: "string" } } },
      required: ["ok"],
    });
  });
  it("maps an object without properties to a bare object", () => {
    expect(jsonSchemaToPortSchema({ type: "object" })).toEqual({ type: "object" });
  });
  it("maps unknown / $ref / missing type to any", () => {
    expect(jsonSchemaToPortSchema({ $ref: "#/types/DocId" })).toEqual({ type: "any" });
    expect(jsonSchemaToPortSchema(undefined)).toEqual({ type: "any" });
    expect(jsonSchemaToPortSchema("nonsense")).toEqual({ type: "any" });
    expect(jsonSchemaToPortSchema({ type: "null" })).toEqual({ type: "any" });
  });
});

describe("parseContractInputs", () => {
  it("turns the meeting-prep input schema into 3 required input defs in declared order", () => {
    const defs = parseContractInputs(MEETING_PREP_INPUT_SCHEMA);
    expect(defs.map((d) => d.name)).toEqual(["vault", "meeting_path", "context_doc_ids"]);
    expect(defs.every((d) => d.required)).toBe(true);
    expect(defs[0].schema).toEqual({ type: "string" });
    expect(defs[2].schema).toEqual({ type: "array", items: { type: "string" } });
  });
  it("honors a partial required list", () => {
    const defs = parseContractInputs({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["b"],
    });
    expect(defs.find((d) => d.name === "a")?.required).toBe(false);
    expect(defs.find((d) => d.name === "b")?.required).toBe(true);
  });
  it("accepts an explicit required override", () => {
    const defs = parseContractInputs({ type: "object", properties: { a: { type: "string" } } }, ["a"]);
    expect(defs[0].required).toBe(true);
  });
  it("returns [] for a schema without properties", () => {
    expect(parseContractInputs({ type: "object" })).toEqual([]);
    expect(parseContractInputs(undefined)).toEqual([]);
  });
});

describe("parseContractOutputs", () => {
  it("meeting-prep: emits a steps object port; object-typed nested prop emits no child", () => {
    const outs = parseContractOutputs(MEETING_PREP_OUTPUT_SHAPE);
    expect(outs.map((o) => o.name)).toEqual(["steps"]);
    expect(outs[0].projection).toBe("steps");
    expect(outs[0].schema.type).toBe("object");
  });
  it("code-review-brief: write_back.doc_id projects to a doc_id port", () => {
    const outs = parseContractOutputs(CODE_REVIEW_BRIEF_OUTPUT_SHAPE);
    expect(outs.map((o) => o.name)).toEqual(["steps", "write_back", "doc_id"]);
    const docId = outs.find((o) => o.name === "doc_id")!;
    expect(docId.projection).toBe("write_back.doc_id");
    expect(docId.schema).toEqual({ type: "string" });
  });
  it("falls back to a single bundle port when output_shape is absent", () => {
    expect(parseContractOutputs(undefined)).toEqual([
      { name: "bundle", schema: { type: "any" }, projection: "" },
    ]);
  });
  it("falls back to bundle when output_shape is non-object or has no properties", () => {
    expect(parseContractOutputs("opaque")).toEqual([
      { name: "bundle", schema: { type: "any" }, projection: "" },
    ]);
    expect(parseContractOutputs({ type: "object" })).toEqual([
      { name: "bundle", schema: { type: "any" }, projection: "" },
    ]);
  });
  it("flattens a colliding nested leaf name to <top>_<leaf>, deterministically", () => {
    const shape = {
      type: "object",
      properties: {
        status: { type: "string" },
        write_back: {
          type: "object",
          properties: { status: { type: "string" }, doc_id: { type: "string" } },
        },
      },
    };
    const outs = parseContractOutputs(shape);
    // declared order: status (top), write_back (top), then its leaves in order:
    // status collides → write_back_status; doc_id is free.
    expect(outs.map((o) => o.name)).toEqual(["status", "write_back", "write_back_status", "doc_id"]);
    expect(outs.find((o) => o.name === "write_back_status")?.projection).toBe("write_back.status");
    // Determinism: a second parse yields the identical array.
    expect(parseContractOutputs(shape)).toEqual(outs);
  });
});

describe("contractSnapshotFromDescribe", () => {
  it("builds a full snapshot from a describe_contract-shaped result", () => {
    const snap = contractSnapshotFromDescribe({
      json_schema: MEETING_PREP_INPUT_SCHEMA,
      output_shape: MEETING_PREP_OUTPUT_SHAPE,
      writes_to: ["default"],
    }, "2026-06-09T00:00:00Z");
    expect(snap.inputs.map((i) => i.name)).toEqual(["vault", "meeting_path", "context_doc_ids"]);
    expect(snap.outputs.map((o) => o.name)).toEqual(["steps"]);
    expect(snap.writesTo).toEqual(["default"]);
    expect(snap.describedAt).toBe("2026-06-09T00:00:00Z");
  });
  it("tolerates a minimal legacy describe result (no output_shape / writes_to)", () => {
    const snap = contractSnapshotFromDescribe({ json_schema: MEETING_PREP_INPUT_SCHEMA });
    expect(snap.outputs).toEqual([{ name: "bundle", schema: { type: "any" }, projection: "" }]);
    expect(snap.writesTo).toEqual([]);
    expect(snap.describedAt).toBeUndefined();
  });
});
