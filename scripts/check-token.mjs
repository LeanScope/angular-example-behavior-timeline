// Asks LeanScope whether the token in `.env` (LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN) is
// accepted, and which repository it opens: the same check the agent server makes before it
// creates a session (GET /application/permissions). Prints the answer, never the token.
//
//   npm run check:token

import { readEnvFile } from './sync-env.mjs';

const ENDPOINT = process.env.LEANSCOPE_ENDPOINT?.trim() || 'https://api.leanscope.io/graphql';
const NAME = 'LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN';

const raw = readEnvFile()[NAME] ?? '';
const token = raw.trim();
if (!token) {
  console.error(`${NAME} is not set in .env.`);
  process.exit(1);
}

// Shape hints, without the value.
const hints = [];
if (raw !== token) hints.push('it has spaces around it (they are trimmed for this check)');
if (/^bearer\s/i.test(token)) hints.push('it starts with "Bearer ": put in the token only');
if (/^["']|["']$/.test(token)) hints.push('it has a stray quote at the start or end');
if (/\s/.test(token)) hints.push('it contains a space or line break');
console.log(`${NAME}: ${token.length} characters.`);
for (const hint of hints) console.log(`  Note: ${hint}.`);

const url = new URL('/application/permissions', ENDPOINT);
let res;
try {
  res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
} catch (err) {
  console.error(`Could not reach ${url.origin}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

if (res.status === 401 || res.status === 403) {
  console.error(
    `LeanScope (${url.origin}) does not accept this token (${res.status}). Create a new personal ` +
      'team-repos access token at https://app.leanscope.ai/ (avatar, top right), put it in .env and ' +
      'run this again. The agent server remembers a rejected token for a minute.',
  );
  process.exit(1);
}
if (!res.ok) {
  console.error(`LeanScope answered ${res.status} ${res.statusText}.`);
  process.exit(1);
}

const body = await res.json();
const repositories = body.teamRepositoryIds ?? [];
console.log(`Accepted by ${url.origin}: ${body.type ?? 'unknown'} token for repository ${repositories.join(', ') || '(none)'}.`);
if (repositories.length !== 1) {
  console.log('  Note: a session needs a token that names exactly one repository (a team-repos access token).');
}
