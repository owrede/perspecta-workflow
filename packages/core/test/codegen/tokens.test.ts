import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

/** Minimal input→agent→output doc with one typed input token on the agent. The
 *  input-node output port matches the agent's port type so the wire is clean. */
function docWithInput(prompt: string, inType: "string" | "object" | "array"): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "tok", description: "d" },
    nodes: [
      { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: inType } }] },
      { id: "ag", kind: "agent", label: "Write", prompt, inputs: [{ id: "in:topic", name: "topic", schema: { type: inType }, required: false }], outputs: [{ id: "out", name: "out", schema: { type: "any" } }] },
      { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "result", schema: { type: "any" } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "in:topic" } },
      { from: { nodeId: "ag", portId: "out" }, to: { nodeId: "out", portId: "i" } },
    ],
    editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
  };
}

describe("input token interpolation (string)", () => {
  it("replaces {{in:topic}} inline with the wired source expression", () => {
    const code = generateClaudeCodeWorkflow(docWithInput("Write about {{in:topic}} now.", "string"));
    expect(code).toContain("Write about ${args.topic} now.");
    expect(code).not.toContain("{{in:topic}}");
    expect(code).not.toContain('<context name="topic">');
  });
  it("an unwired tokened input interpolates an empty string", () => {
    const doc = docWithInput("Write about {{in:topic}} now.", "string");
    const noWire: PflowDocument = { ...doc, wires: doc.wires.filter((w) => w.to.portId !== "in:topic") };
    const code = generateClaudeCodeWorkflow(noWire);
    expect(code).toContain('Write about ${""} now.');
  });
});

describe("output token rendering (name in place)", () => {
  function docWithOutput(prompt: string): PflowDocument {
    return {
      pflowFormatVersion: 1,
      workflow: { name: "o", description: "d" },
      nodes: [
        { id: "ag", kind: "agent", label: "Make", prompt, inputs: [], outputs: [{ id: "out:draft", name: "draft", schema: { type: "string" } }] },
        { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "r", schema: { type: "any" } }], outputs: [] },
      ],
      wires: [{ from: { nodeId: "ag", portId: "out:draft" }, to: { nodeId: "out", portId: "i" } }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
    };
  }
  it("renders a single {{out:name}} as the bare name in place", () => {
    const code = generateClaudeCodeWorkflow(docWithOutput("Return the {{out:draft}} now."));
    expect(code).toContain("Return the draft now.");
    expect(code).not.toContain("{{out:draft}}");
  });
  it("renders every occurrence of a repeated out-token as the same name (one port)", () => {
    const code = generateClaudeCodeWorkflow(docWithOutput("Write {{out:draft}}, revise {{out:draft}}, ship {{out:draft}}."));
    expect(code).toContain("Write draft, revise draft, ship draft.");
  });
});

describe("input token interpolation (json / table)", () => {
  it("json input wraps the source in JSON.stringify", () => {
    const code = generateClaudeCodeWorkflow(docWithInput("Process {{in:topic:json}} fully.", "object"));
    expect(code).toContain("Process ${JSON.stringify(args.topic, null, 2)} fully.");
  });
  it("table input renders the source as a Markdown table and emits the helper", () => {
    const code = generateClaudeCodeWorkflow(docWithInput("Read {{in:topic:table}} rows.", "array"));
    expect(code).toContain("Read ${toMarkdownTable(args.topic)} rows.");
    // helper definition is emitted exactly once
    expect(code).toContain("function toMarkdownTable(");
  });
});

/** input→agent(2 outputs)→two output nodes, each consuming one named output. */
const MULTI: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "multi", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    {
      id: "ag",
      kind: "agent",
      label: "Make",
      prompt: "From {{in:topic}} produce {{out:title}} and {{out:body}}.",
      inputs: [{ id: "in:topic", name: "topic", schema: { type: "string" } }],
      outputs: [
        { id: "out:title", name: "title", schema: { type: "string" } },
        { id: "out:body", name: "body", schema: { type: "string" } },
      ],
    },
    { id: "t", kind: "output", label: "T", inputs: [{ id: "i", name: "r", schema: { type: "string" } }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "in:topic" } },
    { from: { nodeId: "ag", portId: "out:title" }, to: { nodeId: "t", portId: "i" } },
  ],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
};

describe("multi-output (2+ out tokens)", () => {
  it("emits a delimiter instruction and per-output parse", () => {
    const code = generateClaudeCodeWorkflow(MULTI);
    expect(code).toContain("<<<out:title>>>");
    expect(code).toContain("<<<out:body>>>");
    expect(code).toMatch(/split\("<<<out:title>>>"\)/);
  });
  it("a downstream consumer reads the parsed output var, not the raw agent result", () => {
    const code = generateClaudeCodeWorkflow(MULTI);
    expect(code).toMatch(/return \w+__title;/);
  });
  it("runs: parses each section; a missing section yields empty string", async () => {
    const code = generateClaudeCodeWorkflow(MULTI);
    const body = code.replace(/export const meta[\s\S]*?\n}\n/, "");
    // Stub agent returns only the title section (body section absent).
    const agent = async () => "<<<out:title>>>\nHELLO\n<<<end>>>";
    const runner = new Function(
      "agent",
      "args",
      "log",
      "pipeline",
      `return (async () => {\n${body}\n})();`,
    );
    const result = await runner(agent, { topic: "x" }, () => {}, async () => []);
    expect(String(result).trim()).toBe("HELLO");
  });
});

describe("generated code runs (table / json serialization)", () => {
  // Run the generated body with a stub `agent` that echoes the prompt it
  // received, so we can assert how the typed value was serialised into the
  // prompt. The meta export is stripped; the body's top-level `return` (from the
  // output node) is preserved by wrapping it in an async IIFE. Mirrors the
  // run-the-generated-code discipline already used in scriptgen.test.ts.
  function runBody(code: string, args: unknown): Promise<unknown> {
    const body = code.replace(/export const meta[\s\S]*?\n}\n/, "");
    const agent = async (prompt: string) => prompt;
    const runner = new Function(
      "agent",
      "args",
      "log",
      "pipeline",
      `return (async () => {\n${body}\n})();`,
    );
    return runner(agent, args, () => {}, async () => []);
  }

  it("renders an array of row objects as a Markdown table in the prompt", async () => {
    const code = generateClaudeCodeWorkflow(docWithInput("Read {{in:topic:table}} rows.", "array"));
    const result = await runBody(code, { topic: [{ a: 1, b: 2 }, { a: 3, b: 4 }] });
    expect(String(result)).toContain("| a | b |");
    expect(String(result)).toContain("| 1 | 2 |");
    expect(String(result)).toContain("| 3 | 4 |");
  });

  it("json input serializes the value as pretty JSON in the prompt", async () => {
    const code = generateClaudeCodeWorkflow(docWithInput("Process {{in:topic:json}} fully.", "object"));
    const result = await runBody(code, { topic: { k: "v" } });
    expect(String(result)).toContain('"k": "v"');
  });
});
