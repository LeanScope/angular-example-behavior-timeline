import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppShell } from './app-shell';
import { LeanScopeAuthService } from '../../leanscope/leanscope-auth.service';
import { ShellContext } from './shell-context';

async function render(embedded: boolean) {
  TestBed.configureTestingModule({
    imports: [AppShell],
    providers: [
      provideRouter([]),
      { provide: LeanScopeAuthService, useValue: { signedIn: () => true, email: () => 'a@b.de', signOut: () => undefined } },
    ],
  });
  const context = TestBed.inject(ShellContext);
  Object.defineProperty(context, 'embedded', { value: embedded });
  context.crumbs.set([{ label: 'Gruppendiskussion', link: '/' }, { label: 'Leitfaden Flusskreuzfahrt' }]);
  const fixture = TestBed.createComponent(AppShell);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('AppShell', () => {
  it('shows the header with logo and breadcrumb around the page', async () => {
    const el = await render(false);
    expect(el.querySelector('.header .logo')).not.toBeNull();
    const crumbs = [...el.querySelectorAll('.breadcrumb a, .breadcrumb .current')].map((c) => c.textContent?.trim());
    expect(crumbs).toEqual(['Home', 'Gruppendiskussion', 'Leitfaden Flusskreuzfahrt']);
    expect(el.querySelector('[aria-current=page]')?.textContent).toContain('Leitfaden');
    expect(el.querySelector('.sign-out')?.textContent).toContain('Abmelden');
    expect(el.querySelector('router-outlet')).not.toBeNull();
  });

  it('steps aside when embedded: only the page', async () => {
    const el = await render(true);
    expect(el.querySelector('.header')).toBeNull();
    expect(el.querySelector('router-outlet')).not.toBeNull();
  });
});

describe('ShellContext', () => {
  it('is not embedded in a top-level window without ?embedded', () => {
    expect(TestBed.inject(ShellContext).embedded).toBe(false);
  });
});
