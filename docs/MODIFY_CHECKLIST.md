# What to modify, file by file

Legend: **MUST** = only you can do it and it is graded or expected. **SHOULD** = strongly recommended.
**OPTIONAL** = nice to have. **DON'T** = touching it can break security or the tests.

Search every file for `[YOUR TURN]` (VS Code: Ctrl+Shift+F), and also for `<your-project-name>` and `[what you want built]`. When none are left in what you submit, you are done with the writing.

## 0. Order of work

Today is Wednesday, 14 October. "Next Saturday" is either **17 October (3 days)** or **24 October (10 days)**. Ask your instructor today
which one it is (message draft in section 12), and plan for the shorter one until you know.

**If it is Saturday 17 October (3 days):** do the must-haves first, in this order of priority: (1) a deployed server with a real client and
two sessions, (2) the transcript and screenshots, (3) the report, (4) your own idea and tool, (5) extras such as a second client.

| Day | Do |
|-----|----|
| Wed (today) | Step 0, M1 and M2 from the README. Pick your idea (30-minute worksheet in `docs/DEMO_IDEAS.md`). Message your instructor. Read `src/sandbox.js` and `src/http.js`. |
| Thu | M3: ngrok account, tunnel, pm2, connect Claude. M4 quick checks in the Inspector. One dry run of session 1. |
| Fri | The real demo run (2 sessions), `npm run transcript`, screenshots, report draft. Backup video. |
| Sat morning | Finish the report, rehearse twice on the hotspot, demo. Skip the custom tool and the second client if you are behind. |

**If it is Saturday 24 October (10 days):**

| Days | Do |
|------|----|
| 1 to 2 | Step 0, M1, M2. Part 1 of `docs/UNDERSTAND_AND_EXTEND.md` (read the code). |
| 3 to 4 | M3: ngrok, pm2, your client. Decide your idea and write the worksheet. |
| 5 to 6 | M4 and your own tool (Part 2 of the same guide). Dry runs. |
| 7 | The real demo run, plus the with/without-handoff experiment if you chose it. |
| 8 | Transcript, screenshots, report draft. |
| 9 | Finish the report. A classmate follows only your README. Fix what confused them. |
| 10 | Rehearse twice, record the backup video. Keep one buffer day before the checkpoint. |

## 1. `.env` (created by `npm run setup`; never committed)

- [ ] **MUST** set `PUBLIC_URL=https://<your-ngrok-domain>` after you claim the domain.
- [ ] **SHOULD** set `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` to your own, so commits in `workspace/` carry your name.
- [ ] **SHOULD** keep `ALLOW_PATH_TOKEN=true` if you use Claude Free (it cannot send a header). Use `false` if every client you use can send the header.
- [ ] **OPTIONAL** `ALLOW_DELETE=false` if you never want deletes during the demo.
- [ ] **DON'T** paste its contents anywhere: not in chats, screenshots, the report or git. If a token leaks, delete `.env`, run `npm run setup`, and update your client.

## 2. `README.md`

- [ ] **MUST** fill the two `[YOUR TURN]` lines at the top: author and section, tested-on versions, your idea in 2 or 3 sentences.
- [ ] **MUST** add your repository link and your tunnel domain description (without the secret).
- [ ] **MUST** update the tool table if you add tools (name, what it does, roles).
- [ ] **SHOULD** add 2 or 3 screenshots (Inspector listing tools, `/health`, a refused `../`). Put them in `docs/evidence/`.
- [ ] **SHOULD** have a classmate follow the README on their computer and fix every step where they got stuck.
- [ ] **OPTIONAL** shorten sections you do not need; keep it accurate. A short true README beats a long wrong one.

## 3. `docs/REPORT.md` (the graded short report)

- [ ] **MUST** header: name, section, date, repo link, endpoint (no secret).
- [ ] **MUST** section 2 (stack): the row about JavaScript vs Python, in your own honest words.
- [ ] **MUST** section 3 (tool design): add your own tool(s) to the table and say why each exists.
- [ ] **MUST** section 4 (security): pick which trade-offs you actually accepted and rewrite them; fill the line about secret-URL vs header.
- [ ] **MUST** section 5 (handoff): which agent had which role in YOUR demo.
- [ ] **MUST** section 6 (your idea): the idea, what you designed, what you implemented, what you can explain without notes.
- [ ] **MUST** section 7 (evidence): test output, smoke result, sandbox attempt, `/health` from outside, restart test, demo task, transcript numbers, one real problem you hit.
- [ ] **MUST** section 9 (AI use): a specific, honest statement (what AI did, what you decided, how you checked).
- [ ] **SHOULD** rewrite everything in your own words, keep it to about two pages, then export to the format your instructor wants (usually PDF).
- [ ] **DON'T** leave this note in: *"DRAFT. The design facts below are true..."*

## 4. `docs/DEMO_SCRIPT.md`

- [ ] **MUST** replace `<your-project-name>` and the three session task texts with YOUR demo task.
- [ ] **MUST** answer Q12, Q16, Q17 and Q18 (the ones marked `[YOUR TURN]`) with your own numbers and words, and read Q19 until you can say it yourself.
- [ ] **SHOULD** adjust the run sheet times to what you actually rehearse; it must fit 5 minutes.
- [ ] **SHOULD** tick the checklist the day before, on the **same phone hotspot** you will use.

## 5. `workspace-template/` (starter files copied into `workspace/` on first run)

- [ ] **SHOULD** edit `HANDOFF_PROTOCOL.md` to say what you want agents to do (calls per session, naming, anything specific to your task). It is your agents' instruction sheet.
- [ ] **OPTIONAL** edit `demo/*` or leave `demo/` as a rehearsal project. Your real project folder is created by the agent in session 1.
- [ ] **NOTE** editing the template later does not change an existing `workspace/`. To reseed, stop the server, delete `workspace/`, start again (you lose its history).

## 6. Your own tool: `src/tools/custom.js` (new), `src/tools/index.js`, `src/roles.js`, `test/tools.test.js`

- [ ] **SHOULD** follow Part 2 of `docs/UNDERSTAND_AND_EXTEND.md`: create the tool, register it, give it a role, add a test.
- [ ] **MUST** (if you add one) run `npm test` and `npm run smoke` again, and add it to the README and report tables.

## 7. `src/mcp-server.js`

- [ ] **OPTIONAL** the `INSTRUCTIONS` text is what some clients show the model when it connects. Tailor it to your task in your own words.

## 8. `package.json`

- [ ] **SHOULD** change `name` and `description`, add `"author": "Your Name"`, and optionally `"repository"`.
- [ ] **DON'T** change `type`, `scripts.test` or the dependency versions unless you know why. Unpinned upgrades are how a working project breaks.

## 9. `ecosystem.config.cjs`

- [ ] **OPTIONAL** change the pm2 app `name` (then also update the `pm2:*` scripts in `package.json`).
- [ ] **DON'T** raise `instances` above 1: the file locks live in one process.

## 10. Files you generate (and must keep)

- [ ] `TRANSCRIPT.md` from `npm run transcript -- --since "<demo start>" --gap 2`. Add a short note at the top saying what the task was.
- [ ] Your project's `PROJECT_STATE.md`, `PLAN_LOG.md`, `CHECKPOINTS.md`, `DECISIONS.md` from the demo (copy them out of `workspace/<project>/` into `docs/evidence/`).
- [ ] Screenshots in `docs/evidence/`: `/health` from your phone, 401 without a token, a refused path escape, `pm2 status`, the connector in your client.
- [ ] A backup screen recording of one good run (keep it outside git).

## 11. Do not modify without a good reason (and re-run `npm test` if you do)

`src/sandbox.js`, `src/auth.js`, `src/http.js`, `src/config.js`, `src/tools/files.js`, `src/locks.js`, `src/fileio.js`. These are the security
and correctness core; the tests exist to catch accidents. Reading them is encouraged, rewriting them the night before is not.

## 12. Questions to send your instructor (a ready-to-send draft is in the chat)

1. Report: length, format (Word or PDF), template?
2. Where do I submit the repo link and transcript; must the repo be public?
3. May I have slides 12 to 15 (your file-server case study)? My file has the others.
4. Any required MCP SDK or protocol version?
5. Is a Claude Free custom connector fine as the "real client", or do you prefer another client?
6. Checkpoint logistics: my laptop on my phone hotspot, time slot, how long?

## 13. Final pre-submission check

- [ ] `npm test` passes on a **fresh clone** (`git clone` your repo into a new folder, `npm install`, `npm test`)
- [ ] No `.env`, tokens, ngrok authtoken or `logs/` in the repository (`git log -p | findstr /i token` finds nothing)
- [ ] No `[YOUR TURN]` left in README, report and demo script
- [ ] Repo link opens while you are logged out (or your instructor has access)
- [ ] The demo works on the phone hotspot, with the laptop plugged in and sleep disabled
