import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { StarterLayout } from './pages/layout/starter-layout';

describe('App', () => {
  it('renders the router outlet', async () => {
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
  });

  it('frames the starter pages', async () => {
    TestBed.configureTestingModule({ imports: [StarterLayout], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(StarterLayout);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.brand')?.textContent).toContain(
      'LeanScope MVP',
    );
  });
});
