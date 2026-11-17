import { Routes } from '@angular/router';
import { HomePage } from './pages/home/home-page';
import { StarterLayout } from './pages/layout/starter-layout';
import { AppShell } from './features/shell/app-shell';
import { authGuard } from './leanscope/auth.guard';
import { demoOrAuthGuard } from './features/discussion/demo';

export const routes: Routes = [
  {
    // Sign-in with the user's LeanScope account. `authGuard` sends everyone here first, except
    // in a file demo (see `demoOrAuthGuard`).
    path: 'login',
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
    title: 'Anmelden',
  },
  {
    // The app shell (header with logo and breadcrumb). To drop it, replace this route
    // by its children. Embedded in an iframe it steps aside on its own (see ShellContext).
    path: '',
    pathMatch: 'full',
    component: AppShell,
    // A file demo (`npm run demo:wahlplakate`, or `?demo=wahlplakate` as linked from the login)
    // opens without a login.
    canActivate: [demoOrAuthGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/discussion/discussion-page').then((m) => m.DiscussionPage),
        title: 'Gruppendiskussion',
      },
    ],
  },
  {
    // The starter's pages: what is missing in the setup, and a generic session view.
    path: '',
    component: StarterLayout,
    children: [
      { path: 'setup', component: HomePage, title: 'Setup · LeanScope MVP' },
      {
        path: 'session',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/session/session-page').then((m) => m.SessionPage),
        title: 'Session · LeanScope MVP',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
