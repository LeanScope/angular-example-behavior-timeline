// Your values live in ONE place: the gitignored `.env` in the project root (names as in
// `.env.example`). Two kinds, with two destinations:
//
//   - App settings (APP_SETTINGS below: choreo guids, repository id, login). Not secrets.
//     `scripts/run-ng.mjs` passes them to `ng serve` / `ng build` as the build-time constant
//     LEANSCOPE_ENV (see src/environments/environment.ts). No file is written. On a build
//     server without a `.env` (Netlify, see netlify.toml) they come from its environment
//     variables instead.
//   - Secrets for your coding agent (SECRETS below: your LeanScope token and LLM keys). They
//     NEVER reach the app. `node scripts/sync-env.mjs --claude` (npm run connect:claude) stores
//     them in the Agent Kit plugin's settings in Claude Code (OS keychain).
//
//   To pull the newest Agent Kit plugin, see scripts/update-plugin.mjs (npm run update:plugin).
//
// Run without options, it lists which names are set. It never prints a secret.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = join(root, '.env');
const PLUGIN = 'leanscope-agent-kit@leanscope';

/** Secrets for the coding agent only: `.env` name → the plugin's option id. Never passed to the app. */
const SECRETS = [
  { env: 'LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN', plugin: 'token' },
  { env: 'LEANSCOPE_OPENAI_API_KEY', plugin: 'openai' },
  { env: 'LEANSCOPE_ANTHROPIC_API_KEY', plugin: 'anthropic' },
  { env: 'LEANSCOPE_MISTRAL_API_KEY', plugin: 'mistral' },
  { env: 'LEANSCOPE_GOOGLE_API_KEY', plugin: 'google' },
  { env: 'LEANSCOPE_ELEVENLABS_API_KEY', plugin: 'elevenlabs' },
  { env: 'LEANSCOPE_TYPESAFE_API_KEY', plugin: 'typesafe' },
];

/** Reads `KEY=value` lines (optional `export `, quotes and `#` comments). Missing file → {}. */
export function readEnvFile(file = ENV_FILE) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values;
}

/**
 * A demo's own `.env`: `demos/<name>/.env` (gitignored, outside `public/`, so it is never
 * served). `npm run demo <name>` lays it over the root `.env`; see demos/README.md.
 */
export function demoEnvFile(name) {
  return join(root, 'demos', name, '.env');
}

/** The app settings set as environment variables of this process (a build server's own). */
function processAppEnv() {
  return Object.fromEntries(
    APP_SETTINGS.map((name) => [name, process.env[name]?.trim()]).filter(([, value]) => value),
  );
}

/**
 * The root `.env`, with the process's environment variables laid over it (app settings only),
 * then a demo's `.env` (its non-empty values win) and APP_DEMO set to the demo's name.
 */
export function readAppEnv(demo) {
  const base = { ...readEnvFile(), ...processAppEnv() };
  if (!demo) return base;
  const file = demoEnvFile(demo);
  if (!existsSync(file)) {
    console.warn(`No ${file} yet: copy demos/.env.example there. Until then the demo runs on the root .env.`);
  }
  const overlay = Object.fromEntries(Object.entries(readEnvFile(file)).filter(([, v]) => v !== ''));
  return { ...base, ...overlay, APP_DEMO: demo };
}

/**
 * Everything the app is built with. None of it is a secret: all of it ends up in the browser
 * bundle. Keep this list in step with SECRETS_SCAN_OMIT_KEYS in netlify.toml.
 */
const APP_SETTINGS = [
  'LEANSCOPE_CHOREO_SCENARIO_GUID',
  'LEANSCOPE_REPOSITORY_ID',
  'LEANSCOPE_SUPABASE_URL',
  'LEANSCOPE_SUPABASE_ANON_KEY',
  'LEANSCOPE_AGENT_SERVER_URL',
  'APP_DEMO',
  'APP_BRAND',
  'APP_INGEST_CHOREO_GUID',
  'APP_STUDY_QUERY_GUID',
  'APP_PLAYER_CHOREO_GUID',
  'APP_ANALYSIS_CHOREO_GUID',
  'APP_DIRECTOR_CHOREO_GUID',
];

/**
 * The app settings, in the shape of `LeanScopeEnv` (src/app/leanscope/leanscope.config.ts).
 * Reads APP_SETTINGS names only: a token or key in `.env` never gets in here.
 */
export function appValues(env = readAppEnv()) {
  return {
    choreoScenarioGuid: env['LEANSCOPE_CHOREO_SCENARIO_GUID'] ?? '',
    repositoryId: env['LEANSCOPE_REPOSITORY_ID'] ?? '',
    supabaseUrl: env['LEANSCOPE_SUPABASE_URL'] ?? '',
    supabaseAnonKey: env['LEANSCOPE_SUPABASE_ANON_KEY'] ?? '',
    // Empty: the one in src/environments/environment.ts. Set it to try a local agent server.
    agentServerUrl: env['LEANSCOPE_AGENT_SERVER_URL'] ?? '',
    // App settings that are not part of the generic LeanScope client (src/app/features/app-env.ts).
    app: {
      brand: env['APP_BRAND'] ?? '',
      ingestChoreoGuid: env['APP_INGEST_CHOREO_GUID'] ?? '',
      studyQueryGuid: env['APP_STUDY_QUERY_GUID'] ?? '',
      playerChoreoGuid: env['APP_PLAYER_CHOREO_GUID'] ?? '',
      analysisChoreoGuid: env['APP_ANALYSIS_CHOREO_GUID'] ?? '',
      directorChoreoGuid: env['APP_DIRECTOR_CHOREO_GUID'] ?? '',
      demo: env['APP_DEMO'] ?? '',
    },
  };
}

/** One line saying which names are set, for the console. Never a value. */
export function describeEnv(env = readAppEnv()) {
  const set = [...APP_SETTINGS, ...SECRETS.map((s) => s.env)].filter((name) => env[name]);
  if (!existsSync(ENV_FILE)) {
    return set.length
      ? `No .env: values from the environment: ${set.join(', ')}.`
      : 'No .env yet: copy .env.example to .env and fill in your choreo guid, repository id and the login values.';
  }
  return `Values from .env: ${set.length ? set.join(', ') : 'none set'}.`;
}

/** The Claude Code CLI: `claude` on the PATH, else the one bundled with the VS Code extension. */
export function findClaude() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return 'claude';
  } catch {
    // not on the PATH
  }
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const editor of ['.vscode', '.vscode-insiders', '.cursor']) {
    const dir = join(homedir(), editor, 'extensions');
    if (!existsSync(dir)) continue;
    const newest = readdirSync(dir)
      .filter((name) => name.startsWith('anthropic.claude-code-'))
      .map((name) => join(dir, name, 'resources', 'native-binary', binary))
      .filter((path) => existsSync(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .pop();
    if (newest) return newest;
  }
  return null;
}

/** Stores the `.env` values in the plugin's settings. Empty names keep their stored value. */
function configureClaude(env) {
  const values = Object.fromEntries(
    SECRETS.filter((s) => env[s.env]).map((s) => [s.plugin, env[s.env]]),
  );
  if (!values['token']) {
    console.error('LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN is not set in .env.');
    return 1;
  }
  const claude = findClaude();
  if (!claude) {
    console.error(
      `Claude Code CLI not found. Install it (https://code.claude.com) or run /plugin configure ${PLUGIN} in a Claude Code session.`,
    );
    return 1;
  }
  const result = spawnSync(claude, ['plugin', 'configure', PLUGIN, '--values-stdin'], {
    input: JSON.stringify(values),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`Could not configure ${PLUGIN}: ${(result.stderr || result.stdout).trim()}`);
    console.error(
      `Is the plugin installed? Start a Claude Code session in this folder and accept the install, or run:\n  "${claude}" plugin install ${PLUGIN} --scope project`,
    );
    return 1;
  }
  console.log(`Stored in Claude Code (${PLUGIN}): ${Object.keys(values).join(', ')}.`);
  console.log(
    'Start a new Claude Code session (or reload the window) so the LeanScope MCP servers use them.',
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = readEnvFile();
  console.log(describeEnv(env));
  if (process.argv.includes('--claude')) process.exit(configureClaude(env));
}
