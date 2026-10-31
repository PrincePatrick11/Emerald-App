#!/usr/bin/env node
/**
 * Adds the MCP server from `tools/mcp/` to this checkout's `.mcp.json`,
 * which Claude Code reads its servers from. The file is not part of the
 * repository; the template is `tools/mcp/mcp.example.json`.
 *
 *   node scripts/register-mcp.mjs            add the entry or bring it up to the template
 *   node scripts/register-mcp.mjs --remove   remove the entry again
 *
 * Other servers in an existing `.mcp.json` stay as they are.
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
    console.error(`${target} is not valid JSON — nothing changed. (${e.message})`);
    process.exit(1);
  }
  config.mcpServers ??= {};
}

const names = Object.keys(template.mcpServers);
if (process.argv.includes('--remove')) {
  for (const name of names) delete config.mcpServers[name];
  if (Object.keys(config.mcpServers).length === 0 && Object.keys(config).length === 1) {
    rmSync(target, { force: true });
    console.log(`Removed:${target}`);
  } else {
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(`Entry removed from${target}`);
  }
  process.exit(0);
}

const before = JSON.stringify(config);
Object.assign(config.mcpServers, template.mcpServers);
if (JSON.stringify(config) === before) {
  console.log(`Already registered: ${names.join(', ')} in${target}`);
} else {
  writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`Registered: ${names.join(', ')} in${target}`);
}
