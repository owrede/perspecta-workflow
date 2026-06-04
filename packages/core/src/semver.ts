/** Parse "a.b.c" into [a,b,c]; missing or non-numeric parts become 0. */
function parts(v: string): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const segs = String(v).trim().split(".");
  for (let i = 0; i < 3; i++) {
    const n = Number.parseInt(segs[i] ?? "0", 10);
    out[i] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** Pure semver compare. Negative if a<b, 0 if equal, positive if a>b.
 *  Compares major.minor.patch only; pre-release tags are ignored. */
export function compareSemver(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
