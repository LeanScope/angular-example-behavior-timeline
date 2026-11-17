import { Injectable, linkedSignal, signal } from '@angular/core';
import type { PlaceId } from '../model/slots';
import type { Clip } from '../model/study.model';
import { nextTurnOf } from '../model/transcript-mapper';
import { COMPACT_QUERY, NO_PREVIEW_QUERY, SHORT_QUERY, mediaQuery } from '../shared/media-query';

export type DiscussionView = 'study' | 'discussion' | 'analysis';

/** The vertical zoom: a 2–4-word title per turn, the text on one line, the full text. */
export const DETAIL_LEVELS = ['Titel', 'Einzeilig', 'Volltext'] as const;
export type DetailLevel = 0 | 1 | 2;

/** What the user looks at: shared by the sidebar, the timeline, the preview and the detail pane. */
@Injectable()
export class DiscussionUiState {
  /** Small screen or portrait: no sidebars, only the stage. */
  readonly compact = mediaQuery(COMPACT_QUERY);
  /** Too little width for the Panelroom preview: no preview, no toggle. */
  readonly previewHidden = mediaQuery(NO_PREVIEW_QUERY);
  private readonly short = mediaQuery(SHORT_QUERY);
  readonly sidebarOpen = signal(true);
  /**
   * The Panelroom preview above the timeline, toggled in the header. Folded away by default on
   * short screens; the default applies again whenever the screen turns short or tall.
   */
  readonly previewOpen = linkedSignal(() => !this.short());
  /** The right-hand sidebar with the selected participant's profile (else the current speaker's). */
  readonly detailOpen = signal(false);
  /** The guide question open in the sidebar (one at a time). */
  readonly openQuestionKey = signal<string | null>(null);
  /** The participant whose profile the detail pane shows, or `MODERATOR_TRACK` for the moderator. */
  readonly selectedParticipant = signal<string | null>(null);
  /** Where the mouse is on the timeline (seconds), or null outside it. */
  readonly hoverTime = signal<number | null>(null);
  /** The timeline cursor (seconds): set by clicking the time axis. */
  readonly cursorTime = signal(0);
  readonly detailLevel = signal<DetailLevel>(1);
  /**
   * The place where the session's current question is answered (a drop zone or a track head),
   * highlighted until it is answered. Set by `SlotService`.
   */
  readonly askedPlace = signal<PlaceId | null>(null);

  /**
   * The guide question to scroll into view in the sidebar, without opening it. A new object on
   * every request, so a second click on the same badge scrolls again.
   */
  readonly revealedQuestion = signal<{ key: string } | null>(null);

  /** Scrolls a question into view in the sidebar (unfolding the sidebar), but leaves it closed. */
  revealQuestion(key: string): void {
    this.revealedQuestion.set({ key });
    this.sidebarOpen.set(true);
  }

  toggleQuestion(key: string): void {
    this.openQuestionKey.update((open) => (open === key ? null : key));
  }

  /** Selects a participant and unfolds the profile sidebar. */
  selectPersona(guid: string): void {
    this.selectedParticipant.set(guid);
    this.detailOpen.set(true);
  }

  /** Clears the selection: the profile sidebar follows the timeline's speaker again. */
  deselectPersona(): void {
    this.selectedParticipant.set(null);
  }

  /**
   * A click on a persona (Panelroom seat or track head): selects it and moves the cursor to its
   * next turn. A click on the selected persona deselects it.
   */
  togglePersona(guid: string, clips: Clip[]): void {
    if (this.selectedParticipant() === guid) return this.deselectPersona();
    this.selectPersona(guid);
    const turn = nextTurnOf(clips, guid, this.cursorTime());
    if (turn && !(turn.start <= this.cursorTime() && this.cursorTime() <= turn.end)) {
      this.cursorTime.set(turn.start);
    }
  }

  /** The time the preview shows: the hover position, else the cursor. */
  previewTime(): number {
    return this.hoverTime() ?? this.cursorTime();
  }
}
