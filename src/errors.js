// Errors whose message is safe and useful to show to the agent.
export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

const FS_MESSAGES = {
  ENOENT: "Not found. Check the path with list_files.",
  ENOTDIR: "A part of that path is a file, not a folder.",
  EISDIR: "That path is a folder, not a file.",
  EEXIST: "That path already exists.",
  EACCES: "The operating system denied access to that path.",
  EPERM: "The operating system denied access to that path.",
  EBUSY: "The file is busy or locked by another program. Try again in a moment.",
  ENOSPC: "The disk is full.",
  ENOTEMPTY: "That folder is not empty.",
};

/**
 * Turn any thrown value into a message that is safe to show an agent, or null
 * if it is an unexpected error (those are logged on the server, never shown raw:
 * stack traces and absolute paths must not leak to the model).
 */
export function friendlyMessage(err) {
  if (err instanceof ToolError) return err.message;
  const code = err && typeof err === "object" ? err.code : undefined;
  if (code && FS_MESSAGES[code]) return FS_MESSAGES[code];
  return null;
}

/**
 * Wrap a tool so raw operating-system errors (ENOENT ... whose messages contain the host's absolute
 * paths) become short ToolErrors that name only the path the agent itself sent.
 */
export function withFriendlyFsErrors(tool) {
  const original = tool.handler;
  return {
    ...tool,
    async handler(args, call) {
      try {
        return await original(args, call);
      } catch (err) {
        if (err instanceof ToolError) throw err;
        const text = err && typeof err === "object" ? FS_MESSAGES[err.code] : undefined;
        if (!text) throw err;
        const where = typeof args?.path === "string" ? args.path : typeof args?.project === "string" ? args.project : "";
        throw new ToolError(where ? `${text} (path: '${where.slice(0, 120)}')` : text);
      }
    },
  };
}
