#!/usr/bin/env node
/**
 * Serves the shader viewer and watches a directory for .glsl / .frag / .vert changes.
 * Usage: node server.mjs [watchDir] [--port 3847]
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHADER_EXT = new Set([".glsl", ".frag", ".vert"]);
const DEFAULT_PORT = 3847;

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  const args = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      port = Number(argv[++i]) || DEFAULT_PORT;
    } else if (a.startsWith("--port=")) {
      port = Number(a.slice("--port=".length)) || DEFAULT_PORT;
    } else {
      args.push(a);
    }
  }
  const watchDir =
    args[0] !== undefined
      ? path.resolve(args[0])
      : path.join(__dirname, "shaders");
  return { watchDir, port };
}

function isShaderFile(filePath) {
  return SHADER_EXT.has(path.extname(filePath).toLowerCase());
}

function listShaderFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const out = [];
  function walk(dir, rel = "") {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (e.isDirectory()) {
        walk(abs, r);
      } else if (e.isFile() && isShaderFile(abs)) {
        out.push(r.replaceAll("\\", "/"));
      }
    }
  }
  walk(rootDir);
  out.sort();
  return out;
}

function isPathInsideRoot(rootDir, absCandidate) {
  const rootResolved = path.resolve(rootDir);
  const absResolved = path.resolve(absCandidate);
  if (rootResolved === absResolved) return true;
  const prefix =
    rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  return absResolved.startsWith(prefix);
}

function readShaderSafe(rootDir, relPath) {
  const normalized = path.normalize(relPath);
  if (normalized.includes(".." + path.sep) || normalized === "..") {
    return null;
  }
  const abs = path.resolve(rootDir, normalized);
  if (!isPathInsideRoot(rootDir, abs) || !isShaderFile(abs)) {
    return null;
  }
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

const { watchDir, port } = parseArgs(process.argv);

if (!fs.existsSync(watchDir)) {
  fs.mkdirSync(watchDir, { recursive: true });
  console.log(`Created shader directory: ${watchDir}`);
}

const app = express();
const pub = path.join(__dirname, "public");
app.use(express.static(pub));

/** JSON: { root, files: string[] } */
app.get("/api/shaders", (_req, res) => {
  res.json({
    root: watchDir,
    files: listShaderFiles(watchDir),
  });
});

/** Query: path=relative/path.frag */
app.get("/api/shader", (req, res) => {
  const relPath = typeof req.query.path === "string" ? req.query.path : "";
  const source = readShaderSafe(watchDir, relPath);
  if (source === null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.type("text/plain").send(source);
});

/** Vim :ShaderPreviewStop — same idea as markdown-preview.nvim `close_all_pages` before killing the job. */
app.post("/api/close-pages", (_req, res) => {
  broadcast({ type: "close_all_pages" });
  res.status(204).end();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
}

chokidar
  .watch(watchDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 50 },
  })
  .on("all", (event, filePath) => {
    if (!filePath || !isShaderFile(filePath)) return;
    const rel = path.relative(watchDir, filePath).replaceAll("\\", "/");
    broadcast({
      type: "fs",
      event,
      path: rel,
      files: listShaderFiles(watchDir),
    });
  });

server.listen(port, () => {
  console.log(`Shader monitor watching: ${watchDir}`);
  console.log(`Open http://127.0.0.1:${port}/`);
});
