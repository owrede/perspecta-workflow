<!--
  PflowEdge — custom edge with a guaranteed horizontal "stick".

  xyflow's default bezier scales its control-point offset with the horizontal
  distance between handles, so when an output and input handle share a similar
  x (or the edge loops back behind a card, as the loop's session_ready→retry
  wire does), the control points collapse and the edge is drawn nearly straight
  or tucked behind the node — hard to read.

  This edge always pushes each control point AWAY from its handle along the
  handle's facing direction by at least STICK px (more for long edges), so every
  edge leaves and enters its handle with a clear horizontal segment before it
  curves. That disambiguates near-straight edges and swings loop-back edges out
  from behind the card.
-->

<script lang="ts">
  import { BaseEdge, Position, type EdgeProps } from "@xyflow/svelte";

  let {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
  }: EdgeProps = $props();

  // An orphan-backed wire is "inactive": render it dashed and muted, and drop
  // the arrowhead — it no longer carries live dataflow (the port it touches is
  // an orphan left by an edited prompt). A "typeMismatch" wire connects ports of
  // different types: render it red (a non-blocking lint). The two can co-occur;
  // mismatch colour wins, dashed-ness from inactive stacks on top.
  let edgeData = $derived(data as { inactive?: boolean; typeMismatch?: boolean } | undefined);
  let inactive = $derived(Boolean(edgeData?.inactive));
  let typeMismatch = $derived(Boolean(edgeData?.typeMismatch));

  let edgeStyle = $derived.by(() => {
    const parts: string[] = [];
    if (inactive) parts.push("stroke-dasharray: 6 4", "opacity: 0.7");
    if (typeMismatch) parts.push("stroke: var(--color-red, #e05252)");
    else if (inactive) parts.push("stroke: var(--text-faint)");
    return parts.join("; ");
  });

  // Minimum horizontal lead-out/lead-in off each handle, in flow units.
  const STICK = 40;
  // Extra offset proportional to horizontal gap, so long edges curve gently
  // rather than sticking out a fixed tiny amount.
  const CURVE = 0.4;

  // Signed x-direction a handle faces: Right pushes +x, Left pushes −x. (Top/
  // Bottom handles aren't used by pflow nodes, but default to +x/−x by side.)
  function dirX(pos: Position): number {
    return pos === Position.Left ? -1 : 1;
  }

  let path = $derived.by(() => {
    const gap = Math.abs(targetX - sourceX);
    const offset = Math.max(STICK, gap * CURVE);
    const c1x = sourceX + dirX(sourcePosition) * offset;
    const c2x = targetX + dirX(targetPosition) * offset;
    // Cubic bezier: leave the source horizontally, approach the target
    // horizontally. Control-point y = endpoint y keeps the lead in/out flat.
    return `M ${sourceX},${sourceY} C ${c1x},${sourceY} ${c2x},${targetY} ${targetX},${targetY}`;
  });
</script>

<BaseEdge
  {id}
  {path}
  markerEnd={inactive ? undefined : markerEnd}
  style={edgeStyle}
/>
