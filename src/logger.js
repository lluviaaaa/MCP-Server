// Structured logging. One JSON object per line in logs/server.jsonl:
//   tool_call   every tool call (who, what, how long, ok or error)  <- the "transcript" is built from these
//   auth_fail   a rejected request (never includes the secret that was tried)
//   startup / shutdown / error / client_initialize
// File CONTENT is never logged, only its size, so logs stay small and do not leak the workspace.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONTENT_KEYS = new Set(["content", "old_str", "new_str", "entry"]);

/** Short, safe description of tool arguments for the log. */
export function summarizeArgs(args) {
  if (!args || typeof args !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      if (CONTENT_KEYS.has(key)) out[key] = `<${value.length} chars>`;
      else out[key] = value.length > 120 ? `${value.slice(0, 100)}...(${value.length} chars)` : value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 10).map((v) => (typeof v === "string" && v.length > 120 ? `${v.slice(0, 100)}...` : v));
    } else {
      out[key] = value;
    }
  }
  return out;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

/** Hash of the FULL arguments, so repeated identical calls can be detected without storing content. */
export function hashArgs(args) {
  return crypto.createHash("sha1").update(JSON.stringify(canonical(args ?? {}))).digest("hex").slice(0, 10);
}

export function createLogger({ dir, echo = true, maxBytes = 10 * 1024 * 1024 } = {}) {
  let file = null;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, "server.jsonl");
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
        fs.renameSync(file, path.join(dir, `server-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`));
      }
    } catch {
      file = null; // logging must never stop the server
    }
  }

  function write(record) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
    if (file) {
      try {
        fs.appendFileSync(file, line + "\n");
      } catch {
        /* ignore */
      }
    }
    return record;
  }

  function say(text) {
    if (echo) console.log(`[${new Date().toTimeString().slice(0, 8)}] ${text}`);
  }

  return {
    file,
    event(type, data = {}) {
      write({ event: type, ...data });
    },
    toolCall({ role, ua, tool, args, ok, error, ms, chars }) {
      write({
        event: "tool_call",
        role,
        ua,
        tool,
        args: summarizeArgs(args),
        argsHash: hashArgs(args),
        ok,
        ...(error ? { error } : {}),
        ms: Math.round(ms),
        chars: chars ?? 0,
      });
      const target = args?.path ?? args?.project ?? args?.query ?? "";
      say(`${role.padEnd(8)} ${tool.padEnd(13)} ${ok ? "ok   " : "ERROR"} ${String(Math.round(ms)).padStart(4)}ms ${target}${ok ? "" : "  -> " + error}`);
    },
    authFail({ ip, route, reason }) {
      write({ event: "auth_fail", ip, route, reason });
      say(`auth failed (${reason}) from ${ip} on ${route}`);
    },
    info(text, data = {}) {
      write({ event: "info", text, ...data });
      say(text);
    },
    error(text, err) {
      write({ event: "error", text, message: err?.message, stack: err?.stack });
      console.error(`[error] ${text}`, err?.message ?? "");
    },
  };
}
