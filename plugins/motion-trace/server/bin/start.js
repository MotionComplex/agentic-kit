#!/usr/bin/env node
// Plugin entry: ensure dependencies exist (first run on a machine), then start the
// MCP server. npm output is sent to stderr (fd 2) so the MCP stdio channel (stdout)
// stays clean. The browser itself self-provisions later, in launch.js.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');

if (!existsSync(join(serverDir, 'node_modules', 'playwright'))) {
  console.error('motion-trace: installing dependencies (first run on this machine)…');
  execSync('npm install --omit=dev --no-audit --no-fund', { cwd: serverDir, stdio: ['ignore', 2, 2] });
}

await import('./mcp-server.js');
