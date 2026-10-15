import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SandboxError, createSandbox, parseRelativePath } from "../src/sandbox.js";

function makeArea() {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sandbox-"));
  const ws = path.join(area, "ws");
  const evil = path.join(area, "ws-evil"); // sibling whose name STARTS WITH the root's name
  fs.mkdirSync(ws);
  fs.mkdirSync(evil);
  fs.writeFileSync(path.join(evil, "secret.txt"), "TOP SECRET");
  fs.writeFileSync(path.join(area, "outside.txt"), "outside");
  fs.mkdirSync(path.join(ws, ".git"));
  fs.mkdirSync(path.join(ws, "demo"));
  fs.writeFileSync(path.join(ws, "demo", "a.md"), "hi");
  return { area, ws, evil };
}

function trySymlink(target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false; // e.g. Windows without the privilege to create symlinks
  }
}

const REJECTED = [
  ["parent folder", "../outside.txt"],
  ["nested parent", "demo/../../outside.txt"],
  ["parent hidden inside a valid path", "demo/.."],
  ["backslash traversal", "demo\\..\\..\\outside.txt"],
  ["mixed separators", "demo/..\\../outside.txt"],
  ["sibling with the same prefix", "../ws-evil/secret.txt"],
  ["absolute unix path", "/etc/passwd"],
  ["absolute windows path", "C:\\Windows\\win.ini"],
  ["drive letter, forward slashes", "c:/windows/win.ini"],
  ["drive-relative path", "C:evil.txt"],
  ["UNC path", "\\\\server\\share\\x"],
  ["UNC path, forward slashes", "//server/share/x"],
  ["null byte", "demo/a.md\0.png"],
  ["NTFS alternate data stream", "demo/a.md:hidden"],
  ["NTFS stream via ::$DATA", "demo/a.md::$DATA"],
  ["Windows device name CON", "CON"],
  ["Windows device name with extension", "demo/nul.txt"],
  ["Windows device name COM1", "com1"],
  ["trailing dot (Windows strips it)", "demo/a.md."],
  ["trailing space (Windows strips it)", "demo/a.md "],
  ["three dots", "..."],
  ["8.3 short name for .git", "GIT~1/config"],
  [".git folder", ".git/config"],
  [".GIT in capitals", ".GIT/HEAD"],
  [".git nested", "demo/.git/hooks"],
  ["wildcard characters", "demo/*.md"],
  ["too long", "a".repeat(401)],
];

for (const [label, input] of REJECTED) {
  test(`parseRelativePath rejects: ${label}`, () => {
    assert.throws(() => parseRelativePath(input), SandboxError);
  });
}

test("parseRelativePath rejects non-strings", () => {
  for (const bad of [undefined, null, 5, {}, ["a"]]) assert.throws(() => parseRelativePath(bad), SandboxError);
});

test("parseRelativePath accepts normal paths and normalises separators", () => {
  assert.deepEqual(parseRelativePath("demo/notes.md"), ["demo", "notes.md"]);
  assert.deepEqual(parseRelativePath("demo\\sub\\notes.md"), ["demo", "sub", "notes.md"]);
  assert.deepEqual(parseRelativePath("./demo//notes.md"), ["demo", "notes.md"]);
  assert.deepEqual(parseRelativePath("."), []);
  assert.deepEqual(parseRelativePath(""), []);
  assert.deepEqual(parseRelativePath(".env"), [".env"]); // allowed INSIDE the workspace
  assert.deepEqual(parseRelativePath("my notes (v2).md"), ["my notes (v2).md"]);
});

test("URL-encoded dots are just an ordinary (harmless) file name, never decoded", () => {
  assert.deepEqual(parseRelativePath("%2e%2e/secret"), ["%2e%2e", "secret"]);
});

test("resolve keeps everything under the root and reports a clean relative path", async () => {
  const { ws } = makeArea();
  const sb = createSandbox(ws);
  const r = await sb.resolve("demo\\a.md");
  assert.equal(r.rel, "demo/a.md");
  assert.equal(r.abs, path.join(ws, "demo", "a.md"));
  assert.equal((await sb.resolve(".")).rel, ".");
});

test("resolve allows paths that do not exist yet (creating files)", async () => {
  const { ws } = makeArea();
  const r = await createSandbox(ws).resolve("new/deep/folder/file.txt");
  assert.equal(r.rel, "new/deep/folder/file.txt");
});

test("allowRoot=false refuses the root itself", async () => {
  const { ws } = makeArea();
  await assert.rejects(createSandbox(ws).resolve(".", { allowRoot: false }), SandboxError);
});

test("a symlink inside the workspace that points OUTSIDE is rejected", async (t) => {
  const { ws, evil } = makeArea();
  if (!trySymlink(evil, path.join(ws, "link"), "junction")) return t.skip("cannot create symlinks here");
  const sb = createSandbox(ws);
  await assert.rejects(sb.resolve("link/secret.txt"), /outside the workspace/);
  await assert.rejects(sb.resolve("link"), /outside the workspace/);
  await assert.rejects(sb.resolve("link/new-file.txt"), /outside the workspace/); // creating through the link too
});

test("a symlink to a single file outside is rejected", async (t) => {
  const { ws, area } = makeArea();
  if (!trySymlink(path.join(area, "outside.txt"), path.join(ws, "peek.txt"), "file")) return t.skip("cannot create symlinks here");
  await assert.rejects(createSandbox(ws).resolve("peek.txt"), /outside the workspace/);
});

test("a symlink that points at .git inside the workspace is rejected", async (t) => {
  const { ws } = makeArea();
  if (!trySymlink(path.join(ws, ".git"), path.join(ws, "gitlink"), "junction")) return t.skip("cannot create symlinks here");
  await assert.rejects(createSandbox(ws).resolve("gitlink/config"), /\.git/);
});

test("a symlink that stays inside the workspace is fine", async (t) => {
  const { ws } = makeArea();
  if (!trySymlink(path.join(ws, "demo"), path.join(ws, "alias"), "junction")) return t.skip("cannot create symlinks here");
  const r = await createSandbox(ws).resolve("alias/a.md");
  assert.equal(r.rel, "alias/a.md");
});
