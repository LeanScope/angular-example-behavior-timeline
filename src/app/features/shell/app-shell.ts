import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { DsStatus } from '../../design-system';
import { BrandService } from '../../design-system/brand.service';
import { LeanScopeAuthService } from '../../leanscope/leanscope-auth.service';
import { ShellContext } from './shell-context';

/**
 * The application shell: a header with the brand's logo and a breadcrumb, the page below it.
 *
 * Built to be removed: it is one parent route in app.routes.ts, pages never import it (they
 * only set `ShellContext.crumbs`), and in embedded mode (inside an iframe, or `?embedded`) it
 * renders nothing but the page.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, DsStatus],
  host: { '[class.embedded]': 'shell.embedded' },
  template: `
    @if (!shell.embedded) {
      <header class="header">
        <a routerLink="/" class="logo" [attr.aria-label]="brand().name + ' – Start'">
          @if (brand().wordmark; as wordmark) {
            <img [src]="wordmark" [alt]="brand().name" />
          } @else {
            <img class="mark" [src]="brand().logo" alt="" />
            <span class="name">{{ brand().name }}</span>
          }
        </a>
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a routerLink="/">Home</a>
          @for (crumb of shell.crumbs(); track $index; let last = $last) {
            <span class="separator" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M6.94 3.15l4.5 4.5a.5.5 0 0 1 0 .7l-4.5 4.5a.5.5 0 0 1-.71-.7L10.38 8 6.23 3.85a.5.5 0 0 1 .71-.7z" /></svg>
            </span>
            @if (last || !crumb.link) {
              <span class="current" [title]="crumb.label" [attr.aria-current]="last ? 'page' : null">{{ crumb.label }}</span>
            } @else {
              <a [routerLink]="crumb.link" [title]="crumb.label">{{ crumb.label }}</a>
            }
          }
        </nav>
        @if (shell.status(); as status) {
          <ds-status class="status" [state]="status.state" [label]="status.label" [title]="status.title ?? null" />
        }
        @if (auth.signedIn()) {
          <button type="button" class="sign-out" [title]="auth.email()" (click)="signOut()">Abmelden</button>
        }
        <img class="leanscope" src="leanscope-logo.svg" alt="LeanScope" title="Built on LeanScope" />
      </header>
    }
    <main class="content">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: grid;
      // One column, never wider than the window: an implicit column would grow to the page's
      // widest content and push the header's and the page's right edge out of the window.
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      height: 100dvh;
      background: linear-gradient(180deg, var(--color-bg) 0%, var(--color-surface-sunken) 100%);
    }
    :host(.embedded) {
      grid-template-rows: minmax(0, 1fr);
    }
    .header {
      display: flex;
      gap: var(--space-5);
      align-items: center;
      height: 4.5rem;
      padding: 0 var(--space-6);
      background: var(--color-surface);
      box-shadow: var(--elevation-2);
      position: relative;
      z-index: 40;
    }
    .logo {
      display: inline-flex;
      flex: none;
      gap: var(--space-2);
      align-items: center;
      min-width: 12rem;
      height: 2.3rem;
      color: var(--color-text);
      text-decoration: none;
    }
    .logo img {
      width: auto;
      height: 100%;
    }
    .logo .mark {
      height: 1.75rem;
    }
    .logo .name {
      font-size: var(--text-lg);
      font-weight: 700;
    }
    .breadcrumb {
      display: flex;
      flex: 1 1 auto;
      gap: var(--space-2);
      align-items: center;
      min-width: 0;
      font-size: var(--text-sm);
      white-space: nowrap;
    }
    .breadcrumb a,
    .current {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .breadcrumb a {
      flex: 0 1 auto;
      min-width: 2em;
      color: var(--color-muted);
      text-decoration: none;
    }
    .breadcrumb a:hover {
      text-decoration: underline;
    }
    .current {
      flex: 0 0.001 auto;
      min-width: 0;
      color: var(--color-text);
      font-weight: 600;
    }
    .separator {
      display: inline-flex;
      flex: none;
      color: var(--color-border);
    }
    .separator svg {
      width: 0.75rem;
      height: 0.75rem;
      fill: currentColor;
    }
    // Status light, sign-out and LeanScope logo share the right end: the first of them takes
    // the free space, whichever are shown.
    .status,
    .sign-out,
    .leanscope {
      margin-left: auto;
    }
    .status ~ .sign-out,
    .status ~ .leanscope,
    .sign-out ~ .leanscope {
      margin-left: 0;
    }
    .sign-out {
      flex: none;
      padding: var(--space-1) var(--space-2);
      border: 0;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--color-muted);
      font: inherit;
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .sign-out:hover {
      background: var(--color-surface-sunken);
      color: var(--color-text);
    }
    .leanscope {
      flex: none;
      width: auto;
      height: 2rem;
    }
    .content {
      min-width: 0;
      min-height: 0;
    }
    @media (max-width: 48rem) {
      .header {
        gap: var(--space-3);
        padding: 0 var(--space-4);
      }
      .logo {
        min-width: 0;
        height: 1.4rem;
      }
      .leanscope {
        height: 1.5rem;
      }
    }
  `,
})
export class AppShell {
  protected readonly shell = inject(ShellContext);
  protected readonly brand = inject(BrandService).brand;
  protected readonly auth = inject(LeanScopeAuthService);
  private readonly router = inject(Router);

  protected signOut(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
