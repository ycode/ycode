/**
 * Color variable (design token) helpers shared by the builder and imports.
 */

const COLOR_VAR_RE = /var\(--([^)\s]+)\)/g;

/**
 * Pull color-variable ids out of a class string. Classes reference tokens as
 * `var(--<id>)` (and `color:var(--<id>)`); callers filter these to ids that
 * actually exist in the color-variables store so Tailwind's own `--tw-*` vars
 * are ignored.
 */
export function colorVarIdsFromClasses(classes: string | string[] | undefined, out: Set<string>): void {
  if (!classes) return;
  const str = Array.isArray(classes) ? classes.join(' ') : classes;
  for (const match of str.matchAll(COLOR_VAR_RE)) {
    if (match[1]) out.add(match[1]);
  }
}

const COLOR_VAR_REF_RE = /(?:color:)?var\(--([^)\s]+)\)/g;

export type ClassSegment = { text: string } | { variableId: string; text: string };

/**
 * Split a class into plain text and color variable references
 * (`var(--<id>)` / `color:var(--<id>)`), to display tokens by name.
 */
export function splitColorVariableRefs(className: string): ClassSegment[] {
  const segments: ClassSegment[] = [];
  let last = 0;
  for (const match of className.matchAll(COLOR_VAR_REF_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: className.slice(last, index) });
    segments.push({ variableId: match[1], text: match[0] });
    last = index + match[0].length;
  }
  if (last < className.length) segments.push({ text: className.slice(last) });
  return segments;
}

/** Convert a stored color variable value (`#hex` or `#hex/opacity`) to a CSS color */
export function colorVariableToCss(value: string): string {
  const [hex, opacityPart] = value.split('/');
  if (opacityPart === undefined) return value;
  const opacity = parseInt(opacityPart) / 100;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
