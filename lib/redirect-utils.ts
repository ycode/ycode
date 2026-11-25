import type { Redirect } from '@/types';

/**
 * Convert legacy PCRE-style substitution tokens to JS `String.replace` tokens.
 * The UI documents `$0` as the full matched path (PHP `preg_replace` behavior),
 * but JS uses `$&` for the full match. `$1`+ capture groups are left untouched.
 */
function normalizeReplacementTokens(replacement: string): string {
  return replacement.replace(/\$0/g, '$$&');
}

function normalizeOldUrl(oldUrl: string): string {
  return oldUrl.startsWith('/') ? oldUrl : '/' + oldUrl;
}

function isPatternUrl(oldUrl: string): boolean {
  return oldUrl.includes('.+') || oldUrl.includes('.*');
}

function redirectTarget(redirect: Redirect): string {
  return `${redirect.type || '301'} ${redirect.newUrl}`;
}

/** Target of each exact source path; the first entry wins, as in matchRedirect. */
function exactTargets(redirects: Redirect[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const r of redirects) {
    const path = normalizeOldUrl(r.oldUrl);
    if (!isPatternUrl(path) && !targets.has(path)) targets.set(path, redirectTarget(r));
  }
  return targets;
}

/** Ordered pattern redirects, which matchRedirect tries in sequence. */
function patternSignature(redirects: Redirect[]): string {
  return redirects
    .filter(r => isPatternUrl(normalizeOldUrl(r.oldUrl)))
    .map(r => `${normalizeOldUrl(r.oldUrl)} ${redirectTarget(r)}`)
    .join('\n');
}

/**
 * Request paths whose redirect differs between two redirect lists, so only
 * those routes need purging. Returns null when a pattern redirect changed:
 * the affected paths can't be listed.
 */
export function getChangedRedirectPaths(
  previous: Redirect[] | null | undefined,
  next: Redirect[] | null | undefined,
): string[] | null {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(next) ? next : [];

  if (patternSignature(before) !== patternSignature(after)) return null;

  const beforeTargets = exactTargets(before);
  const afterTargets = exactTargets(after);
  const changed = new Set<string>();
  for (const path of new Set([...beforeTargets.keys(), ...afterTargets.keys()])) {
    if (beforeTargets.get(path) !== afterTargets.get(path)) changed.add(path);
  }
  return [...changed];
}

/**
 * Match a request path against configured redirects.
 * Exact string matches take priority, then regex patterns (`.+`, `.*`).
 * Ported from legacy CustomDomain::getRedirectedUrl behavior.
 */
export function matchRedirect(
  currentPath: string,
  redirects: Redirect[],
): Redirect | null {
  const exactMatches: Redirect[] = [];
  const regexMatches: Redirect[] = [];

  for (const r of redirects) {
    const oldUrl = normalizeOldUrl(r.oldUrl);

    if (isPatternUrl(oldUrl)) {
      regexMatches.push({ ...r, oldUrl });
    } else {
      exactMatches.push({ ...r, oldUrl });
    }
  }

  for (const r of exactMatches) {
    if (r.oldUrl === currentPath) {
      return r;
    }
  }

  for (const r of regexMatches) {
    try {
      const escapedPattern = r.oldUrl.replace(/\?/g, '\\?');
      const regex = new RegExp(`^${escapedPattern}$`);

      if (regex.test(currentPath)) {
        const newUrl = currentPath.replace(regex, normalizeReplacementTokens(r.newUrl));
        return { ...r, newUrl };
      }
    } catch {
      // Invalid regex pattern — skip
    }
  }

  return null;
}
