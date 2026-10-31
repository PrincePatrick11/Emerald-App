#!/usr/bin/env node
/**
 * Macht die Review-Agents aus `tools/agents/` für Claude Code sichtbar, indem
 * es `.claude/agents` darauf zeigen lässt — ein Link statt einer Kopie, damit
 * der installierte Satz nicht hinter dem Repository zurückbleibt.
 *
 *   node scripts/link-agents.mjs            in diesem Checkout (.claude/agents)
 *   node scripts/link-agents.mjs --user     für alle Projekte (~/.claude/agents)
 *   node scripts/link-agents.mjs --remove   den Link wieder entfernen
 *
 * Unter Windows entsteht eine Junction, die keine Adminrechte braucht.
 * Ein vorhandener Ordner, der kein Link ist, wird nie angefasst.
 *
 * Im Checkout legt es außerdem ein ignoriertes `CLAUDE.md` an, das auf
 * `AGENTS.md` verweist. Ein vorhandenes bleibt unverändert.
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
  console.error(`${link} existiert und ist kein Link — nichts geändert. Verschiebe den Ordner, wenn er weg soll.`);
  process.exit(1);
}

if (args.includes('--remove')) {
  if (found) rmSync(link);
  console.log(found ? `Link entfernt: ${link}` : `Kein Link vorhanden: ${link}`);
  process.exit(0);
}

const pointer = join(root, 'CLAUDE.md');
if (!args.includes('--user') && !existsSync(pointer)) {
  writeFileSync(pointer, '@AGENTS.md\n');
  console.log(`Angelegt: ${pointer}`);
}

if (found) {
  if (resolve(dirname(link), readlinkSync(link)) === source) {
    console.log(`Schon verlinkt: ${link} -> ${source}`);
    process.exit(0);
  }
  rmSync(link);
}
if (!existsSync(source)) {
  console.error(`${source} fehlt.`);
  process.exit(1);
}
mkdirSync(dirname(link), { recursive: true });
symlinkSync(source, link, 'junction');
console.log(`Verlinkt: ${link} -> ${source}`);
