/**
 * Resolve a human-readable project name from a working directory path.
 *
 * Priority:
 *  1. Git root walk - walk up from cwd checking for a .git entry
 *  2. Common dev-dir heuristic - find a known collection dir and take the next component
 *  3. Leaf fallback - last path component
 */
import { existsSync } from "fs";
import { homedir } from "os";

const COLLECTION_DIRS = new Set([
  "src", "dev", "development", "projects", "repos", "workspace", "code", "tries", "work", "github",
]);
const HOME = homedir();
const cache = new Map<string, string>();

export function resolveProjectName(cwd: string): string {
  if (!cwd) return "unknown";
  const cached = cache.get(cwd);
  if (cached !== undefined) return cached;
  const result = gitRootWalk(cwd) ?? collectionDirHeuristic(cwd) ?? leafName(cwd);
  cache.set(cwd, result);
  return result;
}

function gitRootWalk(startPath: string): string | null {
  let current = startPath;
  let depth = 0;
  while (depth < 6 && current !== "/" && current !== HOME) {
    if (existsSync(current + "/.git")) {
      return leafName(current);
    }
    const parent = current.slice(0, current.lastIndexOf("/")) || "/";
    if (parent === current) break;
    current = parent;
    depth++;
  }
  return null;
}

function collectionDirHeuristic(cwd: string): string | null {
  const parts = cwd.split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (COLLECTION_DIRS.has(parts[i].toLowerCase())) {
      // Skip if the next component is also a collection dir (e.g. src/tries/project)
      const next = parts[i + 1];
      if (COLLECTION_DIRS.has(next.toLowerCase())) continue;
      return next;
    }
  }
  return null;
}

function leafName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "unknown";
}
