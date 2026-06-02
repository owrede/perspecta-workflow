import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { Stepper } from "../src/stepper.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("Stepper linear walk", () => {
  it("starts at the start node", () => {
    const s = new Stepper(join(FIX, "linear.canvas"));
    const cur = s.current();
    expect(cur.kind).toBe("start");
    expect(cur.outgoing).toHaveLength(1);
    expect(cur.outgoing[0].toId).toBe("p");
  });

  it("advances along the only edge and resolves templates", () => {
    const s = new Stepper(join(FIX, "linear.canvas"));
    s.advance({ outputs: { topic: "the meeting" } }); // from start -> p
    const cur = s.current();
    expect(cur.kind).toBe("prompt");
    expect(cur.instruction).toBe("Summarize the meeting.");
  });

  it("reaches the end node and reports done", () => {
    const s = new Stepper(join(FIX, "linear.canvas"));
    s.advance();                         // start -> p
    s.advance({ outputs: { summary: "x" } }); // p -> e
    expect(s.current().kind).toBe("end");
    expect(s.status().atEnd).toBe(true);
  });
});
