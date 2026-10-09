/**
 * Color utility helpers shared between the CSS variable generator,
 * the color picker, and the variables store.
 */

/**
 * Convert a stored color value to a CSS-ready string.
 * Supports `#hex/opacityPercent` (e.g. `#FF0000/50`) by converting to `rgba()`.
 * Pass-through for any other format (named colors, `var(...)`, etc.).
 */
export function toCssColorValue(value: string): string {
  const parts = value.split('/');
  if (parts.length < 2) return value;

  const hex = parts[0];
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return value;

  const opacity = parseInt(parts[1], 10) / 100;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
