import type { Step } from '../../../leanscope/agent-server.types';
import { answerText } from '../../../leanscope/ui/transcript';

/** One question the user asked in the session, with the analyst's answer once it is there. */
export interface Exchange {
  /** The guid of the human step that holds the question. */
  id: string;
  question: string;
  /** The analyst's raw answer (text plus an optional finding block); null while it works on it. */
  answer: string | null;
}

export interface SessionView {
  /** Answered questions, oldest first. */
  exchanges: Exchange[];
  /** The last question, when the analyst hasn't answered it yet. */
  thinking: Exchange | null;
}

/**
 * Reads the questions and answers from the session's steps.
 *
 * The choreo loops: the user's step holds the question (`{"message":"…"}`), and the analyst's
 * answer is the step right before the user's next step (its `predecessorRefs[0]`). The step
 * before the first user step is the greeting.
 */
export function exchangesFromSteps(steps: Step[], pendingGuid: string | null): SessionView {
  const byGuid = new Map(steps.map((s) => [s.guid, s]));
  // Empty user steps that aren't pending are leftovers of earlier turns: skip them, as the server does.
  const humans = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => isHuman(step) && (!!step.line?.trim() || step.guid === pendingGuid));

  const exchanges: Exchange[] = [];
  let thinking: Exchange | null = null;
  humans.forEach(({ step, index }, i) => {
    if (!step.line?.trim()) return; // the open question form, not a question yet
    const next = humans[i + 1];
    const question = answerText(step.line);
    if (!next) {
      thinking = { id: step.guid, question, answer: null };
      return;
    }
    const answer = answerBefore(next.step, byGuid) ?? lastAgentLine(steps, index, next.index);
    if (answer === null) thinking = { id: step.guid, question, answer: null };
    else exchanges.push({ id: step.guid, question, answer });
  });
  return { exchanges, thinking };
}

function isHuman(step: Step): boolean {
  return step.actorSymbolRef === 'human';
}

/** The analyst's line the user's step follows (`predecessorRefs[0]`), when there is one. */
function answerBefore(human: Step, byGuid: Map<string, Step>): string | null {
  const before = byGuid.get(human.predecessorRefs?.[0] ?? '');
  return before && !isHuman(before) && before.line?.trim() ? before.line : null;
}

/** Fallback without predecessor links: the last analyst line between two user steps. */
function lastAgentLine(steps: Step[], from: number, to: number): string | null {
  for (let i = to - 1; i > from; i--) {
    const step = steps[i];
    if (!isHuman(step) && step.line?.trim()) return step.line;
  }
  return null;
}
