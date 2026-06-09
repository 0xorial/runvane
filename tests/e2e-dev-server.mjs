import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const defaultFrontendRoot = path.join(repoRoot, "frontend");

async function loadVite(frontendRoot) {
  const require = createRequire(path.join(frontendRoot, "package.json"));
  const viteEntry = require.resolve("vite");
  return import(pathToFileURL(viteEntry).href);
}

/**
 * @param {{ root?: string; port: number; apiBaseUrl: string }} opts
 */
export async function createE2eFrontend(opts) {
  const root = path.resolve(opts.root ?? defaultFrontendRoot);
  const { createServer } = await loadVite(root);
  const prevCwd = process.cwd();
  const prevApi = process.env.VITE_API_BASE_URL;
  const prevPort = process.env.FRONTEND_PORT;

  process.chdir(root);
  process.env.VITE_API_BASE_URL = opts.apiBaseUrl;
  process.env.FRONTEND_PORT = String(opts.port);

  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    server: {
      host: "127.0.0.1",
      port: opts.port,
      strictPort: true,
    },
  });
  await server.listen();
  server.__e2ePrevCwd = prevCwd;
  server.__e2ePrevEnv = { api: prevApi, port: prevPort };
  return server;
}

/** @param {import('vite').ViteDevServer | null | undefined} server */
export async function closeE2eFrontend(server) {
  if (!server) return;
  await server.close();
  if (server.__e2ePrevCwd) process.chdir(server.__e2ePrevCwd);
  const prev = server.__e2ePrevEnv;
  if (prev) {
    if (prev.api === undefined) delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL = prev.api;
    if (prev.port === undefined) delete process.env.FRONTEND_PORT;
    else process.env.FRONTEND_PORT = prev.port;
  }
}
