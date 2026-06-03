import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { Stepper } from "../src/stepper.js";
import { diskFs } from "./helpers.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("Stepper linear walk", () => {
  it("starts at the start node", () => {
    const s = new Stepper(join(FIX, "linear.canvas"), { fs: diskFs });
    const cur = s.current();
    expect(cur.kind).toBe("start");
    expect(cur.outgoing).toHaveLength(1);
    expect(cur.outgoing[0].toId).toBe("p");
  });

  it("advances along the only edge and resolves templates", () => {
    const s = new Stepper(join(FIX, "linear.canvas"), { fs: diskFs });
    s.advance({ outputs: { topic: "the meeting" } }); // from start -> p
    const cur = s.current();
    expect(cur.kind).toBe("prompt");
    expect(cur.instruction).toBe("Summarize the meeting.");
  });

  it("reaches the end node and reports done", () => {
    const s = new Stepper(join(FIX, "linear.canvas"), { fs: diskFs });
    s.advance();                         // start -> p
    s.advance({ outputs: { summary: "x" } }); // p -> e
    expect(s.current().kind).toBe("end");
    expect(s.status().atEnd).toBe(true);
  });
});

describe("Stepper nested subworkflow", () => {
  it("descends into the child at its start and shares context", () => {
    const s = new Stepper(join(FIX, "parent.canvas"), { fs: diskFs });
    expect(s.current().kind).toBe("start");      // parent start
    s.advance({ outputs: { fromParent: 1 } });   // parent start -> sub (descends)
    const cur = s.current();
    expect(cur.kind).toBe("start");              // child start
    expect(s.status().depth).toBe(2);
    expect(s.context().fromParent).toBe(1);      // shared bag
  });

  it("pops back to the parent after the child end and finishes", () => {
    const s = new Stepper(join(FIX, "parent.canvas"), { fs: diskFs });
    s.advance();   // parent start -> descend into child start
    s.advance();   // child start -> child end
    expect(s.current().kind).toBe("end");        // child end
    s.advance();   // child end -> pop -> parent end
    expect(s.current().kind).toBe("end");        // parent end
    expect(s.status().depth).toBe(1);
    expect(s.status().atEnd).toBe(true);
  });
});

describe("Stepper branch selection", () => {
  it("exposes two labeled outgoing edges at the branch node", () => {
    const s = new Stepper(join(FIX, "branch.canvas"), { fs: diskFs });
    s.advance(); // start -> b (single edge, auto-followed)
    const cur = s.current();
    expect(cur.outgoing).toHaveLength(2);
    expect(cur.outgoing.map((o) => o.label).sort()).toEqual(["no", "yes"]);
  });

  it("follows the chosen labeled edge to the matching end", () => {
    const s = new Stepper(join(FIX, "branch.canvas"), { fs: diskFs });
    s.advance();                  // start -> b
    s.advance({ edge: "yes" });   // b -> ey
    expect(s.current().kind).toBe("end");
    expect(s.status().currentId).toBe("ey");
  });

  it("throws at a branch when no edge label is supplied", () => {
    const s = new Stepper(join(FIX, "branch.canvas"), { fs: diskFs });
    s.advance(); // start -> b
    expect(() => s.advance()).toThrow();
  });

  it("throws when an unknown edge label is supplied at a branch", () => {
    const s = new Stepper(join(FIX, "branch.canvas"), { fs: diskFs });
    s.advance(); // start -> b
    expect(() => s.advance({ edge: "nope" })).toThrow();
  });
});
