#!/usr/bin/env node
/**
 * Makes the review agents in `tools/agents/` visible to Claude Code by
 * pointing `.claude/agents` at them — a link instead of a copy, so that
 * the installed set does not fall behind the repository.
 *
 *   node scripts/link-agents.mjs            in this checkout (.claude/agents)
 *   node scripts/link-agents.mjs --user     for all projects (~/.claude/agents)
 *   node scripts/link-agents.mjs --remove   remove the link again
 *
 * On Windows this creates a junction, which needs no admin rights.
 * An existing folder that is not a link is never touched.
 *
 * In the checkout it also creates an ignored `CLAUDE.md` that points to
 * `AGENTS.md`. An existing one is left unchanged.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'tools', 'agents');
const args = process.argv.slice(2);
const base = args.includes('--user') ? homedir() : root;
const link = join(base, '.claude', 'agents');

function existing() {
  try {
    return lstatSync(link);
  } catch {
    return null;
  }
}

const found = existing();
if (found && !found.isSymbolicLink()) {
  console.error(`${link} exists and is not a link — nothing changed. Move the folder if it should go.`);
  process.exit(1);
}

if (args.includes('--remove')) {
  if (found) rmSync(link);
  console.log(found ? `Link removed: ${link}` : `No link present: ${link}`);
  process.exit(0);
}

const pointer = join(root, 'CLAUDE.md');
if (!args.includes('--user') && !existsSync(pointer)) {
  writeFileSync(pointer, '@AGENTS.md\n');
  console.log(`Created:${pointer}`);
}

if (found) {
  if (resolve(dirname(link), readlinkSync(link)) === source) {
    console.log(`Already linked:${link} -> ${source}`);
    process.exit(0);
  }
  rmSync(link);
}
if (!existsSync(source)) {
  console.error(`${source} is missing.`);
  process.exit(1);
}
mkdirSync(dirname(link), { recursive: true });
symlinkSync(source, link, 'junction');
console.log(`Linked:${link} -> ${source}`);
