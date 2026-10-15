// First-run preparation of the workspace folder: create it, copy the starter handoff files into it
// (only if it is empty) and make it a git repository of its own.
import fs from "node:fs";

export async function prepareWorkspace({ config, git, logger }) {
  fs.mkdirSync(config.workspaceRoot, { recursive: true });
  const existing = fs.readdirSync(config.workspaceRoot).filter((name) => name !== ".git");
  let seeded = false;
  if (existing.length === 0 && fs.existsSync(config.templateDir)) {
    fs.cpSync(config.templateDir, config.workspaceRoot, { recursive: true, force: false, errorOnExist: false });
    seeded = true;
    logger.info("Workspace was empty: copied the starter handoff files into it.");
  }

  const repo = await git.ensureRepo();
  if (!repo.ok) {
    logger.info(`git is not available (${repo.reason}). The git_* tools will report this until git is installed.`);
    return { seeded, git: false };
  }
  if (repo.created) {
    await git.run(["add", "-A"]);
    const first = await git.run(["commit", "--no-verify", "--allow-empty", "--message=Initial workspace"]);
    if (!first.ok) logger.info(`Could not create the first commit: ${first.stderr.trim().split("\n")[0]}`);
    else logger.info("Created a git repository inside the workspace (first commit: 'Initial workspace').");
  }
  return { seeded, git: true };
}
