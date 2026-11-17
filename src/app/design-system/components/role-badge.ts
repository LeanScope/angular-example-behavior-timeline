import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A small uppercase badge for a persona's role: muted text in a pill outline. The outline takes the
 * persona's colour when there is one, and the subtle default otherwise. On hover it fills with that
 * colour, and its tooltip shows the full role. The same look is available as the global
 * `.role-badge` class for DOM built outside Angular (set `--role-color` and `--role-ink` there).
 */
@Component({
  selector: 'ds-role-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ role() }}`,
  host: {
    class: 'role-badge',
    '[attr.title]': 'role()',
    '[style.--role-color]': 'color() || null',
    '[style.--role-ink]': 'color() ? ink(color()!) : null',
  },
})
export class DsRoleBadge {
  readonly role = input.required<string>();
  /** The persona's colour for the outline (any CSS colour). */
  readonly color = input<string | null | undefined>();
  protected readonly ink = inkOn;
}

const LIGHT = 'var(--color-accent-contrast)';
const DARK = 'var(--color-text)';

/** Dark text or the light contrast token, whichever reads better on `color` (hex only; else light). */
export function inkOn(color: string): string {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return LIGHT;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? DARK : LIGHT;
}
