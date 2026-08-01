#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  isLikelyTextFile,
  listFiles,
  listJsonEntries,
  resolveInProject,
  resolveProject,
  searchProject,
} from "./project.js";

async function main() {
  const projectArg = process.argv[2];
  if (!projectArg) {
    console.error("Usage: construct3-mcp <path-to-construct3-project-folder>");
    process.exit(1);
  }

  const { root, manifestPath } = await resolveProject(projectArg);

  const server = new McpServer({ name: "construct3-mcp", version: "0.1.0" });

  server.registerTool(
    "c3_project_info",
    {
      title: "Construct 3 project info",
      description:
        "Returns an overview of the Construct 3 project: its root path, whether a project.c3proj " +
        "manifest was found, and the layouts, event sheets, and object types defined in the project.",
      inputSchema: {},
    },
    async () => {
      let manifest: unknown = null;
      if (manifestPath) {
        try {
          manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        } catch (err) {
          manifest = { error: `Failed to parse project.c3proj: ${(err as Error).message}` };
        }
      }

      const [layouts, eventSheets, objectTypes, families] = await Promise.all([
        listJsonEntries(root, "layouts"),
        listJsonEntries(root, "eventSheets"),
        listJsonEntries(root, "objectTypes"),
        listJsonEntries(root, "families"),
      ]);

      const info = {
        root,
        hasManifest: manifestPath !== null,
        manifestName: (manifest as { name?: string } | null)?.name ?? null,
        layouts,
        eventSheets,
        objectTypes,
        families,
      };

      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
  );

  server.registerTool(
    "c3_list_files",
    {
      title: "List project files",
      description:
        "Lists files in the Construct 3 project, optionally restricted to a subfolder " +
        "(e.g. 'layouts', 'eventSheets', 'objectTypes', 'images'). Paths are relative to the project root.",
      inputSchema: {
        subdir: z
          .string()
          .optional()
          .describe("Subfolder relative to the project root. Defaults to the whole project."),
      },
    },
    async ({ subdir }) => {
      const files = await listFiles(root, subdir ?? ".");
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    }
  );

  server.registerTool(
    "c3_read_file",
    {
      title: "Read project file",
      description:
        "Reads a text file from the Construct 3 project by its path relative to the project root " +
        "(e.g. 'layouts/Main.json', 'eventSheets/Game.json').",
      inputSchema: {
        relPath: z.string().describe("File path relative to the project root."),
      },
    },
    async ({ relPath }) => {
      const full = resolveInProject(root, relPath);
      const content = await fs.readFile(full, "utf8");
      return { content: [{ type: "text", text: content }] };
    }
  );

  server.registerTool(
    "c3_write_file",
    {
      title: "Write project file",
      description:
        "Writes (creates or overwrites) a text file in the Construct 3 project at a path relative to " +
        "the project root. Intermediate directories are created automatically. Use this to add or edit " +
        "layouts, event sheets, and object types directly as JSON.",
      inputSchema: {
        relPath: z.string().describe("File path relative to the project root."),
        content: z.string().describe("Full text content to write to the file."),
      },
    },
    async ({ relPath, content }) => {
      const full = resolveInProject(root, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
      return { content: [{ type: "text", text: `Wrote ${content.length} bytes to ${relPath}` }] };
    }
  );

  server.registerTool(
    "c3_search",
    {
      title: "Search project",
      description:
        "Searches the project's text files (JSON, JS, TS, XML, etc.) for a literal string or regular " +
        "expression, returning matching file paths, line numbers, and line text.",
      inputSchema: {
        pattern: z.string().describe("Literal substring or regular expression to search for."),
        regex: z.boolean().optional().describe("Treat `pattern` as a regular expression. Defaults to false."),
      },
    },
    async ({ pattern, regex }) => {
      const matches = await searchProject(root, pattern, regex ?? false);
      return { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] };
    }
  );

  server.registerTool(
    "c3_is_text_file",
    {
      title: "Check if a project file is text",
      description:
        "Reports whether a given project-relative path looks like a text file safe to read/write " +
        "through this server, based on its extension (JSON, JS, TS, XML, CSS, HTML, etc.).",
      inputSchema: {
        relPath: z.string().describe("File path relative to the project root."),
      },
    },
    async ({ relPath }) => {
      return {
        content: [{ type: "text", text: JSON.stringify({ relPath, isText: isLikelyTextFile(relPath) }) }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("construct3-mcp failed to start:", err);
  process.exit(1);
});
