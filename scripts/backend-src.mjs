// Load the backend straight from TypeScript source (backend/src) — never from
// backend/dist. `dist/` is a distribution artifact and must not be involved in
// tests. This uses ts-node's pure-JS transpiler (the same TypeScript compiler
// integration's ts-jest uses, so NestJS decorator metadata is emitted), plus a
// '.js' -> '.ts' resolve hook for the backend's nodenext import specifiers.
//
// The backend is `type: commonjs`, so it is loaded through CommonJS `require`
// (not ESM `import()`), which keeps the whole backend subtree in CJS and avoids
// Node's require(esm) import-cycle guard.
import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(repoRoot, "backend");
const backendRequire = createRequire(path.join(backendDir, "package.json"));

let registered = false;
function registerOnce() {
  if (registered) return;
  backendRequire("ts-node").register({
    transpileOnly: true,
    project: path.join(backendDir, "tsconfig.json"),
  });
  // In CJS, rewrite a relative './x.js' specifier to './x.ts' when the source
  // file exists (ts-node's own experimentalResolver is broken on Node 22). Same
  // mapping tests/jest.integration.json does via moduleNameMapper. Falls through
  // to the original request when there is no matching .ts.
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (parent?.filename && /^\.{1,2}\//.test(request) && request.endsWith(".js")) {
      try {
        return origResolve.call(this, `${request.slice(0, -3)}.ts`, parent, ...rest);
      } catch {
        /* no sibling .ts — fall through to the original request */
      }
    }
    return origResolve.call(this, request, parent, ...rest);
  };
  registered = true;
}

/** Require a backend module by path relative to backend/src, e.g. "bootstrap.ts". */
export function loadBackendModule(relPath) {
  registerOnce();
  return backendRequire(path.join(backendDir, "src", relPath));
}
