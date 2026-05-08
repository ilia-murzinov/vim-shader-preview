const VERT_DEFAULT = `#version 300 es
/* Fullscreen triangle (clip space), same role as the Book of Shaders plane / glslCanvas. */
precision highp float;

in vec4 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position.xy * 0.5 + 0.5;
  gl_Position = a_position;
}
`;

const KEY_SERVER = "s";
const KEY_LOCAL = "l";

/**
 * Drawing buffer width ÷ height. Kept constant while the canvas is letterboxed in the stage
 * (like a fixed 500×500 canvas in The Book of Shaders). Change to e.g. 16.0 / 9.0 for widescreen.
 */
const VIEW_ASPECT = 1;

/** Snippet fragments: prepend headers when there is no #version directive. */
function wrapFragmentIfNeeded(src) {
  const t = src.trimStart();
  if (t.startsWith("#version")) {
    return src;
  }
  return `#version 300 es
precision highp float;

/* Book of Shaders / glslCanvas uniforms — use e.g. vec2 st = gl_FragCoord.xy / u_resolution.xy; */
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

in vec2 v_uv;

out vec4 fragColor;

` + src;
}

function fullscreenTriangleAttribs(gl, program) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(sh) || "compile failed";
    gl.deleteShader(sh);
    throw new Error(`${label}: ${err}`);
  }
  return sh;
}

function linkProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(p) || "link failed";
    gl.deleteProgram(p);
    throw new Error(err);
  }
  return p;
}

function pairVertPath(fragPath, pathList) {
  const slash = fragPath.lastIndexOf("/");
  const dir = slash >= 0 ? fragPath.slice(0, slash) : "";
  const file = slash >= 0 ? fragPath.slice(slash + 1) : fragPath;
  const base = file.replace(/\.(frag|glsl)$/i, "");
  const cand = dir ? `${dir}/${base}.vert` : `${base}.vert`;
  return pathList.includes(cand) ? cand : null;
}

function isFragmentish(name) {
  return /\.(frag|glsl)$/i.test(name);
}

function makeKey(realm, relativePath) {
  return `${realm}|${relativePath}`;
}

/** @returns {{realm: string, path: string}} */
function parseKey(value) {
  const i = value.indexOf("|");
  if (i <= 0) {
    return { realm: KEY_SERVER, path: value };
  }
  return {
    realm: value.slice(0, i),
    path: value.slice(i + 1),
  };
}

function relatedServerPaths(fragmentOrVertRel, pathListArr) {
  const set = new Set([fragmentOrVertRel]);
  if (fragmentOrVertRel.endsWith(".vert")) {
    const base = fragmentOrVertRel.replace(/\.vert$/i, "");
    for (const ext of [".frag", ".glsl"]) {
      const p = `${base}${ext}`;
      if (pathListArr.includes(p)) set.add(p);
    }
  } else {
    const vp = pairVertPath(fragmentOrVertRel, pathListArr);
    if (vp) set.add(vp);
  }
  return set;
}

const canvas = document.getElementById("c");
const stage = document.getElementById("stage");
const logEl = document.getElementById("log");
const select = document.getElementById("shaderSelect");
const watchRootEl = document.getElementById("watchRoot");
const statusEl = document.getElementById("status");
const pickFolderBtn = document.getElementById("pickFolderBtn");

const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
if (!gl) {
  logEl.textContent = "WebGL2 is not available in this browser.";
  throw new Error("no webgl2");
}

/** @type {FileSystemDirectoryHandle|null} */
let localDirHandle = null;
/** Paths → handle under chosen folder (/-separated keys) */
const localHandles = new Map();
/** @type Map<string, number> */
const localMTimes = new Map();

/** Server-relative paths only (REST + WebSocket refresh this). */
let files = [];

let program = null;
let uResolution = null;
let uTime = null;
let uMouse = null;
let raf = 0;
let start = performance.now() / 1000;
let mouse = [0, 0];

function setLog(text) {
  logEl.textContent = text || "";
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const stageRect = stage.getBoundingClientRect();
  const rw = Math.max(0, stageRect.width);
  const rh = Math.max(0, stageRect.height);
  const ar = VIEW_ASPECT;

  let cssW;
  let cssH;
  if (rw <= 0 || rh <= 0) {
    cssW = 1;
    cssH = 1;
  } else if (rw / rh > ar) {
    cssH = rh;
    cssW = cssH * ar;
  } else {
    cssW = rw;
    cssH = cssW / ar;
  }

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const bw = Math.max(1, Math.floor(cssW * dpr));
  const bh = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function startLoop() {
  stopLoop();
  start = performance.now() / 1000;
  const tick = () => {
    if (!program) return;
    raf = requestAnimationFrame(tick);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    const t = performance.now() / 1000 - start;
    if (uTime) gl.uniform1f(uTime, t);
    if (uResolution) gl.uniform2f(uResolution, canvas.width, canvas.height);
    if (uMouse) gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  raf = requestAnimationFrame(tick);
}

function disposeProgram() {
  if (program) {
    gl.deleteProgram(program);
    program = null;
  }
  uResolution = uTime = uMouse = null;
}

async function fetchServerText(relPath) {
  const r = await fetch(`/api/shader?path=${encodeURIComponent(relPath)}`);
  if (!r.ok) throw new Error(`${r.status} ${relPath}`);
  return r.text();
}

async function readLocalText(relPath) {
  const h = localHandles.get(relPath);
  if (!h) throw new Error(`missing local file handle: ${relPath}`);
  const f = await h.getFile();
  return f.text();
}

function pathListForRealm(realm) {
  return realm === KEY_LOCAL ? [...localHandles.keys()] : [...files];
}

async function fetchText(realm, relativePath) {
  if (realm === KEY_LOCAL) {
    return readLocalText(relativePath);
  }
  return fetchServerText(relativePath);
}

async function syncLocalMtForActive(realm, relPath, pathListArr) {
  if (realm !== KEY_LOCAL || !relPath) return;

  /** @returns {Promise<void>} */
  async function stamp(p) {
    const h = localHandles.get(p);
    if (!h) return;
    const f = await h.getFile();
    localMTimes.set(p, f.lastModified);
  }

  await stamp(relPath);
  const rel = relatedServerPaths(relPath, pathListArr);
  for (const p of rel) {
    await stamp(p);
  }
}

async function loadAndCompile() {
  disposeProgram();
  stopLoop();
  setLog("");

  const key = select.value;
  const { realm, path: relPath } = parseKey(key);
  const pathList = pathListForRealm(realm);

  if (!relPath || (realm !== KEY_LOCAL && realm !== KEY_SERVER)) {
    return;
  }

  try {
    let vsSrc = VERT_DEFAULT;
    let fsSrc;

    if (relPath.endsWith(".vert")) {
      vsSrc = await fetchText(realm, relPath);
      const base = relPath.replace(/\.vert$/i, "");
      const fragCand = [`${base}.frag`, `${base}.glsl`].find((p) =>
        pathList.includes(p),
      );
      if (!fragCand) {
        throw new Error(`No matching .frag or .glsl for ${relPath}`);
      }
      fsSrc = await fetchText(realm, fragCand);
    } else {
      const vertPair = pairVertPath(relPath, pathList);
      if (vertPair) {
        vsSrc = await fetchText(realm, vertPair);
      }
      fsSrc = await fetchText(realm, relPath);
    }

    fsSrc = wrapFragmentIfNeeded(fsSrc);
    if (!vsSrc.trimStart().startsWith("#version")) {
      throw new Error("Vertex shader must start with #version 300 es");
    }

    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, "vertex");
    const fsSh = compile(gl, gl.FRAGMENT_SHADER, fsSrc, "fragment");
    program = linkProgram(gl, vs, fsSh);
    fullscreenTriangleAttribs(gl, program);
    uResolution = gl.getUniformLocation(program, "u_resolution");
    uTime = gl.getUniformLocation(program, "u_time");
    uMouse = gl.getUniformLocation(program, "u_mouse");

    resize();
    startLoop();
    await syncLocalMtForActive(realm, relPath, pathList);
  } catch (e) {
    setLog(String(e.message || e));
  }
}

function addOptGroup(label, realm, sortedPaths) {
  if (sortedPaths.length === 0) return null;
  const og = document.createElement("optgroup");
  og.label = label;
  for (const p of sortedPaths) {
    const opt = document.createElement("option");
    opt.value = makeKey(realm, p);
    opt.textContent = p;
    og.appendChild(opt);
  }
  select.appendChild(og);
  return og;
}

/**
 * @param preserveKey Prefer this dropdown value when it still exists.
 */
function buildDropdown(preserveKey) {
  const prev = preserveKey || select.value;
  select.innerHTML = "";

  addOptGroup(
    "Project shaders (live reload)",
    KEY_SERVER,
    [...files].sort(),
  );

  addOptGroup(
    localDirHandle && localDirHandle.name
      ? `Loaded: ${localDirHandle.name}`
      : "Chosen folder",
    KEY_LOCAL,
    [...localHandles.keys()].sort(),
  );

  /** Pick next selection */
  const optionValues = [...select.options].map((o) => o.value);
  let next =
    prev && optionValues.includes(prev)
      ? prev
      : null;

  function firstChoice(realm, listIterable) {
    const sorted = [...listIterable].sort();
    const fragFirst = sorted.find(isFragmentish);
    if (fragFirst) return makeKey(realm, fragFirst);
    const vertOnly = sorted.find((x) => x.endsWith(".vert"));
    if (vertOnly) return makeKey(realm, vertOnly);
    if (sorted.length > 0) return makeKey(realm, sorted[0]);
    return "";
  }

  if (!next) {
    if (files.length > 0) next = firstChoice(KEY_SERVER, files);
    else if (localHandles.size > 0)
      next = firstChoice(KEY_LOCAL, [...localHandles.keys()]);
  }

  if (next && optionValues.includes(next)) {
    select.value = next;
  } else if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

if (pickFolderBtn) {
  if (typeof window.showDirectoryPicker === "function") {
    pickFolderBtn.hidden = false;
  }
  pickFolderBtn.addEventListener("click", async () => {
  if (typeof window.showDirectoryPicker !== "function") return;
  try {
    const dir = await window.showDirectoryPicker({ mode: "read" });
    localDirHandle = dir;
    localHandles.clear();
    localMTimes.clear();

    /** @type {Map<string, FileSystemFileHandle>} */
    const m = new Map();

    async function walk(handle, baseRel) {
      for await (const [name, h] of handle.entries()) {
        if (name.startsWith(".")) continue;
        const rel =
          baseRel === "" ? name : `${baseRel}/${name}`.replaceAll("\\", "/");
        if (h.kind === "directory") await walk(h, rel);
        else if (h.kind === "file") {
          const low = name.toLowerCase();
          if (/\.(?:glsl|frag|vert)$/.test(low)) m.set(rel, h);
        }
      }
    }

    await walk(dir, "");
    for (const [k, v] of m) localHandles.set(k, v);

    const prevRealm = parseKey(select.value).realm;
    const prefer = prevRealm === KEY_LOCAL ? select.value : null;
    buildDropdown(prefer);
    await loadAndCompile();
    statusEl.textContent = `${localHandles.size} from folder`;
    setTimeout(() => {
      statusEl.textContent = "Watching";
      statusEl.classList.add("live");
    }, 2600);
  } catch (e) {
    if (/** @type {DOMException|undefined} */ (e)?.name === "AbortError") return;
    setLog(`Load folder…: ${e?.message ?? e}`);
  }
  });
}

async function bootstrap() {
  const r = await fetch("/api/shaders");
  const data = await r.json();
  files = data.files || [];
  watchRootEl.textContent = data.root || "";

  statusEl.textContent = "Watching";
  statusEl.classList.add("live");

  const params = new URLSearchParams(location.search);
  const rawPath = params.get("path");
  let pathParam = rawPath;
  if (rawPath) {
    try {
      pathParam = decodeURIComponent(rawPath);
    } catch {
      pathParam = rawPath;
    }
  }
  const matchedByQuery =
    pathParam &&
    (files.includes(pathParam)
      ? pathParam
      : files.find((f) => f.toLowerCase() === pathParam.toLowerCase()));
  const fromUrl = matchedByQuery ? makeKey(KEY_SERVER, matchedByQuery) : null;

  buildDropdown(fromUrl);

  if (select.options.length === 0) {
    setLog(
      "No shader files yet. Add .frag/.glsl/.vert under the watched folder — or click Load folder… (Chrome / Edge).",
    );
    return;
  }

  await loadAndCompile();
}

function setMouseFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = (1 - (clientY - rect.top) / rect.height) * canvas.height;
  mouse = [x, y];
}

select.addEventListener("change", async () => {
  await loadAndCompile();
});

function onLayoutChange() {
  resize();
  startLoop();
}

window.addEventListener("resize", onLayoutChange);
new ResizeObserver(onLayoutChange).observe(stage);

canvas.addEventListener("mousemove", (ev) =>
  setMouseFromClient(ev.clientX, ev.clientY),
);

canvas.addEventListener(
  "touchstart",
  (ev) => {
    const t = ev.touches[0];
    if (t) setMouseFromClient(t.clientX, t.clientY);
  },
  { passive: true },
);

canvas.addEventListener(
  "touchmove",
  (ev) => {
    const t = ev.touches[0];
    if (t) setMouseFromClient(t.clientX, t.clientY);
  },
  { passive: true },
);

const wsUrl =
  location.protocol === "https:"
    ? `wss://${location.host}`
    : `ws://${location.host}`;

/** Set when editor stops preview (see server POST /api/close-pages). */
let previewShutdown = false;

function connectWs() {
  const ws = new WebSocket(wsUrl);
  ws.onmessage = async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg?.type === "close_all_pages") {
      previewShutdown = true;
      try {
        window.close();
      } catch {
        /* may be blocked for user-opened tabs */
      }
      return;
    }
    if (msg?.type !== "fs" || !Array.isArray(msg.files)) return;

    const before = select.value;
    const { realm: beforeRealm, path: beforeRel } = parseKey(before);

    files = msg.files;

    buildDropdown(before);

    const after = select.value;
    if (before !== after) {
      await loadAndCompile();
      return;
    }

    if (beforeRealm !== KEY_SERVER || !beforeRel || typeof msg.path !== "string") {
      return;
    }

    const related = relatedServerPaths(beforeRel, [...files]);

    const touchPath = msg.path;
    if (touchPath === beforeRel || related.has(touchPath)) {
      await loadAndCompile();
    }
  };

  ws.onclose = () => {
    if (previewShutdown) return;
    statusEl.textContent = "Reconnecting…";
    statusEl.classList.remove("live");
    setTimeout(connectWs, 800);
  };
  ws.onopen = () => {
    statusEl.textContent = "Watching";
    statusEl.classList.add("live");
  };
}

setInterval(async () => {
  const { realm, path: relPath } = parseKey(select.value);
  if (realm !== KEY_LOCAL || !relPath) return;

  const pathListArr = [...localHandles.keys()];
  let dirty = false;

  /** @returns {Promise<void>} */
  async function checkTouch(p) {
    const h = localHandles.get(p);
    if (!h) return;
    const file = await h.getFile();
    const prev = localMTimes.get(p);
    const cur = file.lastModified;
    if (prev === undefined || cur !== prev) {
      localMTimes.set(p, cur);
      dirty = true;
    }
  }

  await checkTouch(relPath);
  for (const p of relatedServerPaths(relPath, pathListArr)) {
    await checkTouch(p);
  }

  if (dirty) {
    await loadAndCompile();
  }
}, 500);

bootstrap();
connectWs();
