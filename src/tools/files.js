// File tools: list_files, read_file, write_file, str_replace, delete_file.
// Descriptions are written FOR THE MODEL: what it does, when to use it, how it fails.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { lockKey, withLock } from "../locks.js";
import {
  atomicWrite,
  formatBytes,
  lineNumberAt,
  readTextSnapshot,
  splitLines,
  versionConflict,
  versionOf,
} from "../fileio.js";

export const HANDOFF_FILES = ["PROJECT_STATE.md", "PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"];
const PROTECTED = new Set(HANDOFF_FILES.map((n) => n.toLowerCase()));
const SKIP_NAMES = new Set([".git", "node_modules"]);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function toEol(text, eol) {
  return text.replace(/\r?\n/g, eol);
}

function findAll(text, needle, limit) {
  const found = [];
  let from = 0;
  while (found.length < limit) {
    const i = text.indexOf(needle, from);
    if (i === -1) break;
    found.push(i);
    from = i + 1; // overlapping matches count: they make a replacement ambiguous too
  }
  return found;
}

export function makeFileTools({ config, sandbox }) {
  const listFiles = {
    name: "list_files",
    title: "List files",
    description:
      "List files and folders inside the workspace. Use it first to see what exists before reading or writing. " +
      "Paths are relative to the workspace root ('.' is the root). Set recursive=true to include sub-folders down to max_depth. " +
      "Returns one line per entry with its type, size and modified time. Fails if the path does not exist or is a file. " +
      ".git and node_modules are never shown.",
    inputSchema: {
      path: z.string().max(400).default(".").describe("Folder to list, relative to the workspace root. '.' means the root."),
      recursive: z.boolean().default(false).describe("Also list sub-folders, down to max_depth levels."),
      max_depth: z.number().int().min(1).max(6).default(3).describe("Folder levels to descend when recursive is true."),
      max_entries: z.number().int().min(1).max(500).default(200).describe("Stop after this many entries."),
    },
    annotations: READ_ONLY,
    async handler({ path: p = ".", recursive = false, max_depth = 3, max_entries = 200 }) {
      const { abs, rel } = await sandbox.resolve(p);
      const st = await fs.stat(abs);
      if (!st.isDirectory()) throw new ToolError(`'${rel}' is a file, not a folder. Use read_file to read it.`);

      const lines = [];
      let truncated = false;
      async function walk(dirAbs, dirRel, depth) {
        const entries = (await fs.readdir(dirAbs, { withFileTypes: true }))
          .filter((e) => !SKIP_NAMES.has(e.name.toLowerCase()) && !e.name.includes(".tmp-"))
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const e of entries) {
          if (lines.length >= max_entries) {
            truncated = true;
            return;
          }
          const childRel = dirRel === "." ? e.name : `${dirRel}/${e.name}`;
          const childAbs = path.join(dirAbs, e.name);
          if (e.isSymbolicLink()) {
            lines.push(`link  ${childRel}  (symbolic link, not followed)`);
          } else if (e.isDirectory()) {
            lines.push(`dir   ${childRel}/`);
            if (recursive && depth < max_depth) await walk(childAbs, childRel, depth + 1);
          } else if (e.isFile()) {
            const s = await fs.stat(childAbs);
            lines.push(`file  ${childRel}  ${formatBytes(s.size)}  ${s.mtime.toISOString()}`);
          }
        }
      }
      await walk(abs, rel, 1);

      if (lines.length === 0) return `'${rel}' is an empty folder.`;
      const header = `Listing of '${rel}' (${lines.length} entries${truncated ? ", truncated" : ""})`;
      const footer = truncated
        ? "\n... more entries not shown. Narrow 'path', lower max_depth, or raise max_entries (max 500)."
        : "";
      return `${header}\n${lines.join("\n")}${footer}`;
    },
  };

  const readFile = {
    name: "read_file",
    title: "Read file",
    description:
      "Read a text file from the workspace, in chunks. Returns a header with the file's version, then the requested lines. " +
      "Pass that version back as if_version when you later call write_file or str_replace on this file. " +
      "Returns at most max_lines lines (default 200) starting at start_line; if the file is longer, the header tells you which " +
      "start_line to use next. For big files, use search_files to find the right line numbers first instead of reading everything. " +
      "Fails for binary files, folders, files over the size limit, and files that do not exist.",
    inputSchema: {
      path: z.string().min(1).max(400).describe("File to read, relative to the workspace root."),
      start_line: z.number().int().min(1).default(1).describe("First line to return (1-based)."),
      max_lines: z.number().int().min(1).max(1000).default(200).describe("Maximum number of lines to return."),
    },
    annotations: READ_ONLY,
    async handler({ path: p, start_line = 1, max_lines = 200 }) {
      const { abs, rel } = await sandbox.resolve(p, { allowRoot: false });
      const snap = await readTextSnapshot(abs, rel, config.maxFileBytes);
      const lines = splitLines(snap.text);
      const total = lines.length;
      if (total === 0) return `FILE ${rel} | version ${snap.version} | empty file`;
      if (start_line > total) throw new ToolError(`start_line ${start_line} is past the end of '${rel}' (${total} lines).`);

      const cap = config.maxReadChars;
      const clip = (l) => (l.length > cap ? `${l.slice(0, cap)} ...[line truncated]` : l);
      let end = Math.min(total, start_line + max_lines - 1);
      let chunk = lines.slice(start_line - 1, end).map(clip);
      let chars = 0;
      let keep = 0;
      for (const line of chunk) {
        if (keep > 0 && chars + line.length + 1 > cap) break;
        chars += line.length + 1;
        keep++;
      }
      if (keep < chunk.length) {
        chunk = chunk.slice(0, keep);
        end = start_line + keep - 1;
      }
      const more = end < total ? ` | more: call again with start_line=${end + 1}` : "";
      return `FILE ${rel} | version ${snap.version} | lines ${start_line}-${end} of ${total}${more}\n-----\n${chunk.join("\n")}`;
    },
  };

  const writeFile = {
    name: "write_file",
    title: "Write file",
    description:
      "Create a new file, or replace an existing file completely. To create: give path and content (parent folders are created for you). " +
      "To replace: you MUST pass if_version from a recent read_file of that file; if the file changed since, the call fails and " +
      "reports the current version so you can re-read and merge. For small edits to an existing file prefer str_replace. " +
      "Content must be UTF-8 text under the server's size limit.",
    inputSchema: {
      path: z.string().min(1).max(400).describe("File to create or replace, relative to the workspace root."),
      content: z.string().describe("The complete new text of the file."),
      if_version: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe("Required when the file already exists: the version from your latest read_file. Use 'new' to insist the file must not exist yet."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler({ path: p, content, if_version }) {
      const { abs, rel } = await sandbox.resolve(p, { allowRoot: false });
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > config.maxFileBytes) {
        throw new ToolError(`Content is ${formatBytes(bytes)}, over the ${formatBytes(config.maxFileBytes)} limit. Split it into several files.`);
      }
      return withLock(lockKey(abs), async () => {
        let existing = null;
        try {
          const st = await fs.stat(abs);
          if (st.isDirectory()) throw new ToolError(`'${rel}' is a folder. Choose a file path.`);
          existing = await fs.readFile(abs);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }

        if (existing) {
          const current = versionOf(existing);
          if (!if_version || if_version === "new") {
            throw new ToolError(
              `'${rel}' already exists (version ${current}). To replace it, call read_file first and pass its version as if_version; for a small change use str_replace.`,
            );
          }
          if (if_version !== current) throw versionConflict(rel, current);
        } else if (if_version && if_version !== "new") {
          throw new ToolError(`'${rel}' does not exist, but you passed if_version=${if_version}. Omit if_version to create a new file.`);
        }

        await atomicWrite(abs, content);
        const version = versionOf(Buffer.from(content, "utf8"));
        const lines = splitLines(content).length;
        return `${existing ? "Replaced" : "Created"} ${rel} (${bytes} bytes, ${lines} lines). New version: ${version}`;
      });
    },
  };

  const strReplace = {
    name: "str_replace",
    title: "Replace text in file",
    description:
      "Replace exactly one occurrence of old_str with new_str in an existing file. old_str must match the file text exactly " +
      "(including spaces and line breaks) and must appear exactly once; if it appears zero times or several times the call fails " +
      "and says so (with line numbers), so widen old_str with surrounding lines. Use it for small edits; use write_file to rewrite " +
      "a whole file. Optionally pass if_version (from read_file) to fail if the file changed since you read it. " +
      "To delete text, pass an empty new_str.",
    inputSchema: {
      path: z.string().min(1).max(400).describe("File to edit, relative to the workspace root."),
      old_str: z.string().min(1).describe("Exact text to find. Must occur exactly once."),
      new_str: z.string().describe("Replacement text. May be empty to delete old_str."),
      if_version: z.string().min(1).max(40).optional().describe("Optional: version from read_file; the edit fails if the file has changed."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async handler({ path: p, old_str, new_str, if_version }) {
      if (typeof old_str !== "string" || old_str.length === 0) throw new ToolError("old_str must not be empty.");
      const { abs, rel } = await sandbox.resolve(p, { allowRoot: false });
      return withLock(lockKey(abs), async () => {
        const snap = await readTextSnapshot(abs, rel, config.maxFileBytes);
        if (if_version && if_version !== snap.version) throw versionConflict(rel, snap.version);

        const text = snap.text;
        const crlf = text.includes("\r\n");
        const needle = crlf ? toEol(old_str, "\r\n") : old_str;
        const replacement = crlf ? toEol(new_str, "\r\n") : new_str;

        const hits = findAll(text, needle, 6);
        if (hits.length === 0) {
          throw new ToolError(
            `old_str was not found in '${rel}'. It must match exactly, including spaces, tabs and line breaks. Re-read the file (read_file or search_files) and copy the text again.`,
          );
        }
        if (hits.length > 1) {
          const where = hits.map((i) => lineNumberAt(text, i)).join(", ");
          const count = hits.length >= 6 ? "6 or more" : String(hits.length);
          throw new ToolError(`old_str appears ${count} times in '${rel}' (lines ${where}). Include more surrounding text so it matches exactly once.`);
        }

        const index = hits[0];
        // Slice instead of String.replace so "$&" or "$1" inside new_str are copied literally.
        const updated = text.slice(0, index) + replacement + text.slice(index + needle.length);
        const bytes = Buffer.byteLength(updated, "utf8");
        if (bytes > config.maxFileBytes) throw new ToolError(`The edited file would be ${formatBytes(bytes)}, over the ${formatBytes(config.maxFileBytes)} limit.`);

        await atomicWrite(abs, updated);
        return `Replaced 1 occurrence at line ${lineNumberAt(text, index)} of ${rel}. New version: ${versionOf(Buffer.from(updated, "utf8"))}`;
      });
    },
  };

  const deleteFile = {
    name: "delete_file",
    title: "Delete file",
    description:
      "Permanently delete ONE file (never a folder). This is destructive: if the content might be needed, commit it first with git_commit. " +
      "Requires confirm=true. The handoff files (PROJECT_STATE.md, PLAN_LOG.md, CHECKPOINTS.md, DECISIONS.md) cannot be deleted. " +
      "Only the admin role has this tool, and the owner can switch it off entirely.",
    inputSchema: {
      path: z.string().min(1).max(400).describe("File to delete, relative to the workspace root."),
      confirm: z.boolean().describe("Must be true. A deliberate extra step so deletes are never accidental."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler({ path: p, confirm }) {
      if (confirm !== true) throw new ToolError("Refusing to delete: pass confirm=true to confirm you really want this file gone.");
      if (!config.allowDelete) throw new ToolError("Deleting is switched off on this server (ALLOW_DELETE=false).");
      const { abs, rel } = await sandbox.resolve(p, { allowRoot: false });
      const base = path.posix.basename(rel).toLowerCase();
      if (PROTECTED.has(base)) {
        throw new ToolError(`'${rel}' is a handoff file and cannot be deleted. Edit it instead (write_file or str_replace).`);
      }
      return withLock(lockKey(abs), async () => {
        const st = await fs.lstat(abs);
        if (st.isDirectory()) throw new ToolError(`'${rel}' is a folder. delete_file only deletes single files.`);
        await fs.unlink(abs);
        return `Deleted ${rel}.`;
      });
    },
  };

  return [listFiles, readFile, writeFile, strReplace, deleteFile];
}
