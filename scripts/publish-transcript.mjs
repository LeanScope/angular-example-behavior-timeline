// Publishes a recording's WebVTT as a PUBLIC file in the LeanScope repository the token names, so
// a player choreo can replay it: the agent server fetches a choreo's document without a
// credential, so it has to be public. ANYONE WITH THE LINK CAN READ THE TRANSCRIPT. Publish only
// what may be public (see "Player choreo" in README.md).
//
//   npm run publish:transcript -- <path/to/file.vtt> --public [--demo <name>]
//
// The file is held by a resource ("<file name> (WebVTT)") so it can be found in the repository.
// File and resource guids are derived from the repository and the file name: running it again
// replaces the file. Prints the public URL (the Document facet's `default`), never the token.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readAppEnv } from './sync-env.mjs';

const ENDPOINT = process.env.LEANSCOPE_ENDPOINT?.trim() || 'https://api.leanscope.io/graphql';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const path = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--demo');

if (!path || !flag('--public')) {
  console.error('Usage: npm run publish:transcript -- <path/to/file.vtt> --public [--demo <name>]');
  console.error('--public confirms that anyone with the link may read the transcript.');
  process.exit(1);
}

const token = (readAppEnv(option('--demo'))['LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN'] ?? '').trim();
if (!token) {
  console.error('LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN is not set in .env.');
  process.exit(1);
}

const text = readFileSync(path, 'utf8');
if (!text.startsWith('WEBVTT')) {
  console.error(`${path} is not a WebVTT file.`);
  process.exit(1);
}
const name = basename(path);

const permissions = await fetch(new URL('/application/permissions', ENDPOINT), {
  headers: { Authorization: `Bearer ${token}` },
});
if (!permissions.ok) {
  console.error(`LeanScope does not accept the token (${permissions.status}). Try npm run check:token.`);
  process.exit(1);
}
const repositories = (await permissions.json()).teamRepositoryIds ?? [];
if (repositories.length !== 1) {
  console.error(`The token must name exactly one repository; it names ${repositories.length}.`);
  process.exit(1);
}
const repository = Number(repositories[0]);

/** A stable UUID for `what` in this repository, so a second run writes the same rows. */
function guidOf(what) {
  const hex = createHash('sha1').update(`${repository}:${name}:${what}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const file = guidOf('file');
const resource = guidOf('resource');

async function mutate(argument, type, input, echo) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation Publish($gitLabProjectId: Int!, $input: ${type}!) {
        repository(gitLabProjectId: $gitLabProjectId, ${argument}: $input) { ${echo} { _guid } } }`,
      variables: { gitLabProjectId: repository, input },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.map((e) => e.message).join('; ') || `${res.status} ${res.statusText}`);
  }
}

try {
  // No `action`: the backend creates the row or merges into it.
  await mutate('uxmDataInput', 'UxmDataInput', {
    files: [
      {
        _guid: file,
        name,
        descriptiveName: name,
        mimeType: 'text/vtt',
        type: 'BASE_64_DATA',
        visibility: 'PUBLIC_DOWNLOADABLE',
        base64DataUrl: `data:text/vtt;base64,${Buffer.from(text, 'utf8').toString('base64')}`,
      },
    ],
  }, 'filesMutated');
  await mutate('uxmDataInput', 'UxmDataInput', {
    equipments: [{ _guid: resource, line: `${name} (WebVTT)` }],
  }, 'equipmentsMutated');
  // `fileRefs` only travels the resolved input, and it replaces: the resource holds this file.
  await mutate('uxmResolvedDataInput', 'UxmResolvedDataInput', {
    equipments: [{ _guid: resource, fileRefs: [file] }],
  }, 'equipmentsMutated');
} catch (err) {
  console.error(`Could not publish ${name}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

// Read back the way the agent server will: without a credential.
const url = `${new URL(ENDPOINT).origin}/uxm/${repository}/files/public/${file}`;
const served = await fetch(url);
const body = served.ok ? await served.text() : '';
if (!body.startsWith('WEBVTT')) {
  console.error(`Published, but ${url} does not serve the transcript (${served.status}).`);
  process.exit(1);
}
console.log(`Published ${name} (${body.length} characters) in repository ${repository}.`);
console.log(`  resource: ${resource}`);
console.log(`  public URL (the Document facet's default): ${url}`);
