// One-time setup: creates .env with fresh random tokens. Safe to run again (never overwrites .env).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  console.log(".env already exists, leaving it alone. (Delete it and run setup again to generate new tokens.)");
} else {
  let text = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  for (const name of ["ADMIN_TOKEN", "CODER_TOKEN", "REVIEWER_TOKEN"]) {
    text = text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${crypto.randomBytes(24).toString("hex")}`);
  }
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log("Created .env with three fresh random tokens (admin, coder, reviewer).");
}

console.log(`
Next steps
  1. npm start                 start the server (it creates the workspace/ folder on first run)
  2. npm run urls              print the connector URLs for your tunnel (they contain secrets)
  3. npm run smoke             in a second terminal: checks every tool end to end
  4. npm run inspect           try the tools in the MCP Inspector
Edit .env to set PUBLIC_URL once you have your ngrok address.
`);
