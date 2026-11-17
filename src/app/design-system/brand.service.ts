import { DOCUMENT } from '@angular/common';
import { Injectable, inject, isDevMode, signal } from '@angular/core';
import { APP_ENV } from '../features/app-env';

export interface Brand {
  id: string;
  name: string;
  logo: string;
  /** Logo with the brand's name (for the app shell's header). Without it, the shell shows logo + name. */
  wordmark?: string;
  locale: string;
  reportFooter: string;
  /** The browser tab's icon. */
  favicon?: string;
  /**
   * SVG whose first <path> is the busy animation's line (`app-loading-line`): an absolute `M`
   * followed by `C` pieces; its `stroke-width` is the line's width.
   */
  busyLine?: string;
}

/** The busy animation's line, read from the brand's `busyLine` SVG. */
export interface BusyLine {
  path: string;
  strokeWidth: number;
}

const FALLBACK: Brand = {
  id: 'default',
  name: 'Gruppendiskussion',
  logo: 'brands/default/logo.svg',
  locale: 'de',
  reportFooter: '',
  favicon: 'favicon.ico',
  busyLine: 'brands/default/busy-line.svg',
};
const ID = /^[a-z0-9-]+$/;

/**
 * Loads the brand pack public/brands/<id>/ (brand.json + brand.css) and marks <html data-brand>.
 * The id comes from APP_BRAND in `.env`; in dev, `?brand=<id>` overrides it for demos.
 */
@Injectable({ providedIn: 'root' })
export class BrandService {
  private readonly doc = inject(DOCUMENT);
  private readonly env = inject(APP_ENV);
  private readonly _brand = signal<Brand>(FALLBACK);
  private readonly _busyLine = signal<BusyLine | null>(null);

  readonly brand = this._brand.asReadonly();
  /** The brand's busy line; null while it loads or when the brand has none that can be read. */
  readonly busyLine = this._busyLine.asReadonly();

  /** Called once at startup (provideAppInitializer). Never fails the app: falls back to default. */
  async init(): Promise<void> {
    const fromUrl = isDevMode()
      ? new URLSearchParams(this.doc.location?.search ?? '').get('brand')
      : null;
    const id =
      [fromUrl, this.env.brand, 'default'].find((v): v is string => !!v && ID.test(v)) ??
      'default';
    await this.apply(id);
  }

  async apply(id: string): Promise<void> {
    const brand = await this.loadJson(id);
    this.doc.documentElement.dataset['brand'] = brand.id;
    this.doc.documentElement.lang = brand.locale;
    this.setFavicon(brand.favicon);
    const [, busyLine] = await Promise.all([this.loadCss(brand.id), this.loadBusyLine(brand.busyLine)]);
    this._busyLine.set(busyLine);
    this._brand.set(brand);
  }

  private setFavicon(href: string | undefined): void {
    if (!href) return;
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.rel = 'icon';
      this.doc.head.appendChild(link);
    }
    link.removeAttribute('type');
    link.href = href;
  }

  private async loadBusyLine(url: string | undefined): Promise<BusyLine | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return parseBusyLine(await res.text());
    } catch {
      return null;
    }
  }

  private async loadJson(id: string): Promise<Brand> {
    try {
      const res = await fetch(`brands/${id}/brand.json`);
      if (!res.ok) throw new Error(String(res.status));
      return { ...FALLBACK, ...((await res.json()) as Partial<Brand>), id };
    } catch {
      return id === 'default' ? FALLBACK : this.loadJson('default');
    }
  }

  private loadCss(id: string): Promise<void> {
    const old = this.doc.getElementById('brand-css');
    const link = this.doc.createElement('link');
    link.id = 'brand-css';
    link.rel = 'stylesheet';
    link.href = `brands/${id}/brand.css`;
    return new Promise((resolve) => {
      link.onload = link.onerror = () => {
        old?.remove();
        resolve();
      };
      this.doc.head.appendChild(link);
    });
  }
}

/** The first <path> of a busy-line SVG: its `d` and `stroke-width` (default 2.64). Null if none. */
export function parseBusyLine(svg: string): BusyLine | null {
  const path = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path');
  const d = path?.getAttribute('d')?.trim();
  if (!d) return null;
  const width = Number(path?.getAttribute('stroke-width'));
  return { path: d, strokeWidth: width > 0 ? width : 2.64 };
}
