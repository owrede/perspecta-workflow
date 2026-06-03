/**
 * Pure-JS POSIX `dirname`, matching `node:path.posix.dirname` for the path
 * shapes core encounters (POSIX-style vault and resolved file paths).
 *
 * Keeping this pure (zero Node imports) is what lets `@perspecta/core` bundle
 * cleanly for the browser/mobile renderer. Node-runtime path resolution lives
 * in the NodeFileSystem adapter, NOT here.
 *
 * Semantics (verified against `posix.dirname`):
 *   - ""            -> "."   (empty string)
 *   - "file.md"     -> "."   (no slash at all)
 *   - "flows/x.md"  -> "flows"
 *   - "/a/b/c.md"   -> "/a/b"
 *   - "/a"          -> "/"   (last slash at index 0)
 *   - "/"           -> "/"   (path is just the root)
 *   - "/a/b/"       -> "/a"  (single trailing slash collapsed)
 */
export function dirname(path: string): string {
  if (path.length === 0) return ".";

  // A path that is only slashes (e.g. "/") has the root as its dirname.
  // Strip a single trailing slash, but not if that would empty the path.
  let end = path.length;
  if (end > 1 && path.charCodeAt(end - 1) === 47 /* "/" */) {
    end -= 1;
  }

  // Find the last "/" in the (trimmed) path.
  const lastSlash = path.lastIndexOf("/", end - 1);

  if (lastSlash === -1) return "."; // no separator at all
  if (lastSlash === 0) return "/"; // separator only at the root

  return path.slice(0, lastSlash);
}
