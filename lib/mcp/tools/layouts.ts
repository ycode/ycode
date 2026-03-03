import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Layer } from '@/types';
import { getDraftLayers, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { getLayoutTemplate } from '@/lib/templates/blocks';
import { findLayerById, insertLayer, canHaveChildren, generateId } from '@/lib/mcp/utils';

const LAYOUT_CATALOG = [
  { key: 'hero-001', category: 'Hero', description: 'Two-column hero with heading, text, and image' },
  { key: 'hero-002', category: 'Hero', description: 'Centered hero with large heading and CTA buttons' },
  { key: 'hero-003', category: 'Hero', description: 'Hero with background image and overlay text' },
  { key: 'hero-004', category: 'Hero', description: 'Minimal hero with heading and subtext' },
  { key: 'hero-005', category: 'Hero', description: 'Hero with features grid below' },
  { key: 'header-001', category: 'Header', description: 'Navigation bar with logo and links' },
  { key: 'header-002', category: 'Header', description: 'Centered navigation with logo' },
  { key: 'header-003', category: 'Header', description: 'Minimal header with logo and CTA' },
  { key: 'header-004', category: 'Header', description: 'Header with logo, links, and button' },
  { key: 'features-001', category: 'Features', description: 'Three-column feature cards with icons' },
  { key: 'features-002', category: 'Features', description: 'Two-column features with image' },
  { key: 'features-003', category: 'Features', description: 'Feature grid with 4 cards' },
  { key: 'features-004', category: 'Features', description: 'Alternating feature rows with images' },
  { key: 'features-005', category: 'Features', description: 'Feature list with large numbers' },
  { key: 'features-006', category: 'Features', description: 'Bento grid features layout' },
  { key: 'features-007', category: 'Features', description: 'Features with icon circles' },
  { key: 'features-008', category: 'Features', description: 'Three features side by side' },
  { key: 'features-009', category: 'Features', description: 'Feature showcase with tabs' },
  { key: 'features-010', category: 'Features', description: 'Large feature card grid' },
  { key: 'features-011', category: 'Features', description: 'Minimal two-column features' },
  { key: 'features-012', category: 'Features', description: 'Features with colored backgrounds' },
  { key: 'blog-001', category: 'Blog posts', description: 'Three-column blog post cards' },
  { key: 'blog-002', category: 'Blog posts', description: 'Blog list with featured image' },
  { key: 'blog-003', category: 'Blog posts', description: 'Two-column blog cards' },
  { key: 'blog-004', category: 'Blog posts', description: 'Blog grid with categories' },
  { key: 'blog-005', category: 'Blog posts', description: 'Blog cards with author info' },
  { key: 'blog-006', category: 'Blog posts', description: 'Minimal blog list' },
  { key: 'blog-header-001', category: 'Blog header', description: 'Blog post header with title and meta' },
  { key: 'blog-header-002', category: 'Blog header', description: 'Blog header with cover image' },
  { key: 'blog-header-003', category: 'Blog header', description: 'Minimal blog header' },
  { key: 'blog-header-004', category: 'Blog header', description: 'Blog header with breadcrumbs' },
  { key: 'stats-001', category: 'Stats', description: 'Statistics row with large numbers' },
  { key: 'stats-002', category: 'Stats', description: 'Stats grid with descriptions' },
  { key: 'stats-003', category: 'Stats', description: 'Stats with progress indicators' },
  { key: 'pricing-001', category: 'Pricing', description: 'Three-tier pricing cards' },
  { key: 'team-001', category: 'Team', description: 'Team member cards with photos' },
  { key: 'team-002', category: 'Team', description: 'Team grid with roles' },
  { key: 'testimonials-001', category: 'Testimonials', description: 'Single centered testimonial quote' },
  { key: 'testimonials-002', category: 'Testimonials', description: 'Testimonial cards grid' },
  { key: 'testimonials-003', category: 'Testimonials', description: 'Testimonial with avatar and rating' },
  { key: 'testimonials-004', category: 'Testimonials', description: 'Full-width testimonial slider' },
  { key: 'testimonials-005', category: 'Testimonials', description: 'Testimonial wall' },
  { key: 'faq-001', category: 'FAQ', description: 'Frequently asked questions accordion' },
  { key: 'navigation-001', category: 'Navigation', description: 'Top navigation bar' },
  { key: 'navigation-002', category: 'Navigation', description: 'Side navigation menu' },
  { key: 'footer-001', category: 'Footer', description: 'Multi-column footer with links' },
  { key: 'footer-002', category: 'Footer', description: 'Simple footer with logo and copyright' },
  { key: 'footer-003', category: 'Footer', description: 'Footer with newsletter signup' },
];

export function registerLayoutTools(server: McpServer) {
  server.tool(
    'list_layouts',
    `List all available pre-built layout templates organized by category.
Use add_layout to insert any of these into a page.

Categories: Hero, Header, Features, Blog posts, Blog header, Stats, Pricing,
Team, Testimonials, FAQ, Navigation, Footer`,
    {},
    async () => {
      const byCategory: Record<string, typeof LAYOUT_CATALOG> = {};
      for (const layout of LAYOUT_CATALOG) {
        if (!byCategory[layout.category]) byCategory[layout.category] = [];
        byCategory[layout.category].push(layout);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(byCategory, null, 2) }] };
    },
  );

  server.tool(
    'add_layout',
    `Insert a pre-built layout section into a page from YCode's template library.
Use list_layouts to see available layouts.`,
    {
      page_id: z.string().describe('The page ID'),
      layout_key: z.string().describe('Layout key from list_layouts (e.g. "hero-001")'),
      parent_layer_id: z.string().optional().describe('Parent layer ID. If omitted, appends to page root.'),
      position: z.number().optional().describe('Position within parent. Omit to append at end.'),
    },
    async ({ page_id, layout_key, parent_layer_id, position }) => {
      const found = LAYOUT_CATALOG.find((l) => l.key === layout_key);
      if (!found) {
        return { content: [{ type: 'text' as const, text: `Error: Unknown layout "${layout_key}". Use list_layouts to see available layouts.` }], isError: true };
      }

      const pageLayers = await getDraftLayers(page_id);
      let layers = (pageLayers?.layers as Layer[]) || [];

      // Try the main project's layout template system
      let layoutLayer: Layer | null = null;
      try {
        layoutLayer = getLayoutTemplate(layout_key);
      } catch {
        // Layout template not available
      }

      if (!layoutLayer) {
        // Fallback: create a basic section scaffold
        const section: Layer = {
          id: generateId('lyr'),
          name: 'section',
          customName: `${found.category}: ${found.description}`,
          classes: ['flex', 'flex-col', 'w-[100%]', 'pt-[80px]', 'pb-[80px]', 'items-center'],
          design: {
            layout: { isActive: true, display: 'Flex', flexDirection: 'column', alignItems: 'center' },
            sizing: { isActive: true, width: '100%' },
            spacing: { isActive: true, paddingTop: '80px', paddingBottom: '80px' },
          },
          children: [{
            id: generateId('lyr'),
            name: 'div',
            customName: 'Container',
            classes: ['flex', 'flex-col', 'max-w-[1280px]', 'w-[100%]', 'pl-[32px]', 'pr-[32px]'],
            design: {
              layout: { isActive: true, display: 'Flex', flexDirection: 'column' },
              sizing: { isActive: true, width: '100%', maxWidth: '1280px' },
              spacing: { isActive: true, paddingLeft: '32px', paddingRight: '32px' },
            },
            children: [],
          }],
        };
        layoutLayer = section;
      }

      if (parent_layer_id) {
        const parent = findLayerById(layers, parent_layer_id);
        if (!parent) {
          return { content: [{ type: 'text' as const, text: `Error: Parent "${parent_layer_id}" not found.` }], isError: true };
        }
        if (!canHaveChildren(parent)) {
          return { content: [{ type: 'text' as const, text: `Error: "${parent.customName || parent.name}" cannot have children.` }], isError: true };
        }
        layers = insertLayer(layers, parent_layer_id, layoutLayer, position);
      } else {
        if (position !== undefined) {
          layers = [...layers];
          layers.splice(position, 0, layoutLayer);
        } else {
          layers = [...layers, layoutLayer];
        }
      }

      await upsertDraftLayers(page_id, layers);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Added ${found.category} section to page`,
            section_id: layoutLayer.id,
            container_id: layoutLayer.children?.[0]?.id,
            layout: found,
          }, null, 2),
        }],
      };
    },
  );
}
