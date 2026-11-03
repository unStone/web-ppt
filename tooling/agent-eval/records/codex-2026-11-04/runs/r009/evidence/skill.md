---
name: web-ppt
description: Read, edit, inspect, render and save PPTX or PPT files through the local web-ppt-agent MCP server. Use when the user asks to modify an existing presentation, replace text or images, add slides, fix layout overflow, or render slides without desktop Office.
license: MIT
compatibility: Requires a locally running web-ppt-agent MCP server. File access is limited to paths explicitly supplied by the user or the current task.
---

# Web-PPT

Use the `ppt_*` MCP tools for all presentation operations. Do not unzip the presentation, edit OOXML directly, invoke a model service, or fetch remote resources. The server keeps file access local to the paths explicitly supplied for the task.

## Required loop

1. `ppt_open` with the source path. Keep the returned `sessionId`.
2. `ppt_describe` to identify slide and element IDs. Use `ppt_element` when current style details are needed.
3. `ppt_lint` before editing when layout problems matter. Text/font checks require the host's real font measurement and font inventory; do not assume they are configured.
4. `ppt_edit` with existing commands only. Group dependent changes in one atomic batch and read the affected-slide lint result.
5. `ppt_render` to inspect the current projection. SVG needs real measurement; PNG also needs a configured rasterizer. Write the output only to a requested local path.
6. Repeat describe/edit/lint/render until the requested content and checks are correct. Use `ppt_undo` / `ppt_redo` for history instead of reverse commands.
7. `ppt_save` with the requested destination path, then `ppt_close`.

## Commands and observations

Use stable IDs from describe, not array positions or rendered child IDs. `AddImage`, `ReplaceImage`, and `SetBackgroundImage` take Base64 bytes. When the host permits shell commands, use the local `base64` utility to obtain those bytes; do not guess image content. Use `FitTextShape` for supported autofit cases, or adjust the text body/frame with existing commands. Every edit is one transaction; an invalid command rejects the whole batch without changing the document or history.

Read `lint.status` separately from the edit result. `failed` observation does not mean the transaction failed and does not justify another blind edit. Resolve the observation's reason first.

## Failure handling

- `invalid-input`: correct the request against the tool's JSON Schema and retry.
- `invalid-base64`: supply canonical Base64 bytes.
- `target-not-found`: re-run describe and use current IDs; do not invent replacements.
- `command-rejected`: inspect `commandIndex` and the command's semantic constraint.
- `no-history`: stop undoing or redoing.
- `node-measure-required`: request/configure real font measurement; never substitute estimated widths.
- `node-rasterizer-required`: request/configure a rasterizer or use SVG if acceptable.
- `session-disposed`: reopen the file and rebuild the editing plan from current content.

## Saving and boundaries

`ppt_save` always requires an explicit local destination. It preserves the original package through patch saving when possible and uses generated saving when no patchable package remains. It never uploads the document or creates an HTTP service. Do not claim Windows PowerPoint validation from MCP success alone; use an independent reader when available.
