import { withFriendlyFsErrors } from "../errors.js";
import { makeFileTools } from "./files.js";
import { makeGitTools } from "./git-tools.js";
import { makeHandoffTools } from "./handoff.js";
import { makeSearchTools } from "./search.js";

/** Every tool the server knows. Which ones an agent SEES depends on its role (see roles.js). */
export function buildTools(ctx) {
  const tools = [...makeFileTools(ctx), ...makeSearchTools(ctx), ...makeGitTools(ctx), ...makeHandoffTools(ctx)].map(withFriendlyFsErrors);
  const names = tools.map((t) => t.name);
  if (new Set(names).size !== names.length) throw new Error(`Duplicate tool name in: ${names.join(", ")}`);
  return tools;
}
