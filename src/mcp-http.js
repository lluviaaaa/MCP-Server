// SDK glue #2 of 2: hand one authenticated HTTP request to the MCP SDK.
// "Stateless" mode: a fresh server + transport per request, no session ids. That is why the
// server survives restarts: there is nothing in memory that a client depends on.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-server.js";

export function createMcpRequestHandler({ tools, logger, version, maxOutputChars }) {
  return async function handleMcp({ role, ua, req, res, body }) {
    const server = createMcpServer({ role, tools, logger, version, ua, maxOutputChars });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // plain JSON replies, no streaming: simplest through tunnels/proxies
    });
    res.on("close", () => {
      Promise.resolve(transport.close()).catch(() => {});
      Promise.resolve(server.close()).catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
