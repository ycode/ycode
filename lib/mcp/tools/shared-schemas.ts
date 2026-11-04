import { z } from 'zod';

import type { DesignProperties } from '@/types';
import { ELEMENT_TEMPLATES } from '@/lib/mcp/utils';

/**
 * Enum of every element template key the MCP can create. Derived from
 * ELEMENT_TEMPLATES so the three add-layer surfaces (single, batch,
 * component) cannot drift apart when a new template is added.
 */
export const templateEnum = z.enum(
  Object.keys(ELEMENT_TEMPLATES) as [string, ...string[]],
);

/**
 * Structured rich-text block accepted by add_layer (rich_content) and the
 * batch set_rich_text operation. Mirrors the RichTextBlock type in utils.ts.
 */
export const richTextBlockSchema = z.object({
  type: z.enum([
    'paragraph', 'heading', 'blockquote',
    'bulletList', 'orderedList',
    'codeBlock', 'horizontalRule',
    'htmlEmbed', 'image', 'table', 'component',
  ]),
  text: z.string().optional().describe('Text content. Supports **bold**, *italic*, [link](url).'),
  level: z.number().optional().describe('Heading level 1-6 (for heading type)'),
  items: z.array(z.string()).optional().describe('List items (for bulletList/orderedList)'),
  code: z.string().optional().describe('For htmlEmbed: the HTML/JS code to embed'),
  src: z.string().optional().describe('For image: external image URL (use asset_id for uploaded assets)'),
  alt: z.string().optional().describe('For image: alt text'),
  asset_id: z.string().optional().describe('For image: asset ID from upload_asset'),
  rows: z.array(z.array(z.string())).optional().describe('For table: 2D array of cell text. Inline marks (**bold** etc.) work in each cell.'),
  header_row: z.boolean().optional().describe('For table: whether the first row should render as table headers. Defaults true.'),
  component_id: z.string().optional().describe('For component: ID of the component to embed'),
});

/** Where a field binding reads its value from: a CMS item or a site-wide global variable. */
export const bindingSourceEnum = z.enum(['collection', 'page', 'global']);

/**
 * One segment of dynamic text: a literal or a field reference. Shared by
 * set_dynamic_text and component instance text overrides.
 */
export const dynamicTextSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().describe('Literal text.') }),
  z.object({
    type: z.literal('field'),
    field_id: z.string().describe('Collection field ID to insert (global variable ID when source is "global").'),
    format: z.string().optional().describe('Optional value format (e.g. a date format).'),
  }),
]);

// Accept a bare integer column/row count (e.g. "4") and normalize it to the
// canonical `repeat(N, 1fr)` form used by the visual editor's LayoutControls.
// Without this, `grid-cols-[4]` is emitted, which Tailwind treats as invalid CSS.
const gridTracksSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value.trim())
    ? `repeat(${value.trim()}, 1fr)`
    : value),
  z.string(),
).optional();

export const designSchema = z.object({
  layout: z.object({
    isActive: z.boolean().optional(),
    display: z.string().optional().describe('Flex | block | inline-block | grid | hidden'),
    flexDirection: z.string().optional(),
    flexWrap: z.string().optional(),
    justifyContent: z.string().optional(),
    alignItems: z.string().optional(),
    alignSelf: z.string().optional().describe('Un-stretch a flex child: auto|start|center|end|stretch|baseline'),
    justifyItems: z.string().optional().describe('Grid only — inline-axis alignment of all cells: start|end|center|stretch'),
    justifySelf: z.string().optional().describe('Grid cell — inline-axis alignment of this cell: auto|start|end|center|stretch'),
    flex: z.string().optional().describe('Flex child shorthand: 1 (fill available space) | auto | initial | none'),
    flexGrow: z.string().optional().describe('Flex child grow: "1" | "0"'),
    flexShrink: z.string().optional().describe('Flex child shrink: "1" | "0"'),
    order: z.string().optional().describe('Flex child order: first | last | none | "1".."12"'),
    gap: z.string().optional(),
    columnGap: z.string().optional(),
    rowGap: z.string().optional(),
    gridTemplateColumns: gridTracksSchema,
    gridTemplateRows: gridTracksSchema,
  }).optional(),
  typography: z.object({
    isActive: z.boolean().optional(),
    fontSize: z.string().optional(),
    fontWeight: z.string().optional(),
    fontFamily: z.string().optional(),
    fontStyle: z.string().optional(),
    lineHeight: z.string().optional(),
    letterSpacing: z.string().optional(),
    textAlign: z.string().optional(),
    textWrap: z.string().optional().describe('Text wrapping: "balance" (even multi-line headings), "pretty" (avoids orphans in body copy), "wrap", or "nowrap"'),
    fontVariantNumeric: z.string().optional().describe('Numeric glyph style: "tabular-nums" (aligned digits for pricing/data/tables), "normal", "ordinal", "slashed-zero", "lining-nums", "oldstyle-nums", "proportional-nums", "diagonal-fractions", "stacked-fractions"'),
    textTransform: z.string().optional(),
    textDecoration: z.string().optional(),
    textDecorationColor: z.string().optional(),
    textDecorationThickness: z.string().optional(),
    underlineOffset: z.string().optional(),
    lineClamp: z.string().optional().describe('Truncate text after N lines, e.g. "2" or "line-clamp-3"'),
    verticalAlign: z.string().optional(),
    color: z.string().optional(),
    placeholderColor: z.string().optional(),
    textShadow: z.string().optional().describe('0px_1px_2px_rgba(0,0,0,0.4) or sm/md/lg'),
  }).optional(),
  spacing: z.object({
    isActive: z.boolean().optional(),
    padding: z.string().optional(),
    paddingTop: z.string().optional(),
    paddingRight: z.string().optional(),
    paddingBottom: z.string().optional(),
    paddingLeft: z.string().optional(),
    margin: z.string().optional(),
    marginTop: z.string().optional(),
    marginRight: z.string().optional(),
    marginBottom: z.string().optional(),
    marginLeft: z.string().optional(),
  }).optional(),
  sizing: z.object({
    isActive: z.boolean().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    minWidth: z.string().optional(),
    minHeight: z.string().optional(),
    maxWidth: z.string().optional(),
    maxHeight: z.string().optional(),
    overflow: z.string().optional().describe('visible | hidden | scroll | auto | ellipsis (single-line text-ellipsis)'),
    aspectRatio: z.string().nullable().optional(),
    objectFit: z.string().nullable().optional(),
    objectPosition: z.string().nullable().optional().describe('top | bottom | left | right | center | left-top | right-top | left-bottom | right-bottom'),
    gridColumnSpan: z.string().nullable().optional().describe('Grid column span, e.g. "2" or "span 3"'),
    gridRowSpan: z.string().nullable().optional().describe('Grid row span, e.g. "2" or "span 3"'),
  }).optional(),
  borders: z.object({
    isActive: z.boolean().optional(),
    borderWidth: z.string().optional(),
    borderTopWidth: z.string().optional(),
    borderRightWidth: z.string().optional(),
    borderBottomWidth: z.string().optional(),
    borderLeftWidth: z.string().optional(),
    borderStyle: z.string().optional(),
    borderColor: z.string().optional(),
    borderRadius: z.string().optional(),
    borderTopLeftRadius: z.string().optional(),
    borderTopRightRadius: z.string().optional(),
    borderBottomLeftRadius: z.string().optional(),
    borderBottomRightRadius: z.string().optional(),
    divideX: z.string().optional().describe('Horizontal divider width between children, e.g. "1px"'),
    divideY: z.string().optional().describe('Vertical divider width between children, e.g. "1px"'),
    divideStyle: z.string().optional(),
    divideColor: z.string().optional(),
    outlineWidth: z.string().optional(),
    outlineColor: z.string().optional(),
    outlineOffset: z.string().optional(),
  }).optional(),
  backgrounds: z.object({
    isActive: z.boolean().optional(),
    backgroundColor: z.string().optional(),
    backgroundImage: z.string().optional().describe('CSS background-image value, e.g. "url(...)" or var reference'),
    backgroundSize: z.string().optional(),
    backgroundPosition: z.string().optional(),
    backgroundRepeat: z.string().optional(),
    backgroundClip: z.string().optional().describe('"text" for gradient text effect, "border" or "padding"'),
    bgImageVars: z.record(z.string(), z.string()).optional()
      .describe('Background image CSS values keyed by var name. Use "--bg-img" for desktop neutral.'),
    bgGradientVars: z.record(z.string(), z.string()).optional()
      .describe('Gradient CSS values keyed by var name. Use "--bg-img" for desktop neutral. Value is a CSS gradient like "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"'),
  }).optional(),
  effects: z.object({
    isActive: z.boolean().optional(),
    opacity: z.string().optional(),
    boxShadow: z.string().optional(),
    blur: z.string().optional(),
    backdropBlur: z.string().optional(),
    filter: z.string().optional().describe('CSS filter, e.g. "grayscale(1)" or "brightness(0.5) contrast(1.2)". Sets the whole filter, so include blur() here instead of combining with blur'),
    backdropFilter: z.string().optional().describe('CSS backdrop-filter, e.g. "saturate(180%)". Sets the whole backdrop-filter, so include blur() here instead of combining with backdropBlur'),
    mixBlendMode: z.string().optional().describe('CSS mix-blend-mode, e.g. "multiply", "screen", "overlay"'),
    cursor: z.string().optional().describe('pointer | default | text | grab | wait | not-allowed | auto'),
  }).optional(),
  positioning: z.object({
    isActive: z.boolean().optional(),
    position: z.string().optional(),
    top: z.string().optional(),
    right: z.string().optional(),
    bottom: z.string().optional(),
    left: z.string().optional(),
    zIndex: z.string().optional(),
  }).optional(),
  transforms: z.object({
    isActive: z.boolean().optional(),
    scale: z.string().optional().describe('Uniform scale factor, e.g. "1.1" or "0.95"'),
    rotate: z.string().optional().describe('Rotation, e.g. "45deg" or "-15deg"'),
    translateX: z.string().optional(),
    translateY: z.string().optional(),
    skewX: z.string().optional(),
    skewY: z.string().optional(),
    transformOrigin: z.string().optional().describe('CSS transform-origin, e.g. "center" or "top left"'),
  }).optional(),
  transitions: z.object({
    isActive: z.boolean().optional(),
    transitionProperty: z.string().optional().describe('e.g. "all", "opacity", "transform, background-color"'),
    duration: z.string().optional().describe('e.g. "200ms" or "0.3s"'),
    easing: z.string().optional().describe('"linear", "in", "out", "in-out" (the "ease-" prefix is optional), or a cubic-bezier(...) value'),
    delay: z.string().optional().describe('e.g. "100ms"'),
  }).optional(),
}).describe('Design properties object. Set isActive: true on any category to apply it.');

// ── Drift guard ─────────────────────────────────────────────────────────────
//
// Compile-time assertion that every category and property of `DesignProperties`
// is mirrored in `designSchema` above. If you add a new field to one of the
// DesignProperties interfaces in `types/index.ts` and forget to expose it here,
// this assertion fails to compile and the TypeScript error names every missing
// `category.property` pair.
//
// Fields listed in `IntentionallyUnexposed` are deliberately omitted from MCP
// because they store builder-only UI state (which mode toggle is shown) rather
// than CSS that agents should set directly.

type IntentionallyUnexposed = {
  layout: 'gapMode';
  spacing: 'marginMode' | 'paddingMode';
  borders: 'borderWidthMode' | 'borderRadiusMode';
};

type NonUndefined<T> = Exclude<T, undefined>;
type CategoryKeys<T> = keyof NonUndefined<T>;

type ExpectedKeys<K extends keyof DesignProperties> = Exclude<
  CategoryKeys<DesignProperties[K]>,
  K extends keyof IntentionallyUnexposed ? IntentionallyUnexposed[K] : never
>;

type SchemaShape = z.infer<typeof designSchema>;

type MissingPerCategory = {
  [K in keyof DesignProperties]-?: K extends keyof SchemaShape
    ? Exclude<ExpectedKeys<K>, CategoryKeys<SchemaShape[K]>>
    : 'CATEGORY_MISSING';
};

type MissingFields = {
  [K in keyof MissingPerCategory]: [MissingPerCategory[K]] extends [never]
    ? never
    : `${K & string}.${MissingPerCategory[K] & string}`;
}[keyof MissingPerCategory];

const _designSchemaDriftCheck: [MissingFields] extends [never] ? true : MissingFields = true;
void _designSchemaDriftCheck;

/**
 * Batch operations shared by batch_operations (pages) and update_component_layers
 * (components). Kept here so the two tools accept the same shapes; the single
 * tools (update_layer_link, update_layer_settings, update_layer_background_image)
 * use the same helpers in lib/mcp/utils.
 */
export const updateLinkOp = z.object({
  type: z.literal('update_link'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  link_type: z.enum(['url', 'email', 'phone', 'asset', 'page']).describe('Type of link'),
  url: z.string().optional().describe('For url type: the target URL'),
  page_id_target: z.string().optional().describe('For page type: the target page ID'),
  collection_item_id: z.string().optional().describe('For dynamic page links: "current-collection", "current-page", "next-item", "previous-item", or a collection item id. Defaults to "current-collection" inside a list of that collection and "current-page" on its dynamic page.'),
  email: z.string().optional().describe('For email type: the email address'),
  phone: z.string().optional().describe('For phone type: the phone number'),
  asset_id: z.string().optional().describe('For asset type: the asset ID to download'),
  anchor_layer_id: z.string().optional().describe('Layer to scroll to (layer ID, ref_id, or HTML id). The target needs an HTML id (update_settings html_id). With url type and no url it links within the page; with page type it links to that section on page_id_target.'),
  target: z.enum(['_blank', '_self', '_parent', '_top']).optional().describe('Link target. _blank opens a new tab.'),
  rel: z.string().optional().describe('rel attribute, e.g. "noopener noreferrer", "nofollow"'),
  download: z.boolean().optional().describe('When true, download the linked resource instead of navigating.'),
});

export const updateSettingsOp = z.object({
  type: z.literal('update_settings'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  tag: z.string().optional().describe('HTML tag override: h1-h6, p, span, div, section, nav, footer, header, main, aside, article'),
  html_id: z.string().optional().describe('Custom HTML element ID (for anchor links, CSS targeting)'),
  custom_name: z.string().optional().describe('Display name for the layer in the builder'),
  hidden: z.boolean().optional().describe('Hide the layer everywhere (canvas and published site)'),
  keep_in_html: z.boolean().optional().describe('When hidden, keep the element in the HTML collapsed so custom code can reveal it'),
  custom_attributes: z.record(z.string(), z.string()).optional().describe('Custom HTML attributes as { name: value } pairs (merged into existing). On input / textarea / select, type, name, placeholder, value, required and autofocus set the field\'s own settings.'),
  html_embed_code: z.string().optional().describe('For htmlEmbed layers: the HTML/CSS/JS code to embed'),
});

export const updateBackgroundImageOp = z.object({
  type: z.literal('update_background_image'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  asset_id: z.string().optional().describe('Asset ID for the background image'),
  url: z.string().optional().describe('Direct URL for the background image (alternative to asset_id)'),
});
