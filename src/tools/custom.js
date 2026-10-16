// My own tool: audit_loot_table (read-only).
// The reviewer agent cannot run code and sometimes makes mistakes when it adds numbers,
// so this tool does the checking and reports exact line numbers.
import { z } from "zod";
import { ToolError } from "../errors.js";
import { readTextSnapshot, splitLines } from "../fileio.js";

const PLACEHOLDER = /\b(TODO|FIXME|TBD)\b/i;
const PLAIN_NUMBER = /^\d+(\.\d+)?$/; // digits only, like 15 or 12.5 (no % sign, no minus sign)
const MAX_LISTED = 10; // list at most this many lines per problem, so the answer stays short

const clip = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const round2 = (n) => Math.round(n * 100) / 100;

/** Split one CSV line into fields. Understands "quoted, text" and "" inside quotes (one line only). */
function splitCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

/** Return the index of the weight column: the one asked for (a name or a 1-based number), or "weight" / "chance". */
function findWeightColumn(headers, wanted) {
  const names = headers.map((h) => h.toLowerCase());
  if (wanted !== undefined) {
    const index = /^\d+$/.test(wanted) ? Number(wanted) - 1 : names.indexOf(wanted.toLowerCase());
    if (index < 0 || index >= headers.length) {
      throw new ToolError(
        `weight_column '${wanted}' does not match the header (${headers.join(", ")}). Use a column name or a number from 1 to ${headers.length}.`,
      );
    }
    return index;
  }
  const index = names.findIndex((name) => name === "weight" || name === "chance");
  if (index === -1) {
    throw new ToolError(
      `No column named 'weight' or 'chance' in the header (${headers.join(", ")}). Pass weight_column with the column name or number.`,
    );
  }
  return index;
}

/** Turn a list of problems into indented lines, cut after MAX_LISTED. */
function listLines(items) {
  const shown = items.slice(0, MAX_LISTED).map((text) => `  ${text}`);
  if (items.length > MAX_LISTED) shown.push(`  ... and ${items.length - MAX_LISTED} more`);
  return shown;
}

export function makeCustomTools({ config, sandbox }) {
  const auditLootTable = {
    name: "audit_loot_table",
    title: "Audit a loot or encounter table",
    description:
      "Audit a CSV table in the workspace, such as an encounter table or a loot table. Counts the data rows, lists the line numbers " +
      "of any TODO, FIXME or TBD placeholders, checks that every weight is a plain number, and adds up the weight column to see " +
      "if the total is exactly 100. The weight column is the header named 'weight' or 'chance', or the one you name in weight_column. " +
      "Read-only: use it to check a table before you review or commit it. " +
      "Fails if the file is missing, is not a .csv, is empty, is too big, or has no weight column.",
    inputSchema: {
      path: z.string().min(1).max(400).describe("CSV file to check, relative to the workspace root, for example 'dnd-swamp/loot.csv'."),
      weight_column: z
        .string()
        .min(1)
        .max(60)
        .optional()
        .describe("Optional, as text: the name of the weight column, or its number (1 is the first column). Default: the column named 'weight' or 'chance'."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler({ path: p, weight_column }) {
      const { abs, rel } = await sandbox.resolve(p, { allowRoot: false });
      if (!rel.toLowerCase().endsWith(".csv")) {
        throw new ToolError(`'${rel}' is not a .csv file. audit_loot_table only checks CSV tables.`);
      }
      const snap = await readTextSnapshot(abs, rel, config.maxFileBytes);
      const lines = splitLines(snap.text.replace(/^\uFEFF/, "")); // drop a byte-order mark if there is one

      // The first line that is not blank is the header. Every later line that is not blank is a data row.
      const headerIndex = lines.findIndex((line) => line.trim() !== "");
      if (headerIndex === -1) throw new ToolError(`'${rel}' is empty: it has no header row.`);
      const headers = splitCsvLine(lines[headerIndex]);
      const col = findWeightColumn(headers, weight_column);

      let rows = 0;
      let firstRow = 0;
      let lastRow = 0;
      let total = 0;
      const placeholders = [];
      const badWeights = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1; // line numbers start at 1, like in an editor

        const hit = PLACEHOLDER.exec(line);
        if (hit) placeholders.push(`line ${lineNo}: ${hit[1].toUpperCase()} in "${clip(line.trim())}"`);

        if (i <= headerIndex || line.trim() === "") continue; // not a data row
        rows++;
        if (rows === 1) firstRow = lineNo;
        lastRow = lineNo;

        const raw = splitCsvLine(line)[col];
        if (raw === undefined || raw === "") badWeights.push(`line ${lineNo}: the weight is missing`);
        else if (!PLAIN_NUMBER.test(raw)) badWeights.push(`line ${lineNo}: weight "${clip(raw, 30)}" is not a plain number`);
        else total += Number(raw);
      }

      total = round2(total);
      let problems = placeholders.length + badWeights.length;
      const out = [`Audit of ${rel}`];
      out.push(rows === 0 ? "Rows: 0 (the file has a header but no data rows)" : `Rows: ${rows} (lines ${firstRow}-${lastRow})`);
      out.push(`Weight column: "${headers[col] || `column ${col + 1}`}" (column ${col + 1})`);

      const note = badWeights.length ? ", valid weights only" : "";
      if (total === 100) {
        out.push(`Total weight: 100 (OK, equals 100${note})`);
      } else {
        problems++;
        const gap = round2(Math.abs(100 - total));
        out.push(`Total weight: ${total} (PROBLEM: ${gap} ${total < 100 ? "short of" : "over"} 100${note})`);
      }

      out.push(placeholders.length ? `Placeholders (TODO, FIXME, TBD): ${placeholders.length}` : "Placeholders (TODO, FIXME, TBD): none");
      out.push(...listLines(placeholders));
      out.push(badWeights.length ? `Invalid weights: ${badWeights.length}` : "Invalid weights: none");
      out.push(...listLines(badWeights));
      out.push(problems === 0 ? "Result: no problems found" : `Result: ${problems} problem(s) found`);
      return out.join("\n");
    },
  };

  return [auditLootTable];
}
