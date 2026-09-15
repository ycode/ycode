import { Mark, mergeAttributes } from '@tiptap/core';
import type { LinkSettings } from '@/types';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';

export interface RichTextLinkOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    richTextLink: {
      /**
       * Set a link mark with full LinkSettings
       */
      setRichTextLink: (settings: LinkSettings) => ReturnType;
      /**
       * Toggle a link mark
       */
      toggleRichTextLink: (settings: LinkSettings) => ReturnType;
      /**
       * Unset a link mark
       */
      unsetRichTextLink: () => ReturnType;
      /**
       * Update an existing link mark
       */
      updateRichTextLink: (settings: Partial<LinkSettings>) => ReturnType;
    };
  }
}

/**
 * Custom TipTap Link mark that stores full LinkSettings structure
 * Supports all link types: url, email, phone, asset, page, field
 * Plus anchor selection and link behavior (target, rel, download)
 */
export const RichTextLink = Mark.create<RichTextLinkOptions>({
  name: 'richTextLink',

  priority: 1000,

  keepOnSplit: false,

  inclusive: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      // Link type discriminator
      type: {
        default: 'url',
        parseHTML: (element) => element.getAttribute('data-link-type') || 'url',
        renderHTML: (attributes) => ({
          'data-link-type': attributes.type,
        }),
      },

      // URL link data (DynamicTextVariable structure)
      url: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-link-url');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            // Fallback: treat as plain URL
            return { type: 'dynamic_text', data: { content: attr } };
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.url) return {};
          return { 'data-link-url': JSON.stringify(attributes.url) };
        },
      },

      // Email link data
      email: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-link-email');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.email) return {};
          return { 'data-link-email': JSON.stringify(attributes.email) };
        },
      },

      // Phone link data
      phone: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-link-phone');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.phone) return {};
          return { 'data-link-phone': JSON.stringify(attributes.phone) };
        },
      },

      // Asset link data
      asset: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-link-asset');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.asset) return {};
          return { 'data-link-asset': JSON.stringify(attributes.asset) };
        },
      },

      // Page link data
      page: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-link-page');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.page) return {};
          return { 'data-link-page': JSON.stringify(attributes.page) };
        },
      },

      // Field link data (CMS field)
      field: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-link-field');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.field) return {};
          return { 'data-link-field': JSON.stringify(attributes.field) };
        },
      },

      // Anchor layer ID
      anchor_layer_id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-link-anchor') || null,
        renderHTML: (attributes) => {
          if (!attributes.anchor_layer_id) return {};
          return { 'data-link-anchor': attributes.anchor_layer_id };
        },
      },

      // Link target
      target: {
        default: null,
        parseHTML: (element) => element.getAttribute('target') || null,
        renderHTML: (attributes) => {
          if (!attributes.target) return {};
          return { target: attributes.target };
        },
      },

      // Download attribute (for asset links)
      download: {
        default: false,
        parseHTML: (element) => element.hasAttribute('download'),
        renderHTML: (attributes) => {
          if (!attributes.download) return {};
          return { download: '' };
        },
      },

      // Rel attribute
      rel: {
        default: null,
        parseHTML: (element) => element.getAttribute('rel') || null,
        renderHTML: (attributes) => {
          if (!attributes.rel) return {};
          return { rel: attributes.rel };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-link-type]',
      },
      {
        tag: 'a[href]',
        getAttrs: (element) => {
          const href = (element as HTMLElement).getAttribute('href');
          if (!href) return false;

          // Parse standard links
          if (href.startsWith('mailto:')) {
            return {
              type: 'email',
              email: { type: 'dynamic_text', data: { content: href.replace('mailto:', '') } },
            };
          }
          if (href.startsWith('tel:')) {
            return {
              type: 'phone',
              phone: { type: 'dynamic_text', data: { content: href.replace('tel:', '') } },
            };
          }

          // Default to URL type
          return {
            type: 'url',
            url: { type: 'dynamic_text', data: { content: href } },
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    // Build href based on link type for preview/editing display
    let href = '#';
    const type = mark.attrs.type;

    switch (type) {
      case 'url':
        if (mark.attrs.url?.data?.content) {
          href = mark.attrs.url.data.content;
        }
        break;
      case 'email':
        if (mark.attrs.email?.data?.content) {
          href = `mailto:${mark.attrs.email.data.content}`;
        }
        break;
      case 'phone':
        if (mark.attrs.phone?.data?.content) {
          href = `tel:${mark.attrs.phone.data.content}`;
        }
        break;
      case 'asset':
      case 'page':
      case 'field':
        // These are resolved at render time, show placeholder
        href = '#';
        break;
    }

    // Add rel for blank targets
    const rel = mark.attrs.rel || (mark.attrs.target === '_blank' ? 'noopener noreferrer' : null);

    // Use class from options if set (from createRichTextLinkExtension), otherwise fallback to DEFAULT_TEXT_STYLES
    const linkClass = this.options.HTMLAttributes?.class || DEFAULT_TEXT_STYLES.link?.classes || '';

    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        href,
        ...(rel ? { rel } : {}),
        class: `${linkClass} cursor-pointer`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setRichTextLink:
        (settings: LinkSettings) =>
          ({ commands }) => {
            return commands.setMark(this.name, settings);
          },

      toggleRichTextLink:
        (settings: LinkSettings) =>
          ({ commands }) => {
            return commands.toggleMark(this.name, settings);
          },

      unsetRichTextLink:
        () =>
          ({ commands }) => {
            return commands.unsetMark(this.name, { extendEmptyMarkRange: true });
          },

      updateRichTextLink:
        (settings: Partial<LinkSettings>) =>
          ({ commands, editor }) => {
            // Get current link attributes
            const currentAttrs = editor.getAttributes(this.name);
            // Merge with new settings
            const newAttrs = { ...currentAttrs, ...settings };
            return commands.setMark(this.name, newAttrs);
          },
    };
  },
});

// Re-export the render-safe attrs mapper (no Tiptap dependency) so existing
// builder imports keep working while public render paths import it directly
// from `./link-settings` to avoid bundling `@tiptap/core`.
export { getLinkSettingsFromMark } from './link-settings';

export default RichTextLink;
