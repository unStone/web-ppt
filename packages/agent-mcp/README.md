# @web-ppt/agent-mcp

Local-only Model Context Protocol stdio server and Agent Skill for deterministic PowerPoint reading, editing, rendering and saving. No model, HTTP server, remote transport or bundled font bytes are included.

The package reuses `@web-ppt/edit-core/agent` for all document operations. Files are read and written only at paths supplied by the caller, and saves use a same-directory temporary file followed by an atomic rename.

```bash
npm i @web-ppt/core@next @web-ppt/edit-core@next @web-ppt/agent-mcp@next
web-ppt-agent
```

The `skills/web-ppt` directory contains the Agent Skill with the read → edit → lint → render loop and save guidance. See [implementation plan](https://github.com/unStone/web-ppt/blob/master/docs/design/agent-mcp.md).

## License

MIT.
