// Role-based tool scoping: each token maps to a role, and a role only SEES the tools it needs.
// A tool that is not registered for a role does not exist for that agent at all.
export const READ_TOOLS = [
  "list_files",
  "read_file",
  "search_files",
  "git_status",
  "git_diff",
  "git_log",
  "read_handoff",
  "append_log",
];
export const WRITE_TOOLS = [...READ_TOOLS, "write_file", "str_replace", "git_commit"];
export const ADMIN_TOOLS = [...WRITE_TOOLS, "delete_file"];

export const ROLE_TOOLS = Object.freeze({
  reviewer: new Set(READ_TOOLS),
  coder: new Set(WRITE_TOOLS),
  admin: new Set(ADMIN_TOOLS),
});
