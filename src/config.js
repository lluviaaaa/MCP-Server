// Central configuration. Anything that differs between machines, or is secret, comes from
// environment variables (optionally loaded from a .env file). Nothing is hard-coded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Load .env if present. Variables already set in the real environment win over the file. */
export function loadDotEnv(file = path.join(PROJECT_ROOT, ".env")) {
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

function readInt(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
  }
  return n;
}

function readBool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new ConfigError(`${name} must be true or false (got "${raw}").`);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith(".." + path.sep)) return false;
  return !path.isAbsolute(rel);
}

/** The workspace must never contain the server's own files (.env holds the tokens!). */
function assertSafeWorkspace(workspaceRoot, projectRoot, logDir) {
  if (path.parse(workspaceRoot).root === workspaceRoot) {
    throw new ConfigError("WORKSPACE_ROOT must be a folder, not a drive or filesystem root.");
  }
  if (isInside(workspaceRoot, projectRoot)) {
    throw new ConfigError(
      "WORKSPACE_ROOT must not contain the server's own project folder: agents could then read .env (the tokens) and the source code.",
    );
  }
  if (isInside(workspaceRoot, logDir)) {
    throw new ConfigError("LOG_DIR must be outside WORKSPACE_ROOT: logs describe every tool call.");
  }
  if (isInside(projectRoot, workspaceRoot)) {
    const first = path.relative(projectRoot, workspaceRoot).split(path.sep)[0];
    if (["src", "scripts", "test", "docs", "node_modules", ".git", "logs"].includes(first)) {
      throw new ConfigError(`WORKSPACE_ROOT must not be inside the project's "${first}" folder.`);
    }
  }
}

const TOKEN_ENV = { admin: "ADMIN_TOKEN", coder: "CODER_TOKEN", reviewer: "REVIEWER_TOKEN" };
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{24,128}$/;

export function loadConfig(env = process.env, projectRoot = PROJECT_ROOT) {
  const tokens = {};
  for (const [role, name] of Object.entries(TOKEN_ENV)) {
    const value = String(env[name] ?? "").trim();
    if (!value) continue;
    if (!TOKEN_PATTERN.test(value)) {
      throw new ConfigError(
        `${name} must be 24-128 characters using only letters, digits and . _ ~ - (generate one with: npm run gen-token).`,
      );
    }
    tokens[role] = value;
  }
  const values = Object.values(tokens);
  if (values.length === 0) {
    throw new ConfigError("No access tokens are configured. Run `npm run setup` (or set ADMIN_TOKEN in .env). The server refuses to start without one.");
  }
  if (new Set(values).size !== values.length) {
    throw new ConfigError("Each role needs its own token: two roles share the same value.");
  }

  const workspaceRoot = path.resolve(projectRoot, env.WORKSPACE_ROOT || "workspace");
  const logDir = path.resolve(projectRoot, env.LOG_DIR || "logs");
  assertSafeWorkspace(workspaceRoot, projectRoot, logDir);

  const publicUrl = String(env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (publicUrl && !/^https:\/\/[^\s/]+$/i.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicUrl)) {
    throw new ConfigError("PUBLIC_URL must look like https://your-name.ngrok-free.app (no path, no trailing slash).");
  }

  return Object.freeze({
    projectRoot,
    host: String(env.HOST || "127.0.0.1").trim(),
    port: readInt(env, "PORT", 3333, 1, 65535),
    workspaceRoot,
    logDir,
    templateDir: path.join(projectRoot, "workspace-template"),
    tokens: Object.freeze(tokens),
    allowPathToken: readBool(env, "ALLOW_PATH_TOKEN", true),
    allowDelete: readBool(env, "ALLOW_DELETE", true),
    allowedOrigins: String(env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    maxFileBytes: readInt(env, "MAX_FILE_BYTES", 1_000_000, 1_000, 50_000_000),
    maxBodyBytes: readInt(env, "MAX_BODY_BYTES", 2_000_000, 10_000, 100_000_000),
    maxReadChars: 20_000,
    maxOutputChars: 40_000,
    publicUrl,
    git: Object.freeze({
      authorName: String(env.GIT_AUTHOR_NAME || "MCP File Server").trim(),
      authorEmail: String(env.GIT_AUTHOR_EMAIL || "mcp@localhost").trim(),
      timeoutMs: 15_000,
    }),
  });
}
