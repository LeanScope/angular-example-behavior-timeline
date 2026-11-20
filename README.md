# LeanScope Agent Kit – Quickstart for Angular Devs

Fork this repository to build a minimum viable Angular app on LeanScope. A coding agent with the
**LeanScope Agent Kit** helps you pick or model a choreo and build screens around it. The app runs
the choreo through the **LeanScope Agent Server**.

```
 While you build                              While the app runs
 ───────────────                              ──────────────────
 Coding agent (Claude Code, …)                This Angular app
   └─ LeanScope Agent Kit plugin                └─ LeanScopeSessionService
        └─ LeanScope MCP Server                      └─ LeanScope Agent Server (REST + SSE)
             (models, test-runs and reads             (runs the choreo: AI personas
              your choreos)                            talk with your user)
```

A **choreo** is a LeanScope Scenario that the agent server plays out as a conversation between AI
personas and the user. Out of the box the app starts a session of one choreo, shows the
conversation and renders a form for each question. Your MVP screens go on top of that.

## What you need

- Node.js 22.22.3+, 24.15+ or 26+ (`nvm use` reads `.nvmrc`)
- A LeanScope account that is a member of the repository your choreos live in. The app's users
  sign in with theirs; the agent server then runs the session on its own LLM keys.
- For your coding agent only: a LeanScope **personal team-repos access token**
  (https://app.leanscope.ai/ → your avatar, top-right) and an LLM key for its test runs. They
  never reach the app.
- A coding agent. Claude Code is set up already; other clients are covered below.

## Get started

1. **Create your copy:** click **Use this template** on GitHub (or fork), then clone it.
2. **Install:** `npm install`
3. **Fill in `.env`.** Copy `.env.example` to `.env` and fill it in yourself, not through the
   agent. `.env` is gitignored. It has two parts:
   - the app's settings (repository id, login URL and anon key, choreo guids). None is a secret.
     Leave `LEANSCOPE_CHOREO_SCENARIO_GUID` empty for now: your agent tells you its value in
     step 5.
   - secrets for your coding agent's MCP servers (token, LLM keys). They never reach the app.
4. **Connect your coding agent.** Open the folder in Claude Code (CLI or the VS Code extension).
   `.claude/settings.json` enables the Agent Kit plugin and keeps it up to date: Claude Code pulls
   new versions on startup. To pull one right away, run `npm run update:plugin`.
   - Accept the plugin install when the session starts. (If it asks for the token, you can leave
     the fields empty: the next step fills them.)
   - Run `npm run connect:claude`. It stores the values from `.env` in the plugin's settings (your
     OS keychain) without printing them. Run it again whenever you change `.env`.
   - Start a new session. `/mcp` should now list `leanscope-admin`, `leanscope-graphql` and
     `leanscope-agents`, all connected.
5. **Ask your agent:**
   > Set up LeanScope in this project and help me build an MVP for my choreo.

   It follows [AGENTS.md](AGENTS.md):
   1. connect
   2. pick or model a choreo, and tell you its guid for `LEANSCOPE_CHOREO_SCENARIO_GUID` in `.env`
   3. test-run it
   4. propose screens
   5. build them
6. **Run:** `npm start`, then open http://localhost:4200, sign in with your LeanScope account
   and click **Start session**. Saving `.env`
   while it runs restarts the dev server with the new values.

## Project layout

```
.env.example                   names of the app's settings (and of your coding agent's
                               secrets); copy to .env (gitignored) and fill in
netlify.toml                   deploy on Netlify: build, routing, secrets-scan exemptions
.claude/settings.json          enables the LeanScope Agent Kit plugin for Claude Code
AGENTS.md, CLAUDE.md           instructions and workflow for coding agents
src/environments/
  environment.ts               agent server URL, locale (committed); the settings from .env
                               are added at build time
src/app/leanscope/             the LeanScope client: keep it generic
  leanscope-session.service.ts   start a session, follow it, answer questions (signals)
  agent-server.types.ts          request/response and frame types of the Agent Server
  sse-parser.ts                  reads the SSE event stream
  answer-fields.ts               turns a question's JSON Schema into form fields
  ui/transcript.ts               <ls-transcript>: the conversation
  ui/pending-step-form.ts        <ls-pending-step-form>: the form for the open question
src/app/pages/                 home and session pages
src/app/features/              your MVP's screens
```

## Use the session in your own screens

```ts
@Component({ /* … */ })
export class OnboardingPage {
  protected readonly session = inject(LeanScopeSessionService);

  // session.state()            'idle' | 'connecting' | 'waiting' | 'working' | 'asking' | 'ended' | 'error'
  // session.steps()            the conversation so far
  // session.pendingQuestion()  what the session asks right now (question text + JSON Schema)
  // session.error(), session.endReason()

  start() { return this.session.start({ initialInput: { company: 'ACME' } }); }
  answer(value: Record<string, unknown>) { return this.session.submit(value); }
}
```

`session.onFrame(frame => …)` passes on every SSE frame, including the ones the service doesn't
handle (`inventory`, `tool_activity`, `tts_audio`, …). The full API is in the
[Agent Server docs](https://dev.api.agents.leanscope.ai/api/v1/docs).

## Open the app from LeanScope Classic

The agent server's `run-choreo` plugin can open this app instead of its own UI:

1. In LeanScope, set the theme's `uiBaseUrl` parameter to `http://localhost:4200/`.
2. Run `npm start`.
3. Run the choreo from LeanScope Classic.

The plugin creates the session itself and opens
`http://localhost:4200/?sessionToken=<token>&theme=…&themeMode=follow`. The discussion page then
calls `session.attach(token)` instead of `start()` and opens the session's start gate. Attaching
needs no login and no choreo guid: the session token authorizes every session route.
The agent server must be the one in `environment.leanscope.agentServerUrl`; any other server
answers "does not know this session".

### The choreo's inputs land in the app

The session's chat (the guide, e.g. "Thomas") shows in the agent server's support
widget: a small window over the app that can be collapsed, dragged and resized. It loads from
`environment.leanscope.agentUiUrl`; leave that empty for no widget. It takes the theme LeanScope
opened the app with (`?theme=`), and while the session asks for an input, the minimized widget
sits next to the place where it is answered. While the guide only explains, it sits at its home
position.

The guide leads through the process in chapters (`src/app/features/guide/`): each chapter is a
choreo, run as a session of its own, and when one reaches its authored end the next one starts
and the widget follows. The first chapter is `LEANSCOPE_CHOREO_SCENARIO_GUID` (the data basis:
documents, moderator, participants); the second is `APP_DIRECTOR_CHOREO_GUID` (one director
instruction per turn of the discussion; optional). The chapters reference the same 🍱 Inventory,
so the cast picked in the first is there in the second.

When the session asks for an input the app has a place for, the app goes there and highlights it.
The input is recognised by its key, the facet's `key` or the override on its relationship (see
`features/discussion/model/slots.ts`). Not by facet guid: one facet can back several inputs.

| Input (facet key) | Place in the app |
|---|---|
| Angebot (`brief`) | Studie › "Angebot ablegen" |
| Skript (`document`) | Studie › Leitfaden |
| Screener (`screener`) | Studie › Screener |
| Stimuli (`stimuli`) | Studie › Stimuli |
| Moderatorin (`moderator`) | Timeline › ▾ on the moderator's head |
| Teilnehmende (`participants`) | Timeline › ▾ on "Teilnehmende", then "Übernehmen" |

A document dropped before the session asks for it is handed over as soon as it does. The widget
shows its own form for the same question; whichever answers first wins.

## Replay a choreo from the app

You don't need LeanScope Classic to try a choreo. With these values in `.env`, the red Play
button on the timeline ("Diskussion starten") creates the session itself:

- `LEANSCOPE_CHOREO_SCENARIO_GUID`: the choreo, e.g. a recorded group discussion
- `LEANSCOPE_REPOSITORY_ID`: the repository the choreo lives in. You must be signed in with an
  account that is a member of it; the session then runs on the agent server's own keys.

The participants are whoever speaks in the session. Names and portraits come from the session's
`actors` frame (`LeanScopeSessionService.actors()`), and the first speaker is the moderator.
`APP_INGEST_CHOREO_GUID` and `APP_STUDY_QUERY_GUID` are only needed for the study: the guide in
the sidebar, the stimuli, and reading in documents.

## Recordings from the repository

A recorded discussion does not need a `.vtt`: the card **Aufzeichnung** under "Studie" (and ⋮ →
**Aufzeichnung aus LeanScope öffnen …** on the timeline) lists the `Conversation` scenarios of
the repository (`LEANSCOPE_REPOSITORY_ID`) and shows the one you pick (`?recording=<scenario guid>` in the URL). It is read as the signed-in user through the agent server's
`POST /api/v1/queries` (`src/app/features/discussion/model/repository-recording.ts`):

| What the app shows | Where it comes from |
|---|---|
| The turns, in order | The scenario's steps along `activeSuccessorRef` (else the only successor) |
| Who speaks | `actorSymbolRef` (a persona guid); `title` is the name |
| When | `duration.time` is the turn's length; a turn starts where the turns before it end. Without a length it is estimated from the text |
| The moderator | The speaker whose Group Role `type` is `Moderator`, else the first speaker |
| Stimuli | A resource a step `HAS` that owns a file, for as long as the steps have it |
| The guide | The resource the scenario attaches that `IS` an `📋 Interview Guide` (markdown in its `description`) |
| A turn's guide question | The questions its step's topic resource lists, narrowed down by the turn's words |

Session records of the agent server (`customId` `session_…`) are not offered: they carry neither
lengths nor persona guids. A `.vtt` (drop, import, the bundled demos) still works as before.

## Player choreo: hear the discussion

Once the timeline shows a **recording read from the repository**, the red Play button opens
**player mode**: the screen turns dark, only the Panelroom preview and the guide's sections stay,
and the personas speak the steps with their ElevenLabs voices from the cursor on. Pause cuts the
speech off, a click anywhere on the timeline or on a section jumps there, ✕ or Esc closes. (With
an empty timeline the button still starts the discussion; "Diskussion neu starten" is in the ⋮
menu.) A live discussion or a `.vtt` can't be played: their phrases are no steps of the repository.

The voices come from one session of a **carrier choreo** in the recording's repository, which
needs agent server ≥ 0.160.0. Set `APP_PLAYER_CHOREO_GUID` in
`.env` (per demo: in `demos/<name>/.env`); the voices run on the agent server's ElevenLabs key. Any choreo of that repository works whose scenario has
a Config with `autoTransition = false`: its director says one line (one language-model call) and
then waits, and the app never lets it go on. Attach an AI-model resource to it (e.g. `💬 Claude Sonnet 5.5`): without one, and
without an OpenAI key, the agent server falls back to a retired Anthropic model and the session
ends at once. Each persona of the recording needs a
`persona → 🗣️ Voice` edge with its `voiceId`; a persona without one is silent for its turn.

The app opens that session on the first Play and keeps it (`PlayerService`,
`src/app/features/discussion/player/`). For each step it asks the agent server to speak it
(`POST …/speak` with the step guid, `LeanScopeSessionService.speak()`): the server reads the text
and the voice from the repository, writes nothing, and streams the audio as `tts_audio` frames.

- **Ahead.** The step to be heard is asked for with `replace`, the one after it with `queue`, so it
  is ready when the listener gets there. No further ahead.
- **Jumps** cost only the synthesis of the target's first sentence: the target replaces what was
  asked before, in the same session. A step heard once plays from memory.
- **Close** drops what was asked (`DELETE …/speak`); the session stays for the next Play.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server on http://localhost:4200 |
| `npm test -- --watch=false` | Unit tests (Vitest) |
| `npm run build` | Production build into `dist/` |
| `npm run check:token` | Asks LeanScope whether your coding agent's token in `.env` is accepted and which repository it opens (never prints it) |
| `npm run publish:transcript -- <file.vtt> --public` | Uploads a recording's `.vtt` to the token's repository as a **public** file and prints its URL (`--demo <name>` uses that demo's `.env`) |
| `npm run connect:claude` | Stores your coding agent's secrets from `.env` in the Agent Kit plugin in Claude Code |
| `npm run update:plugin` | Pulls the newest Agent Kit plugin into every coding agent that has it: Claude Code, GitHub Copilot in VS Code, Cursor (Copilot CLI and Codex: prints the command). `-- --clients vscode` limits it to one |

## Login and deploy

The app holds no secret. Its user signs in with their LeanScope account
(`LeanScopeAuthService`, the route guard `authGuard`, the page under `src/app/features/login/`),
and the login is the Bearer of `POST /api/v1/sessions`. When LeanScope confirms that this user
reaches `LEANSCOPE_REPOSITORY_ID`, the agent server runs the session on its own LLM keys.
Someone who is not a member of the repository gets no session.

What is compiled into the JavaScript the browser loads (repository id, choreo guids, the login's
URL and anon key) is public by nature, so the app can be deployed as a static site.

- **Netlify:** `netlify.toml` has the build, the routing and the exemptions for Netlify's secrets
  scan. Set the names from the first part of `.env.example` as environment variables of the site.
  Never set a token or an LLM key there.
- Every signed-in member of the repository spends the agent server's keys, not their own.
- A URL with `?sessionToken=…` opens without a login: that token alone authorizes its session.

## Other coding agents

The plugin setup above is for Claude Code. For other clients, run the Agent Kit's setup script:

```sh
npx -y github:leanscope/leanscope-agent-kit --clients vscode        # GitHub Copilot in VS Code
npx -y github:leanscope/leanscope-agent-kit --clients copilot-cli
npx -y github:leanscope/leanscope-agent-kit --clients codex
npx -y github:leanscope/leanscope-agent-kit --clients cursor
```

To diagnose a connection: `npx -y github:leanscope/leanscope-agent-kit --check --clients <client>`.
Details are in the [Agent Kit README](https://github.com/leanscope/leanscope-agent-kit).

To update the plugin later, run `npm run update:plugin`. VS Code and Cursor don't update it on
their own.

## License

[MIT](LICENSE)
