// search_files: literal text search across the workspace, so agents can LOCATE things
// instead of reading whole files (that is where tool-use efficiency is won or lost).
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { looksBinary, splitLines } from "../fileio.js";

const SKIP_NAMES = new Set([".git", "node_modules"]);
const MAX_FILES_SCANNED = 5000;

/** Minimal glob: * (not across folders), ** (across folders), ? (one character). */
export function globToRegExp(glob) {
  if (typeof glob !== "string" || glob.length === 0 || glob.length > 100) {
    throw new ToolError("glob must be 1-100 characters, for example '*.md' or 'src/**/*.js'.");
  }
  const g = glob.replaceAll("\\", "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return { regex: new RegExp(`^${re}$`, "i"), hasSlash: g.includes("/") };
}

export function makeSearchTools({ config, sandbox }) {
  const searchFiles = {
    name: "search_files",
    title: "Search files",
    description:
      "Find text inside files in the workspace (case-insensitive literal substring search, not regex). " +
      "Returns one 'path:line: text' line per match, up to max_results. Use it BEFORE read_file to locate the right file and line " +
      "instead of reading whole files. Optional glob narrows which files are searched (for example '*.md' or 'src/**/*.js'). " +
      "Skips .git, node_modules, binary files and files over the size limit.",
    inputSchema: {
      query: z.string().min(1).max(200).describe("Text to look for (exact substring, not a pattern)."),
      path: z.string().max(400).default(".").describe("Folder (or single file) to search, relative to the workspace root."),
      glob: z.string().min(1).max(100).optional().describe("Only search files whose path matches, e.g. '*.md' or 'src/**/*.js'."),
      case_sensitive: z.boolean().default(false).describe("Match upper/lower case exactly."),
      max_results: z.number().int().min(1).max(200).default(50).describe("Stop after this many matching lines."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler({ query, path: p = ".", glob, case_sensitive = false, max_results = 50 }) {
      if (typeof query !== "string" || query.length === 0) throw new ToolError("query must not be empty.");
      const { abs, rel } = await sandbox.resolve(p);
      const st = await fs.stat(abs);
      const matcher = glob ? globToRegExp(glob) : null;
      const needle = case_sensitive ? query : query.toLowerCase();

      const results = [];
      const filesWithHits = new Set();
      let scanned = 0;
      let stoppedEarly = false;
      let scanLimit = false;

      function globOk(fileRel) {
        if (!matcher) return true;
        return matcher.regex.test(matcher.hasSlash ? fileRel : path.posix.basename(fileRel));
      }

      async function scanFile(fileAbs, fileRel) {
        if (!globOk(fileRel)) return;
        scanned++;
        const s = await fs.stat(fileAbs);
        if (s.size > config.maxFileBytes) return;
        const buffer = await fs.readFile(fileAbs);
        if (looksBinary(buffer)) return;
        const lines = splitLines(buffer.toString("utf8"));
        for (let i = 0; i < lines.length; i++) {
          const hay = case_sensitive ? lines[i] : lines[i].toLowerCase();
          if (!hay.includes(needle)) continue;
          const shown = lines[i].trim();
          results.push(`${fileRel}:${i + 1}: ${shown.length > 200 ? `${shown.slice(0, 200)}...` : shown}`);
          filesWithHits.add(fileRel);
          if (results.length >= max_results) {
            stoppedEarly = true;
            return;
          }
        }
      }

      async function walk(dirAbs, dirRel) {
        let entries;
        try {
          entries = (await fs.readdir(dirAbs, { withFileTypes: true }))
            .filter((e) => !SKIP_NAMES.has(e.name.toLowerCase()) && !e.name.includes(".tmp-"))
            .sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
          if (["EACCES", "EPERM", "ENOENT"].includes(err.code) && dirAbs !== abs) return; // unreadable sub-folder: skip it
          throw err;
        }
        for (const e of entries) {
          if (stoppedEarly || scanLimit) return;
          if (e.isSymbolicLink()) continue;
          const childRel = dirRel === "." ? e.name : `${dirRel}/${e.name}`;
          const childAbs = path.join(dirAbs, e.name);
          if (e.isDirectory()) {
            await walk(childAbs, childRel);
          } else if (e.isFile()) {
            if (scanned >= MAX_FILES_SCANNED) {
              scanLimit = true;
              return;
            }
            try {
              await scanFile(childAbs, childRel);
            } catch (err) {
              if (!["EACCES", "EPERM", "ENOENT"].includes(err.code)) throw err; // vanished or unreadable: skip
            }
          }
        }
      }

      if (st.isFile()) await scanFile(abs, rel);
      else await walk(abs, rel);

      if (results.length === 0) {
        return `No matches for "${query}" in '${rel}' (${scanned} files searched${scanLimit ? ", scan limit reached" : ""}).`;
      }
      const notes = [];
      if (stoppedEarly) notes.push(`stopped at max_results=${max_results}; narrow the query, path or glob`);
      if (scanLimit) notes.push(`stopped after scanning ${MAX_FILES_SCANNED} files`);
      const header = `${results.length} match(es) in ${filesWithHits.size} file(s) for "${query}"${notes.length ? ` (${notes.join("; ")})` : ""}`;
      return `${header}\n${results.join("\n")}`;
    },
  };

  return [searchFiles];
}
