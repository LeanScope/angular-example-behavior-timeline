import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { DsButton, DsIcon, DsRoleBadge, DsSkeleton } from '../../../design-system';
import type { Clip, Ocean, Participant, Stimulus, Transcript } from '../model/study.model';
import { clipAt, lastTurnBy, MODERATOR_ROLE, MODERATOR_TRACK, trackOf } from '../model/transcript-mapper';
import { BrokenImages } from '../shared/broken-images';
import { DiscussionUiState } from '../state/discussion-ui.state';
import { clockLabel } from '../timeline/time-format';

const OCEAN_LABELS: { key: keyof Ocean; label: string }[] = [
  { key: 'openness', label: 'Offenheit' },
  { key: 'conscientiousness', label: 'Gewissenhaftigkeit' },
  { key: 'extraversion', label: 'Extraversion' },
  { key: 'agreeableness', label: 'Verträglichkeit' },
  { key: 'neuroticism', label: 'Neurotizismus' },
];

/**
 * The profile ("Steckbrief") in the right-hand sidebar. With a participant selected it shows them;
 * without one it follows the timeline like the Panelroom preview, but focused on one speaker: whoever
 * speaks at the hover position (else the cursor), staying on the last speaker in the pauses.
 */
@Component({
  selector: 'app-persona-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, DsButton, DsIcon, DsRoleBadge, DsSkeleton],
  template: `
    <!--
      One structure for participants and the moderator: switching speakers only updates bindings,
      so the portrait is never rebuilt (no reload, no jump).
    -->
    <div class="sheet" [class.with-tray]="hasTray()">
    @if (head(); as h) {
      <p class="mode">
        <span>{{ following() ? 'Folgt der Zeitleiste' : 'Ausgewählt' }}</span>
        @if (following()) {
          <button ds-button variant="ghost" size="icon" type="button" aria-label="Festhalten" title="Festhalten" (click)="ui.selectPersona(h.track)">
            <ds-icon name="pin" />
          </button>
        } @else {
          <button ds-button variant="ghost" size="icon" type="button" aria-label="Wieder der Zeitleiste folgen" title="Wieder der Zeitleiste folgen" (click)="closed.emit()">
            <ds-icon name="unpin" />
          </button>
        }
      </p>

      <header>
        <span
          class="avatar"
          [class.moderator]="h.moderator"
          [class.stub]="!h.filled"
          [class.live]="speakingTrack() === h.track"
        >
          @if (images.usable(h.imageUrl); as src) {
            <img [src]="src" alt="" (error)="images.markBroken(src)" />
          } @else {
            {{ h.initials }}
          }
        </span>
        <div class="title">
          <h2 [attr.title]="h.name">{{ h.name }}</h2>
          <!-- Its own line between name and demographics (kept when empty), so the name has the full width. -->
          <p class="role">
            @if (h.role) {
              <ds-role-badge [role]="h.role" [color]="h.color" [class.moderator]="h.moderator" />
            }
          </p>
          <!-- Always two lines high, so the pane doesn't jump between speakers. -->
          <p class="meta subtitle" [attr.title]="h.subtitle || null">{{ h.subtitle }}</p>
        </div>
      </header>

      @if (!previewShown()) {
        <ng-container [ngTemplateOutlet]="now" />
      }

      @if (h.participant; as p) {
        @if (p.filled) {
          <div class="body">
            @if (p.profile) {
              <section>
                <h3>Profil</h3>
                <p>{{ p.profile }}</p>
              </section>
            }
            @if (p.attributes?.length) {
              <section>
                <h3>Merkmale</h3>
                <dl class="attributes">
                  @for (a of p.attributes; track a.label) {
                    <dt>{{ a.label }}</dt>
                    <dd>{{ a.value }}</dd>
                  }
                </dl>
              </section>
            }
            @if (p.ocean; as ocean) {
              <section>
                <h3>Persönlichkeit (OCEAN)</h3>
                <dl class="ocean">
                  @for (trait of traits; track trait.key) {
                    <dt>{{ trait.label }}</dt>
                    <dd>
                      <span class="bar"><span [style.width.%]="ocean[trait.key] * 100"></span></span>
                      <span class="value">{{ (ocean[trait.key] * 100).toFixed(0) }}</span>
                    </dd>
                  }
                </dl>
              </section>
            }
            <ng-container [ngTemplateOutlet]="stats" />
          </div>
        } @else {
          <p class="meta">Die Persona wird aus dem Screener erzeugt …</p>
          <ds-skeleton />
        }
      } @else {
        <div class="body">
          <ng-container [ngTemplateOutlet]="stats" />
        </div>
      }
    } @else {
      <h2 class="empty-head"><ds-icon name="users" /> Steckbrief</h2>
      <p class="empty">
        {{
          transcript().clips.length
            ? 'Hier erscheint, wer an der Stelle der Zeitleiste spricht. Oder wählen Sie eine Person in der Runde.'
            : 'Sobald die Diskussion läuft, erscheint hier, wer gerade spricht.'
        }}
      </p>
    }

    </div>

    <!--
      The stimulus slides in from the bottom over the sheet, so the sheet's layout never moves with
      it. Out of the way while there is none (or while the Panelroom preview shows it anyway).
    -->
    @if (hasTray()) {
      <figure class="tray" [class.open]="!!stimulus()" [attr.aria-hidden]="!stimulus()">
        @if (lastStimulus(); as s) {
          @if (s.mimeType.startsWith('image/')) {
            <img [src]="s.url" alt="" [attr.title]="s.name" />
          } @else {
            <figcaption>{{ s.name }}</figcaption>
          }
        }
      </figure>
    }

    <ng-template #stats>
      <section>
        <h3>In der Diskussion</h3>
        <p class="meta">{{ turns() }} Beiträge, {{ words() }} Wörter</p>
      </section>
    </ng-template>

    <!--
      What the shown speaker says at the preview time, as a bubble hanging from the portrait above
      (the pointer as in the Panelroom preview). The place for values that change over time.
    -->
    <ng-template #now>
      <section class="talk" aria-live="polite">
        <!-- A fixed height (four lines), so the profile below never moves while scrubbing. -->
        @if (turn(); as clip) {
          <p class="quote" tabindex="0" [class.live]="clip === speaking()"><span class="text">{{ clip.text }}</span></p>
          <h3>
            {{ clip === speaking() ? 'Sagt gerade' : 'Zuletzt gesagt' }}
            <span class="clock">{{ clockOf(clip.start) }}</span>
          </h3>
        } @else {
          <p class="quote"><span class="text">Hat an dieser Stelle noch nichts gesagt.</span></p>
          <h3>Bisher</h3>
        }
      </section>
    </ng-template>
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      --tray-h: 8rem;
    }
    .sheet {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-4);
      min-height: 0;
      padding: var(--space-5) var(--space-4);
      overflow: auto;
    }
    /* Never shrink to fit: a long profile would squeeze the rows above it, a short one not (the
       sheet jumped between participants and the moderator). It scrolls instead. */
    .sheet > * {
      flex-shrink: 0;
    }
    /* Room to scroll the last lines out from under the tray. */
    .sheet.with-tray {
      padding-bottom: calc(var(--tray-h) + 2 * var(--space-4));
    }
    .mode {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      justify-content: space-between;
      min-height: 2rem;
      margin: calc(-1 * var(--space-2)) 0 calc(-1 * var(--space-3));
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    header {
      display: flex;
      gap: var(--space-3);
      align-items: center;
    }
    /* A fixed height (name row + role row + two subtitle lines), so the pointer below always meets
       the portrait. */
    .title {
      flex: 1;
      min-width: 0;
      height: 5.625rem;
    }
    h2 {
      height: 1.75rem;
      margin: 0;
      font-size: var(--text-lg);
      line-height: 1.75rem;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    /* As high with a role badge as without one. */
    .role {
      display: flex;
      align-items: center;
      height: 1.25rem;
    }
    .role ds-role-badge {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
    }
    /* Filled, as on the moderator's track of the timeline. */
    .role ds-role-badge.moderator:not(:hover) {
      background: var(--color-surface-sunken);
    }
    .subtitle {
      height: calc(2 * 1.5em);
      line-height: 1.5;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    h3 {
      margin: 0 0 var(--space-1);
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    p {
      margin: 0;
    }
    .meta {
      color: var(--color-muted);
      font-size: var(--text-sm);
    }
    .avatar {
      position: relative;
      z-index: 1;
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border-radius: var(--radius-pill);
      background: var(--color-surface-sunken);
      color: var(--color-text);
      font-weight: 700;
      overflow: hidden;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar.moderator {
      background: var(--color-accent);
      color: var(--color-accent-contrast);
    }
    /* Speaking at the preview time: the red ring of the Panelroom frame. */
    .avatar.live {
      box-shadow: 0 0 0 3px var(--color-accent);
    }
    .avatar.stub {
      background: var(--color-surface-sunken);
      color: var(--color-muted);
    }
    /* The image scales down to fit whole (never cropped, never enlarged), left-aligned. */
    /* A white drawer across the bottom; the image's left edge lines up with the speech bubble's
       (sheet padding + half a portrait). */
    .tray {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      display: flex;
      align-items: flex-end;
      box-sizing: content-box;
      height: var(--tray-h);
      margin: 0;
      padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) + 1.5rem);
      background: var(--color-surface);
      /* A soft shadow along the top edge only: the drawer lies over the sheet. */
      box-shadow: 0 -0.5rem 1rem -0.5rem color-mix(in oklch, var(--color-text) 18%, transparent);
      pointer-events: none;
      transform: translateY(100%);
      opacity: 0;
      transition:
        transform var(--motion-base) var(--ease-standard),
        opacity var(--motion-base) var(--ease-standard);
    }
    .tray.open {
      transform: none;
      opacity: 1;
      pointer-events: auto;
    }
    .tray img {
      display: block;
      min-width: 0;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
      border-radius: var(--radius-md);
      box-shadow: var(--elevation-2);
    }
    .tray figcaption {
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--elevation-2);
      color: var(--color-muted);
      font-size: var(--text-sm);
    }

    /* The bubble hangs right below the portrait: its left edge starts under the portrait's centre,
       where the pointer's tip sits (as in the Panelroom preview). Label and clock go below it. */
    .talk {
      --tail-w: 2rem;
      /* From the bubble up through the small gap into the portrait (which covers the tip). The
         header is 5.625rem high (see .title), so the portrait ends 1.3125rem above its bottom. */
      --gap: var(--space-2);
      --tail-reach: calc(var(--gap) + 1.3125rem + 0.75rem);
      position: relative;
      display: grid;
      gap: var(--space-1);
      margin: calc(var(--gap) - var(--space-4)) 0 0 1.5rem;
    }
    .talk::before {
      content: '';
      position: absolute;
      left: 0;
      top: calc(-1 * var(--tail-reach));
      width: var(--tail-w);
      /* Down to the bubble's top edge, one pixel into it so no seam shows. */
      height: calc(var(--tail-reach) + 1px);
      background: var(--color-surface-sunken);
      clip-path: polygon(0 0, 100% 100%, 0 100%);
    }
    .talk h3 {
      display: flex;
      gap: var(--space-2);
      align-items: baseline;
      margin: 0;
      padding-left: var(--space-3);
    }
    .clock {
      font-family: var(--font-mono);
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
    }
    /* Four lines high; longer turns end in an ellipsis and scroll on hover or focus. The clamp sits
       on the inner text, so no fifth line peeks into the bubble's padding. */
    .quote {
      display: block;
      padding: var(--space-2) var(--space-3);
      border-radius: 0 var(--radius-md) var(--radius-md) var(--radius-md);
      background: var(--color-surface-sunken);
      color: var(--color-muted);
      font-size: var(--text-sm);
      line-height: 1.5;
    }
    .quote .text {
      height: calc(4 * 1.5em);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
    }
    .quote[tabindex]:hover .text,
    .quote[tabindex]:focus-visible .text {
      display: block;
      overflow-y: auto;
    }
    .quote.live {
      color: var(--color-text);
    }
    .body {
      display: grid;
      gap: var(--space-5);
    }
    .empty-head {
      font-size: var(--text-md);
    }
    .empty {
      padding: var(--space-3);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-muted);
      font-size: var(--text-sm);
    }
    .ocean {
      display: grid;
      grid-template-columns: auto minmax(6rem, 1fr);
      gap: var(--space-1) var(--space-3);
      margin: 0;
      font-size: var(--text-sm);
    }
    dd {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
    }
    .bar {
      flex: 1;
      height: 0.5rem;
      border-radius: var(--radius-pill);
      background: var(--color-surface-sunken);
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: var(--radius-pill);
      background: var(--color-accent);
    }
    .attributes {
      display: grid;
      gap: var(--space-1);
      margin: 0;
    }
    .attributes dt {
      color: var(--color-muted);
      font-size: var(--text-xs);
    }
    .attributes dd {
      margin: 0 0 var(--space-2);
    }
    @media (prefers-reduced-motion: reduce) {
      .tray {
        transition: none;
      }
    }
    .value {
      width: 2ch;
      color: var(--color-muted);
      font-size: var(--text-xs);
      text-align: right;
    }
  `,
})
export class PersonaDetail {
  /** The selected participant (null while following, or while the moderator is selected). */
  readonly participant = input.required<Participant | null>();
  readonly participants = input.required<Participant[]>();
  readonly transcript = input.required<Transcript>();
  readonly stimuli = input<Stimulus[]>([]);
  readonly moderatorName = input('Moderation');
  readonly moderatorImage = input<string | null>(null);
  readonly moderatorColor = input<string | null>(null);
  /** The badge on the moderator's track (a stand-in's own role in a recording). */
  readonly moderatorRole = input(MODERATOR_ROLE);
  /** Clears the selection: the pane follows the timeline again. */
  readonly closed = output<void>();

  protected readonly ui = inject(DiscussionUiState);
  protected readonly images = inject(BrokenImages);
  protected readonly traits = OCEAN_LABELS;
  private readonly time = computed(() => this.ui.previewTime());

  /** The turn at the preview time (as in the Panelroom preview), if someone speaks. */
  protected readonly speaking = computed(() => clipAt(this.transcript().clips, this.time()));
  /** The last turn begun by the preview time, so the pane stays put in the pauses between turns. */
  private readonly lastTurn = computed(() => lastTurnBy(this.transcript().clips, this.time()));

  /** The Panelroom preview already shows what is said: the pane then leaves the turn out. */
  protected readonly previewShown = computed(() => this.ui.previewOpen() && !this.ui.previewHidden());
  protected readonly following = computed(() => !this.ui.selectedParticipant());
  /** The pane shows the moderator: selected, or speaking last while following. */
  protected readonly moderating = computed(() =>
    this.following() ? !!this.lastTurn()?.moderator : this.ui.selectedParticipant() === MODERATOR_TRACK,
  );
  /** The participant the pane shows: the selected one, else the one who spoke last. */
  protected readonly shown = computed(() => {
    if (!this.following()) return this.participant() ?? undefined;
    const turn = this.lastTurn();
    return turn && !turn.moderator ? this.participants().find((p) => p.guid === turn.speakerGuid) : undefined;
  });
  /** What the header shows, for a participant and the moderator alike. */
  protected readonly head = computed<Head | null>(() => {
    const p = this.shown();
    if (p) {
      return {
        track: p.guid,
        name: p.name,
        role: p.role,
        subtitle: p.demographics ?? '',
        color: p.color,
        imageUrl: p.imageUrl,
        initials: p.initials,
        filled: p.filled,
        moderator: false,
        participant: p,
      };
    }
    if (!this.moderating()) return null;
    return {
      track: MODERATOR_TRACK,
      name: this.moderatorName(),
      role: this.moderatorRole(),
      subtitle: '',
      color: this.moderatorColor() ?? undefined,
      imageUrl: this.moderatorImage() ?? undefined,
      initials: 'MO',
      filled: true,
      moderator: true,
    };
  });
  /** The track of whoever speaks at the preview time (their portrait gets the red ring). */
  protected readonly speakingTrack = computed(() => {
    const clip = this.speaking();
    return clip ? trackOf(clip) : null;
  });

  /** The shown speaker's track: a participant's guid or the moderator's. */
  private readonly track = computed(() => (this.moderating() ? MODERATOR_TRACK : this.shown()?.guid));
  private readonly clips = computed(() => this.transcript().clips.filter((c) => trackOf(c) === this.track()));
  /** The shown speaker's last turn begun by the preview time. */
  protected readonly turn = computed(() => lastTurnBy(this.clips(), this.time()));
  /**
   * The stimulus to show. Following: the one up at the preview time, so the tray only moves when a
   * stimulus begins or ends (not on every change of speaker). Selected: the one up while the shown
   * turn was said, else at the preview time.
   */
  protected readonly stimulus = computed(() => {
    const at = this.following() ? this.time() : (this.turn()?.start ?? this.time());
    return this.stimuli().find((s) => s.start <= at && at <= s.end);
  });
  /** The tray exists once the study has stimuli and the Panelroom preview doesn't show them. */
  protected readonly hasTray = computed(() => this.stimuli().length > 0 && !this.previewShown());
  /** The stimulus to draw: the current one, else the last one, so the tray slides out with it. */
  protected readonly lastStimulus = linkedSignal<Stimulus | undefined, Stimulus | undefined>({
    source: this.stimulus,
    computation: (now, previous) => now ?? previous?.value,
  });
  protected readonly turns = computed(() => this.clips().length);
  protected readonly words = computed(() =>
    this.clips().reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0),
  );

  protected clockOf(seconds: number): string {
    return clockLabel(seconds);
  }
}

interface Head {
  track: string;
  name: string;
  role?: string;
  /** The persona's colour, for the role badge's outline. */
  color?: string;
  subtitle: string;
  imageUrl?: string;
  initials: string;
  filled: boolean;
  moderator: boolean;
  participant?: Participant;
}
