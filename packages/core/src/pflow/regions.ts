import type { PflowDocument, Wire } from "./schema.js";
import { nodeById, outWires } from "./topo.js";

/** A bounded loop: a refine back-edge from the loop node's output to an
 *  upstream node makes a cycle; the span is the forward path from the back-edge
 *  target down to the loop node. */
export interface LoopRegion {
  kind: "loop";
  entryId: string;
  memberIds: string[];
  backEdge: Wire;
}

/** A fan-out: a split node and its matching downstream join; the span is the
 *  nodes strictly between them. */
export interface SplitJoinRegion {
  kind: "splitjoin";
  entryId: string;
  joinId: string;
  memberIds: string[];
}

/** A conditional: a branch node with one labelled path per outgoing port. */
export interface BranchRegion {
  kind: "branch";
  entryId: string;
  paths: { label: string; memberIds: string[] }[];
}

export type Region = LoopRegion | SplitJoinRegion | BranchRegion;

export interface RegionAnalysis {
  regions: Region[];
  /** Node ids emitted as part of a region — skipped at the top level. */
  absorbed: Set<string>;
}

/** All member ids a region absorbs (entry + members, both ends for splitjoin). */
export function memberIdsOf(r: Region): string[] {
  if (r.kind === "loop") return r.memberIds;
  if (r.kind === "splitjoin") return [r.entryId, ...r.memberIds, r.joinId];
  return [r.entryId, ...r.paths.flatMap((p) => p.memberIds)];
}

// ---- loop ----------------------------------------------------------------

function findLoopRegions(doc: PflowDocument): LoopRegion[] {
  const regions: LoopRegion[] = [];
  for (const node of doc.nodes) {
    if (node.kind !== "loop") continue;
    // The back-edge is the loop's own outgoing wire whose target can reach the
    // loop again via forward (non-back) wires — i.e. it closes a cycle.
    const back = outWires(doc, node.id).find((w) => reaches(doc, w.to.nodeId, node.id, w));
    if (!back) continue;
    const members = pathNodes(doc, back.to.nodeId, node.id, back);
    regions.push({ kind: "loop", entryId: node.id, memberIds: members, backEdge: back });
  }
  return regions;
}

/** True if `fromId` can reach `toId` via forward wires (excluding `exclude`). */
function reaches(doc: PflowDocument, fromId: string, toId: string, exclude: Wire): boolean {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === toId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const w of outWires(doc, id)) {
      if (w === exclude) continue;
      stack.push(w.to.nodeId);
    }
  }
  return false;
}

/** Nodes on forward paths from startId to endId (inclusive), excluding the
 *  back-edge. Declaration-ordered. */
function pathNodes(doc: PflowDocument, startId: string, endId: string, exclude: Wire): string[] {
  const onPath = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (id === endId) {
      for (const t of [...trail, id]) onPath.add(t);
      return;
    }
    if (trail.includes(id)) return; // cycle guard
    for (const w of outWires(doc, id)) {
      if (w === exclude) continue;
      visit(w.to.nodeId, [...trail, id]);
    }
  };
  visit(startId, []);
  return doc.nodes.filter((n) => onPath.has(n.id)).map((n) => n.id);
}

// ---- split / join --------------------------------------------------------

function findSplitJoinRegions(doc: PflowDocument): SplitJoinRegion[] {
  const regions: SplitJoinRegion[] = [];
  for (const split of doc.nodes.filter((n) => n.kind === "split")) {
    const join = findMatchingJoin(doc, split.id);
    if (!join) continue;
    const between = pathNodesBetween(doc, split.id, join);
    regions.push({ kind: "splitjoin", entryId: split.id, joinId: join, memberIds: between });
  }
  return regions;
}

/** First downstream join reachable from a split via forward wires. */
function findMatchingJoin(doc: PflowDocument, splitId: string): string | undefined {
  const seen = new Set<string>();
  const stack = [splitId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodeById(doc, id);
    if (node && id !== splitId && node.kind === "join") return id;
    for (const w of outWires(doc, id)) stack.push(w.to.nodeId);
  }
  return undefined;
}

/** Nodes strictly between start and end (exclusive of both), declaration-ordered. */
function pathNodesBetween(doc: PflowDocument, startId: string, endId: string): string[] {
  const onPath = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (id === endId) {
      for (const t of trail) if (t !== startId) onPath.add(t);
      return;
    }
    if (trail.includes(id)) return;
    for (const w of outWires(doc, id)) visit(w.to.nodeId, [...trail, id]);
  };
  visit(startId, []);
  return doc.nodes.filter((n) => onPath.has(n.id)).map((n) => n.id);
}

// ---- branch --------------------------------------------------------------

function findBranchRegions(doc: PflowDocument): BranchRegion[] {
  const regions: BranchRegion[] = [];
  for (const branch of doc.nodes.filter((n) => n.kind === "branch")) {
    const paths: { label: string; memberIds: string[] }[] = [];
    for (const port of branch.outputs) {
      const wire = outWires(doc, branch.id).find((w) => w.from.portId === port.id);
      if (!wire) continue;
      const members = reachableFrom(doc, wire.to.nodeId, branch.id);
      paths.push({ label: port.name, memberIds: members });
    }
    if (paths.length > 0) regions.push({ kind: "branch", entryId: branch.id, paths });
  }
  return regions;
}

/** Nodes reachable forward from startId, declaration-ordered, never re-entering
 *  the branch node. Single-level: paths are assumed disjoint until graph end. */
function reachableFrom(doc: PflowDocument, startId: string, stopId: string): string[] {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === stopId || seen.has(id)) continue;
    seen.add(id);
    for (const w of outWires(doc, id)) stack.push(w.to.nodeId);
  }
  return doc.nodes.filter((n) => seen.has(n.id)).map((n) => n.id);
}

// ---- entry point ---------------------------------------------------------

/** Identify all control-flow regions in a document. Pure; declaration-ordered
 *  output for determinism. */
export function analyzeRegions(doc: PflowDocument): RegionAnalysis {
  const regions: Region[] = [
    ...findLoopRegions(doc),
    ...findSplitJoinRegions(doc),
    ...findBranchRegions(doc),
  ];
  const absorbed = new Set<string>();
  for (const r of regions) for (const id of memberIdsOf(r)) absorbed.add(id);
  return { regions, absorbed };
}
