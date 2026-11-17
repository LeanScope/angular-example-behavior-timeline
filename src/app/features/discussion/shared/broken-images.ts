import { Injectable, signal } from '@angular/core';

/**
 * Image URLs that failed to load, so an avatar can fall back to the initials. A persona's image
 * may be a public-catalog match URL (`…/resources/public/match?kind=image&q=…`), which the agent
 * server answers with an error while it cannot match; the avatar then shows the initials instead
 * of a broken image.
 */
@Injectable({ providedIn: 'root' })
export class BrokenImages {
  private readonly urls = signal<ReadonlySet<string>>(new Set());

  /** The URL if it may still load, else undefined. */
  usable(url: string | null | undefined): string | undefined {
    return url && !this.urls().has(url) ? url : undefined;
  }

  markBroken(url: string): void {
    if (this.urls().has(url)) return;
    this.urls.update((set) => new Set(set).add(url));
  }
}
