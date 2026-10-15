# Understand it, then make it yours

Your course expects the idea to be yours and you to explain the design in the Q&A. Reading the code yourself, and adding
one tool of your own, is how that becomes true. You know Python best, so Part 1 translates JavaScript into Python.

## Part 1: Reading this JavaScript as a Python programmer

| Python | JavaScript in this project |
|--------|---------------------------|
| `import os` / `from x import y` | `import fs from "node:fs/promises"` / `import { y } from "./x.js"` (relative imports end in `.js`) |
| `def f(a, b=1):` | `function f(a, b = 1) { ... }` or the arrow form `const f = (a, b = 1) => { ... }` |
| `async def` / `await` | `async function` / `await` (same idea). Forget `await` and you get a *Promise object*, not the value |
| `None` | `null` (or `undefined`, "nothing was given") |
| `True`, `False`, `and`, `or`, `not` | `true`, `false`, `&&`, `\|\|`, `!` |
| `==` | `===` (strict equality; always three) |
| `f"hi {name}"` | `` `hi ${name}` `` (backticks) |
| `{"a": 1}` / `[1, 2]` | `{ a: 1 }` (object) / `[1, 2]` (array) |
| `d.get("k")`, `x or default` | `obj.k`, `obj?.k` (safe access, gives `undefined` instead of an error), `x ?? default` |
| `for x in xs:` | `for (const x of xs) { ... }` |
| `[f(x) for x in xs if c(x)]` | `xs.filter(c).map(f)` |
| `try: ... except E as e:` | `try { ... } catch (e) { ... }` |
| `raise ValueError("..")` | `throw new Error("..")` (here: `throw new ToolError("..")`) |
| `class A(B):` | `class A extends B { ... }` |
| `set()` | `new Set()` |
| `f(**kwargs)` / `def f(*args)` | `f({ ...obj })` / `function f(...args)` |
| `def f(path, content):` called as `f(path=..., content=...)` | `function f({ path, content })` called as `f({ path: ..., content: ... })` (destructuring: the arguments arrive as one object) |
| `with lock:` | `await withLock(key, async () => { ... })` (see `src/locks.js`) |
| `pip install` / `requirements.txt` | `npm install` / `package.json` |
| `python app.py` | `node src/index.js` |
| `unittest` / `pytest` | `node --test` (`node:test`, files in `test/`) |
| `json.loads` / `json.dumps` | `JSON.parse` / `JSON.stringify` |
| `print()` | `console.log()` |

Two more things you will meet: `const` means "this name will not be reassigned" (`let` means it can be), and every
statement ends with a `;`.

### The reading order (about two hours in total)

For each file: read it once for the shape, then answer the question **in your own words, out loud**. If you cannot,
read it again. These are the same questions an instructor would ask.

| # | File | What to look for | Answer this |
|---|------|------------------|-------------|
| 1 | `src/index.js` | the order of start-up steps | What stops the server from starting with no token? Where does the friendly message come from? |
| 2 | `src/http.js` | the checks before any MCP code runs: route, throttle, Origin, token, method, content type, body size | Why does a wrong *secret URL* get 404 but a wrong *header token* get 401? |
| 3 | `src/auth.js` | hashing before comparing | Why compare SHA-256 digests with `timingSafeEqual` instead of `===`? |
| 4 | `src/sandbox.js` | `parseRelativePath`, then `resolve` with `realpath` | Walk `../../x`, `C:\x`, `CON` and a symlink to a folder outside through the code. What rejects each, and where? |
| 5 | `src/tools/files.js` | `write_file`, `str_replace`, `read_file` | Draw a timeline of two agents editing one file. Where does `if_version` stop the second one? |
| 6 | `src/tools/handoff.js` and `workspace-template/HANDOFF_PROTOCOL.md` | append-only logs | Why can two agents write the logs at the same time but not PROJECT_STATE? |
| 7 | `src/run-tool.js`, `src/logger.js`, `src/errors.js` | what is logged and what the agent sees | A tool crashes unexpectedly. What does the agent see, and what does the log hold? Why the difference? |
| 8 | `src/roles.js`, `src/mcp-server.js` | the `allowed.has(tool.name)` line | How does a reviewer end up without `write_file`? |

Then run `npm test` and open `test/sandbox.test.js`: each test is an attack. Add one attack of your own.

## Part 2: Add a tool of your own (about 45 minutes)

The best way to make this project yours is a tool that serves *your* demo idea. The steps below build a small example,
`count_words`. **Replace it with your own idea** (seeds at the end).

### Step 1: create `src/tools/custom.js`

```js
// Your own tools live here.
import { z } from "zod";
import { readTextSnapshot } from "../fileio.js";

export function makeCustomTools({ config, sandbox }) {
  const countWords = {
    name: "count_words",
    title: "Count words",
    description:
      "Count the lines, words and characters of one text file in the workspace. " +
      "Use it to check the length of a draft without reading the whole file. " +
      "Fails if the file is missing, binary or over the size limit.",
    inputSchema: {
      path: z.string().min(1).max(400).describe("File to measure, relative to the workspace root."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler({ path: p }) {
      const { abs, rel } = await sandbox.resolve(p, { allowRoot: false });
      const snap = await readTextSnapshot(abs, rel, config.maxFileBytes);
      const words = snap.text.split(/\s+/).filter(Boolean).length;
      const lines = snap.text === "" ? 0 : snap.text.split(/\r?\n/).length - (snap.text.endsWith("\n") ? 1 : 0);
      return `${rel}: ${lines} lines, ${words} words, ${snap.text.length} characters`;
    },
  };
  return [countWords];
}
```

What each part does: `name` is what the agent calls; `description` is the instruction the AI reads (what, when, how it fails);
`inputSchema` is the form the AI must fill (checked by zod before your code runs); `annotations` tell the client whether the
tool only reads; `handler` is your code. Always go through `sandbox.resolve(...)` for any path. That is the wall.

### Step 2: register it in `src/tools/index.js`

Add the import at the top and the spread inside the array:

```js
import { makeCustomTools } from "./custom.js";
// ...
const tools = [
  ...makeFileTools(ctx), ...makeSearchTools(ctx), ...makeGitTools(ctx), ...makeHandoffTools(ctx),
  ...makeCustomTools(ctx),
].map(withFriendlyFsErrors);
```

### Step 3: decide who may use it, in `src/roles.js`

A read-only tool goes into `READ_TOOLS` (reviewers get it): add `"count_words",` to that list. A tool that changes files goes
into `WRITE_TOOLS` (coder and admin), and a dangerous one only into `ADMIN_TOOLS`. A test checks that every tool in the
reviewer role is annotated `readOnlyHint: true`, so the project protects you from a mistake here.

### Step 4: add a test to `test/tools.test.js`

Copy the pattern of the existing tests (`makeEnv` gives you a throw-away workspace and a `run` helper):

```js
test("count_words counts lines, words and characters", async () => {
  const { run } = await makeEnv();
  await run("write_file", { path: "essay.md", content: "one two\nthree\n" });
  assert.equal(await run("count_words", { path: "essay.md" }), "essay.md: 2 lines, 3 words, 14 characters");
});
```

### Step 5: check it, then document it

1. `npm test` should be green. 2. Restart (`npm start`, or `pm2 restart mcp-file-server`). 3. `npm run smoke` still passes.
4. Open the Inspector, *List Tools*, and run your tool. 5. Add it to the tool table in `README.md` and to the tool-design
table in `docs/REPORT.md`, and prepare one sentence on *why it exists*.

### Rules for a good tool

- One job, a `verb_noun` name, and a description that says what, when and how it fails.
- Every path goes through `sandbox.resolve`; never build a path yourself.
- Read-only if it can be; if it writes, think about a version check, a size cap and a log entry.
- Return short text. If the result can be big, cap it and say how to get the rest.
- Throw `ToolError("clear instruction")` for expected problems; let unexpected ones surface (they are logged, not shown).

### Tool ideas (pick what serves YOUR demo)

| Idea | Kind | Why it helps an agent |
|------|------|-----------------------|
| `file_outline` | read-only | list the headings of a Markdown file so the agent can jump to a section |
| `find_todos` | read-only | collect every `TODO` / `FIXME` line with file and line |
| `recent_changes` | read-only | list files changed in the last N commits: a digest for the next session |
| `word_frequency` | read-only | most-used words in a file or folder |
| `check_links` | read-only | find broken links between your notes |
| `project_stats` | read-only | files, lines and words per folder: a quick overview in one call |
| `snapshot_project` | writes | copy a project folder to a dated backup folder before risky edits |

## Part 3: Should I port the server to Python?

Both stacks score the same under the rubric ("a better-reasoned alternative scores the same as the reference"). What changes
is how comfortably *you* can read, change and defend the code. A sensible order:

1. Get the JavaScript version fully working first (M1 to M3). It is the one that has been tested.
2. Use Part 1 and Part 2 to understand it and add your own tool.
3. Only if you still prefer Python and have days to spare, ask me to port it. What would be rewritten: every module, with
   `zod` becoming type hints or `pydantic`, the SDK becoming the official Python `mcp` package (its `FastMCP` class) or the
   `fastmcp` package, tests becoming `unittest` or `pytest`, and `pm2` running `python server.py` instead of Node
   (`pm2 start server.py --interpreter python`). What stays identical: the design (sandbox, roles, handoff files, logging),
   ngrok, the demo, the transcript idea and the report.

A port late in the week is risky because it has to be re-tested on your machine, so decide early.
