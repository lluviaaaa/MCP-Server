// Prints the URLs / headers to paste into an MCP client. These contain secrets: keep them out of
// screenshots, chats, git and the report.
//   npm run urls               URLs and headers for every role
//   npm run urls -- --agy      also prints a ready-to-paste mcp_config.json block (Antigravity CLI style)
import { loadConfig, loadDotEnv } from "../src/config.js";

loadDotEnv();
const config = loadConfig();
const base = config.publicUrl || `http://127.0.0.1:${config.port}`;

console.log(`\nBase address: ${base}${config.publicUrl ? "" : "   (set PUBLIC_URL in .env to your ngrok address to see public URLs)"}`);
console.log("These lines contain secrets. Do not screenshot or share them.\n");
for (const [role, token] of Object.entries(config.tokens)) {
  console.log(`ROLE ${role}`);
  console.log(`  Client that can send a header : ${base}/mcp`);
  console.log(`                                  Authorization: Bearer ${token}`);
  if (config.allowPathToken) console.log(`  Claude connector URL box       : ${base}/s/${token}/mcp`);
  console.log("");
}

if (process.argv.includes("--agy")) {
  const servers = {};
  for (const [role, token] of Object.entries(config.tokens)) {
    servers[`file-server-${role}`] = { serverUrl: `${base}/mcp`, headers: { Authorization: `Bearer ${token}` } };
  }
  console.log("Antigravity CLI (agy): put this in  %USERPROFILE%\\.gemini\\config\\mcp_config.json  (or .agents/mcp_config.json inside one folder).");
  console.log("Remote servers use the key serverUrl and no 'type' field. Check with:  agy mcp list   (details can differ by version: agy mcp add --help)\n");
  console.log(JSON.stringify({ mcpServers: servers }, null, 2));
  console.log("");
}
