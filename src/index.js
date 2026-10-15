// Entry point: load config, prepare the workspace, wire everything together, listen.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createAuth } from "./auth.js";
import { ConfigError, PROJECT_ROOT, loadConfig, loadDotEnv } from "./config.js";
import { createGit } from "./git.js";
import { createHttpHandler } from "./http.js";
import { createLogger } from "./logger.js";
import { createMcpRequestHandler } from "./mcp-http.js";
import { createSandbox } from "./sandbox.js";
import { buildTools } from "./tools/index.js";
import { prepareWorkspace } from "./workspace.js";

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  const logger = createLogger({ dir: config.logDir });

  const git = createGit({
    cwd: config.workspaceRoot,
    authorName: config.git.authorName,
    authorEmail: config.git.authorEmail,
    timeoutMs: config.git.timeoutMs,
  });
  await prepareWorkspace({ config, git, logger });

  const sandbox = createSandbox(config.workspaceRoot);
  const tools = buildTools({ config, sandbox, git });
  const auth = createAuth({ tokens: config.tokens });
  const handleMcp = createMcpRequestHandler({ tools, logger, version: pkg.version, maxOutputChars: config.maxOutputChars });
  const server = http.createServer(createHttpHandler({ auth, handleMcp, logger, config }));
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\nPort ${config.port} is already in use. Stop the other copy of the server (pm2 stop mcp-file-server) or change PORT in .env.\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.event("startup", { version: pkg.version, host: config.host, port: config.port, roles: auth.roles, tools: tools.length });
    console.log(`\nMCP file server v${pkg.version} listening on http://${config.host}:${config.port}`);
    console.log(`Workspace : ${config.workspaceRoot}`);
    console.log(`Roles     : ${auth.roles.join(", ")}   (${tools.length} tools in total)`);
    console.log(`Endpoints : POST /mcp with "Authorization: Bearer <token>"${config.allowPathToken ? "  |  POST /s/<token>/mcp" : ""}  |  GET /health`);
    console.log(`Run "npm run urls" to print your connector URLs (they contain secrets: do not share or screenshot them).`);
    if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
      console.log(`WARNING: HOST=${config.host} exposes the server on your network, not just to the tunnel. Use 127.0.0.1 unless you know why not.`);
    }
    console.log("");
  });

  function shutdown(signal) {
    logger.event("shutdown", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", reason instanceof Error ? reason : new Error(String(reason))));
  process.on("uncaughtException", (err) => {
    logger.error("uncaught exception", err);
    process.exit(1); // the process manager (pm2) restarts us
  });
}

main().catch((err) => {
  if (err instanceof ConfigError) console.error(`\nConfiguration problem: ${err.message}\n`);
  else console.error(err);
  process.exit(1);
});
