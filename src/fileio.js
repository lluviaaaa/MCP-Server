// Small file helpers shared by the tools: versions, safe reads, atomic writes.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./errors.js";

/** A file's "version" is a short hash of its bytes. Agents pass it back as if_version. */
export function versionOf(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function splitLines(text) {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function lineNumberAt(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

/** Read a text file with size and binary checks. Never returns more than maxBytes. */
export async function readTextSnapshot(abs, rel, maxBytes) {
  const st = await fs.stat(abs);
  if (st.isDirectory()) throw new ToolError(`'${rel}' is a folder, not a file. Use list_files.`);
  if (!st.isFile()) throw new ToolError(`'${rel}' is not a regular file.`);
  if (st.size > maxBytes) {
    throw new ToolError(
      `'${rel}' is ${formatBytes(st.size)}, over this server's ${formatBytes(maxBytes)} limit. Use search_files to find what you need.`,
    );
  }
  const buffer = await fs.readFile(abs);
  if (looksBinary(buffer)) throw new ToolError(`'${rel}' looks like a binary file; this server only reads text.`);
  return { text: buffer.toString("utf8"), version: versionOf(buffer), bytes: buffer.length };
}

async function renameWithRetry(from, to, attempts = 5) {
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      // Windows can briefly lock files (antivirus, indexers). Retry a few times.
      if (i >= attempts - 1 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 * (i + 1)));
    }
  }
}

/** Write to a temp file in the same folder, then rename: readers never see a half-written file. */
export async function atomicWrite(abs, data) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmp, data);
  try {
    await renameWithRetry(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export function versionConflict(rel, currentVersion) {
  return new ToolError(
    `Version conflict on '${rel}': the file has changed since you read it (current version ${currentVersion}). ` +
      `Call read_file again, merge your change into the current content, then retry with if_version=${currentVersion}.`,
  );
}
