// Brand guardrail: keeps the app OEM-brandable. Component code under src/app/features/ and
// src/app/design-system/ must take colours and fonts from design tokens, never hard-code them.
// Only src/app/design-system/tokens.scss and the brand packs in public/brands/ may hold raw values.
// Runs before the unit tests (npm test).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/app/features', 'src/app/design-system'];
const ALLOWED = new Set(['src/app/design-system/tokens.scss']);
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
const RAW_FONT = /font-family\s*:(?!\s*var\()/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|scss|html|css)$/.test(name) && !name.endsWith('.spec.ts')) yield path;
  }
}

const problems = [];
for (const dir of DIRS) {
  for (const path of walk(join(root, dir))) {
    const rel = relative(root, path);
    if (ALLOWED.has(rel)) continue;
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // `brand-ok` in a comment: an allowed escape hatch for a line that must hold a raw value
        if (line.includes('brand-ok')) return;
        const code = line
          .replace(/\/\/.*$/, '')
          .replace(/\/\*.*?\*\//g, '')
          // colour math on tokens is fine: color-mix(in oklch, var(--x) 20%, transparent)
          .replace(/color-mix\(in \w+/g, 'color-mix(');
        if (RAW_COLOUR.test(code) || RAW_FONT.test(code)) problems.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
}

if (problems.length) {
  console.error('Brand guardrail: use design tokens (var(--color-…), var(--font-sans)) instead of raw values:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Brand guardrail: no raw colours or fonts in components.');
