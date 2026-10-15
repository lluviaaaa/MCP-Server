// The HTTP front door. Everything that decides "may this request reach the MCP code?" lives here:
//   /health                     no auth, reveals nothing
//   POST /mcp                   needs  Authorization: Bearer <token>
//   POST /s/<token>/mcp         token in the URL (only if ALLOW_PATH_TOKEN=true)
// Anything else is 404. The MCP SDK is injected as `handleMcp`, so this file can be tested without it.
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

const rpcError = (code, message) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

/** Remember recent failed logins per client address; refuse further attempts for a while. */
export class FailureLimiter {
  constructor({ max = 20, windowMs = 60_000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  #recent(key, now) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
  blocked(key, now = Date.now()) {
    return this.#recent(key, now).length >= this.max;
  }
  record(key, now = Date.now()) {
    if (this.hits.size > 10_000) this.hits.clear();
    const list = this.#recent(key, now);
    list.push(now);
    this.hits.set(key, list);
  }
}

/** Behind a tunnel the real client address is in X-Forwarded-For; the closest proxy appends last. */
export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    req.on("data", (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > limit) {
        finished = true;
        const err = new Error("request body too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!finished) {
        finished = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", (err) => {
      if (!finished) {
        finished = true;
        reject(err);
      }
    });
  });
}

export function createHttpHandler({ auth, handleMcp, logger, config }) {
  const limiter = new FailureLimiter();
  const allowedOrigins = new Set(config.allowedOrigins ?? []);

  async function route(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return sendJson(res, 400, rpcError(-32600, "Bad request"));
    }

    if (pathname === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET, HEAD" });
      return sendJson(res, 200, { status: "ok" });
    }

    let kind = null;
    let pathToken = "";
    if (pathname === "/mcp" || pathname === "/mcp/") {
      kind = "header";
    } else if (config.allowPathToken) {
      const m = /^\/s\/([^/]+)\/mcp\/?$/.exec(pathname);
      if (m) {
        kind = "path";
        try {
          pathToken = decodeURIComponent(m[1]);
        } catch {
          pathToken = "";
        }
      }
    }
    if (!kind) return sendJson(res, 404, { error: "not_found" });

    const ip = clientIp(req);
    const routeLabel = kind === "path" ? "/s/[redacted]/mcp" : "/mcp"; // never log the secret
    if (limiter.blocked(ip)) {
      logger.authFail({ ip, route: routeLabel, reason: "rate_limited" });
      return sendJson(res, 429, { error: "too_many_failed_attempts" }, { "Retry-After": "60" });
    }

    // Browsers always send Origin; MCP servers should refuse origins they do not know (DNS-rebinding defence).
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      logger.authFail({ ip, route: routeLabel, reason: "origin_not_allowed" });
      return sendJson(res, 403, { error: "origin_not_allowed" });
    }

    const role = kind === "path" ? auth.roleForToken(pathToken) : auth.roleForAuthorizationHeader(req.headers.authorization);
    if (!role) {
      limiter.record(ip);
      const reason = kind === "path" ? "bad_path_token" : req.headers.authorization ? "bad_token" : "missing_token";
      logger.authFail({ ip, route: routeLabel, reason });
      if (kind === "path") return sendJson(res, 404, { error: "not_found" }); // do not confirm the route exists
      return sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="mcp-file-server"' });
    }

    if (req.method !== "POST") {
      return sendJson(res, 405, rpcError(-32000, "Method not allowed. This server is stateless: send JSON-RPC requests with POST."), { Allow: "POST" });
    }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return sendJson(res, 415, rpcError(-32600, "Content-Type must be application/json"));
    }

    let raw;
    try {
      raw = await readBody(req, config.maxBodyBytes);
    } catch (err) {
      if (err.statusCode === 413) {
        res.once("finish", () => req.destroy());
        return sendJson(res, 413, rpcError(-32600, "Request body too large"), { Connection: "close" });
      }
      throw err;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, rpcError(-32700, "Parse error: the body is not valid JSON"));
    }

    const messages = Array.isArray(body) ? body : [body];
    const init = messages.find((m) => m && typeof m === "object" && m.method === "initialize");
    if (init) {
      logger.event("client_initialize", {
        role,
        client: init.params?.clientInfo ?? null,
        protocolVersion: init.params?.protocolVersion ?? null,
      });
    }

    await handleMcp({ role, ua: String(req.headers["user-agent"] ?? "").slice(0, 80), req, res, body });
  }

  return async function handler(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      logger.error("http handler crashed", err);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, "Internal server error"));
      else res.end();
    }
  };
}
