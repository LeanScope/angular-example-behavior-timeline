// Runs the Angular CLI (`node scripts/run-ng.mjs serve`, `… build`, `… test`) on a Node.js version
// it supports, so `npm start` works even when the active Node is too old. Uses the active Node when
// it fits, else the newest fitting version installed with nvm, else explains what to install.
//
// For `serve` and `build` it also passes your app settings from `.env` (choreo guids, repository
// id, login; no secrets) to Angular as the build-time constant LEANSCOPE_ENV (see
// src/environments/environment.ts). Without a `.env` they come from the environment variables. While `serve` runs, saving
// `.env` restarts the dev server with the new values.
//
// `--demo <name>` (as in `npm run demo stadtwerke`) lays `demos/<name>/.env` over `.env` and makes
// the app open that demo (APP_DEMO). Only that one repository's values reach the bundle.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_FILE, appValues, demoEnvFile, describeEnv, readAppEnv } from './sync-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ng = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const REQUIRED = '^22.22.3 || ^24.15.0 || >=26.0.0'; // as in package.json "engines"

/** Matches REQUIRED. */
function supported(version) {
  const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number);
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 3);
  if (major === 24) return minor >= 15;
  return major >= 26;
}

function newer(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

/** The bin folder of the newest supported Node installed with nvm, or null. */
function nvmNodeBin() {
  const versions = join(process.env.NVM_DIR ?? join(homedir(), '.nvm'), 'versions', 'node');
  if (!existsSync(versions)) return null;
  const best = readdirSync(versions)
    .filter(supported)
    .reduce((a, b) => (a === null || newer(b, a) ? b : a), null);
  return best ? join(versions, best, 'bin') : null;
}

if (!existsSync(ng)) {
  console.error('The Angular CLI is not installed yet. Run `npm install` first.');
  process.exit(1);
}

let node = process.execPath;
let env = process.env;
if (!supported(process.version)) {
  const bin = nvmNodeBin();
  if (!bin) {
    console.error(
      `Angular needs Node.js ${REQUIRED}; this is ${process.version}.\n` +
        'Install a newer one, e.g. `nvm install 26`, or from https://nodejs.org/.',
    );
    process.exit(1);
  }
  node = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  // Child processes the CLI starts should use the same Node.
  env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
  console.log(`Using Node.js from ${bin} (the active ${process.version} is too old for Angular).`);
}

const [command, ...args] = process.argv.slice(2);
const demoAt = args.indexOf('--demo');
const demo = demoAt >= 0 ? args[demoAt + 1]?.trim().toLowerCase() : undefined;
if (demoAt >= 0 && !demo) {
  const demosDir = join(root, 'demos');
  const names = existsSync(demosDir)
    ? readdirSync(demosDir).filter((n) => statSync(join(demosDir, n)).isDirectory())
    : [];
  console.error(
    `Which demo? Run \`npm run demo:<name>\` or \`npm run demo <name>\`. Demos: ${names.join(', ') || 'none under demos/'}.`,
  );
  process.exit(1);
}
const rest = demoAt >= 0 ? args.filter((_, i) => i !== demoAt && i !== demoAt + 1) : args;
const usesEnv = command === 'serve' || command === 'build';

function ngArgs() {
  if (!usesEnv) return [ng, command, ...rest];
  const env = readAppEnv(demo);
  console.log(describeEnv(env));
  if (demo) console.log(`Demo "${demo}": ${demoEnvFile(demo)} laid over .env.`);
  return [ng, command, ...rest, '--define', `LEANSCOPE_ENV=${JSON.stringify(appValues(env))}`];
}

let child;
let restarting = false;

function run() {
  child = spawn(node, ngArgs(), { stdio: 'inherit', env, cwd: root });
  child.on('exit', (code, signal) => {
    if (restarting) {
      restarting = false;
      run();
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

run();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

if (command === 'serve') {
  for (const file of demo ? [ENV_FILE, demoEnvFile(demo)] : [ENV_FILE]) {
    watchFile(file, { interval: 1000 }, () => {
      console.log('\n.env changed: restarting the dev server with the new values…');
      restarting = true;
      child.kill('SIGTERM');
    });
  }
}
