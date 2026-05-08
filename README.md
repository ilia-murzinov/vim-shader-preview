# Shader monitor

Local dev viewer: watches a folder of GLSL files and hot-reloads them in the browser via WebGL2.

Coordinate style follows [**The Book of Shaders — Running your shader**](https://thebookofshaders.com/04/): fullscreen clip-space triangle, `u_resolution` / `u_time` / `u_mouse`, and `gl_FragCoord.xy / u_resolution.xy` for normalized `st` in fragment snippets.

The **drawing buffer keeps a fixed aspect ratio** (default **1:1**, like a 500×500 canvas) and is **letterboxed** inside the preview so your pattern does not stretch when the window resizes. Edit `VIEW_ASPECT` in `public/app.js` (e.g. `16 / 9`) to change that ratio.

## Quick start

```bash
cd ~/projects/shader-monitor
npm install
npm start
```

Open [http://127.0.0.1:3847/](http://127.0.0.1:3847/). By default the server watches `./shaders`, which ships several example `.frag` files — open the **Shader** dropdown to switch between them (live reload on save).

## Watch another directory

```bash
node server.mjs /path/to/your/shaders
node server.mjs /path/to/your/shaders --port 5000
```

## Shader files

- **`.frag` / `.glsl`** — fragment shaders. If the file does **not** start with `#version`, the client prepends uniforms `u_resolution`, `u_time`, `u_mouse`, varyings `v_uv`, and `out vec4 fragColor` (snippet mode; your code should define `void main()`).
- **`.vert`** — optional custom vertex shader. Put `foo.vert` next to `foo.frag` (or `foo.glsl`) with the same base name to use it. Vertex sources must include `#version 300 es` and define `a_position`, and should output `v_uv` for snippet-style fragments.

## API

- `GET /api/shaders` — JSON `{ root, files }`
- `GET /api/shader?path=relative/path.frag` — raw shader source
- WebSocket — same host/port; messages `{ type: "fs", event, path, files }` on changes

## Vim (Markdown Preview–style)

Add the `vim/` folder to `runtimepath` (see `vim/doc/shader-monitor.txt`), run `npm install` once in the repo, then from a saved shader buffer:

| Command | Role (like typical Markdown preview plugins) |
|--------|-----------------------------------------------|
| `:ShaderPreview` | Watch **this buffer’s directory** (`%:p:h`), start the server if needed, open the browser when `g:shader_monitor_auto_open` is on. If the job already watches that folder, only re-open the tab when `g:shader_monitor_preview_reopen_browser` is on. |
| `:ShaderPreviewStop` | Stop the background `node` job. |
| `:ShaderPreviewToggle` | Stop if running, otherwise `:ShaderPreview`. |

`<Plug>(ShaderPreview)`, `<Plug>(ShaderPreviewStop)`, `<Plug>(ShaderPreviewToggle)` are provided; map them yourself, or set `let g:shader_monitor_preview_default_mappings = 1` for `<Leader>sv` / `<Leader>sV` / `<Leader>st`.

By default the UI opens in a **new browser window** (`g:shader_monitor_open_new_window = 1`, macOS: `open -n`). Override with `g:shader_monitor_browser_cmd` using `%URL%` if you need a specific app or flags (see `vim/doc/shader-monitor.txt`).

Lower-level commands (`:ShaderMonitorStart` with an explicit path, etc.) stay available for scripting.

```vim
Plug '~/projects/shader-monitor', {'rtp': 'vim'}
```
