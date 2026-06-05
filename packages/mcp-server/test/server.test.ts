import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { handlers, resetSessions } from "../src/server.js";

const FIX = join(import.meta.dirname, "..", "..", "core", "test", "fixtures");

describe("MCP handlers", () => {
  it("workflow_lint returns ok for a valid workflow", async () => {
    const r = await handlers.workflow_lint({ canvas: join(FIX, "linear.canvas") });
    expect(r.ok).toBe(true);
  });

  it("workflow_start + workflow_current returns the start node", async () => {
    resetSessions();
    const started = await handlers.workflow_start({ canvas: join(FIX, "linear.canvas") });
    expect(started.session).toBeTruthy();
    const cur = await handlers.workflow_current({ session: started.session! });
    expect(cur.kind).toBe("start");
  });

  it("workflow_advance moves the cursor", async () => {
    resetSessions();
    const started = await handlers.workflow_start({ canvas: join(FIX, "linear.canvas") });
    await handlers.workflow_advance({ session: started.session!, outputs: { topic: "x" } });
    const cur = await handlers.workflow_current({ session: started.session! });
    expect(cur.kind).toBe("prompt");
  });

  it("workflow_current rejects on an unknown session", async () => {
    resetSessions();
    await expect(
      handlers.workflow_current({ session: "does-not-exist" }),
    ).rejects.toThrow("Unknown session");
  });

  it("frees the session automatically once a run reaches its end node", async () => {
    resetSessions();
    const started = await handlers.workflow_start({ canvas: join(FIX, "linear.canvas") });
    const session = started.session!;
    // start -> prompt
    await handlers.workflow_advance({ session, outputs: { topic: "x" } });
    // prompt -> end (atEnd); the session should be evicted here
    const last = await handlers.workflow_advance({ session });
    expect(last.atEnd).toBe(true);
    await expect(handlers.workflow_status({ session })).rejects.toThrow("Unknown session");
  });

  it("workflow_end releases a live session and is idempotent", async () => {
    resetSessions();
    const started = await handlers.workflow_start({ canvas: join(FIX, "linear.canvas") });
    const session = started.session!;
    expect(await handlers.workflow_end({ session })).toEqual({ ok: true, ended: true });
    expect(await handlers.workflow_end({ session })).toEqual({ ok: true, ended: false });
    await expect(handlers.workflow_current({ session })).rejects.toThrow("Unknown session");
  });
});
