// Runs one tool call with the safety net every call needs:
//   - times it and writes it to the log
//   - turns ANY failure into a short, friendly { isError: true } result (never a stack trace)
//   - caps how much text can come back (keeps the agent's context small)
import { friendlyMessage } from "./errors.js";

export async function runTool(tool, args, { role, ua = "", logger, maxOutputChars = 40_000 }) {
  const started = performance.now();
  try {
    let text = String(await tool.handler(args ?? {}, { role }));
    if (text.length > maxOutputChars) {
      text = `${text.slice(0, maxOutputChars)}\n[output truncated at ${maxOutputChars} characters; narrow your request]`;
    }
    logger.toolCall({ role, ua, tool: tool.name, args, ok: true, ms: performance.now() - started, chars: text.length });
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const friendly = friendlyMessage(err);
    logger.toolCall({
      role,
      ua,
      tool: tool.name,
      args,
      ok: false,
      error: friendly ?? `internal error: ${err?.message ?? err}`,
      ms: performance.now() - started,
    });
    if (!friendly) logger.error(`tool ${tool.name} crashed`, err);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${friendly ?? "Internal server error. It was logged on the server. Try a different approach or ask the owner."}`,
        },
      ],
      isError: true,
    };
  }
}
