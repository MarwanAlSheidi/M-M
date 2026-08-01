# construct3-mcp

An [MCP](https://modelcontextprotocol.io) server for working with [Construct 3](https://www.construct.net/en)
projects saved in the **Folder** project format (`File > Save project as... > Folder`, or a project
already unpacked from a `.c3p` file). It lets an MCP client (e.g. Claude Code) inspect and edit a
project's layouts, event sheets, and object types directly as JSON.

## Setup

```bash
cd construct3-mcp
npm install
npm run build
```

Then register it with Claude Code, pointing at your unpacked Construct 3 project folder:

```bash
claude mcp add construct3 -- node /abs/path/construct3-mcp/dist/index.js /abs/path/your-project
```

`your-project` must be the folder containing `project.c3proj`.

## Tools

- `c3_project_info` — project name plus the layouts, event sheets, object types, and families found on disk.
- `c3_list_files` — list files in the project, optionally scoped to a subfolder.
- `c3_read_file` — read a project file by path relative to the project root.
- `c3_write_file` — create or overwrite a project file by path relative to the project root.
- `c3_search` — search text files in the project for a literal string or regular expression.
- `c3_is_text_file` — check whether a path looks like a text file this server can safely read/write.

All file paths are resolved relative to, and constrained to stay within, the project root.

## Development

```bash
npm run dev    # tsc --watch
npm run build  # one-off compile to dist/
```
