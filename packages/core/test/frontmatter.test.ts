import { describe, it, expect } from "vitest";
import {
  splitFrontmatter,
  parseNoteFrontmatter,
  readFlatFrontmatter,
} from "../src/frontmatter.js";

describe("splitFrontmatter", () => {
  it("splits a frontmatter block from the body (LF)", () => {
    const split = splitFrontmatter("---\nnode_type: start\n---\nBody line.");
    expect(split).not.toBeNull();
    expect(split!.raw).toBe("node_type: start");
    expect(split!.body).toBe("Body line.");
  });

  it("is CRLF-tolerant", () => {
    const split = splitFrontmatter("---\r\nnode_type: start\r\n---\r\nBody line.");
    expect(split).not.toBeNull();
    expect(split!.raw).toBe("node_type: start");
    expect(split!.body).toBe("Body line.");
  });

  it("returns an empty body when nothing follows the closing fence", () => {
    expect(splitFrontmatter("---\nk: v\n---")!.body).toBe("");
    expect(splitFrontmatter("---\nk: v\n---\n")!.body).toBe("");
  });

  it("returns null when there is no opening frontmatter block", () => {
    expect(splitFrontmatter("no frontmatter here")).toBeNull();
    expect(splitFrontmatter("text\n---\nk: v\n---")).toBeNull();
  });
});

describe("parseNoteFrontmatter", () => {
  it("parses YAML frontmatter into an object plus body", () => {
    const parsed = parseNoteFrontmatter<{ node_type: string }>(
      "---\nnode_type: start\nclass: WorkflowNode\n---\nBegin.",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.node_type).toBe("start");
    expect(parsed!.body).toBe("Begin.");
  });

  it("parses identically across LF and CRLF", () => {
    const lf = parseNoteFrontmatter<{ node_type: string }>("---\nnode_type: end\n---\nDone.");
    const crlf = parseNoteFrontmatter<{ node_type: string }>("---\r\nnode_type: end\r\n---\r\nDone.");
    expect(crlf!.frontmatter.node_type).toBe("end");
    expect(crlf!.frontmatter).toEqual(lf!.frontmatter);
  });

  it("returns null without a frontmatter block", () => {
    expect(parseNoteFrontmatter("plain text")).toBeNull();
  });
});

describe("readFlatFrontmatter", () => {
  it("reads flat key: value pairs", () => {
    const fm = readFlatFrontmatter("---\nperspecta_generated: true\nperspecta_version: 0.1.0\n---\nbody");
    expect(fm.perspecta_generated).toBe("true");
    expect(fm.perspecta_version).toBe("0.1.0");
  });

  it("is CRLF-tolerant (no stray \\r left on values)", () => {
    const fm = readFlatFrontmatter("---\r\nperspecta_version: 0.1.0\r\n---\r\nbody");
    expect(fm.perspecta_version).toBe("0.1.0");
  });

  it("skips lines without a colon and ignores empty keys", () => {
    const fm = readFlatFrontmatter("---\nnot a pair\nkey: value\n---");
    expect(fm).toEqual({ key: "value" });
  });

  it("returns {} without a frontmatter block", () => {
    expect(readFlatFrontmatter("nope")).toEqual({});
  });
});
