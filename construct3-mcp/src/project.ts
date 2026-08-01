import { promises as fs } from "node:fs";
import path from "node:path";

export interface ProjectPaths {
  root: string;
  manifestPath: string | null;
}

/** Resolves and validates the Construct 3 project root passed on the CLI. */
export async function resolveProject(projectArg: string): Promise<ProjectPaths> {
  const root = path.resolve(projectArg);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${root}`);
  }

  const manifestPath = path.join(root, "project.c3proj");
  const hasManifest = await fs
    .stat(manifestPath)
    .then((s) => s.isFile())
    .catch(() => false);

  return { root, manifestPath: hasManifest ? manifestPath : null };
}

/**
 * Resolves a project-relative path and guarantees it stays inside the project root.
 * Construct 3 projects are opened by trusted local tooling, but this still guards
 * against a path like "../../etc/passwd" being handed to us by a tool call.
 */
export function resolveInProject(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return resolved;
}

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".c3proj",
  ".js",
  ".ts",
  ".txt",
  ".xml",
  ".md",
  ".css",
  ".html",
  ".csv",
]);

export function isLikelyTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export interface ListedFile {
  relPath: string;
  size: number;
}

/** Recursively lists files under `subdir` (relative to root), skipping hidden/build dirs. */
export async function listFiles(
  root: string,
  subdir = ".",
  maxFiles = 2000
): Promise<ListedFile[]> {
  const startDir = resolveInProject(root, subdir);
  const results: ListedFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxFiles) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        results.push({ relPath: path.relative(root, full), size: stat.size });
      }
    }
  }

  await walk(startDir);
  return results;
}

export interface SearchMatch {
  relPath: string;
  line: number;
  text: string;
}

/** Searches text files under the project root for a literal or regex pattern. */
export async function searchProject(
  root: string,
  pattern: string,
  useRegex: boolean,
  maxMatches = 200
): Promise<SearchMatch[]> {
  const files = await listFiles(root, ".", 5000);
  const matcher = useRegex ? new RegExp(pattern, "i") : null;
  const needle = pattern.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const file of files) {
    if (matches.length >= maxMatches) break;
    if (!isLikelyTextFile(file.relPath)) continue;
    const full = path.join(root, file.relPath);
    let content: string;
    try {
      content = await fs.readFile(full, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) break;
      const line = lines[i];
      const hit = matcher ? matcher.test(line) : line.toLowerCase().includes(needle);
      if (hit) {
        matches.push({ relPath: file.relPath, line: i + 1, text: line.trim().slice(0, 300) });
      }
    }
  }

  return matches;
}

/** Lists the JSON entries (by base name, without extension) directly inside a project subfolder. */
export async function listJsonEntries(root: string, subdir: string): Promise<string[]> {
  const dir = resolveInProject(root, subdir);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => e.name.slice(0, -".json".length))
    .sort();
}
