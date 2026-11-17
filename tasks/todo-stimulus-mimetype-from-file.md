# Read `fileResources` from an exported `.vtt`, and take a stimulus's MIME type from its file

> **DO NOT COMMIT.** This is a hand-off note from `leanscope-agent-server`, and this repository is
> public.
>
> Version bump: third number (a fix).

## Why

The server's **Export Transcript (.vtt)** plugin (leanscope-agent-server 0.157.0) now writes
what the recording had in hand when, under a **generic top-level key `fileResources`**, NOT
`study.stimuli`. The server names it for what it is (a resource that owns a file, placed on the
cue clock). A group discussion's stimuli are one use of it. Each entry carries `resourceRef` +
`fileRef` and `start`/`end`, and **no `mimeType`**. The MIME type is a property of the `File`
entity, so the file need not repeat it.

```yaml
fileResources:
  - key: r_1
    name: "Stimulus material: Übersicht_Kampagnen_ohne_Balken.png"
    resourceRef: b71f5c1b-96db-4f24-8578-4db2eed59a0a
    fileRef: d95bc98f-4e02-4219-80f8-f1bdc45a133f
    start: 00:17:56.000
    end: 01:05:09.000
```

**As it stands, the app imports none of these**, because it reads only `study.stimuli`.

For the entries it does read, the import places repository files (`isRepositoryFile` →
`fileStimuli` in `src/app/features/discussion/model/vtt-import.ts`), but it sets
`mimeType: s.mimeType ?? ''`.
The tray in `src/app/features/discussion/detail/persona-detail.ts` shows the image only when
`s.mimeType.startsWith('image/')`, so an exported stimulus shows its **name instead of the
image**.

## What to change

0. `vtt-import.ts`: read top-level `fileResources` as stimuli, alongside `study.stimuli`, which
   stays readable for the hand-made demo files. Same entry shape (`key`, `name`,
   `resourceRef`, `fileRef`, `start`, `end`), so it is a second source for `fileStimuli` /
   `placeStimuli`, not a second code path. If a file has both, take `study.stimuli` (it is
   hand-authored) and ignore `fileResources`.
1. `RepositoryResourcesService.fileUrl` (`src/app/leanscope/repository-resources.service.ts`)
   already reads the response as a blob. Also return its type:
   `{ url, mimeType: blob.type }`, or add a sibling method if changing the return shape is too
   wide. `blob.type` comes from the server's `Content-Type`, which is the file's own MIME type.
2. In `discussion-page.ts`, where `imported.files` are resolved (`fileUrl(s.resourceRef!,
   s.fileRef!)`), fill `mimeType` from that result **when the manifest gave none**. A
   hand-written `.vtt` that states `mimeType` keeps it.
3. Test: a `.vtt` with top-level `fileResources` (no `study`) imports its entries as stimuli, and one whose repository stimulus has no `mimeType` ends up with `image/png` once
   loaded (fake `LEANSCOPE_FETCH` returning a `Blob` of type `image/png`).

## Also worth knowing (no change needed)

- Speaker labels are now the persona names as they are in LeanScope, e.g. `Ernst (19%)`. The
  identity is still `actorRef`.
- The export writes **no actor `parameters`**. The moderator is found through
  `MODERATORS_BY_GUID`, as already done when a file names none. The segment share then
  doesn't show as an attribute.
- A stimulus can occur several times (it comes back after other material). Comparison turns can
  also show two or three stimuli at once, so spans may overlap. Real export of 2449: 10 spans,
  with Übersicht / K1 / K2 / K3 at exactly the times of the hand-made demo file.

## Since 0.158.0: `sources` (optional, no change required)

The export also lists, under the top-level `sources`, what the discussion was made from. Today
that is its discussion guide: a resource the scenario attaches that `IS` the `📋 Interview Guide`
type. Entries carry no time:

```yaml
sources:
  - key: s_1          # the resource's customId, else s_<n>
    name: Discussion Guide
    resourceRef: ac34fe04-30ea-4023-87d6-b094316612d4
    # fileRef: <guid> # only when the guide owns a file (an uploaded document)
```

The guide's text is in the resource's `description`; the file does not copy it. Reading `sources` is
optional. The import ignores unknown keys today, so an exported file loads as before. If the
app wants to link an imported discussion to its guide, `resourceRef` is the identity.
