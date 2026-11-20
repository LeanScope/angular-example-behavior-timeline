# Release notes

## 0.11.0 — 2026-11-20

First step of "Thomas guides the whole process": the guide, its choreos, and answering them in
the app. The director track, the turn-by-turn discussion and the personas' state at the cursor
follow.

- **The guide leads through a row of choreos** (`src/app/features/guide/`), each run as a session
  of its own. The first is `LEANSCOPE_CHOREO_SCENARIO_GUID` (the data basis); the new, optional
  `APP_DIRECTOR_CHOREO_GUID` is the second ("🎬 Thomas zeigt, wie man Regie führt": one director
  instruction per turn). When one reaches its authored end, `GuideService` starts the next and
  the support widget follows. Any other end (an error, a stop) leaves the guide where it is. A
  session LeanScope started (`?sessionToken=`) is recognised by the choreo it runs
  (`GET …/config`) and goes on the same way.
- **The guide starts with the app and rejoins its last session.** Opening the app (signed in, no
  demo, no recording) asks the agent server for the session this browser ran last
  (`sessionScenarioGuid`, remembered as an id, never a token): a running one is joined at once, a
  stored one resumed, else a new one starts. "Tour starten" (in the "Studie" view and in the
  timeline's ⋮ menu) starts over.
- **The support widget belongs to the guide, not to the page.** It is hidden over a recording or
  the player. The minimized widget sits next to the place where a question is answered and stays
  there between questions; a question without a place in the app sends it to its home position.
  Without room beside the place it sits above its right end (else below), not on the neighbour.
- **The cast is picked in the row header.** While the session asks for the moderator or the
  participants, everyone offered is listed as a row to tick under that head, with the session's
  question in the row; "Übernehmen" answers, and the unticked rows go. The moderator no longer
  answers on the first click. Picks survive a new step arriving meanwhile.
- **The cast carries over between choreos.** They reference the same 🍱 Inventory. The guide reads
  it from the session's `inventory` frames, and the timeline takes moderator and participants
  from it when the running choreo doesn't ask for them.
- **An earlier answer can be taken away.** A handed-over file's × (or new files dropped on its
  zone) undoes the session back to that question; the answers given after it go in again by
  themselves, and a removed optional answer is not asked again. An answer others rest on
  (`CLAIMS` between their facets) is only removed together with them, on "Auch entfernen".
  Within one visit only: after a reload the earlier files are no longer at hand.
- **A settled data basis is closed.** Once the guide has moved on to a later choreo, the zones
  and the timeline's drop hints take nothing more: nothing would ask for it. "Tour starten"
  starts over. What the first choreo was told (the cast above all) goes along to the next one in
  the app, also across a reload; the Inventory itself keeps only the slots it declares.
- **An optional document can be skipped.** While the session asks for a document whose question
  names no required field, its zone offers "Überspringen" (an empty answer). The cast is never
  optional.
- **Handed-over files show inside their zone**, the message under the file name when the zone is
  narrow, and handed-over stimuli show as thumbnails in their zone and on the timeline's track
  (from the files themselves, for this visit).
- **The director's instruction has a place.** A form with the field `innerVoice` sends the app to
  the "Diskussion" view (`SlotPlace` `director`). Until the timeline has its director track, the
  instruction is answered in the widget (or in the form under the discussion without one).
- **The widget points to the app for its slots.** Every single-field slot the app has a place for
  is passed as `hostSlots`, so the widget shows a pointer instead of a second form.
- Generic layer: `LeanScopeSessionService.undo()` / `redo()` / `undoState` / `sessionConfig()`,
  `steps` following `branch` frames, `SessionRequest.sessionScenarioGuid`, typed `InventoryFrame`,
  `BranchFrame`, `UndoState`, `SessionConfig`, `hostSlots` on `SupportWidget.show()`.

## 0.10.3 — 2026-11-17

- **The Wahlplakate demo opens without a login.** `npm run demo:wahlplakate` (APP_DEMO built in)
  and `?demo=wahlplakate` show the bundled recording without signing in (`demoOrAuthGuard`,
  `src/app/features/discussion/demo.ts`); the login page links to it ("Demo Wahlplakate ansehen").
  The start page asks for a login first: `npm start`, a deployed build (no APP_DEMO), a
  repository demo such as `stadtwerke`, and `?recording=` on top of the built demo.
- **The busy animation comes from the brand pack.** `busyLine` in `brand.json` names an SVG
  (`public/brands/<id>/busy-line.svg`) whose first path is the line `app-loading-line` morphs;
  mindline's is the m of its emblem, the default brand's a plain wave. No shape is left in code.
- **Favicon per brand** (`favicon` in `brand.json`). Mindline's is its emblem as on mindline.de,
  cut from `wordmark.svg`; `logo.svg` is now that emblem too (it was a made-up wave).
- **No brand left in code.** The player's busy button (`app-loading-mark`) draws the brand's
  busy line on its accent disc instead of a built-in emblem, and without `APP_BRAND` the app
  takes the `default` brand. Mindline is one brand pack in `public/brands/`, nothing more.
- **Login:** the e-mail field has the focus from the start, and the LeanScope logo sits subtly in
  the top-right corner next to the brand logo.

## 0.10.2 — 2026-11-17

- **A repository recording brings its guide along.** The recording's own query now reads the
  guide resource's text, so the guide no longer needs a second query (that one failed with
  "Query upstream request failed", 502). A `.vtt` that names its guide under `sources` still
  reads it with `GUIDE_BY_GUID`.

## 0.10.1 — 2026-11-17

- **The app opens in the "Studie" view.** Without `?view=`, the study is shown first;
  `?view=discussion` opens the discussion. Picking a recording still switches to the discussion.

## 0.10.0 — 2026-11-17

- **The app holds no secret any more: its user signs in.** A login page (`/login`, LeanScope
  account, e-mail and password) replaces the access token and the LLM keys in `.env`. The login
  is the Bearer of `POST /api/v1/sessions`; the agent server runs the session on its own keys
  when LeanScope confirms the user reaches the repository. "Abmelden" is in the header.
- New in `.env`: `LEANSCOPE_REPOSITORY_ID` (a login names no repository), `LEANSCOPE_SUPABASE_URL`
  and `LEANSCOPE_SUPABASE_ANON_KEY` (the login; public values). Gone from the app:
  `LEANSCOPE_PERSONAL_TEAM_REPOS_ACCESS_TOKEN` and every `LEANSCOPE_*_API_KEY`. They remain
  optional in `.env` for the coding agent only (`npm run connect:claude`) and never reach the
  bundle. The build constant is now `LEANSCOPE_ENV`.
- **Deployable on Netlify:** `netlify.toml` (build, routing, and `SECRETS_SCAN_OMIT_KEYS` for the
  app's settings). Without a `.env`, the build reads the settings from the environment variables.
- `LeanScopeAuthService` (sign in, renew, sign out; login kept in `sessionStorage`) and
  `authGuard`. A URL with `?sessionToken=…` still opens without a login.
- `RepositoryResourcesService` reads as the signed-in user and sends `?repositoryId=<id>`.
  **This needs an agent server change that is not built yet**
  (its `tasks/todo-login-jwt-repository-reads.md`): until then, recordings from the repository,
  portraits, stimuli and the guide do not load.
- The player no longer asks for `LEANSCOPE_ELEVENLABS_API_KEY`: voices run on the server's key.

## 0.9.0 — 2026-11-17

- **Player mode keeps one session and jumps anywhere at once.** It no longer replays a `.vtt`
  through the player choreo: it asks the agent server (≥ 0.160.0) to speak a recorded step
  (`POST …/speak`), forward, backward or anywhere, in the same session. A jump costs only the
  synthesis of the target's first sentence instead of about half a minute, and playing no longer
  leaves a session record per jump in the repository.
- The step to be heard is asked for with `replace`, the one after it with `queue`; a step heard
  once plays from memory. Close drops what was asked and keeps the session.
- `APP_PLAYER_CHOREO_GUID` now names a **carrier choreo**: any choreo of the recording's
  repository with `autoTransition = false`. It needs no Document facet and no public `.vtt`.
- Only recordings read from the repository can be played; for a live discussion or a `.vtt` the
  Play button says so. `TranscriptPublisher` and `toReplayVtt` are gone.
- When the player's session ends, the message says why (`Die Player-Choreo ist beendet (error:
  …)`): `LeanScopeSessionService` keeps the failure a `session_ending` frame carries.
- The carrier choreo needs an AI-model resource. Without one, and without an OpenAI key, the
  agent server falls back to the retired `claude-3-5-haiku-latest` and the session ends at once
  (agent server `tasks/todo-retired-anthropic-default-model.md`).
- `LeanScopeSessionService` gains `speak()` and `cancelSpeech()`; the `tts_audio` /
  `tts_audio_end` frame types gain `requestId`, `cancelled` and `reason`.

## 0.8.4 — 2026-11-16

- The timeline's speech bubbles are bold at every level of detail, not only at "Titel".
- A click on a question badge in the timeline scrolls the question into view in the sidebar
  instead of opening it. It still opens with a click in the sidebar.

## 0.8.3 — 2026-11-16

- The player's tooltip shows the speaker's portrait (or initials) beside what they say.

## 0.8.2 — 2026-11-16

- The breadcrumb ends at the discussion guide on every tab. "Analyse" no longer adds a crumb of
  its own, as "Studie" and "Diskussion" never did.

## 0.8.1 — 2026-11-16

- **Scrubbing along the guide's pearl chain**: with the mouse on the chain in the left sidebar,
  the red dot jumps to the asked question nearest the mouse, and the timeline's red line moves to
  where it was asked, scrolling it into view. A click on the chain moves the cursor there. This is
  the reverse of scrubbing the timeline.

## 0.8.0 — 2026-11-16

- **A recording opens straight from the repository, without a `.vtt`.** The card "Aufzeichnung"
  under "Studie" (and ⋮ → "Aufzeichnung aus LeanScope öffnen …" on the timeline) lists the
  recorded discussions of the connected repository (its `Conversation` scenarios; the agent
  server's session records are left out). The one picked is read from its steps and stays in the
  URL as `?recording=<scenario guid>`. No recording is built into the app.
- **The timeline comes from the steps**: the turns follow the scenario's active branch, a step's
  `duration` is the length of its turn, and a turn starts where the turns before it end (the rule
  of the agent server's export, so both look the same). Each turn keeps its step guid.
- **Stimuli and guide come from the steps too**: a file resource a step has was on screen during
  that turn, and the guide is the `📋 Interview Guide` the scenario attaches. A step's topic lists
  the guide questions it covers, so a moderator turn is only assigned to one of those
  (`matchQuestions` with `topics`).
- **`npm run demo stadtwerke` starts empty when its repository is connected**: nothing is read
  from the bundled `.vtt`, everything comes from the recording you pick. `?demo=stadtwerke` (or no
  token) still shows the bundled file.
- **"Studie" layout**: Aufzeichnung, Leitfaden and Screener sit in one row at the same height, the
  Stimuli below them across the full width, side by side. Every file is listed once, also when
  the timeline shows it several times.
- **`.vtt` stays** as the second way in: drop, import, export and the demos work as before.
- **Player:** unchanged for now. It still hands the transcript to the player choreo as a file and
  starts a new session for a jump back. One session that speaks any step needs the agent server
  to replay a recorded scenario: proposed in leanscope-agent-server
  `tasks/todo-replay-recorded-scenario.md`.

## 0.7.1 — 2026-11-16

- **An Angebot dropped onto a recording is ignored** without a notice: the .vtt brings its own
  study.
- **The Stimuli zone shows its stimuli** one below the other at the zone's full width (images as
  thumbnails, PDFs by name), and grows downwards with them. It now sits between Leitfaden and
  Screener.

## 0.7.0 — 2026-11-16

- **New tab "Analyse": ask the study a question, get a chart.** A new choreo reads the
  guide, the stimuli, the personas and the transcripts in the repository and answers with a short text, a chart (bar, grouped, 100 % stacked, donut or heatmap) and the
  quotes behind it, each with the speaker's portrait and the guide question's code.
- **While it works**, the card shows what it does right now (from the choreo's tool calls, e.g.
  "Leitfaden, Personas und Transkripte abfragen") with the animated mindline line and the
  seconds, as in mindline-data-dashboard.
- **The guide stays on the left** and folds away like in the discussion. An open question shows
  its answers from the discussion, and "Auswerten" puts a question about it into the input.
- **Sample questions** fill the input with a click: the study's research questions first, then a
  few built-in ones. After the first answer they sit in a drawer above the input.
- **One session takes question after question**: the choreo loops on its question (a need with
  `revisitingScenarioStepRefs`).
- **The choreo** "📊 Analyse der Studie – Stadtwerke Lindenau" (repository 2449,
  `b25d6c7c-9917-4cc6-ad34-d65a6af034b2`) has the repository's MCP server
  (`https://dev.api.leanscope.ai/mcp/2449`) and Claude Sonnet 5.5 attached as resources. The
  agent server sends the session's own token to the MCP server, and the model runs on
  `LEANSCOPE_ANTHROPIC_API_KEY`. Set its guid as `APP_ANALYSIS_CHOREO_GUID` in `.env`. A Mistral
  Large resource is there too, detached: the agent server crashes on Mistral after MCP tool calls.
- **The answer contract**: every answer ends with a ```finding JSON block
  (`src/app/features/analysis/finding/finding.types.ts`), parsed tolerantly; without one, the
  text is shown as it is. Charts are drawn with ECharts (new dependency), in the brand's chart
  colours. Ported from mindline-data-dashboard.

## 0.6.1 — 2026-11-16

- **The speaker's portrait sends out rings in player mode**, like the mindline busy mark: they
  grow out from under it, thin out and fade, turning from red into the speaker's colour. Every
  syllable of the voice sends out a ring, as big and strong as it is loud. Without a voice they
  beat evenly.
- **The speaker stays in the frame until their voice has finished**, also when it takes longer
  than the transcript says; before, the next speaker took over too early.

## 0.6.0 — 2026-11-16

- **Player mode: hear the discussion.** Once the timeline has phrases, the red Play button opens a
  dark, full-window view with the Panelroom preview as large as it fits and a speech bubble high
  enough for long turns. The personas speak the phrases with their ElevenLabs voices from the
  cursor on, and the cursor follows the voice. Nothing can be selected there.
- **Below the preview, the whole guide fits in one row of sections**, with the current section's
  name. The mouse over the row shows a light second cursor and what happens there (time, section,
  who says what); a click jumps there.
- **Play becomes Pause while it speaks**, and the animated mindline emblem while a voice is being
  prepared. Pause cuts the speech off; Play goes on with the same turn. ✕ or Esc closes player
  mode and keeps the cursor.
- **The voices come from a separate player choreo** (`APP_PLAYER_CHOREO_GUID`), built on the agent
  server's transcript replay; see "Player choreo" in the README. The app puts the timeline's
  transcript where the choreo reads it before each session, starting at the cursor, so the two
  can't get out of step. That file is public.
- A turn heard once is replayed from memory. A short jump ahead is stepped through in the running
  session; a long one, or one back to a turn not heard, starts a session at the target.
- `npm run publish:transcript` creates the public file a player choreo names.
- With an empty timeline the Play button still starts the discussion. "Diskussion neu starten"
  moved into the ⋮ menu.
- `LeanScopeSessionService` has `setTts()` and `continue()`.

## 0.5.2 — 2026-11-16

- **A role badge fills with its persona's colour on hover**, with dark or light text, whichever
  reads better; its tooltip shows the full role. It is no longer selectable as text.
- **The ring around a selected avatar on the timeline is in the persona's colour**, like the badge
  outline (dark grey without one).
- The speaker names in the timeline's track heads are bold.
- **An opened question in the Leitfaden shows each speaker's portrait** in front of their answer
  (the initials when there is no image).

## 0.5.1 — 2026-11-16

- **A role badge is outlined in its persona's colour** (`Persona.backgroundColor`), on the
  timeline tracks and in the Steckbrief. A persona without a colour keeps the grey outline.
- **The moderator looks like the participants:** the Steckbrief shows a "Moderator" badge, outlined
  in the moderator's colour like the timeline's. The colour comes from the `.vtt` file or the
  repository, so it shows for recordings; a live session's roster carries no colours yet.
  "Transkript exportieren" writes the moderator's colour into the file.
- **The Steckbrief's role badge has its own line** between name and demographics, so a long role
  no longer cuts the name.
- On a narrow timeline the participants' icon is centred like the other track icons.

## 0.5.0 — 2026-11-16

- **A recording brings its guide along by reference.** The server's `.vtt` export (agent server
  0.158.0) names the discussion guide it was made from under the top-level `sources`. The app
  reads that resource from the token's repository and shows it as the Leitfaden: each `##`
  heading of the guide's markdown is a block, each bullet a question. A file with its own
  `study.guide` keeps it.
- **The turns are assigned to the guide's questions by their words.** The export has no `[q_…]`
  tags, so the app matches each moderator turn to the question it paraphrases (no LLM). The
  stimulus on screen tells the same question about two campaigns apart, and a stimulus that comes
  on opens its block. This is a heuristic: on the Stadtwerke recording most moderator turns land on
  the right question, and a free paraphrase can be missed.
- **A matched question is never ticked as done.** The match is a guess made after the discussion,
  so questions and blocks show as asked, not as answered by everyone.
- **A red dot in the Leitfaden shows where the timeline is.** While you scrub over the timeline
  it slides to the question at that moment, and the list scrolls to keep it in view.
- **A question's badge on the timeline stays in view:** zoomed in, it sticks to the left edge
  while its question runs, like the guide blocks and the stimuli.
- "Transkript exportieren" writes the matched guide and its tags into the file, so the result
  needs no repository to show its Leitfaden.
- The `stadtwerke` demo names its guide.

## 0.4.6 — 2026-11-16

- **The server's own `.vtt` export shows its stimuli.** The app now reads the top-level
  `fileResources` that **Export Transcript (.vtt)** writes (agent server 0.157.0) as stimuli; a
  hand-written `study.stimuli` still wins when a file has both.
- **A repository stimulus shows as an image, not as its name:** when the file states no
  `mimeType`, it is taken from the fetched file itself. A file that occurs several times is
  fetched once.

## 0.4.5 — 2026-11-15

- **The moderator can come from the repository.** A `.vtt` that names no moderator itself (only
  `actorRef`s) is no longer refused: the app asks the token's repository which of its personas
  has the Group Role `type` `Moderator` (a resource relationship on the persona). The file's own
  `parameters` or `moderator: true` still win.

## 0.4.4 — 2026-11-15

- **The stimulus fills the Panelroom's left area** instead of a fixed 10–18rem width.
- **Stimuli and guide blocks keep their label in view:** zoomed in, thumbnail and name stick to
  the timeline's left edge while the item runs past it.

## 0.4.3 — 2026-11-15

- **No query guid for the portraits.** The app sends its own personas query to the agent server
  (`POST /api/v1/queries`, agent server 0.156.0), so `APP_PERSONAS_QUERY_GUID` is gone and no
  repository needs a "Personas nach Guid" resource.
- **A recording's cast is complete:** its participants no longer show "Die Persona wird aus dem
  Screener erzeugt …", and the Steckbrief leaves out an empty profile.

## 0.4.2 — 2026-11-15

- **Demos belong to their repository.** `npm run demo:<name>` (or `npm run demo <name>`) lays `demos/<name>/.env` (gitignored,
  outside `public/`) over `.env` and opens that demo; see `demos/README.md`. Only that one
  repository's token reaches the bundle. `LEANSCOPE_AGENT_SERVER_URL` can point the app at another
  agent server, e.g. a local one.
- **A recording reads what it names from the repository** (agent server 0.154.0), with the token
  and without a session:
  - the portraits and profiles of its personas (`actorRef`), through the published query
    "Personas nach Guid" (new `APP_PERSONAS_QUERY_GUID`);
  - stimuli named by `resourceRef` + `fileRef` instead of `url`.
  The recording's own values win. Without a token it shows as before.
- **Actor traits by guid.** An actor's `parameters: [{ ownerRef, resourceRef, parameterRef, value }]`
  name its traits: the Group Role `type` `Moderator` marks the moderator (`moderator: true` is
  still read), the Segment's `sharePercentage` shows as `segmentSharePercentage`. The export
  writes them back.
- **Demo "stadtwerke"** names its four campaign images by resource and file, timed to the
  transcript, and its actors' traits by guid; the PNGs are no longer in the app.
- **Handed to the LeanScope Classic team:** the plan for their `.vtt` export (manifest, traits by
  guid, guide from the scenario's sections, summaries as step titles, every linked resource by
  guid). The format itself is documented in `vtt-import.ts`.

## 0.4.1 — 2026-11-15

- **Drop a recording.** A self-contained `.vtt` dropped on any document zone of the Studie tab or
  on the timeline, or picked in the Leitfaden zone, is shown as a recording, and the app switches
  to the discussion. It no longer goes to the session's input slots.
- **Demo "Stadtwerke Lindenau"** (`?demo=stadtwerke`): the LeanScope Classic export of the
  focus group, converted to the manifest format (Maren moderates; `segmentSharePercentage` per
  customer). The demo's files are sorted into `documents/`, `stimuli/` and `transcripts/`. The
  Classic export itself is kept and refused until it carries a manifest.
- **Drop zones keep one height:** every hint reserves two lines, and the icon sits by the title.

## 0.4.0 — 2026-11-15

- **The choreo's inputs land where the app has a place for them.** When the session asks for an
  input slot the app knows, the app goes there and highlights it:
  - Angebot, Skript (Leitfaden), Screener and Stimuli: their drop zones on the Studie tab.
  - Moderatorin and Teilnehmende: their heads on the timeline.

  A document dropped before it is asked for is handed over as soon as it is.
  Slots are matched by their key (the facet's `key` or its override), not by facet guid, since
  one facet can back several slots. `PendingQuestion.facetGuid` is still there for other uses.
- **The session's chat runs in the agent server's support widget**, which can be collapsed and
  moved. The generic question form under the timeline only shows when there is no widget
  (`agentUiUrl` empty).
- **The widget comes in the choreo's theme and sits next to the question.** The app forwards
  `?theme=` / `?themeMode=` from LeanScope to the widget. While a slot is asked, the minimized
  widget sits next to the highlighted place. That is a stopgap until the agent server can place
  it. The question itself is to show in the widget's handle; the plan for the agent server is in
  `docs/agent-server-widget-plan.md`.
- **Documents always answer the input slots**, also before a session runs (held until asked). The
  ingest choreo only reads them in when it is set up and no session runs. The Studie tab no longer
  shows the banner about `APP_INGEST_CHOREO_GUID` / `APP_STUDY_QUERY_GUID`.
- **Pick the cast on the timeline.** The "Teilnehmende" head is always there. Its ▾ opens the
  session's persona roster to add participant rows, × removes one, and "Übernehmen" answers the
  slot. The moderator's head has its own ▾.
- **The director is not the moderator.** In a choreo with input slots, the moderator and the
  participants are the ones its slots name. The director (who asks for the inputs) speaks in the
  widget and gets no track.
- **Choreo "Moderationsschleife – Stadtwerke Lindenau (Studie)"** (repo 2449) now also asks for
  the Angebot, the Screener and the Stimuli.
- Fix: a step frame arriving just as the pending question was being read could be missed, so a
  question stayed unseen.

## 0.3.11 — 2026-11-13

- **The red Play button starts the discussion.** The separate "Diskussion starten" button is
  gone. The Play button on the timeline starts or restarts the discussion, and it is off while
  one runs, while a recording is shown, or while the setup is incomplete.
- **`npm run check:token`** asks LeanScope whether the token in `.env` is accepted and which
  repository it opens, the same check the agent server makes. It never prints the token.

## 0.3.10 — 2026-11-13

- **Replay a choreo straight from the app.** "Diskussion starten" works with the choreo guid,
  your access token and one LLM key alone. `APP_INGEST_CHOREO_GUID` and `APP_STUDY_QUERY_GUID`
  are optional now: without them the Studie tab says what is missing, and the discussion still
  runs.
- **Participants from the session.** When no screener names the participants, they are whoever
  speaks in the session. Names and portraits come from the agent server's `actors` frame, which
  `LeanScopeSessionService.actors()` now exposes. The first speaker is the moderator. This also
  applies to a session opened from LeanScope Classic.

## 0.3.9 — 2026-11-13

- **The app opens from LeanScope Classic.** When the agent server's `run-choreo` plugin opens
  the app at the theme's `uiBaseUrl` (e.g. `http://localhost:4200/`) with `?sessionToken=…`, the
  discussion page follows the session the plugin created and opens its start gate, instead of
  creating a session of its own. The new `LeanScopeSessionService.attach(sessionToken)` needs no
  access token, choreo guid or LLM key. An unknown or ended session now shows an error.

## 0.3.8 — 2026-11-13

- **Persona portraits from the public catalog.** A participant without an image of its own gets a
  portrait picked by meaning from the agent server's public catalog
  (`GET /api/v1/resources/public/match?kind=image&q=…`, agent server 0.151.0), described by its
  role, demographics and profile. The Bürger dialog demo carries such match URLs in its `.vtt`.
- **Initials when an image fails.** An avatar whose image cannot be loaded shows the initials
  instead of a broken image (Steckbrief, panel room preview and timeline).

## 0.3.7 — 2026-11-12

- **Stimulus without a caption** in the panel room preview: name and credit only as a tooltip on
  the image, which now uses the full height of the left area and keeps clear of the speaker.
- **No jump when the stimulus resizes.** Its bottom edge stays on the bubble's lower edge, so only
  the top edge and the width animate.

## 0.3.6 — 2026-11-12

- **The moderator can be selected.** Her seat in the panel room, her track head and her clips
  select her like any participant, so the Steckbrief can follow what she says.
- **Steckbrief as a speech bubble.** The current or last turn hangs from the portrait with a
  pointer, its label and time below it. While the panel room preview is open, the turn is left
  out (the preview shows it already).
- **Stimulus drawer.** The stimulus slides up from the bottom of the white Steckbrief in a drawer
  with a soft top shadow, the image whole and aligned with the bubble. It lies over the sheet, so
  nothing moves when it comes or goes.
- **No more jumping while following.** Rows no longer shrink when a long profile overflows, and
  the moderator and participants share one layout.
- **Stimulus titles hidden** in the panel room preview for now.

## 0.3.5 — 2026-11-12

- **A real speech bubble in the panel room.** The bubble now has a pointer whose tip sits below the
  centre of the speaking portrait, and the bubble starts right below it. The name and timestamp
  stand to the right of the pointer, above the bubble.

## 0.3.4 — 2026-11-12

- **Lettered pearls.** The block letter now sits inside the pearl, in the Leitfaden and on the
  timeline: green with a white letter when the block is done, outlined otherwise. The separate
  check icon and the "·" between letter and title are gone; timeline blocks always show their
  pearl.

## 0.3.3 — 2026-11-12

- **Steckbrief follows the timeline.** Without a selected persona, the right sidebar shows who
  speaks at the hover position (else the cursor), like the panel room preview but focused on one
  speaker: portrait with a red ring while speaking, profile, and the current turn ("Sagt gerade" /
  "Zuletzt gesagt") with its time. In pauses it stays on the last speaker; during the moderator's
  turns it shows the moderator. A pin button holds the shown persona; unpinning returns to
  following, and deselecting no longer folds the sidebar away.
- **No jumping while scrubbing.** The name sits on one line, the subtitle is always two lines high
  and the speech bubble four lines (longer turns end in an ellipsis and scroll on hover).

## 0.3.2 — 2026-11-12

- **Calmer role badges.** Roles are muted text in a subtle pill outline, no longer in the persona's
  colour. The moderator's badge keeps its grey fill so it stands apart.
- **Neutral initials.** Persona circles without a portrait use the speech-bubble grey with dark
  initials (preview seats, track heads, persona detail).
- **Speech bubble fits its text.** The bubble in the panel room preview keeps its height and
  shrinks long turns from 16 to 14 to 12 px. If that still isn't enough, the text ends in an
  ellipsis, a "Text gekürzt" label appears next to the speaker, and the bubble scrolls on hover
  (click the clip first, so the preview stays on it).
- **Stimulus in the preview.** The title stacks above the image, both right-aligned and anchored
  to the speech bubble's lower edge, in the moderator's and the participants' layout alike. Long
  titles end in an ellipsis with the full title in the tooltip; the credit link is clickable.

## 0.3.1 — 2026-11-12

- **Timeline toolbar polish.** A red Play button (later: start a live panel) sits on the border
  between the track heads and the tracks. The detail slider is centred between it and the menu,
  with a one-line and a multi-line icon at its ends and the level's name in a tip under the thumb.
  Zoom −/+ moved into the corner above the track heads.
- **Calmer tracks.** No more coloured lines in front of the guide blocks; the question badges are
  vertically centred in their track.

## 0.3.0 — 2026-11-12

- **Demo data is a file now: self-contained WebVTT.** One `.vtt` holds a whole recorded group
  discussion: the study (brief, guide, screener, stimuli) and the cast (personas with profile,
  OCEAN, colour, portrait) in a YAML manifest inside a `NOTE`, then one cue per turn. The cue
  identifier is the turn's title, `[q_…]` in a moderator cue opens a guide question, and the cue
  times are the clip times. It is the agent server's transcript format, extended. The server's
  parser accepts these files and only reports the extra keys. Format and rules:
  `src/app/features/discussion/model/vtt-import.ts`.
- **New demo: "Wahlplakate im Bürgerdialog"** (`?demo=wahlplakate`). Six fictional citizens of
  different age, mindset and political orientation talk with moderator Maren about the questions
  that decide their vote, and react to five real election posters from recent campaigns (SPD, Die
  Linke, CDU, AfD, Grüne), each reaction in character. The posters are loaded from their public
  URLs with a credit line in the preview. They are party and press images, not free licences:
  fine for local demos, to be replaced before anything is published.
- **The cruise demo moved into `public/demo/flusskreuzfahrt.vtt`** (`?demo`, or
  `?demo=flusskreuzfahrt`), unchanged on screen. `demo-study.ts` is gone.
- **Import and export round-trip.** "Transkript importieren (.vtt)" in the timeline menu shows any
  such file as a recording. "Transkript exportieren" now writes the full manifest, so an export
  imports back to the same screen.
- **Steckbrief: "Merkmale".** Personas can carry extra traits (e.g. "Politische Orientierung"),
  shown above OCEAN.

## 0.2.6 — 2026-11-12

- **Responsive discussion view.** On small screens or in portrait orientation the sidebars and
  their toggles disappear. The Panelroom preview has its own toggle in the header and folds up and
  down with an animation; it starts folded on short screens and is gone on narrow ones, leaving
  the stage to the timeline.
- **Timeline scrolls its own rows.** The timeline fills the stage and scrolls its tracks inside,
  with the time axis, the track heads and the Leitfaden, Fragen and Stimuli tracks staying put.
  The wheel scrolls the rows; Shift + wheel (or a sideways swipe) moves in time.
- **Narrow timeline.** Below 56rem the track heads shrink to avatars and icons, with name and role
  in the tooltip, and the clips switch to "Titel" (back to the previous level once there is room).
  Tooltips wrap instead of running out of the timeline.
- **Status light in the shell header.** The "● Demo" light moved from the page bar to the right end
  of the shell's header (`ds-status`); embedded without the shell, the page still shows it.
- **Fixes.** The page no longer runs past the right edge of narrow windows, and the timeline is no
  longer empty after switching from "Studie" to "Diskussion".

## 0.2.5 — 2026-11-12

- **"Titel" replaces "Balken".** The timeline's top detail level shows each turn as a 2–4-word
  title: participants with a leading emoji for their mood in that question ("😟 Preis zu hoch"),
  the moderator without. The title comes from the step's `title`, which the agent server is to
  write when the choreo opts in (`tasks/todo-step-titles.md` in `leanscope-agent-server`). Until
  then a turn shows its first four words. The demo turns carry hand-written titles.

## 0.2.4 — 2026-11-12

- **Panelroom preview with a fixed speaker frame.** The round of portraits rolls sideways until the
  speaker sits in a fixed red frame above the bubble, instead of enlarging the speaker. The dark
  grey ring outside marks only the selected persona, as on the track heads.
- **Stimulus in the free space.** While the moderator speaks, the stimulus is shown large left of
  the frame; once a participant answers, it shrinks below the seats that rolled to the left. A new
  stimulus flies in from the left and fades in.
- **Question as a badge.** The preview no longer spells out the guide question (the moderator
  words it anyway); its code badge sits in the top right corner, with the text as tooltip.

## 0.2.3 — 2026-11-12

- **Persona clicks jump the cursor.** Clicking a persona in the Panelroom preview or on its track
  head selects it and moves the red line to that persona's next turn; clicking it again
  deselects it.
- **Who speaks, at a glance.** The bubble under the red line turns red on the timeline (grey in
  the preview). The speaking persona's avatar gets a red ring inside, the selected one a dark grey
  ring outside.
- **Steckbrief as a right-hand sidebar.** The profile of the selected persona folds in and out on
  the right like the Leitfaden on the left, via its icon or by (de)selecting a persona.

## 0.2.2 — 2026-11-11

- **Polished discussion screen.** The timeline toolbar is compact: zoom strip and detail slider on
  the right, secondary actions ("Alles zeigen", transcript export) in a ⋮ menu. Speech text runs on
  to the speaker's next turn (faded past the spoken part); only the bubble shows a tooltip.
- **Timeline navigation.** The red line follows the mouse and returns to the clicked position.
  Near the left or right edge the timeline scrolls along; hold Space and drag to pan.
- **Role badges in the persona colour** on the speaker tracks and in the profile, read from
  `Persona.backgroundColor` (`color` in the study query; grey without one). The published query
  "Studie der Choreo" still has to return it as `color: backgroundColor`.
- **Leitfaden sidebar as a pearl chain**: green checks for finished blocks and questions, one
  scrollbar. The Panelroom preview shows the open question above the round and mirrors the
  portraits.

## 0.2.1 — 2026-11-11

- **`npm run update:plugin` works for every coding agent, not only Claude Code.** It finds each
  client that has the Agent Kit plugin and updates it: Claude Code through its CLI, GitHub Copilot
  in VS Code and Cursor by pulling their plugin clone. For Copilot CLI and Codex it prints the
  command to run. `npm run update:plugin -- --clients vscode` limits it to one client.

## 0.2.0 — 2026-11-01

- **Google Gemini keys work.** Set `LEANSCOPE_GOOGLE_API_KEY` in `.env` to run choreos on Gemini.
  The app sends it to the agent server as the `google` key and counts it as an LLM key on the home
  page. `npm run connect:claude` also stores it in the Agent Kit plugin (needs plugin 0.6.0+).
- **The Agent Kit plugin stays up to date.** `.claude/settings.json` sets `autoUpdate: true` on
  the `leanscope` marketplace, so Claude Code pulls new plugin versions on startup. To pull one
  right away, run the new `npm run update:plugin`.
  - **Existing forks:** run `npm run update:plugin` once, then `npm run connect:claude`, and start
    a new Claude Code session.

## 0.1.2 — 2026-10-31

- **The choreo guid moved to `.env`.** Set `LEANSCOPE_CHOREO_SCENARIO_GUID` in `.env` instead of
  `choreoScenarioGuid` in `src/environments/environment.ts`, so your choreo stays local and isn't
  committed. `npm start` and `npm run build` pass it in with the secrets.
  - **Update your `.env`:** add `LEANSCOPE_CHOREO_SCENARIO_GUID=<your choreo's _guid>`. Until then
    the home page lists it as missing.

## 0.1.1 — 2026-10-30

- **The question is no longer shown twice.** The answer form shows only the input; the question is
  the persona's last message in the conversation above it.
- **Your answers read as text.** The conversation unwraps the server's answer envelope
  (`kind` / `schema` / `data`) and shows just what you wrote; a picked choice shows its label.

## 0.1.0 — 2026-10-30

The first version of the template: fork it to build an Angular MVP on a LeanScope choreo.

- **Angular 22 app that runs a choreo.** `LeanScopeSessionService` creates a session on the
  LeanScope Agent Server, follows its event stream and answers its questions; the state is exposed
  as signals. The session page shows the conversation (`ls-transcript`) and a form for each
  question, built from the question's JSON Schema (`ls-pending-step-form`). The home page lists
  what's still missing in the setup.
- **The LeanScope Agent Kit is enabled for Claude Code.** `.claude/settings.json` enables
  `leanscope-agent-kit@leanscope`. Claude Code offers to install it when a session starts in the
  project, with its skills and the three LeanScope MCP servers.
- **A guided workflow for coding agents.** `AGENTS.md` (imported by `CLAUDE.md`) takes the agent
  from connecting to the first MVP screens: pick or model a choreo, test-run it, propose screens,
  build them under `src/app/features/`.
- **One place for your secrets: `.env`.** Copy `.env.example` to `.env` and fill it in; it uses
  the same names as the Agent Kit. `npm start` and `npm run build` hand the values to the app at
  build time. Saving `.env` while `npm start` runs restarts the dev server with the new values.
  `npm run connect:claude` stores the same values in the Agent Kit plugin's settings (OS keychain)
  for the MCP servers. No script ever prints a value.
  - **Development only:** the token and keys end up in the browser bundle. Don't deploy this setup.
- **Works with older Node too.** If the active Node.js is too old for Angular 22, the npm scripts
  use the newest suitable version installed with nvm.
- **CI** runs the tests and the build on every push and pull request, without secrets.
