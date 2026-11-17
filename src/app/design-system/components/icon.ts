import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// A small inline icon set (24px grid, stroke = currentColor), so icons follow the brand colour.
const PATHS: Record<string, string> = {
  send: 'M5 12h13M13 6l6 6-6 6',
  pin: 'M12 17v4M8 3h8l-1 6 3 3H6l3-3-1-6z',
  unpin: 'M12 17v4M8 3h8l-1 6 3 3H6l3-3-1-6zM4 4l16 16',
  close: 'M6 6l12 12M18 6L6 18',
  'panel-left-close': 'M3 4h18v16H3zM9 4v16M16 9l-3 3 3 3',
  'panel-left-open': 'M3 4h18v16H3zM9 4v16M14 9l3 3-3 3',
  'panel-right-close': 'M3 4h18v16H3zM15 4v16M8 9l3 3-3 3',
  'panel-right-open': 'M3 4h18v16H3zM15 4v16M10 9l-3 3 3 3',
  'panel-top-close': 'M3 4h18v16H3zM3 10h18M9 16l3-3 3 3',
  'panel-top-open': 'M3 4h18v16H3zM3 10h18M9 13l3 3 3-3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12l5 5L20 7',
  'more-vertical': 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  'text-lines': 'M4 6h16M4 10h16M4 14h16M4 18h10',
  'text-line': 'M4 12h16',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
  table: 'M4 5h16v14H4zM4 10h16M10 5v14',
  chart: 'M5 19V9m7 10V5m7 14v-7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  board: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  report: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  back: 'M15 6l-6 6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  segment: 'M12 3a9 9 0 1 0 9 9h-9z M14 3.3A9 9 0 0 1 20.7 10H14z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  // Variable icons (outline, drawn in the style of Lucide, ISC licence).
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  'map-pin': 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  car: 'M5 17h14v-5l-2-5H7l-2 5zM5 12h14M7.5 17v2M16.5 17v2M8 14.5h.01M16 14.5h.01',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  leaf: 'M5 20c0-9 6-15 15-15 0 9-6 15-15 15zM5 20l8-8',
  smartphone: 'M7 2h10v20H7zM11 18h2',
  euro: 'M18 6.5A7 7 0 1 0 18 17.5M4 10h9M4 14h9',
  home: 'M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6',
  briefcase: 'M3 7h18v13H3zM8 7V4h8v3M3 12h18',
  'thumbs-up': 'M7 10v11H3V10zM7 10l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7',
  repeat: 'M4 11V9a3 3 0 0 1 3-3h13M16 2l4 4-4 4M20 13v2a3 3 0 0 1-3 3H4M8 22l-4-4 4-4',
  message: 'M4 5h16v11H9l-5 4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  book: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
  graduation: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  'check-square': 'M4 4h16v16H4zM8 12l3 3 5-6',
  hash: 'M5 9h15M4 15h15M10 3L8 21M16 3l-2 18',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01',
};

/** An icon as an SVG element, for DOM that Angular doesn't render (e.g. vis-timeline labels). */
export function iconSvg(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS['info']);
  svg.append(path);
  return svg;
}

@Component({
  selector: 'ds-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
  styles: `
    :host {
      display: inline-flex;
      width: 1.15em;
      height: 1.15em;
      flex: none;
    }
    svg {
      width: 100%;
      height: 100%;
      /* Outline icons; a filled one (Play on a button) sets --icon-fill. */
      fill: var(--icon-fill, none);
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class DsIcon {
  readonly name = input.required<string>();
  protected readonly d = computed(() => PATHS[this.name()] ?? PATHS['info']);
}
