# MCP File-Server Connector: Report

> **DRAFT.** The design facts below are true for this code, but the report has to be yours: rewrite it in your own
> words, replace every **[YOUR TURN]** with your real results, delete this note. You will be asked to defend each claim.
> Aim for two pages.

**Name:** [YOUR TURN] **Section:** [YOUR TURN] **Date:** [YOUR TURN] **Project type:** individual
**Repository:** [YOUR TURN: link] **Public endpoint tested:** `https://<your-domain>.ngrok-free.app` (never print the secret)

## 1. What I built

A Node.js MCP server that exposes 12 tools over the Streamable HTTP transport, so an AI client can list, read, edit,
search and commit inside **one sandboxed folder** (the workspace) and hand work from one chat session to the next
through four files. It is reachable through an ngrok tunnel, protected by tokens, and kept alive by pm2.

```
client (Claude) -> ngrok (HTTPS) -> http.js (door) -> MCP SDK (role -> tools) -> tools -> sandbox.js (wall) -> workspace/
```

## 2. Stack and why

| Choice | Why | Alternative I considered |
|--------|-----|--------------------------|
| Node.js (v24 on my Windows laptop; tested on 22) + official MCP SDK **v1** (modern JavaScript, ESM) | matches the course reference stack; no build step, so pm2 runs the source directly (fewer failure points on Windows); `zod` validates every tool input at run time | TypeScript (compile-time types, extra build step); Python + FastMCP; SDK v2 (newest line, stable since July 2026, but the slides and most client behaviour describe the 2025 protocol). The SDK is isolated in two files, so migrating is small |
| JavaScript, although Python is my strongest language | [YOUR TURN: your honest reasoning, e.g. it is the course's reference stack and was tested; I translated it with a cheat sheet; or, if you ported it, why] | Python with the official SDK or FastMCP (scores the same under the rubric) |
| Streamable HTTP, **stateless**, plain JSON replies | the transport remote clients use; with no sessions held in memory, a restart is invisible to clients; simplest through a tunnel | stdio (local only), legacy SSE, stateful sessions |
| ngrok with a free static domain | free, stable address, TLS handled for me | Cloudflare Tunnel (needs my own domain), a cloud VPS |
| pm2 | restarts on crash, keeps logs, one command | NSSM, Task Scheduler, systemd |
| git inside the workspace | free history, review (`git_diff`, `git_log`) and recovery after a bad edit | hand-made snapshots |
| `node:test` | built in, no dependencies | Jest, Vitest |

## 3. Tool design

I chose **12 single-purpose tools** instead of one generic "run anything" tool. Small tools give least privilege (a
reviewer simply does not get `write_file`), clearer choices for the model, and a log line that says exactly what happened.

- **Names and descriptions are written for the model:** `verb_noun`, and each description says what the tool does, when to use it, its limits and how it fails.
- **Outputs are small by design:** `read_file` returns 200 lines (at most 20 000 characters) at a time and says which `start_line` comes next; `search_files`, `list_files` and `git_diff` are capped; a hard 40 000-character cap applies to everything.
- **Errors are instructions:** "`old_str` appears 3 times (lines 2, 4, 6); include more surrounding text" lets the agent fix the call instead of guessing.
- **Read-before-write is enforced, not requested:** replacing an existing file needs the `if_version` from a recent `read_file`; a stale version is rejected together with the current one.
- **Batching:** `read_handoff` returns the state and three logs in one call, replacing four.
- **Annotations:** `readOnlyHint` / `destructiveHint` are set on every tool so a client can show the right approval prompts.

| Tool | Why it exists | Guard |
|------|---------------|-------|
| list_files, read_file, search_files | orient, then read only what is needed | sandbox, size and chunk caps, `.git` hidden |
| write_file, str_replace | create / change files | `if_version`, per-file lock, size limit, atomic write |
| delete_file | remove a file | admin only, `confirm=true`, handoff files protected, `ALLOW_DELETE` switch |
| git_status, git_diff, git_log, git_commit | review and checkpoint | no shell, paths after `--`, `.git` unreachable |
| append_log, read_handoff | the handoff protocol | append-only logs, project-name validation |

## 4. Security model and trade-offs

| Threat | Defence |
|--------|---------|
| Strangers calling the public URL | a token (Bearer header or secret URL) is required; compared in constant time; 401 / 404; throttled after 20 failures a minute |
| Leaving the workspace (`../`, `C:\`, `\\server\share`, symlinks) | paths are parsed and rejected before any file call; then resolved with `realpath` and re-checked |
| Windows-specific tricks (`CON`, `file:stream`, trailing dot, `GIT~1`) | rejected by name rules; `.git` can never be addressed |
| Reading `.env` or the source | the configuration refuses a workspace that contains the project folder |
| Destructive mistakes | roles, `confirm=true`, protected handoff files, kill-switch, every call logged |
| Lost updates between agents | `if_version` + lock; the logs are append-only |
| Information leaks | friendly errors only; file content and the secret URL segment never reach the log |

**Trade-offs I accepted** (say why in your own words):

1. **Secret URL as well as header token.** Some Claude plans cannot send a custom header, so the token may sit in the URL. URLs leak into logs and history more easily than headers, so the header form exists and the URL form can be switched off (`ALLOW_PATH_TOKEN=false`). [YOUR TURN: which one you used in the demo and why.]
2. **`..` is rejected even when it would stay inside.** Slightly less convenient, much easier to reason about than "normalise and compare".
3. **Literal search only, no regex.** A hostile or sloppy regex can freeze a single-threaded Node process (ReDoS).
4. **In-process locks.** Correct for one instance; two instances would need file locks or a database, so pm2 is set to exactly one.
5. **Stateless transport.** The server cannot push messages to clients, which a tools-only server never needs.
6. **Three shared secrets, not accounts.** Fine for one owner; OAuth would be the next step for several users.
7. **TLS ends at the tunnel provider**, who can see the traffic.
8. **Prompt injection.** A file can contain text aimed at the agent. Roles limit the damage, deletes are gated, and the protocol tells agents that file content is data, not instructions; this reduces the risk but cannot remove it.

## 5. Handoff protocol and concurrency

Agents never talk to each other; they leave state in `PROJECT_STATE.md` (rewritten, protected by `if_version`) and three
append-only logs: `PLAN_LOG.md` (intent), `CHECKPOINTS.md` (done *and verified*, how to resume) and `DECISIONS.md`
(choices and reasons). A session starts with `read_handoff` and ends by updating the state, logging a checkpoint and
committing. Append-only files cannot be overwritten, so concurrent writers are safe; the single mutable file is guarded by
a version check. Roles: [YOUR TURN: which agent had which role in your demo, and why].

## 6. My own idea and what is mine

- **The idea:** [YOUR TURN: what you used the server for and why it matters to you; what makes it different from a standard to-do-app demo]
- **What I designed myself:** [YOUR TURN: your demo task, roles, acceptance criteria, your experiment (for example with versus without the handoff), your own tool(s)]
- **What I implemented myself:** [YOUR TURN: the files or functions you wrote or changed, for example `src/tools/custom.js` and its tests]
- **What I can explain without notes:** [YOUR TURN: pick three parts, for example the sandbox, `if_version`, role scoping]

## 7. Evidence

- Unit tests: `npm test` -> [YOUR TURN: paste the final summary lines]
- End-to-end: `npm run smoke` -> [YOUR TURN: result]
- Sandbox attempt through a real client: [YOUR TURN: screenshot or log line of a refused `../` attempt]
- Endpoint check: [YOUR TURN: `/health` from mobile data; the 401 without a token]
- Survives a restart: [YOUR TURN: what you killed, how long until it answered again]
- Client(s) used: [YOUR TURN: Claude Free connector, Antigravity CLI, Inspector ...]
- Demo task: [YOUR TURN: what the agents built] in [YOUR TURN: N] sessions with roles [YOUR TURN]
- From `TRANSCRIPT.md`: [YOUR TURN: total calls, errors, edits without a read, redundant reads, whether the second session started with `read_handoff`]
- One real problem I hit and how I fixed it: [YOUR TURN]

## 8. Limitations and next steps

OAuth instead of shared secrets; one workspace per user; container isolation; per-token rate limits; locks that work across
processes; migrating to SDK v2 (`src/mcp-server.js` and `src/mcp-http.js` only); automatic archive of full logs.

## 9. How I used AI (course rule: the idea and the understanding must be mine)

[YOUR TURN: be specific and truthful. Suggested shape:
- I used an AI assistant to: explain the slides, produce a first version of the server code, review my writing.
- I decided myself: the demo idea, the roles, the trade-offs I accepted, my own tool or experiment.
- I checked the AI's work by: running `npm test` and the smoke test, reading each file (see `docs/UNDERSTAND_AND_EXTEND.md`), trying to break the sandbox myself.]
