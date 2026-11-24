# Offer the agent server's session records as recordings

> **DO NOT COMMIT.** This is a hand-off note from `leanscope-agent-server`, and this repository is
> public.
>
> Version bump: second number (a feature).

## Why

The agent server writes one `Conversation` scenario per session (its "session record",
`customId: session_<token>`) into the session repository. The app hides these today:

- `toRecordings` drops every row whose `customId` matches `SESSION_RECORD`
  (`src/app/features/discussion/model/repository-recording.ts:92`, `:156`).
- The header comment (`:24-26`) gives the reason: "They carry no lengths and no persona guids,
  so they are not offered."

As of **leanscope-agent-server 0.172.0** both reasons are gone when the choreo's repository is the
session repository (the usual case, e.g. repository 2342):

| Field | What the server now writes |
|---|---|
| `ScenarioStep.actorSymbolRef` | the **persona guid** of a persona's step. `speakerOf` (`:310`) already accepts it. Other steps keep the reserved symbols `human`, `system`, `worker` and `agent`. |
| `ScenarioStep.duration.time` | the step's **length**: from its start to the start of the next step, in whole seconds. The last step gets begin → finished. `lengthOf` (`:316`) already reads it. |
| `Scenario.startTime` | when the session began, in UTC. The sum of the earlier lengths added to it gives every step's wall-clock time. |
| step `HAS` Resource with `fileRefs` | an **image a tool returned** (for example a computer-use screenshot). It is recorded as a step of its own, by the persona that called the tool, with line `Image from <tool>`. `shownSpans` (`:357`) already reads this shape. |

The server can only write the guid where it resolves. A choreo read from one repository and
recorded into another keeps the old form: `actorSymbolRef` is the persona's portrait URL, so those
records still have no persona guid.

## Work

1. **Offer session records.** Remove the `SESSION_RECORD` filter in `toRecordings`, or list session
   records as a second group ("Sitzungen") next to the discussions, sorted newest first by
   `startTime`. Update the header comment at `:24-26`. `?recording=<scenario guid>` already loads
   any scenario by guid.
2. **Records from before 0.172.0, or recorded across repositories.**
   - With no guid actors, `fromScenarioSteps` throws "hat keine gesprochenen Beiträge". Show that
     as a readable state, not an error.
   - Optional: if `title` carries the persona name, map a portrait-URL actor to a pseudo speaker
     keyed by that URL.
3. **Cast.** A session usually has one persona. With no `moderatorRefs` the first speaker becomes
   the moderator (`:228`), so there are no participant tracks at all. For a session record, decide
   the mapping explicitly:
   - every persona is a participant;
   - a human step (`actorSymbolRef: human`, text in `line`) is the moderator / interviewer track;
   - today human steps are skipped, because they are not guids.
4. **Image steps.** Their line (`Image from cua_observe`) is short and would be a clip of the
   persona. Keep it as the keyframe's caption on the persona track. The image itself goes on the
   stimuli track through `shownSpans`. The file is served by the agent server:
   `GET /api/v1/resources/:resourceGuid/files/:fileGuid` (Bearer).
5. **Wall clock (optional).** Show `startTime` + offset as the time under the cursor. Read
   `startTime { year month day time { hour minute second } }` in `RECORDING_BY_GUID`.
6. **Later: `Interaction`.** When the backend's scenario-type enum gets `Interaction`, the server
   writes computer-use sessions with that type. Move this mapping into the interaction feature
   planned in `leanscope-mcp-server/tasks/handoff-cua-timeline-app.md` then.

## Verification

- Run the agent server's `citizen-cua` example once (repository 2342). The new session record is
  listed. It shows Sabine's turn, then the image step with the screenshot on the stimuli track.
- A discussion recording looks exactly as before. Run `npm test -- --watch=false` and check it is
  green.
