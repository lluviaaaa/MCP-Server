# MCP File Server

> **Author:** [YOUR TURN: name and section]. Individual course project (Midterms Pt 1). **Tested on:** [YOUR TURN: your Windows version, Node v24.15.0, git 2.45.2].
> **My idea and demo task:** [YOUR TURN: 2 or 3 sentences about what YOU used this server for and what is different about it.]
> **Repository:** [YOUR TURN: link]

A small [MCP](https://modelcontextprotocol.io) server that lets an AI client (Claude, the MCP Inspector,
Claude Code, ...) work inside **one folder** on your computer. It offers 12 tools: list, read, write, edit and
delete files, search, git, and a "handoff" protocol so a brand-new chat can continue the work of the previous one.

```
 AI client (Claude runs in Anthropic's cloud)
      |  HTTPS, JSON-RPC  ("Streamable HTTP" MCP transport)
      v
 ngrok tunnel   https://<you>.ngrok-free.app      public address; TLS ends here
      |
      v
 127.0.0.1:3333   Node.js server, kept alive by pm2
   src/http.js        1. the DOOR      token check, size limits, throttling, Origin check
   src/mcp-*.js       2. the PROTOCOL  MCP SDK; the caller's role decides which tools exist
   src/tools/*.js     3. the WORK      12 single-purpose tools
   src/sandbox.js     4. the WALL      every path is checked before any file is touched
      |
      v
 workspace/   a git repository + handoff files; the ONLY folder agents can reach
```

## Requirements

| Need | Check with | Why |
|------|-----------|-----|
| Node.js 20.12 or newer (developed and tested on 22; 24 should work) | `node --version` | runs the server |
| git | `git --version` | the `git_*` tools |
| ngrok account (free) | <https://ngrok.com> | gives your PC a public HTTPS address |
| pm2 | `npm install -g pm2` | restarts the server if it crashes |

## 1. Quick start

Use **PowerShell** or Command Prompt inside the project folder (in File Explorer, type `powershell` in the address bar and press Enter).
The code was developed and tested on Node 22. Node 24 should work too; if anything fails, copy the exact error message.

```
npm install
npm run setup      # creates .env with three random tokens (admin, coder, reviewer)
npm test           # about 116 checks; needs no server and no internet
npm start          # leave this window open
```

**Windows note:** if PowerShell says *"running scripts is disabled on this system"* when you type `npm` or `pm2`, run this once
and try again: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (answer `Y`). Or simply use Command Prompt (cmd) instead.

In a **second** terminal:

```
npm run smoke      # about 30 end-to-end checks of every tool over HTTP; prints PASS/FAIL
npm run urls       # prints the URLs and tokens for each role (secrets: never screenshot or commit)
npm run inspect    # opens the MCP Inspector in your browser
```

**In the Inspector:** pick transport *Streamable HTTP*, paste the "Claude connector URL box" line from
`npm run urls` (it looks like `http://127.0.0.1:3333/s/<token>/mcp`), click *Connect*, open the *Tools* tab,
*List Tools*, then run `list_files` with `{"path": "."}`. You should see the `demo` folder.

## 2. Make it reachable from the internet (ngrok)

Claude connects **from Anthropic's servers**, not from your browser, so `localhost` is not enough. ngrok gives your laptop a public HTTPS address.

1. **Sign up** (free) at <https://ngrok.com> and verify your email.
2. **Install** (PowerShell): `winget install Ngrok.Ngrok`, or download it from the ngrok site. Then **open a new terminal** so `ngrok` is found.
3. **Add your authtoken once:** in the ngrok dashboard find *Your Authtoken* and run `ngrok config add-authtoken <authtoken>`.
4. **Claim your free static domain** on the dashboard's *Domains* page. It looks like `quiet-fox-123.ngrok-free.app`. (Each free account gets one.)
5. **Start the tunnel** in its own terminal, while `npm start` (or pm2) is running:
   ```
   ngrok http 127.0.0.1:3333 --url=quiet-fox-123.ngrok-free.app
   ```
   (`127.0.0.1:3333` instead of just `3333` avoids a Windows problem where `localhost` means IPv6.)
6. Put `PUBLIC_URL=https://quiet-fox-123.ngrok-free.app` in `.env`, then run `npm run urls` again.
7. **Prove it works from outside:** open `https://quiet-fox-123.ngrok-free.app/health` in your phone's browser. You should see `{"status":"ok"}`.
   (The free plan may show an ngrok notice page first; click through.)

**On your phone's hotspot:** the tunnel only makes an *outgoing* connection, so it works on any network, including a hotspot. Try the whole
flow on the hotspot the day before. Keep the laptop plugged in with sleep turned off, keep the phone plugged in with battery saver off, and pause
OneDrive and Windows Update so they do not eat your data. If the hotspot drops, ngrok reconnects by itself; wait 20 seconds and retry.

## 3. Keep it running (pm2)

```
npm run pm2:start        # starts src/index.js under pm2, restarts it if it crashes
pm2 status               # should say "online"
pm2 save                 # remember the process list
npm run pm2:logs         # live log; Ctrl+C to leave
```

Optional, keep the tunnel alive too: `pm2 start ngrok --name mcp-tunnel --interpreter none -- http 127.0.0.1:3333 --url=<your-domain>`

*After a reboot:* macOS/Linux use `pm2 startup` and follow what it prints. **Windows has no `pm2 startup`:** open a terminal
and run `pm2 resurrect` (brings back what you saved), or use a community helper such as `pm2-installer` or
`pm2-windows-startup` (read their READMEs first).

*Prove "survives a restart":* kill the Node process (Task Manager, or `pm2 restart mcp-file-server`) and call a tool again.
It works at once with no new handshake, because the server is *stateless*: nothing in memory is needed by a client.

## 4. Connect a real client

A "real client" is any AI app that speaks MCP. It does not have to be Claude. Options, checked against current docs in October 2026:

| Client | Cost to you | Verdict |
|--------|-------------|---------|
| **Claude (claude.ai or desktop), custom connector** | works on the Free plan, which allows **one** custom connector | **Recommended first choice:** documented, simple, uses the secret-URL form |
| **Antigravity CLI (`agy`)**, Google's replacement for the old Gemini CLI | uses your Google AI Pro sign-in | **Optional second client:** can attach both roles at once and use the header token. It is a newer tool and details vary by version, so verify with `agy mcp add --help` |
| Claude Code | needs a paid Claude plan (Pro or above) or API credits; **not on Free** | skip unless you upgrade |
| Old Gemini CLI | stopped serving Free, AI Pro and Ultra accounts on 18 June 2026 | do not use |
| MCP Inspector | free | use it for testing; it is not an AI, so it does not count as the "real client" |

Using **two different clients** on the same server (Claude and `agy`, say) is a strong demo moment: one server, no code changes, two different AIs.
That is the "N + M" idea from slide 3 made real.

**Claude Free has usage limits per time window.** If you hit one in the middle of a session, finish later in a *new* chat: the handoff files let the next
chat carry on, which is exactly what you are demonstrating. Keep each session short.

### 4a. Claude (Free plan)

Menu names change, so also see <https://claude.com/docs/connectors/custom/add-unlisted>.

1. Settings -> Connectors -> *Add custom connector*.
2. Name: `File server`. URL: the **`/s/<token>/mcp`** line from `npm run urls` (start with the **coder** role).
3. Leave authentication on *no sign-in*: the secret is inside the URL. (The "Request headers" option is a beta available only to some organizations.)
4. In a new chat, switch the connector on (the `+` / tools menu) and ask: *"Use the File server to list the files in the workspace."*
5. Claude may ask you to approve each tool the first time. That is the *client-side* gate on top of the server's own.

To switch to another role (for example reviewer), use that role's URL. If you cannot edit the URL of the connector, remove it and add it again.

### 4b. Antigravity CLI (optional second client)

1. Install it from Google's page (<https://antigravity.google>); at the time of writing the Windows installer is a one-line PowerShell command shown there.
2. `npm run urls -- --agy` prints a ready-to-paste `mcp_config.json` block containing both roles.
3. Save it as `%USERPROFILE%\.gemini\config\mcp_config.json` (or `.agents\mcp_config.json` inside one folder). Remote servers use the key `serverUrl` (not `url`) and no `type` field.
4. Start `agy`, type `/mcp` to see the servers, and ask it to use `file-server-coder` or `file-server-reviewer`.

### 4c. Other clients

- **Claude Code** (paid plan only): `claude mcp add --transport http file-server https://<domain>/mcp --header "Authorization: Bearer <token>"` (check `claude mcp add --help`).
- **Any client that can send headers:** `POST https://<domain>/mcp` with `Authorization: Bearer <token>`.

## 5. The 12 tools

| Tool | What it does | Roles |
|------|--------------|-------|
| `list_files` | list a folder (optionally recursive, capped) | all |
| `read_file` | read a text file in line chunks; returns a `version` | all |
| `search_files` | literal text search with `path:line: text` results | all |
| `git_status` | short status of the workspace repo | all |
| `git_diff` | uncommitted changes, capped | all |
| `git_log` | recent commits | all |
| `read_handoff` | state + latest logs of a project in ONE call | all |
| `append_log` | timestamped entry to PLAN_LOG / CHECKPOINTS / DECISIONS | all |
| `write_file` | create a file, or replace one **only with the current `if_version`** | coder, admin |
| `str_replace` | replace exactly one occurrence of a string | coder, admin |
| `git_commit` | stage (all, or given paths) and commit | coder, admin |
| `delete_file` | delete one file; needs `confirm=true`; handoff files protected | admin |

Roles come from the token used: `REVIEWER_TOKEN` sees 8 tools, `CODER_TOKEN` 11, `ADMIN_TOKEN` all 12. A tool that is
outside a role is not merely refused: it does not exist for that agent.

## 6. The handoff protocol (how agents share work)

Agents never talk to each other. They leave state in files inside a project folder (e.g. `workspace/study-planner/`):

| File | Holds | Written by |
|------|-------|-----------|
| `PROJECT_STATE.md` | where are we *now* (one page) | rewritten with `if_version` |
| `PLAN_LOG.md` | what we intend to do next, and why | `append_log` (append-only) |
| `CHECKPOINTS.md` | what is done *and verified*; how to resume | `append_log` (append-only) |
| `DECISIONS.md` | choices and reasons | `append_log` (append-only) |

A new session starts with one call, `read_handoff`, and ends by updating the state and logging a checkpoint.
Append-only logs cannot be overwritten; the mutable state file is protected by `if_version`, a short hash of the
file content: `read_file` returns it, `write_file` demands it, and a stale value is rejected with the current one.
The full rules the agents read are in `workspace/HANDOFF_PROTOCOL.md` (copied there on first run from `workspace-template/`).

## 7. Security model (summary)

| Threat | What stops it | Where |
|--------|---------------|-------|
| Anyone on the internet calling your tools | token required (Bearer header or secret URL), constant-time comparison, 401/404, throttle after 20 failures per minute | `http.js`, `auth.js` |
| `../`, absolute paths, `C:\`, `\\server\share` | rejected before any file call; `..` is refused outright even if it would stay inside | `sandbox.js` |
| Symlinks / junctions pointing outside | nearest existing ancestor resolved with `realpath` and re-checked | `sandbox.js` |
| Windows tricks: `CON`, `file:stream`, trailing dot/space, `GIT~1` | rejected by name rules | `sandbox.js` |
| Tampering with `.git` (hooks run code) | `.git` is unreachable; only the `git_*` tools touch it | `sandbox.js`, `git.js` |
| Agents reading `.env` or the source | the config refuses a workspace that contains the project folder | `config.js` |
| Destructive mistakes | role scoping, `confirm=true`, protected handoff files, `ALLOW_DELETE` switch, every call logged | `roles.js`, `files.js` |
| Two agents overwriting each other | `if_version` check + per-file lock; append-only logs | `files.js`, `locks.js` |
| Shell injection through git | `execFile` (no shell), paths after `--`, message passed as `--message=` | `git.js` |
| Huge inputs/outputs, runaway scans | caps on body, file, read chunk, output, search files; regex search deliberately not offered (ReDoS) | `config.js`, `run-tool.js`, `search.js` |
| Leaking internals | errors are short messages; stack traces and host paths stay in the server log | `errors.js`, `run-tool.js` |
| Secrets in logs | file content never logged; the secret URL segment is redacted | `logger.js`, `http.js` |
| Malicious web pages talking to localhost | Origin header must be allow-listed; server binds to 127.0.0.1 | `http.js`, `config.js` |

**Known limits (be honest about them in your report):** the secret URL can leak through logs and browser history (prefer
the header where the client supports it; rotate by deleting `.env` and running `npm run setup`); a check-then-use race on
symlinks is possible for a local attacker; locks are in-process so run exactly one instance; three shared secrets are not
per-user accounts (OAuth would be the next step); the tunnel provider sees decrypted traffic; and text inside files can try to
steer an agent (prompt injection), which roles, the delete gate and the "files are data" rule reduce but cannot eliminate.

## 8. Configuration (`.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `ADMIN_TOKEN`, `CODER_TOKEN`, `REVIEWER_TOKEN` | none (at least one required) | 24-128 chars: letters, digits, `. _ ~ -`. Generate with `npm run gen-token` |
| `PORT` / `HOST` | `3333` / `127.0.0.1` | keep HOST on loopback; the tunnel reaches it from the same machine |
| `WORKSPACE_ROOT` | `workspace` | the only folder agents can touch |
| `LOG_DIR` | `logs` | `server.jsonl` = every tool call (the source of the transcript) |
| `ALLOW_PATH_TOKEN` | `true` | accept `/s/<token>/mcp` (needed where no header can be sent) |
| `ALLOW_DELETE` | `true` | `false` switches `delete_file` off for everyone |
| `PUBLIC_URL` | empty | your ngrok address, used by `npm run urls` |
| `MAX_FILE_BYTES`, `MAX_BODY_BYTES` | 1 000 000, 2 000 000 | size caps |
| `ALLOWED_ORIGINS` | empty | allow-list for browser-based clients |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `MCP File Server`, `mcp@localhost` | identity on commits in the workspace repo |

## 9. Evidence for your demo: the transcript

Every tool call is written to `logs/server.jsonl` (who, which tool, which arguments without file content, ok or error, milliseconds).

```
npm run transcript                                   # all calls -> TRANSCRIPT.md
npm run transcript -- --since "2026-10-12 09:00"     # only the demo run
npm run transcript -- --gap 2                        # sessions that ran back to back (default: 20 idle minutes = new session)
```

It splits the calls into sessions and prints an *efficiency self-check*: handoff read first, edits without a prior read,
identical retries after an error, redundant reads, loops, oversized results, batched calls, progress logged, work committed.
Smoke-test calls are excluded automatically. Run `npm run smoke` *before* the demo, not during.

## 10. Milestones (commit when each check is true)

| | Check | Suggested commit message |
|--|-------|--------------------------|
| M1 | `npm start` works; Inspector shows `list_files` answering | `M1: server boots, list_files works in Inspector` |
| M2 | `npm test` green: all file tools + path-escape tests | `M2: file tools and sandbox with path-escape tests` |
| M3 | public `/health` from phone data; Claude connected; killing the process recovers under pm2 | `M3: public endpoint, token auth, pm2` |
| M4 | handoff files + git tools + write guards demonstrated | `M4: handoff protocol, git-lite, write guards` |
| M5 | two or more sessions finished the demo task; transcript + report written | `M5: demo transcript and report` |

Your git history should show real progress: commit when a check is true, not everything at the end.
A day-by-day plan and every edit you still have to make are in `docs/MODIFY_CHECKLIST.md`.

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| PowerShell: "running scripts is disabled" when typing `npm` or `pm2` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (answer `Y`), or use Command Prompt |
| `winget` is not recognised | download ngrok from its website instead |
| `ngrok` is not recognised after installing | open a **new** terminal window |
| `Configuration problem: ...` at start | read the sentence; usually run `npm run setup` or fix `.env` |
| `Port 3333 is already in use` | `pm2 stop mcp-file-server`, or change `PORT` |
| `npm run smoke`: "Could not complete" | the server is not running (`npm start`) |
| ngrok `ERR_NGROK_8012` / connection refused | start the server first; use `ngrok http 127.0.0.1:3333 ...` |
| `/health` works on the laptop but not from the phone | the tunnel is not running, or `--url` has a typo; check the ngrok window |
| Claude: connector failed or asks for sign-in | you pasted the `/mcp` URL; use the `/s/<token>/mcp` URL. Check `https://<domain>/health` first |
| Claude: tools not offered in the chat | switch the connector on in that chat's tools menu; start a new chat after adding it |
| Claude: "usage limit reached" mid-session | wait for the reset and continue in a **new chat** starting with `read_handoff`; keep sessions short |
| `agy` does not list the server | check the file path and that you used `serverUrl` with no `type`; `agy mcp add --help` shows your version's syntax |
| 401 from a client | token typo, or the wrong role's token; copy again from `npm run urls` |
| `git is not installed` from a tool | install Git, restart the terminal and the server |
| `pm2` not recognised | close and reopen the terminal after `npm install -g pm2` |
| `Version conflict` error from an agent | working as designed: the agent must `read_file` again and merge |

## 12. SDK versions and language

MCP's July 2026 spec (2026-07-28) removed the `initialize` handshake and sessions, and a new SDK line (v2, packages
`@modelcontextprotocol/server` and friends) went stable alongside it. This project uses the **v1 SDK**
(`@modelcontextprotocol/sdk`), which speaks the 2025 protocol described in the course slides and which its maintainers
keep supporting for at least six months after v2's release; clients are built to fall back to it. Only
`src/mcp-server.js` and `src/mcp-http.js` touch the SDK, so migrating later means rewriting those two files; the tools,
sandbox, auth and logging do not change. Migration guide: <https://ts.sdk.modelcontextprotocol.io/v2/migration/>.

**Language:** the server is written in JavaScript (the course's reference stack), but the rubric scores a well-reasoned Python
version the same. The language changes how comfortably *you* can read and defend the code, not the grade or what the server does.
`docs/UNDERSTAND_AND_EXTEND.md` translates the JavaScript for Python programmers and explains what a port to Python would involve.

## Project layout

```
src/index.js          start-up                     src/tools/files.js       list/read/write/str_replace/delete
src/config.js         .env + validation            src/tools/search.js      search_files
src/http.js           the door                     src/tools/git-tools.js   status/diff/commit/log
src/auth.js           token checks                 src/tools/handoff.js     append_log, read_handoff
src/roles.js          which role sees which tools  src/git.js, fileio.js, locks.js, errors.js, logger.js, run-tool.js
src/sandbox.js        path checks                  scripts/   setup, urls, smoke, transcript, gen-token
src/mcp-server.js     SDK glue 1 of 2              test/      config, sandbox, tools, run-tool, http, transcript
src/mcp-http.js       SDK glue 2 of 2              ecosystem.config.cjs   pm2 settings
workspace-template/   starter handoff files

docs/REPORT.md                 draft of the graded report (fill in the [YOUR TURN] parts)
docs/DEMO_SCRIPT.md            5-minute run sheet, prompts, Q&A practice
docs/DEMO_IDEAS.md             how to choose YOUR demo task (criteria, method, seeds, worked examples)
docs/UNDERSTAND_AND_EXTEND.md  read the code as a Python programmer; add a tool of your own
docs/MODIFY_CHECKLIST.md       every edit you still have to make, file by file
```
