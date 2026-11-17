import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { LeanScopeAuthService } from './leanscope-auth.service';

/**
 * Lets a signed-in user through and sends everyone else to `/login?returnUrl=…`.
 *
 * A URL with `?sessionToken=…` passes without a login: the app then only follows a session
 * someone else created, and that token authorizes every session route.
 */
export const authGuard: CanActivateFn = (route, state) => {
  if (inject(LeanScopeAuthService).signedIn() || route.queryParamMap.get('sessionToken')?.trim()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
