# MCP File Server Project

> **Author:** Aleah Rofh Montealto Romano (BSCS-3A)  
> **Tested on:** Microsoft Windows 10 Pro, Node v24.15.0, git 2.45.2  
> **Repository:** https://github.com/lluviaaaa/MCP-Server.git  
> **About the Server:** I used this Node.js MCP server with an ngrok tunnel and PM2 to connect Claude to my local files, allowing different AI agents to act as coders and reviewers. To make this server unique, I added a custom `audit_loot_table` tool that lets the AI automatically verify the math inside Dungeons and Dragons CSV tables rather than just reading plain text. This multi-agent setup successfully completed my project by giving the AI the exact tools needed to autonomously find and fix intentional errors in the files.

A small [MCP](https://modelcontextprotocol.io) server that lets an AI client (Claude, the MCP Inspector,
Claude Code, ...) work inside **one folder** on your computer[cite: 12]. It offers 13 tools: list, read, write, edit and
delete files, search, git, a custom D&D CSV table auditor (`audit_loot_table`), and a "handoff" protocol so a brand-new chat can continue the work of the previous one.

```
 AI client (Claude runs in Anthropic's cloud)
      |  HTTPS, JSON-RPC  ("Streamable HTTP" MCP transport)
      v
 ngrok tunnel   https://<you>.ngrok-free.dev      public address; TLS ends here
      |
      v
 127.0.0.1:3333   Node.js server, kept alive by pm2
   src/http.js        1. the DOOR      token check, size limits, throttling, Origin check
   src/mcp-*.js       2. the PROTOCOL  MCP SDK; the caller's role decides which tools exist
   src/tools/*.js     3. the WORK      13 single-purpose tools (including audit_loot_table)
   src/sandbox.js     4. the WALL      every path is checked before any file is touched
      |
      v
 workspace/   a git repository + handoff files; the ONLY folder agents can reach
```

## Requirements

| Need | Check with | Why |
|------|-----------|-----|
| Node.js 20.12 or newer (developed and tested on 22; 24 works) | `node --version` | runs the server[cite: 12] |
| git | `git --version` | the `git_*` tools[cite: 12] |
| ngrok account (free) | <https://ngrok.com> | gives your PC a public HTTPS address[cite: 12] |
| pm2 | `npm install -g pm2` | restarts the server if it crashes[cite: 12] |

## 1. Quick start

Use **PowerShell** or Command Prompt inside the project folder (in File Explorer, type `powershell` in the address bar and press Enter)[cite: 12].
The code was developed and tested on Node 22 and verified on Node 24.15.0[cite: 12].

```
npm install
npm run setup      # creates .env with three random tokens (admin, coder, reviewer)
npm test           # runs unit and integration checks; needs no server and no internet
npm start          # leave this window open
```

**Windows note:** if PowerShell says *"running scripts is disabled on this system"* when you type `npm` or `pm2`, run this once
and try again: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (answer `Y`)[cite: 12]. Or simply use Command Prompt (cmd) instead[cite: 12].

In a **second** terminal[cite: 12]:

```
npm run smoke      # end-to-end checks of every tool over HTTP; prints PASS/FAIL
npm run urls       # prints the URLs and tokens for each role (secrets: never screenshot or commit)
npm run inspect    # opens the MCP Inspector in your browser
```

**In the Inspector:** pick transport *Streamable HTTP*, paste the local admin URL using the token from
`npm run urls` (it looks like `http://127.0.0.1:3333/s/<token>/mcp`), click *Connect*, open the *Tools* tab,
*List Tools*, then run `list_files` with `{"path": "."}`[cite: 12].

## 2. Make it reachable from the internet (ngrok)

Claude connects **from Anthropic's servers**, not from your browser, so `localhost` is not enough[cite: 12]. ngrok gives your laptop a public HTTPS address[cite: 12].

1. **Sign up** (free) at <https://ngrok.com> and verify your email[cite: 12].
2. **Install** (PowerShell): `winget install Ngrok.Ngrok`, or download it from the ngrok site[cite: 12]. Then **open a new terminal** so `ngrok` is found[cite: 12].
3. **Add your authtoken once:** in the ngrok dashboard find *Your Authtoken* and run `ngrok config add-authtoken <authtoken>`[cite: 12].
4. **Claim your free static domain** on the dashboard's *Domains* page (for example, `lyrically-stays-slouchy.ngrok-free.dev`)[cite: 12].
5. **Start the tunnel** in its own terminal, while `npm start` (or pm2) is running[cite: 12]:
   ```
   ngrok http 127.0.0.1:3333 --url=lyrically-stays-slouchy.ngrok-free.dev
   ```
   (`127.0.0.1:3333` instead of just `3333` avoids a Windows problem where `localhost` means IPv6[cite: 12].)
6. Put `PUBLIC_URL=https://lyrically-stays-slouchy.ngrok-free.dev` in `.env`, then run `npm run urls` again[cite: 12].
7. **Prove it works from outside:** open `https://lyrically-stays-slouchy.ngrok-free.dev/health` in your phone's browser[cite: 12]. You should see `{"status":"ok"}`[cite: 12].
   (The free plan may show an ngrok notice page first; click through[cite: 12].)

**On your phone's hotspot:** the tunnel only makes an *outgoing* connection, so it works on any network, including a hotspot[cite: 12]. Keep the laptop plugged in with sleep turned off, keep the phone plugged in with battery saver off, and pause OneDrive and Windows Update so they do not eat your data[cite: 12]. If the hotspot drops, ngrok reconnects by itself; wait 20 seconds and retry[cite: 12].

## 3. Keep it running (pm2)

```
npm run pm2:start        # starts src/index.js under pm2, restarts it if it crashes
pm2 status               # should say "online"
pm2 save                 # remember the process list
npm run pm2:logs         # live log; Ctrl+C to leave
```

Optional, keep the tunnel alive too: `pm2 start ngrok --name mcp-tunnel --interpreter none -- http 127.0.0.1:3333 --url=<your-domain>`[cite: 12]

*After a reboot:* macOS/Linux use `pm2 startup` and follow what it prints[cite: 12]. **Windows has no `pm2 startup`:** open a terminal
and run `pm2 resurrect` (brings back what you saved), or use a community helper such as `pm2-installer` or
`pm2-windows-startup` (read their READMEs first)[cite: 12].

*Prove "survives a restart":* kill the Node process (Task Manager, or `pm2 restart mcp-file-server`) and call a tool again[cite: 12].
It works at once with no new handshake, because the server is *stateless*: nothing in memory is needed by a client[cite: 12].

## 4. Connect a real client

A "real client" is any AI app that speaks MCP[cite: 12]. It does not have to be Claude[cite: 12]. Options, checked against current docs in October 2026[cite: 12]:

| Client | Cost to you | Verdict |
|--------|-------------|---------|
| **Claude (claude.ai or desktop), custom connector** | works on the Free plan, which allows **one** custom connector[cite: 12] | **Recommended first choice:** documented, simple, uses the secret-URL form[cite: 12] |
| **Antigravity CLI (`agy`)**, Google's replacement for the old Gemini CLI | uses your Google AI Pro sign-in[cite: 12] | **Optional second client:** can attach both roles at once and use the header token. It is a newer tool and details vary by version, so verify with `agy mcp add --help`[cite: 12] |
| Claude Code | needs a paid Claude plan (Pro or above) or API credits; **not on Free**[cite: 12] | skip unless you upgrade[cite: 12] |
| Old Gemini CLI | stopped serving Free, AI Pro and Ultra accounts on 18 June 2026[cite: 12] | do not use[cite: 12] |
| MCP Inspector | free[cite: 12] | use it for testing; it is not an AI, so it does not count as the "real client"[cite: 12] |

Using **two different clients** on the same server (Claude and `agy`, say) is a strong demo moment: one server, no code changes, two different AIs[cite: 12].
That is the "N + M" idea from slide 3 made real[cite: 12].

**Claude Free has usage limits per time window[cite: 12].** If you hit one in the middle of a session, finish later in a *new* chat: the handoff files let the next
chat carry on, which is exactly what you are demonstrating[cite: 12]. Keep each session short[cite: 12].

### 4a. Claude (Free plan)

Menu names change, so also see <https://claude.com/docs/connectors/custom/add-unlisted>[cite: 12].

1. Settings -> Connectors -> *Add custom connector*[cite: 12].
2. Name: `File server` (or `Coder` / `Reviewer`). URL: the **`/s/<token>/mcp`** line from `npm run urls` (start with the **coder** role)[cite: 12].
3. Leave authentication on *no sign-in*: the secret is inside the URL[cite: 12]. (The "Request headers" option is a beta available only to some organizations[cite: 12].)
4. In a new chat, switch the connector on (the `+` / tools menu) and ask: *"Use the File server to list the files in the workspace."*[cite: 12]
5. Claude may ask you to approve each tool the first time[cite: 12]. That is the *client-side* gate on top of the server's own[cite: 12].

To switch to another role (for example reviewer), use that role's URL[cite: 12]. If you cannot edit the URL of the connector, remove it and add it again[cite: 12].

### 4b. Antigravity CLI (optional second client)

1. Install it from Google's page (<https://antigravity.google>); at the time of writing the Windows installer is a one-line PowerShell command shown there[cite: 12].
2. `npm run urls -- --agy` prints a ready-to-paste `mcp_config.json` block containing both roles[cite: 12].
3. Save it as `%USERPROFILE%\.gemini\config\mcp_config.json` (or `.agents\mcp_config.json` inside one folder)[cite: 12]. Remote servers use the key `serverUrl` (not `url`) and no `type` field[cite: 12].
4. Start `agy`, type `/mcp` to see the servers, and ask it to use `file-server-coder` or `file-server-reviewer`[cite: 12].

### 4c. Other clients

- **Claude Code** (paid plan only): `claude mcp add --transport http file-server https://<domain>/mcp --header "Authorization: Bearer <token>"` (check `claude mcp add --help`)[cite: 12].
- **Any client that can send headers:** `POST https://<domain>/mcp` with `Authorization: Bearer <token>`[cite: 12].

## 5. The 13 tools

| Tool | What it does | Roles |
|------|--------------|-------|
| `list_files` | list a folder (optionally recursive, capped)[cite: 12] | all[cite: 12] |
| `read_file` | read a text file in line chunks; returns a `version`[cite: 12] | all[cite: 12] |
| `search_files` | literal text search with `path:line: text` results[cite: 12] | all[cite: 12] |
| `git_status` | short status of the workspace repo[cite: 12] | all[cite: 12] |
| `git_diff` | uncommitted changes, capped[cite: 12] | all[cite: 12] |
| `git_log` | recent commits[cite: 12] | all[cite: 12] |
| `read_handoff` | state + latest logs of a project in ONE call[cite: 12] | all[cite: 12] |
| `append_log` | timestamped entry to PLAN_LOG / CHECKPOINTS / DECISIONS[cite: 12] | all[cite: 12] |
| `audit_loot_table` | custom tool: audits CSV encounter/loot tables for weight sum (100) and placeholders (TODO/FIXME/TBD)[cite: 11] | all |
| `write_file` | create a file, or replace one **only with the current `if_version`**[cite: 12] | coder, admin[cite: 12] |
| `str_replace` | replace exactly one occurrence of a string[cite: 12] | coder, admin[cite: 12] |
| `git_commit` | stage (all, or given paths) and commit[cite: 12] | coder, admin[cite: 12] |
| `delete_file` | delete one file; needs `confirm=true`; handoff files protected[cite: 12] | admin[cite: 12] |

Roles come from the token used: `REVIEWER_TOKEN` sees 9 tools, `CODER_TOKEN` 12, `ADMIN_TOKEN` all 13[cite: 12]. A tool that is
outside a role is not merely refused: it does not exist for that agent[cite: 12].

## 6. The handoff protocol (how agents share work)

Agents never talk to each other[cite: 12]. They leave state in files inside a project folder (e.g. `workspace/dnd-swamp/`)[cite: 11, 12]:

| File | Holds | Written by |
|------|-------|-----------|
| `PROJECT_STATE.md` | where are we *now* (one page)[cite: 12] | rewritten with `if_version`[cite: 12] |
| `PLAN_LOG.md` | what we intend to do next, and why[cite: 12] | `append_log` (append-only)[cite: 12] |
| `CHECKPOINTS.md` | what is done *and verified*; how to resume[cite: 12] | `append_log` (append-only)[cite: 12] |
| `DECISIONS.md` | choices and reasons[cite: 12] | `append_log` (append-only)[cite: 12] |

A new session starts with one call, `read_handoff`, and ends by updating the state and logging a checkpoint[cite: 12].
Append-only logs cannot be overwritten; the mutable state file is protected by `if_version`, a short hash of the
file content: `read_file` returns it, `write_file` demands it, and a stale value is rejected with the current one[cite: 12].
The full rules the agents read are in `workspace/HANDOFF_PROTOCOL.md` (copied there on first run from `workspace-template/`)[cite: 12].

## 7. Security model (summary)

| Threat | What stops it | Where |
|--------|---------------|-------|
| Anyone on the internet calling your tools | token required (Bearer header or secret URL), constant-time comparison, 401/404, throttle after 20 failures per minute[cite: 12] | `http.js`, `auth.js`[cite: 12] |
| `../`, absolute paths, `C:\`, `\\server\share` | rejected before any file call; `..` is refused outright even if it would stay inside[cite: 12] | `sandbox.js`[cite: 12] |
| Symlinks / junctions pointing outside | nearest existing ancestor resolved with `realpath` and re-checked[cite: 12] | `sandbox.js`[cite: 12] |
| Windows tricks: `CON`, `file:stream`, trailing dot/space, `GIT~1` | rejected by name rules[cite: 12] | `sandbox.js`[cite: 12] |
| Tampering with `.git` (hooks run code) | `.git` is unreachable; only the `git_*` tools touch it[cite: 12] | `sandbox.js`, `git.js`[cite: 12] |
| Agents reading `.env` or the source | the config refuses a workspace that contains the project folder[cite: 12] | `config.js`[cite: 12] |
| Destructive mistakes | role scoping, `confirm=true`, protected handoff files, `ALLOW_DELETE` switch, every call logged[cite: 12] | `roles.js`, `files.js`[cite: 12] |
| Two agents overwriting each other | `if_version` check + per-file lock; append-only logs[cite: 12] | `files.js`, `locks.js`[cite: 12] |
| Shell injection through git | `execFile` (no shell), paths after `--`, message passed as `--message=`[cite: 12] | `git.js`[cite: 12] |
| Huge inputs/outputs, runaway scans | caps on body, file, read chunk, output, search files; regex search deliberately not offered (ReDoS)[cite: 12] | `config.js`, `run-tool.js`, `search.js`[cite: 12] |
| Leaking internals | errors are short messages; stack traces and host paths stay in the server log[cite: 12] | `errors.js`, `run-tool.js`[cite: 12] |
| Secrets in logs | file content never logged; the secret URL segment is redacted[cite: 12] | `logger.js`, `http.js`[cite: 12] |
| Malicious web pages talking to localhost | Origin header must be allow-listed; server binds to 127.0.0.1[cite: 12] | `http.js`, `config.js`[cite: 12] |

**Known limits:** the secret URL can leak through logs and browser history (prefer the header where the client supports it; rotate by deleting `.env` and running `npm run setup`)[cite: 12]; a check-then-use race on symlinks is possible for a local attacker[cite: 12]; locks are in-process so run exactly one instance[cite: 12]; three shared secrets are not per-user accounts (OAuth would be the next step)[cite: 12]; the tunnel provider sees decrypted traffic[cite: 12]; and text inside files can try to steer an agent (prompt injection), which roles, the delete gate and the "files are data" rule reduce but cannot eliminate[cite: 12].

## 8. Configuration (`.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `ADMIN_TOKEN`, `CODER_TOKEN`, `REVIEWER_TOKEN` | none (at least one required)[cite: 12] | 24-128 chars: letters, digits, `. _ ~ -`. Generate with `npm run gen-token`[cite: 12] |
| `PORT` / `HOST` | `3333` / `127.0.0.1`[cite: 12] | keep HOST on loopback; the tunnel reaches it from the same machine[cite: 12] |
| `WORKSPACE_ROOT` | `workspace`[cite: 12] | the only folder agents can touch[cite: 12] |
| `LOG_DIR` | `logs`[cite: 12] | `server.jsonl` = every tool call (the source of the transcript)[cite: 12] |
| `ALLOW_PATH_TOKEN` | `true`[cite: 12] | accept `/s/<token>/mcp` (needed where no header can be sent)[cite: 12] |
| `ALLOW_DELETE` | `true`[cite: 12] | `false` switches `delete_file` off for everyone[cite: 12] |
| `PUBLIC_URL` | empty[cite: 12] | your ngrok address, used by `npm run urls`[cite: 12] |
| `MAX_FILE_BYTES`, `MAX_BODY_BYTES` | 1 000 000, 2 000 000[cite: 12] | size caps[cite: 12] |
| `ALLOWED_ORIGINS` | empty[cite: 12] | allow-list for browser-based clients[cite: 12] |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `MCP File Server`, `mcp@localhost`[cite: 12] | identity on commits in the workspace repo[cite: 12] |

## 9. Evidence for the demo: the transcript

Every tool call is written to `logs/server.jsonl` (who, which tool, which arguments without file content, ok or error, milliseconds)[cite: 12].

```
npm run transcript                                   # all calls -> TRANSCRIPT.md
npm run transcript -- --since "2026-10-16 11:53"     # only the demo run
npm run transcript -- --gap 2                        # sessions that ran back to back (default: 20 idle minutes = new session)
```

It splits the calls into sessions and prints an *efficiency self-check*: handoff read first, edits without a prior read,
identical retries after an error, redundant reads, loops, oversized results, batched calls, progress logged, work committed[cite: 12].
Smoke-test calls are excluded automatically[cite: 12].

## 10. Milestones

| | Check | Suggested commit message |
|--|-------|--------------------------|
| M1 | `npm start` works; Inspector shows `list_files` answering[cite: 12] | `M1: server boots, list_files works in Inspector`[cite: 12] |
| M2 | `npm test` green: all file tools + path-escape tests[cite: 12] | `M2: file tools and sandbox with path-escape tests`[cite: 12] |
| M3 | public `/health` from phone data; Claude connected; killing the process recovers under pm2[cite: 12] | `M3: public endpoint, token auth, pm2`[cite: 12] |
| M4 | handoff files + git tools + write guards demonstrated[cite: 12] | `M4: handoff protocol, git-lite, write guards`[cite: 12] |
| M5 | two or more sessions finished the demo task; transcript + report written[cite: 12] | `M5: demo transcript and report`[cite: 12] |

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| PowerShell: "running scripts is disabled" when typing `npm` or `pm2`[cite: 12] | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (answer `Y`), or use Command Prompt[cite: 12] |
| `winget` is not recognised[cite: 12] | download ngrok from its website instead[cite: 12] |
| `ngrok` is not recognised after installing[cite: 12] | open a **new** terminal window[cite: 12] |
| `Configuration problem: ...` at start[cite: 12] | read the sentence; usually run `npm run setup` or fix `.env`[cite: 12] |
| `Port 3333 is already in use`[cite: 12] | `pm2 stop mcp-file-server`, or change `PORT`[cite: 12] |
| `npm run smoke`: "Could not complete"[cite: 12] | the server is not running (`npm start`)[cite: 12] |
| ngrok `ERR_NGROK_8012` / connection refused[cite: 12] | start the server first; use `ngrok http 127.0.0.1:3333 ...`[cite: 12] |
| `/health` works on the laptop but not from the phone[cite: 12] | the tunnel is not running, or `--url` has a typo; check the ngrok window[cite: 12] |
| Claude: connector failed or asks for sign-in[cite: 12] | you pasted the `/mcp` URL; use the `/s/<token>/mcp` URL. Check `https://<domain>/health` first[cite: 12] |
| Claude: tools not offered in the chat[cite: 12] | switch the connector on in that chat's tools menu; start a new chat after adding it[cite: 12] |
| Claude: "usage limit reached" mid-session[cite: 12] | wait for the reset and continue in a **new chat** starting with `read_handoff`; keep sessions short[cite: 12] |
| `agy` does not list the server[cite: 12] | check the file path and that you used `serverUrl` with no `type`; `agy mcp add --help` shows your version's syntax[cite: 12] |
| 401 from a client[cite: 12] | token typo, or the wrong role's token; copy again from `npm run urls`[cite: 12] |
| `git is not installed` from a tool[cite: 12] | install Git, restart the terminal and the server[cite: 12] |
| `pm2` not recognised[cite: 12] | close and reopen the terminal after `npm install -g pm2`[cite: 12] |
| `Version conflict` error from an agent[cite: 12] | working as designed: the agent must `read_file` again and merge[cite: 12] |

## 12. SDK versions and language

MCP's July 2026 spec (2026-07-28) removed the `initialize` handshake and sessions, and a new SDK line (v2, packages
`@modelcontextprotocol/server` and friends) went stable alongside it[cite: 12]. This project uses the **v1 SDK**
(`@modelcontextprotocol/sdk`), which speaks the 2025 protocol described in the course slides and which its maintainers
keep supporting for at least six months after v2's release; clients are built to fall back to it[cite: 12]. Only
`src/mcp-server.js` and `src/mcp-http.js` touch the SDK, so migrating later means rewriting those two files; the tools,
sandbox, auth and logging do not change[cite: 12]. Migration guide: <https://ts.sdk.modelcontextprotocol.io/v2/migration/>[cite: 12].

**Language:** the server is written in JavaScript (the course's reference stack), but the rubric scores a well-reasoned Python
version the same[cite: 12]. The language changes how comfortably *you* can read and defend the code, not the grade or what the server does[cite: 12].
`docs/UNDERSTAND_AND_EXTEND.md` translates the JavaScript for Python programmers and explains what a port to Python would involve[cite: 12].

## Project layout

```
src/index.js          start-up                     src/tools/files.js       list/read/write/str_replace/delete
src/config.js         .env + validation            src/tools/search.js      search_files
src/http.js           the door                     src/tools/git-tools.js   status/diff/commit/log
src/auth.js           token checks                 src/tools/handoff.js     append_log, read_handoff
src/roles.js          which role sees which tools  src/tools/custom.js      audit_loot_table (custom D&D tool)
src/sandbox.js        path checks                  src/git.js, fileio.js, locks.js, errors.js, logger.js, run-tool.js
src/mcp-server.js     SDK glue 1 of 2              scripts/   setup, urls, smoke, transcript, gen-token
src/mcp-http.js       SDK glue 2 of 2              test/      config, sandbox, tools, run-tool, http, transcript
workspace-template/   starter handoff files        ecosystem.config.cjs   pm2 settings

TRANSCRIPT.md                  multi-agent session log and efficiency self-check
docs/REPORT.md                 graded technical report
docs/evidence/                 screenshots, workspace git log, and final D&D deliverables
docs/DEMO_SCRIPT.md            5-minute run sheet, prompts, Q&A practice
docs/DEMO_IDEAS.md             how to choose YOUR demo task (criteria, method, seeds, worked examples)
docs/UNDERSTAND_AND_EXTEND.md  read the code as a Python programmer; add a tool of your own
docs/MODIFY_CHECKLIST.md       project modification checklist
```