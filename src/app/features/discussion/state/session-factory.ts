import { Injector, type Signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';
import { LeanScopeSessionService } from '../../../leanscope/leanscope-session.service';

/**
 * A session of its own. `LeanScopeSessionService` follows one session per instance, and the
 * page runs several side by side (one per drop, plus the discussion), so each gets a child
 * injector instead of the root instance.
 */
export function createSession(parent: Injector): LeanScopeSessionService {
  return Injector.create({ providers: [LeanScopeSessionService], parent }).get(
    LeanScopeSessionService,
  );
}

/** Resolves with the first value of `source` that passes `predicate`. */
export function when<T>(
  injector: Injector,
  source: () => T,
  predicate: (value: T) => boolean,
): Promise<T> {
  const value: Signal<T> = computed(source);
  return firstValueFrom(toObservable(value, { injector }).pipe(filter(predicate)));
}
