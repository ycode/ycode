/**
 * Layout File Utilities
 *
 * Helpers for the developer-only layouts API, which writes preview images to
 * /public and layout entries into lib/templates/layouts.ts. All user input
 * that reaches the filesystem or generated source must go through these.
 *
 * SERVER-ONLY: Uses Node.js path module.
 */

import 'server-only';

import path from 'path';

export const LAYOUT_PREVIEWS_DIR = path.join(process.cwd(), 'public', 'ycode', 'layouts', 'previews');

export const LAYOUT_PREVIEW_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.gif'];

const LAYOUT_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The layouts API rewrites source files, so it is only available in local
 * development or when developer mode is explicitly enabled.
 */
export function isLayoutsApiEnabled(): boolean {
  return process.env.NODE_ENV === 'development'
    || process.env.NEXT_PUBLIC_DEVELOPER_MODE === 'true';
}

export function isValidLayoutKey(key: unknown): key is string {
  return typeof key === 'string' && LAYOUT_KEY_PATTERN.test(key);
}

/**
 * Normalize an uploaded file's extension, returning null when it is not an allowed image type
 */
export function getLayoutPreviewExtension(filename: string): string | null {
  const extension = path.extname(filename).toLowerCase() || '.webp';
  return LAYOUT_PREVIEW_EXTENSIONS.includes(extension) ? extension : null;
}

/**
 * Resolve the preview image path for a layout, guaranteeing it stays inside the previews directory
 * @throws When the key or extension is invalid or the path escapes the directory
 */
export function getLayoutPreviewPath(layoutKey: string, extension: string): string {
  if (!isValidLayoutKey(layoutKey) || !LAYOUT_PREVIEW_EXTENSIONS.includes(extension)) {
    throw new Error('Invalid layout preview path');
  }

  const resolved = path.resolve(LAYOUT_PREVIEWS_DIR, `${layoutKey}${extension}`);
  if (path.dirname(resolved) !== LAYOUT_PREVIEWS_DIR) {
    throw new Error('Invalid layout preview path');
  }

  return resolved;
}

/**
 * Convert a JSON string literal (double-quoted) into an equivalent single-quoted one
 */
function jsonStringToSingleQuoted(jsonLiteral: string): string {
  const inner = jsonLiteral
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/'/g, '\\\'');
  return `'${inner}'`;
}

/**
 * Serialize a string as a safely escaped single-quoted TypeScript literal
 */
export function toTsStringLiteral(value: string): string {
  return jsonStringToSingleQuoted(JSON.stringify(value));
}

/**
 * Serialize a JSON-compatible value as TypeScript source using single-quoted strings
 */
export function toTsObjectLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/"(?:[^"\\]|\\.)*"/g, jsonStringToSingleQuoted);
}
