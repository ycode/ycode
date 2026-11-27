/**
 * Agentic Resource Discovery (ARD) manifest helpers.
 * See: https://agenticresourcediscovery.org/spec/
 */

export const ARD_JSON_SETTING_KEY = 'ard_json';

/**
 * Validate ard.json content: a JSON string from Settings or an object set
 * through MCP. Empty content is valid (nothing is served).
 * @returns An error message, or null when the content can be saved
 */
export function getArdManifestError(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return null;
  }

  let manifest: unknown;
  try {
    manifest = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    return `ard.json is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`;
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return 'ard.json must be a JSON object';
  }

  if (!Array.isArray((manifest as { entries?: unknown }).entries)) {
    return 'ard.json must have an "entries" array';
  }

  return null;
}

/**
 * Serialize a stored manifest for the response body.
 * @returns The JSON text, or null when there is nothing to serve
 */
export function serializeArdManifest(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return null;
}
