import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LeanScopeSessionService } from '../../leanscope/leanscope-session.service';
import { PendingStepForm } from '../../leanscope/ui/pending-step-form';
import { DiscussionService } from './state/discussion.service';

/**
 * What the discussion choreo asks the user, if anything. The form below answers the discussion's
 * own session (not the root one), so it is provided here.
 */
@Component({
  selector: 'app-discussion-question',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PendingStepForm],
  providers: [
    { provide: LeanScopeSessionService, useFactory: () => inject(DiscussionService).session },
  ],
  template: `
    @if (discussion.pendingQuestion(); as question) {
      <p class="ask">{{ question.question || 'Die Moderation braucht eine Angabe von Ihnen.' }}</p>
      <ls-pending-step-form [question]="question" [busy]="busy()" (answered)="answer($event)" />
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
    }
    .ask {
      margin: 0;
      font-weight: 600;
    }
  `,
})
export class DiscussionQuestion {
  protected readonly discussion = inject(DiscussionService);
  protected readonly busy = signal(false);

  protected async answer(value: Record<string, unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await this.discussion.answer(value);
    } finally {
      this.busy.set(false);
    }
  }
}
