#!/usr/bin/env node
/**
 * Trägt den MCP-Server aus `tools/mcp/` in die `.mcp.json` dieses Checkouts
 * ein, aus der Claude Code seine Server liest. Die Datei ist nicht Teil des
 * Repositories; die Vorlage ist `tools/mcp/mcp.example.json`.
 *
 *   node scripts/register-mcp.mjs            eintragen oder auf den Stand der Vorlage bringen
 *   node scripts/register-mcp.mjs --remove   den Eintrag wieder entfernen
 *
 * Andere Server in einer vorhandenen `.mcp.json` bleiben, wie sie sind.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = JSON.parse(readFileSync(join(root, 'tools', 'mcp', 'mcp.example.json'), 'utf-8'));
const target = join(root, '.mcp.json');

let config = { mcpServers: {} };
if (existsSync(target)) {
  try {
    config = JSON.parse(readFileSync(target, 'utf-8'));
  } catch (e) {
    console.error(`${target} ist kein gültiges JSON — nichts geändert. (${e.message})`);
    process.exit(1);
  }
  config.mcpServers ??= {};
}

const names = Object.keys(template.mcpServers);
if (process.argv.includes('--remove')) {
  for (const name of names) delete config.mcpServers[name];
  if (Object.keys(config.mcpServers).length === 0 && Object.keys(config).length === 1) {
    rmSync(target, { force: true });
    console.log(`Entfernt: ${target}`);
  } else {
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(`Eintrag entfernt aus ${target}`);
  }
  process.exit(0);
}

const before = JSON.stringify(config);
Object.assign(config.mcpServers, template.mcpServers);
if (JSON.stringify(config) === before) {
  console.log(`Schon eingetragen: ${names.join(', ')} in ${target}`);
} else {
  writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`Eingetragen: ${names.join(', ')} in ${target}`);
}
