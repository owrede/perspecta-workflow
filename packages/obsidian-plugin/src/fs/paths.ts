/**
 * Pure path helpers for safe generated-file writes. Kept free of Obsidian so
 * the recursive-directory logic can be unit tested without a Vault adapter.
 */

/**
 * Ordered list of ancestor directories that must exist before writing
 * `filePath`, shallowest first. Vault-relative, "/"-separated.
 *
 * Examples:
 *   "_agents/workflows/INDEX.md" -> ["_agents", "_agents/workflows"]
 *   "top.md"                     -> []
 *   ".claude/skills/x/SKILL.md"  -> [".claude", ".claude/skills", ".claude/skills/x"]
 */
export function ancestorDirs(filePath: string): string[] {
	const lastSlash = filePath.lastIndexOf("/");
	// No "/" means a top-level file with no parent directory to create.
	// (slice(0, -1) here would wrongly drop the final character.)
	if (lastSlash < 0) return [];
	const dir = filePath.slice(0, lastSlash);
	if (!dir) return [];
	const parts = dir.split("/").filter((part) => part.length > 0);
	const dirs: string[] = [];
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		dirs.push(current);
	}
	return dirs;
}
