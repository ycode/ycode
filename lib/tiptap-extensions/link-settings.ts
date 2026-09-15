import type { LinkSettings } from '@/types';

/**
 * Extract LinkSettings from rich-text link mark attributes.
 *
 * This is a plain attrs mapper with no Tiptap/ProseMirror dependency, so it is
 * safe to import from published-page render paths (keeps `@tiptap/core` out of
 * the public bundle). The editor Mark that produces these attrs lives in
 * `rich-text-link.ts`.
 *
 * Tolerates the legacy `{ href, linkType }` shape (older MCP-authored links) by
 * mapping a bare `href` into the canonical url variable structure.
 */
export function getLinkSettingsFromMark(attrs: Record<string, any>): LinkSettings {
  const legacyUrl = !attrs.url && typeof attrs.href === 'string' && attrs.href
    ? { type: 'dynamic_text' as const, data: { content: attrs.href } }
    : undefined;

  return {
    type: attrs.type || attrs.linkType || 'url',
    url: attrs.url || legacyUrl || undefined,
    email: attrs.email || undefined,
    phone: attrs.phone || undefined,
    asset: attrs.asset || undefined,
    page: attrs.page || undefined,
    field: attrs.field || undefined,
    anchor_layer_id: attrs.anchor_layer_id || undefined,
    target: attrs.target || undefined,
    download: attrs.download || false,
    rel: attrs.rel || undefined,
  };
}
