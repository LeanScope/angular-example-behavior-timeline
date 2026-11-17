import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsButton } from '../../design-system';
import { BrandService } from '../../design-system/brand.service';
import { LeanScopeAuthService } from '../../leanscope/leanscope-auth.service';

/**
 * Sign-in with the user's LeanScope account. On success it goes on to `returnUrl` (set by
 * `authGuard`), else to the start page.
 */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DsButton],
  template: `
    <form class="card" [formGroup]="form" (ngSubmit)="signIn()">
      <div class="logos">
        @if (brand().wordmark; as wordmark) {
          <img class="logo" [src]="wordmark" [alt]="brand().name" />
        } @else {
          <img class="logo" [src]="brand().logo" [alt]="brand().name" />
        }
        <img class="leanscope" src="leanscope-logo.svg" alt="LeanScope" title="Built on LeanScope" />
      </div>
      <h1>Anmelden</h1>
      <p class="hint">Mit Ihrem LeanScope-Konto.</p>

      @if (!auth.configured) {
        <p class="error" role="alert">
          Die Anmeldung ist noch nicht eingerichtet. <a routerLink="/setup">Was fehlt?</a>
        </p>
      }

      <label for="login-email">E-Mail</label>
      <input #email id="login-email" type="email" formControlName="email" autocomplete="username" />

      <label for="login-password">Passwort</label>
      <input id="login-password" type="password" formControlName="password" autocomplete="current-password" />

      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      <button ds-button type="submit" [disabled]="form.invalid || busy() || !auth.configured">
        {{ busy() ? 'Anmelden …' : 'Anmelden' }}
      </button>
    </form>
    <p class="demo">
      Ohne Konto? <a routerLink="/" [queryParams]="{ demo: 'wahlplakate' }">Demo Wahlplakate ansehen</a>
    </p>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: min(100%, 26rem);
      place-content: center;
      gap: var(--space-4);
      min-height: 100dvh;
      padding: var(--space-4);
      background: linear-gradient(180deg, var(--color-bg) 0%, var(--color-surface-sunken) 100%);
    }
    .card {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-6);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--elevation-2);
    }
    .logos {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .logo {
      min-width: 0;
      width: auto;
      height: 2rem;
    }
    .leanscope {
      flex: none;
      width: auto;
      height: 2rem;
      opacity: 0.7;
    }
    h1 {
      margin: 0;
      font-size: var(--text-lg);
    }
    .hint {
      margin: 0 0 var(--space-3);
      color: var(--color-muted);
      font-size: var(--text-sm);
    }
    label {
      font-size: var(--text-sm);
      font-weight: 600;
    }
    input {
      min-height: 2.5rem;
      margin-bottom: var(--space-2);
      padding: 0 var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
    }
    .error {
      margin: 0 0 var(--space-2);
      color: var(--color-danger);
      font-size: var(--text-sm);
    }
    button {
      margin-top: var(--space-2);
    }
    .demo {
      margin: 0;
      color: var(--color-muted);
      font-size: var(--text-sm);
      text-align: center;
    }
    .demo a {
      color: var(--color-text);
    }
  `,
})
export class LoginPage {
  protected readonly auth = inject(LeanScopeAuthService);
  protected readonly brand = inject(BrandService).brand;
  private readonly router = inject(Router);

  /** Where to go after signing in (`?returnUrl=`, from `authGuard`). */
  readonly returnUrl = input<string | undefined>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly email = viewChild.required<ElementRef<HTMLInputElement>>('email');

  constructor() {
    // The e-mail field has the focus from the start: the user can type right away.
    afterNextRender(() => this.email().nativeElement.focus());
  }

  protected async signIn(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    try {
      await this.auth.signIn(email, password);
      const target = this.returnUrl()?.trim();
      // Only a path of this app: never follow a `returnUrl` that leads elsewhere.
      await this.router.navigateByUrl(target?.startsWith('/') && !target.startsWith('//') ? target : '/');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }
}
