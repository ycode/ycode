/**
 * Ycode Type Definitions
 *
 * Core types for pages, layers, and editor functionality
 */

// UI State Types (for state-specific styling: hover, focus, etc.)
export type UIState = 'neutral' | 'hover' | 'focus' | 'active' | 'disabled' | 'current';
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';
export type StringAssetId = string;

// Design Property Interfaces
export interface LayoutDesign {
  isActive?: boolean;
  display?: string;
  flexDirection?: string;
  flexWrap?: string;
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  // Flex child (how this layer behaves inside a flex parent)
  flex?: string; // '1' | 'auto' | 'initial' | 'none'
  flexGrow?: string; // '1' | '0'
  flexShrink?: string; // '1' | '0'
  order?: string; // 'first' | 'last' | 'none' | '1'..'12'
  gap?: string;
  columnGap?: string;
  rowGap?: string;
  gapMode?: 'all' | 'individual'; // User's toggle preference for gap
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
}

export interface TypographyDesign {
  isActive?: boolean;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  fontStyle?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textWrap?: string;
  fontVariantNumeric?: string;
  textTransform?: string;
  textDecoration?: string;
  lineClamp?: string;
  textDecorationColor?: string;
  textDecorationThickness?: string;
  underlineOffset?: string;
  verticalAlign?: string;
  color?: string;
  placeholderColor?: string;
  textShadow?: string;
}

export interface SpacingDesign {
  isActive?: boolean;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginMode?: 'all' | 'individual'; // User's toggle preference for margin
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  paddingMode?: 'all' | 'individual'; // User's toggle preference for padding
}

export interface SizingDesign {
  isActive?: boolean;
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  overflow?: string;
  aspectRatio?: string | null;
  objectFit?: string | null;
  objectPosition?: string | null;
  gridColumnSpan?: string | null;
  gridRowSpan?: string | null;
}

export interface BordersDesign {
  isActive?: boolean;
  borderWidth?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderWidthMode?: 'all' | 'individual'; // User's toggle preference for border width
  borderStyle?: string;
  borderColor?: string;
  borderRadius?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderBottomRightRadius?: string;
  borderRadiusMode?: 'all' | 'individual'; // User's toggle preference for border radius
  divideX?: string;
  divideY?: string;
  divideStyle?: string;
  divideColor?: string;
  outlineWidth?: string;
  outlineColor?: string;
  outlineOffset?: string;
}

export interface BackgroundsDesign {
  isActive?: boolean;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundClip?: string;
  /** CSS variable values for background image per breakpoint/state, e.g. { '--bg-img': 'url(...)' } */
  bgImageVars?: Record<string, string>;
  /** CSS variable values for background gradient per breakpoint/state, e.g. { '--bg-img': 'linear-gradient(...)' } */
  bgGradientVars?: Record<string, string>;
}

export interface EffectsDesign {
  isActive?: boolean;
  opacity?: string;
  boxShadow?: string;
  blur?: string;
  backdropBlur?: string;
  filter?: string;
  backdropFilter?: string;
  mixBlendMode?: string;
  cursor?: string;
}

export interface PositioningDesign {
  isActive?: boolean;
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;
}

export interface TransformsDesign {
  isActive?: boolean;
  scale?: string;
  rotate?: string;
  translateX?: string;
  translateY?: string;
  skewX?: string;
  skewY?: string;
  transformOrigin?: string;
}

export interface TransitionsDesign {
  isActive?: boolean;
  transitionProperty?: string;
  duration?: string;
  easing?: string;
  delay?: string;
}

export interface DesignProperties {
  layout?: LayoutDesign;
  typography?: TypographyDesign;
  spacing?: SpacingDesign;
  sizing?: SizingDesign;
  borders?: BordersDesign;
  backgrounds?: BackgroundsDesign;
  effects?: EffectsDesign;
  positioning?: PositioningDesign;
  transforms?: TransformsDesign;
  transitions?: TransitionsDesign;
}

export type FormType = 'standard' | 'password_protected';

export type PasswordProtectionContext = {
  pageId?: string;
  folderId?: string;
  redirectUrl: string;
  isPublished: boolean;
};

export interface FormSettings {
  // 'password_protected' wires the form to the page-auth verify endpoint and gates access to
  // password-protected pages; 'standard' (default) submits to /ycode/api/form-submissions.
  form_type?: FormType;
  success_action?: 'message' | 'redirect'; // What happens on successful submission (default: 'message')
  success_message?: string; // Message shown on successful submission (deprecated - now uses alert child)
  error_message?: string; // Message shown on failed submission (deprecated - now uses alert child)
  redirect_url?: LinkSettingsValue; // Link settings for redirect after successful submission
  email_notification?: {
    enabled: boolean;
    to: string; // Email address to send notifications to
    subject?: string; // Email subject line
  };
}

export type SwiperAnimationEffect = 'slide' | 'fade' | 'cube' | 'flip' | 'coverflow' | 'cards';
export type SliderLoopMode = 'none' | 'loop' | 'rewind';
export type SliderPaginationType = 'bullets' | 'fraction';
export type LightboxOverlay = 'light' | 'dark';
export type LightboxFilesSource = 'files' | 'cms';

export interface LightboxSettings {
  files: string[]; // Asset IDs or external URLs (used when filesSource is 'files')
  filesSource: LightboxFilesSource; // Whether files come from manual selection or a CMS field
  filesField?: FieldVariable | null; // CMS field binding for dynamic images (used when filesSource is 'cms')
  thumbnails: boolean;
  navigation: boolean;
  pagination: boolean;
  zoom: boolean; // Pinch-to-zoom on touch devices
  doubleTapZoom: boolean; // Double-tap/click to zoom
  mousewheel: boolean; // Navigate slides with scroll wheel
  overlay: LightboxOverlay;
  groupId: string; // Links multiple lightboxes into one shared gallery
  animationEffect: SwiperAnimationEffect;
  easing: string;
  duration: string; // Transition duration in seconds
}

/**
 * A value that can either be a single number (applies to every breakpoint) or
 * an object of per-breakpoint overrides. Desktop is the base; tablet/mobile
 * fall back to larger breakpoints when unset (desktop-first).
 */
export type ResponsiveNumber = number | Partial<Record<Breakpoint, number>>;

export interface SliderSettings {
  navigation: boolean;
  groupSlide: ResponsiveNumber; // Slides visible per view (responsive)
  slidesPerGroup: ResponsiveNumber; // Slides advanced per navigation step (responsive)
  loop: SliderLoopMode;
  centered: boolean;
  touchEvents: boolean;
  slideToClicked: boolean;
  mousewheel: boolean;

  pagination: boolean;
  paginationType: SliderPaginationType;
  paginationClickable: boolean;
  autoplay: boolean;
  pauseOnHover: boolean;
  delay: string; // Autoplay delay in seconds
  animationEffect: SwiperAnimationEffect;
  easing: string;
  duration: string; // Transition duration in seconds
}

export interface LayerSettings {
  id?: string; // Custom element ID
  tag?: string; // HTML tag override (e.g., 'h1', 'h2', etc.)
  hidden?: boolean; // Hidden everywhere (canvas + published) — not rendered unless kept in HTML
  // Inside a component: drive `hidden` from a 'visibility' component variable so
  // each instance can show or hide this layer. Resolved during
  // `applyComponentOverrides` (SSR) and live in the editor LayerRenderer; while
  // linked, the stored `hidden` value is ignored.
  visibilityVariableId?: string;
  // Inside a component: drive the HTML `id` attribute from an 'id' component
  // variable so each instance can carry its own element ID (e.g. per-page
  // analytics/tracking IDs on a shared button). Resolved during
  // `applyComponentOverrides` (SSR) and live in the editor LayerRenderer; while
  // linked, the stored `id` value is ignored.
  idVariableId?: string;
  keepInHtml?: boolean; // When hidden, render collapsed (display: none) instead of omitting, so custom code / interactions can reveal it
  customAttributes?: Record<string, string>; // Custom HTML attributes { attributeName: attributeValue }
  locale?: {
    format?: 'locale' | 'code'; // Display format for `localeSelector` layers (locale => 'English', code => 'EN')
  };
  htmlEmbed?: {
    code?: string; // Custom HTML code to embed
  };
  slider?: SliderSettings; // Slider-specific settings (only for slider layers)
  lightbox?: LightboxSettings; // Lightbox-specific settings (only for lightbox layers)
  form?: FormSettings; // Form-specific settings (only for form layers)
  filterOnChange?: boolean; // For filter layers: trigger filtering on every input change (debounced)
  optionsSource?: {
    collectionId: string;
    defaultItemId?: string; // item ID to pre-select as default (select elements)
    defaultItemIds?: string[]; // item IDs to pre-check as defaults (checkbox groups)
    sortFieldId?: string; // field ID to sort options by (undefined = manual/insertion order)
    sortOrder?: 'asc' | 'desc'; // sort direction (defaults to 'asc')
  };
  selectOptionsMode?: 'list' | 'sort_by' | 'sort_order'; // Builder source mode for select options
  sortByCollectionId?: string; // Collection to source sort-by field options from
  sortByFieldIds?: string[]; // Which field IDs are enabled as sort-by options
  isPlaceholder?: boolean; // Marks an <option> child as a placeholder (disabled, hidden, selected)
  map?: MapSettings; // Map-specific settings (only for map layers)
}

export type MapProvider = 'mapbox' | 'google';
export type MapStyle = 'streets' | 'satellite' | 'light' | 'dark' | 'outdoors';
export type GoogleMapStyle = 'roadmap' | 'satellite';

export interface MapProviderSettings {
  style: string;
  interactive: boolean;
  scrollZoom: boolean;
  showNavControl: boolean;
  showScaleBar: boolean;
}

export interface MapSettings {
  provider: MapProvider;
  latitude: number;
  longitude: number;
  zoom: number;
  markerColor: string | null;
  search?: string;
  mapbox: MapProviderSettings;
  google: MapProviderSettings;
}

// Layer Style Types
export interface LayerStyle {
  id: string;
  name: string;
  group?: string; // Element category (e.g. "text", "block", "button") for scoped filtering
  /** Role within a combo-class stack. Used for UI affordances (base vs combo vs synced global). */
  kind?: 'base' | 'combo' | 'global';

  // Style data
  classes: string;
  design?: DesignProperties;

  // Versioning fields
  content_hash?: string; // SHA-256 hash for change detection
  is_published: boolean;

  created_at: string;
  updated_at: string;
  deleted_at?: string | null; // Soft delete for undo/redo support
}

export interface LayerInteraction {
  id: string;
  trigger: 'click' | 'hover' | 'scroll-into-view' | 'while-scrolling' | 'load';
  timeline: InteractionTimeline;
  tweens: InteractionTween[];
}

export interface InteractionTimeline {
  breakpoints: Breakpoint[];
  repeat: number; // -1 = infinite, 0 = none, n = repeat n times
  yoyo: boolean; // reverse direction on each repeat
  scrollStart?: string; // e.g., 'top 80%', 'top center' - when trigger enters viewport
  scrollEnd?: string; // e.g., 'bottom top' - when trigger leaves viewport (while-scrolling only)
  scrub?: boolean | number; // while-scrolling: true for direct link, number for smoothing (seconds)
  toggleActions?: string; // scroll-into-view: GSAP toggleActions (e.g., 'play none none none')
}

export interface InteractionTween {
  id: string;
  layer_id: string;
  position: number | string; // GSAP position: number (seconds), ">" (after previous), "<" (with previous)
  duration: number; // seconds
  ease: string; // GSAP ease (e.g., 'power1.out', 'elastic.inOut')
  from: TweenProperties;
  to: TweenProperties;
  apply_styles: InteractionApplyStyles;
  splitText?: {
    type: 'chars' | 'words' | 'lines';
    stagger: { amount: number }; // GSAP stagger: { amount: totalTime }
  };
}

export type ApplyStyles = 'on-load' | 'on-trigger';

export type TweenPropertyKey = 'x' | 'y' | 'rotation' | 'scale' | 'skewX' | 'skewY' | 'autoAlpha' | 'display' | 'width' | 'height' | 'backgroundColor' | 'filterBlur' | 'filterBrightness' | 'filterGrayscale';

export type InteractionApplyStyles = Partial<Record<TweenPropertyKey, ApplyStyles>>;

export type TweenProperties = {
  [K in TweenPropertyKey]?: string | null;
};

export interface TextStyle {
  label?: string; // Display label for the style (e.g., "Bold", "Italic")
  classes?: string;
  design?: DesignProperties;
  styleId?: string; // Layer style applied to this text style
  styleOverrides?: { classes?: string; design?: DesignProperties };
}

export interface Layer {
  id: string;
  key?: string; // Optional internal ID for the layer (i.e. "localeSelectorLabel")
  name: string; // Element type name: 'div', 'section', 'text', etc.
  customName?: string; // User-defined name for display in the UI

  // Restrictions (for layer actions)
  restrictions?: {
    copy?: boolean; // Whether the layer can be copied / duplicated
    delete?: boolean; // Whether the layer can be deleted
    ancestor?: string; // The ancestor `layer.name` that the layer should be a child of
    editText?: boolean; // Whether the layer text contents can be edited
  };

  classes: string | string[]; // Tailwind CSS classes (support arrays and strings)

  // Text styles object, e.g. `{ bold: { classes: 'font-bold', design: { typography: { fontWeight: 'bold' } } }, ... }`
  textStyles?: Record<string, TextStyle>;

  // Children
  children?: Layer[];

  // Special properties
  open?: boolean; // Collapsed/expanded state in tree
  hidden?: boolean;
  hiddenGenerated?: boolean; // Hidden by default, shown via form actions (for alerts)
  alertType?: 'success' | 'error'; // Type of alert (for form success/error messages)

  // Attributes (for HTML elements)
  attributes?: Record<string, any> & {
    id?: string; // Custom HTML ID attribute

    // Media element attributes (video/audio)
    muted?: boolean;
    controls?: boolean;
    loop?: boolean;
    autoplay?: boolean;
    volume?: string; // Volume as string (0-100)
    preload?: string; // 'none' | 'metadata' | 'auto'
    youtubePrivacyMode?: boolean; // Privacy-enhanced mode (uses youtube-nocookie.com)
  };

  // Design system (structured properties)
  design?: DesignProperties;

  // Settings (element-specific configuration)
  settings?: LayerSettings;

  // Layer Styles (reusable design system)
  /**
   * @deprecated Use `styleIds`. A single applied LayerStyle. Still read for
   * backward compatibility via `getStyleIds()` and migrated to `styleIds` on
   * the next write.
   */
  styleId?: string;
  /**
   * Ordered stack of applied LayerStyles, low to high priority (base class
   * first, combo classes after). Mirrors Webflow's combo-class chain. The flat
   * `classes` string is derived from this stack (plus `styleOverrides`) via
   * `resolveLayerClasses`.
   */
  styleIds?: string[];
  styleOverrides?: {
    classes?: string;
    design?: DesignProperties;
    /**
     * @deprecated Per-chip overrides now live in `styleOverridesByStyle`. This
     * single highest-priority blob is kept for backward compatibility (legacy
     * layers/imports) and is still applied last by `resolveLayerClasses`.
     */
    styleId?: string;
  }; // Legacy: local changes after style applied (highest priority)
  /**
   * Per-style local overrides, keyed by the `LayerStyle` id in the stack. Each
   * entry REPLACES that style's classes for THIS layer only (the rest of the
   * stack still cascades around it). This is what makes customization unique to
   * the selected chip: editing while "Heading 3" is active writes
   * `styleOverridesByStyle["heading-3-id"]`, shows "Customized" on that chip
   * only, and "Update" folds just that entry back into the shared style.
   */
  styleOverridesByStyle?: Record<string, { classes?: string; design?: DesignProperties }>;

  // Components (reusable layer trees)
  componentId?: string; // Reference to applied Component
  // Selected variant id within the referenced component. When undefined or
  // pointing to a missing variant, the first variant ("Default") is used.
  componentVariantId?: string;
  // When set, the variant for this nested component instance is driven by the
  // parent component's variable (by id). Resolved during
  // `applyComponentOverrides` and written back to `componentVariantId` before
  // the component tree is expanded.
  componentVariantVariableId?: string;
  componentOverrides?: {
    text?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (text)
    rich_text?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (rich text)
    image?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (image)
    link?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (link)
    audio?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (audio)
    video?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (video)
    icon?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (icon)
    variant?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (variant)
    visibility?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (visibility)
    id?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (element id)
    variableLinks?: Record<string, string>; // childVariableId → parentVariableId (pass-through from nested component to parent)
  };

  // Layer variables (layer collection data & dynamic data for texts, assets, links)
  variables?: LayerVariables;

  // Interactions / Animations (new structured approach)
  interactions?: LayerInteraction[];

  // SSR-only property for resolved collection items
  _collectionItems?: CollectionItemWithValues[];
  // SSR-only property for collection item values (used for visibility filtering)
  _collectionItemValues?: Record<string, string>;
  // SSR-only property for collection item ID (used for link URL building)
  _collectionItemId?: string;
  // SSR-only property for collection item slug (used for link URL building)
  _collectionItemSlug?: string;
  // SSR-only property for layer-specific collection data (layer_id -> field values map)
  _layerDataMap?: Record<string, Record<string, string>>;
  // SSR-only property for master component ID (for translation lookups)
  _masterComponentId?: string;
  // SSR-only property for original layer ID before instance-specific ID transform (for translation lookups)
  _originalLayerId?: string;
  // SSR-only property for pagination metadata (when pagination is enabled)
  _paginationMeta?: CollectionPaginationMeta;
  // SSR-only property: live pagination numbers stashed on the count/info text
  // layers so renderers can resolve `pagination` inline variables at display time
  _paginationNumbers?: PaginationNumbers;
  // SSR-only property for dynamic inline styles from CMS color field bindings
  _dynamicStyles?: Record<string, string>;
  // SSR-only property: when a conditionalVisibility rule references a date
  // preset (e.g. `$today`), the layer is kept in the tree even if the
  // export-time eval is false, and this metadata is attached so layerToHtml
  // can serialize it for the static-export client-side runtime to re-eval.
  // Non-date conditions are baked to a boolean at export time; only
  // date-preset conditions are re-evaluated client-side against the current date.
  _dynamicVisibilityRule?: {
    /** Project timezone (IANA) for resolving date presets on the client. */
    timezone?: string;
    groups: Array<{ conditions: DynamicVisibilityCondition[] }>;
  };
  // SSR-only property for filterable collection config (when collection has linked filter inputs)
  _filterConfig?: {
    collectionId: string;
    collectionLayerId: string;
    filters: ConditionalVisibility;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    sortByInputLayerId?: string;
    sortOrderInputLayerId?: string;
    limit?: number;
    // Hard cap on the total (from `collection.limit` with pagination enabled).
    // Mirrors `CollectionPaginationMeta.maxTotal` so client-side filtering shows
    // the same clamped count/`hasMore` as SSR instead of the raw filtered total.
    maxTotal?: number;
    // The collection's configured `offset` — leading records skipped before
    // paginating. Forwarded to the filter API so client-side filtered paging
    // composes offset with pagination the same way SSR does.
    baseOffset?: number;
    paginationMode?: 'pages' | 'load_more';
    layerTemplate: Layer[];
    collectionLayerClasses?: string[];
    collectionLayerTag?: string;
    isPublished?: boolean;
    // Full collection layer (sans children) used by the client to rebuild
    // proper item wrappers (anchor/link/attribute) when injecting filtered
    // or load-more items. Without this, the wrapper would be a plain <div>
    // and lose link/action behavior.
    collectionLayer?: Omit<Layer, 'children'>;
  };
}

export interface LayerVariables {
  // Collection data
  collection?: CollectionVariable;
  conditionalVisibility?: ConditionalVisibility;

  // Variables by type
  text?: DynamicTextVariable | DynamicRichTextVariable;
  icon?: {
    src?: AssetVariable | StaticTextVariable; // Static Asset ID | Static Text (SVG code, internal use only)
  };
  image?: {
    src: AssetVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Field Variable | Dynamic Text (URL that allows inline variables)
    alt: DynamicTextVariable; // Image alt text with inline variables
  };
  audio?: {
    src: AssetVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Field Variable | Dynamic Text (URL that allows inline variables)
  };
  video?: {
    src?: AssetVariable | VideoVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Video provider + ID (YouTube) | Field Variable | Dynamic Text (URL that allows inline variables)
    poster?: AssetVariable | FieldVariable; // Poster image (asset or field variable)
  };
  iframe?: {
    src: DynamicTextVariable; // Embed URL (allow inline variables)
  };
  backgroundImage?: {
    src: AssetVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Field Variable | Dynamic Text (URL)
  };
  link?: LinkSettings;

  // Design property bindings (CMS color fields)
  design?: {
    backgroundColor?: DesignColorVariable;
    color?: DesignColorVariable; // text color
    borderColor?: DesignColorVariable;
    divideColor?: DesignColorVariable;
    outlineColor?: DesignColorVariable;
    textDecorationColor?: DesignColorVariable;
    placeholderColor?: DesignColorVariable;
  };
}

/** A gradient stop with optional CMS field binding */
export interface BoundColorStop {
  id: string;
  position: number;
  color: string; // static fallback color
  field?: FieldVariable; // optional CMS binding for this stop
}

/** Design color variable supporting solid and gradient CMS bindings.
 *  Each mode's state is stored separately so switching tabs preserves bindings. */
export interface DesignColorVariable {
  type: 'color';
  mode: 'solid' | 'linear' | 'radial';
  /** Solid mode: the CMS field binding */
  field?: FieldVariable;
  /** Linear gradient state (preserved across tab switches) */
  linear?: { angle?: number; stops?: BoundColorStop[] };
  /** Radial gradient state (preserved across tab switches) */
  radial?: { stops?: BoundColorStop[] };
}

// Link type discriminator
export type LinkType = 'url' | 'email' | 'phone' | 'asset' | 'page' | 'field';

// Collection link field types (simplified for CMS fields)
export type CollectionLinkType = 'url' | 'page' | 'asset';

// Collection Link Field Value (stored as JSON in collection item values)
// Note: Link behavior (target, rel) is set on the layer, not in the CMS value
export interface CollectionLinkValue {
  type: CollectionLinkType;

  // URL link - simple string URL
  url?: string;

  // Page link - link to a page (static or dynamic with static item)
  page?: {
    id: string; // Page ID
    collection_item_id?: string | null; // Static collection item ID (no current-page/current-collection)
    anchor_layer_id?: string | null; // Optional layer ID for anchor links
  };

  // Asset link - link to a downloadable asset
  asset?: {
    id: string | null;
  };
}

// Reusable link settings structure
export interface LinkSettings {
  type: LinkType;

  // URL link - custom URL with inline variables support
  url?: DynamicTextVariable;

  // Email link - mailto:address (supports inline variables)
  email?: DynamicTextVariable;

  // Phone link - tel:number (supports inline variables)
  phone?: DynamicTextVariable;

  // Asset link - link to downloadable asset
  asset?: {
    id: StringAssetId | null;
  };

  // Page link - link to a page (static or dynamic)
  page?: {
    id: string; // Page ID (static or dynamic)
    collection_item_id?: string | null; // Collection item ID (for dynamic pages)
  };

  // Field link - href from collection field (CMS field containing URL)
  field?: FieldVariable;

  // Anchor - reference to a layer ID to use as #anchor
  anchor_layer_id?: string | null;

  // Link behavior
  target?: '_blank' | '_self' | '_parent' | '_top';
  download?: boolean; // Force download the linked resource
  rel?: string; // 'noopener noreferrer' | 'nofollow' | 'sponsored' | 'ugc'
}

// Essentially a layer without ID (that can have children without IDs)
// Optional id is allowed for templates with animations that reference specific layers
export interface LayerTemplate extends Omit<Layer, 'id' | 'children'> {
  id?: string; // Optional: used when animations reference specific layers
  children?: Array<LayerTemplate | LayerTemplateRef>;
  // Inlined component metadata (for portable layouts)
  _inlinedComponentName?: string; // Component name when inlined for portability
  _inlinedComponentVariables?: ComponentVariable[]; // Component variables when inlined
}

// Template reference marker (lazy reference resolved during template instantiation)
export type LayerTemplateRef = { __ref: string } & Partial<Omit<LayerTemplate, 'children'>> & {
  children?: Array<LayerTemplate | LayerTemplateRef>;
};

// Block template definition (used in template collections)
export interface BlockTemplate {
  icon: string;
  name: string;
  template: LayerTemplate | LayerTemplateRef;
}

// Component Variable Types (ComponentVariableValue defined after text variable types)
export interface ComponentVariable {
  id: string;        // Unique variable ID
  name: string;      // Display name (e.g., "Button title")
  type?: 'text' | 'rich_text' | 'image' | 'link' | 'audio' | 'video' | 'icon' | 'variant' | 'visibility' | 'id'; // Variable type (defaults to 'text' for backwards compatibility)
  placeholder?: string; // Placeholder text shown in text override inputs
  default_value?: ComponentVariableValue; // Default value
}

// A named layer tree variant of a component (e.g. "Default", "Small", "Large").
// All variants share the same component-level `variables`.
export interface ComponentVariant {
  id: string;
  name: string;
  layers: Layer[];
}

// Component Types (Reusable Layer Trees)
export interface Component {
  id: string;
  name: string;

  // Component data - complete layer tree.
  // Mirrors `variants[0].layers` for backwards compatibility; new code should
  // read from `variants` via `getComponentVariantLayers()`.
  layers: Layer[];

  // Named layer tree variants. Always has at least one entry ("Default")
  // after the variants migration runs. Treat this as the source of truth.
  variants?: ComponentVariant[];

  // Component variables - exposed properties for overrides (shared across variants)
  variables?: ComponentVariable[];

  // Versioning fields
  content_hash?: string; // SHA-256 hash for change detection
  is_published: boolean;

  // Auto-generated preview thumbnail URL (stored in Supabase Storage)
  thumbnail_url?: string | null;

  created_at: string;
  updated_at: string;
  deleted_at?: string | null; // Soft delete timestamp
}

export interface Page {
  id: string;
  slug: string;
  name: string;
  page_folder_id: string | null; // Reference to page_folders
  order: number; // Sort order
  depth: number; // Depth in hierarchy
  is_index: boolean; // Index of the root or parent folder
  is_dynamic: boolean; // Dynamic page (CMS-driven)
  error_page: number | null; // Error page type: 401, 404, 500
  settings: PageSettings; // Page settings (CMS, auth, seo, custom code)
  content_hash?: string; // SHA-256 hash of page metadata for change detection
  is_published: boolean;
  is_publishable: boolean; // Whether the page goes live on publish (false = draft)
  has_published_version?: boolean; // Computed (builder listing only): a live row exists
  is_modified?: boolean; // Computed (builder listing only): draft differs from live
  created_at: string;
  updated_at: string;
  deleted_at: string | null; // Soft delete timestamp
}

export interface PageSettings {
  cms?: {
    collection_id: string;
    slug_field_id: string;
    /**
     * Controls the order in which `next-item` / `previous-item` link keywords
     * traverse this dynamic page's collection. When omitted, items are sorted
     * by their `manual_order` ascending — the same default used elsewhere in
     * the system.
     */
    next_previous?: {
      sort_by?: 'manual' | string; // 'manual' or a collection field id
      sort_order?: 'asc' | 'desc';
    };
  };
  auth?: {
    enabled: boolean;
    password: string;
  };
  seo?: {
    image: StringAssetId | FieldVariable | null; // Asset ID or Field Variable (image field)
    title: string;
    description: string;
    noindex: boolean; // Prevent search engines from indexing the page
  };
  custom_code?: {
    head: string;
    body: string;
  };
}

export interface PageLayers {
  id: string;
  page_id: string;
  layers: Layer[];
  content_hash?: string; // SHA-256 hash of layers and CSS for change detection
  is_published: boolean;
  created_at: string;
  updated_at?: string;
  deleted_at: string | null; // Soft delete timestamp
  generated_css?: string; // Extracted CSS from Play CDN for published pages
}

export interface PageFolderSettings {
  auth?: {
    enabled: boolean;
    password: string;
  };
}

export interface PageFolder {
  id: string;
  page_folder_id: string | null; // Self-referential: parent folder ID
  name: string;
  slug: string;
  depth: number; // Folder depth in hierarchy (0 for root)
  order: number; // Sort order within parent folder
  settings: PageFolderSettings; // Settings for auth (enabled + password), etc.
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null; // Soft delete timestamp
}

// Page/Folder Duplicate Operation Types
export interface PageItemDuplicateMetadata {
  tempId: string;
  originalName: string;
  parentFolderId: string | null;
  expectedName: string;
}

export interface PageItemDuplicateResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: PageItemDuplicateMetadata;
}

// Asset Types
/**
 * Asset categories for validation
 */
export type AssetCategory = 'images' | 'videos' | 'audio' | 'documents' | 'icons';

/**
 * Category filter for file manager - supports single, multiple, or all categories
 */
export type AssetCategoryFilter = AssetCategory | AssetCategory[] | 'all' | null;

/**
 * Asset - Represents any uploaded file (images, videos, documents, etc.)
 *
 * The asset system is designed to handle any file type, not just images.
 * - Images will have width/height dimensions
 * - Non-images will have null width/height
 * - Use mime_type to determine asset type (e.g., image/, video/, application/pdf)
 */
export interface Asset {
  id: string;
  filename: string;
  storage_path: string | null; // Nullable for SVG icons with inline content
  public_url: string | null; // Nullable for SVG icons with inline content
  file_size: number;
  mime_type: string;
  width?: number | null;
  height?: number | null;
  source: string; // Required: identifies where the asset was uploaded from
  asset_folder_id?: string | null;
  content?: string | null; // Inline SVG content for icon assets
  content_hash?: string | null; // SHA-256 hash for change detection during publishing
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AssetFolder {
  id: string;
  asset_folder_id: string | null;
  name: string;
  depth: number;
  order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAssetFolderData {
  id?: string;
  name: string;
  depth?: number;
  order?: number;
  is_published?: boolean;
  asset_folder_id?: string | null;
}

export interface UpdateAssetFolderData {
  name?: string;
  depth?: number;
  order?: number;
  is_published?: boolean;
  asset_folder_id?: string | null;
}

// Settings Types
export interface SiteSettings {
  site_name: string;
  site_description: string;
  theme?: string;
  logo_url?: string;
}

export interface Redirect {
  id: string;
  oldUrl: string;   // Internal path only, e.g. "/about-us"
  newUrl: string;   // Internal path "/about" OR external URL "https://example.com"
  type?: '301' | '302'; // Permanent vs temporary (default 301)
}

export type SmtpProvider = 'google' | 'microsoft365' | 'mailersend' | 'postmark' | 'sendgrid' | 'mailgun' | 'amazonses' | 'other';

export type EmailMode = 'ycode' | 'custom';

export interface EmailSettings {
  enabled: boolean;
  mode?: EmailMode;
  provider: SmtpProvider;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
}

// Editor State Types
export interface EditorState {
  selectedLayerId: string | null; // Legacy - kept for backward compatibility
  selectedLayerIds: string[]; // New multi-select
  lastSelectedLayerId: string | null; // For Shift+Click range
  currentPageId: string | null;
  isDragging: boolean;
  isLoading: boolean;
  isSaving: boolean;
  activeBreakpoint: Breakpoint;
  activeUIState: UIState; // Current UI state for editing (hover, focus, etc.)
}

// API Response Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// Supabase Config Types (for setup wizard)
export interface SupabaseConfig {
  anonKey: string;
  serviceRoleKey: string;
  connectionUrl: string; // With [YOUR-PASSWORD] placeholder
  dbPassword: string; // Actual password to replace [YOUR-PASSWORD]
  supabaseUrl?: string; // Explicit API URL for self-hosted instances (e.g. https://supabase.my-company.com)
}

// Internal credentials structure (derived from SupabaseConfig)
export interface SupabaseCredentials {
  anonKey: string;
  serviceRoleKey: string;
  connectionUrl: string; // Original with placeholder
  dbPassword: string;
  // Derived properties
  projectId: string;
  projectUrl: string; // API URL — explicit or derived from project ID
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
}

// Vercel Config Types
export interface VercelConfig {
  project_id: string;
  token: string;
}

// Setup Wizard Types
export type SetupStep = 'welcome' | 'supabase' | 'migrate' | 'admin' | 'template' | 'complete';

export interface SetupState {
  currentStep: SetupStep;
  supabaseConfig?: SupabaseConfig;
  vercelConfig?: VercelConfig;
  adminEmail?: string;
  isComplete: boolean;
}

// Auth Types
export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
}

export interface AuthState {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

// Collaboration Types
export interface CollaborationUser {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  color: string;
  cursor: { x: number; y: number } | null;
  selected_layer_id: string | null;
  locked_layer_id: string | null;
  is_editing: boolean; // Typing/editing indicator
  last_active: number;
  page_id: string;
}

// Legacy type - use ResourceLock from useCollaborationPresenceStore instead
export interface LayerLock {
  layer_id: string;
  user_id: string;
  acquired_at: number;
  expires_at: number;
}

export interface LayerUpdate {
  layer_id: string;
  user_id: string;
  changes: Partial<Layer>;
  timestamp: number;
}

// Base collaboration state - extended in useCollaborationPresenceStore
export interface CollaborationState {
  users: Record<string, CollaborationUser>;
  isConnected: boolean;
  currentUserId: string | null;
  currentUserColor: string;
  currentUserAvatarUrl: string | null;
}

export interface ActivityNotification {
  id: string;
  type: 'user_joined' | 'user_left' | 'layer_edit_started' | 'layer_edit_ended' | 'page_published' | 'user_idle' | 'page_created' | 'page_deleted';
  user_id: string;
  user_name: string;
  layer_id?: string;
  layer_name?: string;
  page_id?: string;
  timestamp: number;
  message: string;
}

// Collection Types (EAV Architecture)
export type CollectionFieldType = 'text' | 'number' | 'boolean' | 'date' | 'date_only' | 'color' | 'reference' | 'multi_reference' | 'rich_text' | 'image' | 'audio' | 'video' | 'document' | 'link' | 'email' | 'phone' | 'option' | 'count' | 'status';
export type CollectionSortDirection = 'asc' | 'desc' | 'manual';

export interface CollectionSorting {
  field: string; // field ID or 'manual_order'
  direction: CollectionSortDirection;
}

export interface Collection {
  id: string; // UUID
  name: string;
  uuid: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sorting: CollectionSorting | null;
  order: number;
  is_published: boolean;
  draft_items_count?: number;
  has_published_version?: boolean;
}

export interface CreateCollectionData {
  name: string;
  sorting?: CollectionSorting | null;
  order?: number;
  is_published?: boolean;
}

export interface UpdateCollectionData {
  name?: string;
  sorting?: CollectionSorting | null;
  order?: number;
}

/** Field-specific settings stored in the data column */
export interface CollectionFieldData {
  multiple?: boolean; // For asset fields - allow multiple files
  options?: { id: string; name: string }[]; // For option fields - selectable values
  // For count fields: which child collection / reference field to count back from
  count?: { collectionId: string; fieldId: string };
}

export interface CreateCollectionFieldData {
  name: string;
  key?: string | null;
  type: CollectionFieldType;
  default?: string | null;
  fillable?: boolean;
  order: number;
  collection_id: string; // UUID
  reference_collection_id?: string | null; // UUID
  hidden?: boolean;
  is_computed?: boolean;
  data?: CollectionFieldData;
  is_published?: boolean;
}

export interface UpdateCollectionFieldData {
  name?: string;
  key?: string | null;
  type?: CollectionFieldType;
  default?: string | null;
  fillable?: boolean;
  order?: number;
  reference_collection_id?: string | null; // UUID
  hidden?: boolean;
  data?: CollectionFieldData;
}

export interface CollectionField {
  id: string; // UUID
  name: string;
  key: string | null; // Built-in fields have a key to identify them
  type: CollectionFieldType;
  default: string | null;
  fillable: boolean;
  order: number;
  collection_id: string; // UUID
  reference_collection_id: string | null; // UUID
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  hidden: boolean;
  is_computed: boolean;
  data: CollectionFieldData;
  is_published: boolean;
}

export interface CollectionItem {
  id: string; // UUID
  collection_id: string; // UUID
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  manual_order: number;
  is_published: boolean;
  is_publishable: boolean;
  content_hash: string | null;
}

export interface CollectionItemValue {
  id: string; // UUID
  value: string | null;
  item_id: string; // UUID
  field_id: string; // UUID
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_published: boolean;
}

// Helper type for working with items + values
export interface CollectionItemWithValues extends CollectionItem {
  values: Record<string, string>; // field_id (UUID) -> value
  publish_status?: 'new' | 'updated' | 'deleted'; // Status badge for publish modal
}

// Global Variables (site-wide typed singletons)
//
// A global combines a field-like schema (name + type) and its value in one
// row. Its type is a subset of CollectionFieldType so it can ride the same
// FieldVariable binding/resolution/formatting rails as collection fields.
export type GlobalVariableType = Extract<
  CollectionFieldType,
  'text' | 'rich_text' | 'number' | 'date' | 'color' | 'image' | 'link'
>;

export const GLOBAL_VARIABLE_TYPES: readonly GlobalVariableType[] = [
  'text',
  'rich_text',
  'number',
  'date',
  'color',
  'image',
  'link',
] as const;

/** Runtime guard for an allowed global variable type (used by API validation). */
export function isValidGlobalVariableType(type: unknown): type is GlobalVariableType {
  return typeof type === 'string' && (GLOBAL_VARIABLE_TYPES as readonly string[]).includes(type);
}

export interface GlobalVariable {
  id: string; // UUID
  name: string;
  key: string | null; // Stable slug used for resolution/imports
  type: GlobalVariableType;
  value: string | null; // Stored as text, cast based on type (same as collection values)
  data: CollectionFieldData; // Type-specific config (format, options)
  order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateGlobalVariableData {
  name: string;
  key?: string | null;
  type: GlobalVariableType;
  value?: string | null;
  data?: CollectionFieldData;
  order?: number;
}

export interface UpdateGlobalVariableData {
  name?: string;
  key?: string | null;
  type?: GlobalVariableType;
  value?: string | null;
  data?: CollectionFieldData;
  order?: number;
}

// Collection Import Types
export type CollectionImportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CollectionImport {
  id: string; // UUID
  collection_id: string; // UUID
  status: CollectionImportStatus;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  column_mapping: Record<string, string>; // csvColumn -> fieldId
  csv_data: { storage_path: string } | Record<string, string>[] | null;
  errors: string[] | null;
  created_at: string;
  updated_at: string;
}

// Settings Types
export interface Setting {
  id: string;
  key: string;
  value: any;
  created_at: string;
  updated_at: string;
}

// Agent (AI builder) Settings
export type AgentProviderId = 'anthropic' | 'openai' | 'google' | 'xai';

/** Who a configured provider key is available to. */
export type AgentKeyScope = 'all' | 'personal';

export interface AgentProviderKeyStatus {
  /** Whether this provider has an API key (from settings or environment). */
  configured: boolean;
  /** Where the active key comes from. */
  source: 'setting' | 'env' | null;
  /** Availability of the active key: 'personal' = only the current user,
   * 'all' = everyone on the project (shared key or env var). */
  scope: AgentKeyScope | null;
  /** Masked hint of the configured key (e.g. "sk-ant-...wxyz"), never the full key. */
  maskedKey: string | null;
}

export interface AgentSettingsStatus {
  /** Whether at least one provider has an API key. */
  configured: boolean;
  /** Whether the agent is enabled in the builder (defaults to true). */
  agentEnabled: boolean;
  /** Per-provider key status. */
  providers: Record<AgentProviderId, AgentProviderKeyStatus>;
  /** Default model id. */
  model: string;
  /** Model ids the builder is allowed to use. */
  enabledModels: string[];
}

export interface UpdateAgentSettingsData {
  /** Per-provider keys; null removes the stored key; undefined keeps the current one. */
  keys?: Partial<Record<AgentProviderId, string | null>>;
  /** Per-provider key availability. With a new key: where to store it. Without
   * a key: moves the existing stored key to the given scope. */
  keyScopes?: Partial<Record<AgentProviderId, AgentKeyScope>>;
  model?: string;
  enabledModels?: string[];
  agentEnabled?: boolean;
}

// Color Variables
export interface ColorVariable {
  id: string;
  name: string;
  value: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VariableType {
  id?: string; // Reference to ComponentVariable.id (for component variable linking)
  type: 'field' | 'asset' | 'video'  | 'dynamic_rich_text' | 'dynamic_text'| 'static_text' | 'pagination';
  data: object;
}

// CMS Field Variable, used for CMS data binding and inline variables
export interface FieldVariable extends VariableType {
  type: 'field';
  data: {
    field_id: string | null;
    field_type: CollectionFieldType | null;
    relationships: string[];
    format?: string;
    /**
     * Source of the field data: 'page' for page collection, 'collection' for
     * collection layer, 'global' for a site-wide global variable.
     */
    source?: 'page' | 'collection' | 'global';
    /** ID of the collection layer this field belongs to (for nested collections) */
    collection_layer_id?: string;
    /**
     * ID of the global variable this binding points to (only when source is
     * 'global'). When set, field_id mirrors this value so the existing
     * resolution helpers can key on it uniformly.
     */
    global_id?: string;
    /** Pre-resolved raw value from injectCollectionData (survives stripSSROnlyData) */
    _resolvedValue?: string;
  };
}

// Asset ID Variable, used for image, audio, video, etc.
export interface AssetVariable extends VariableType {
  type: 'asset';
  data: {
    asset_id: StringAssetId | null;
  };
}

// Asset ID Variable, used for image, audio, video, etc.
export interface VideoVariable extends VariableType {
  type: 'video';
  data: {
    provider: 'youtube'; // | 'vimeo'
    video_id: string;
  };
}

// Dynamic Text Variable, contains text with inline variables (without formatting)
export interface DynamicTextVariable extends VariableType {
  type: 'dynamic_text';
  data: {
    content: string; // String with inline variables (no HTML)
  };
}

// Dynamic Rich Text Variable, contains rich text with formatting (bold, italic, etc.) + inline variables
export interface DynamicRichTextVariable extends VariableType {
  type: 'dynamic_rich_text';
  data: {
    content: object; // Tiptap JSON content with inline variables and formatting (bold, italic, etc.)
  };
}

// Static Text Variable, contains text without formatting and without inline variables
export interface StaticTextVariable extends VariableType {
  type: 'static_text';
  data: {
    content: string; // String without inline variables (no HTML)
  };
}

// Pagination Variable, an inline variable that resolves to a live pagination
// number (items shown/total, current/total pages) at render time. Lets the
// pagination count/info texts ("Showing 6 of 20", "Page 1 of 3") be edited and
// translated while keeping the numbers dynamic.
export interface PaginationVariable extends VariableType {
  type: 'pagination';
  data: {
    key: 'shown' | 'total' | 'current' | 'pages';
  };
}

export type InlineVariable = FieldVariable | PaginationVariable;

/** Live pagination numbers used to resolve `pagination` inline variables. */
export interface PaginationNumbers {
  shown: number;
  total: number;
  current: number;
  pages: number;
}

// Image settings value for component variables
export interface ImageSettingsValue {
  src?: AssetVariable | DynamicTextVariable | FieldVariable;
  alt?: DynamicTextVariable;
  width?: string;
  height?: string;
  loading?: 'lazy' | 'eager';
}

// Link settings value for component variables (alias to LinkSettings)
export type LinkSettingsValue = LinkSettings;

// Audio settings value for component variables
export interface AudioSettingsValue {
  src?: AssetVariable | DynamicTextVariable | FieldVariable;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  volume?: number;
}

// Video settings value for component variables
export interface VideoSettingsValue {
  src?: AssetVariable | VideoVariable | FieldVariable | DynamicTextVariable;
  poster?: AssetVariable | FieldVariable;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  autoplay?: boolean;
  youtubePrivacyMode?: boolean;
}

// Icon settings value for component variables
export interface IconSettingsValue {
  src?: AssetVariable | StaticTextVariable;
}

// Variant settings value for component variables. Stored on
// `componentOverrides.variant[<variableId>]` and as `default_value` on a
// `'variant'`-typed ComponentVariable. The variant_id is matched against the
// referenced nested component's variants at resolve time; a missing match
// silently falls back to the layer's own `componentVariantId`.
export interface VariantSettingsValue {
  variant_id: string;
}

// Visibility value for component variables. Stored on
// `componentOverrides.visibility[<variableId>]` and as `default_value` on a
// `'visibility'`-typed ComponentVariable. Layers linked through
// `settings.visibilityVariableId` render only when `visible` is true.
export interface VisibilitySettingsValue {
  visible: boolean;
}

// Element id value for component variables. Stored on
// `componentOverrides.id[<variableId>]` and as `default_value` on an
// `'id'`-typed ComponentVariable. Layers linked through
// `settings.idVariableId` render this as their HTML `id` attribute.
export interface IdSettingsValue {
  id: string;
}

// Component variable value type (text, image, link, audio, video, icon, variant, visibility, and id variables)
export type ComponentVariableValue = DynamicTextVariable | DynamicRichTextVariable | ImageSettingsValue | LinkSettingsValue | AudioSettingsValue | VideoSettingsValue | IconSettingsValue | VariantSettingsValue | VisibilitySettingsValue | IdSettingsValue;

// Pagination Layer Definition (partial Layer for styling pagination controls)
export interface PaginationLayerConfig {
  classes?: string;
  design?: DesignProperties;
}

// Layer Variable Types
export interface CollectionPaginationConfig {
  enabled: boolean;
  mode: 'pages' | 'load_more';
  items_per_page: number;
  // Stylable pagination layer configurations
  wrapperLayer?: PaginationLayerConfig;
  prevButtonLayer?: PaginationLayerConfig;
  nextButtonLayer?: PaginationLayerConfig;
  pageInfoLayer?: PaginationLayerConfig;
}

export interface CollectionVariable {
  id: string; // Collection ID
  sort_by?: 'none' | 'manual' | 'random' | string; // 'none', 'manual', 'random', or field ID
  sort_order?: 'asc' | 'desc'; // Only used when sort_by is a field ID
  sort_by_inputLayerId?: string; // Linked filter input controlling sort_by at runtime
  sort_order_inputLayerId?: string; // Linked filter input controlling sort_order at runtime
  limit?: number; // Maximum number of items to show (deprecated when pagination enabled)
  offset?: number; // Number of items to skip (deprecated when pagination enabled)
  source_field_id?: string; // Field ID from parent item (reference or multi-asset field), or field ID on child collection (inverse_reference)
  source_field_type?: 'reference' | 'multi_reference' | 'multi_asset' | 'inverse_reference'; // Type of source field
  source_field_source?: 'page' | 'collection'; // Source of the field (page data or collection layer)
  filters?: ConditionalVisibility; // Filter conditions to apply to collection items
  pagination?: CollectionPaginationConfig; // Pagination settings for collection
}

// Runtime pagination metadata (attached to layer during SSR, not saved to database)
export interface CollectionPaginationMeta {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  layerId: string; // To identify which collection layer this belongs to
  collectionId: string; // Collection ID for fetching more pages
  mode?: 'pages' | 'load_more'; // Pagination mode
  itemIds?: string[]; // For multi-reference filtering in load_more mode
  layerTemplate?: Layer[]; // Layer template for rendering new items in load_more mode
  // Full collection layer (sans children) — used by load-more (and filter)
  // to rebuild proper item wrappers (link/action/attributes) when items are
  // re-rendered client-side.
  collectionLayer?: Omit<Layer, 'children'>;
  // Whether SSR rendered this collection from published data. The client
  // must fetch load-more items from the same source so draft previews
  // don't accidentally append published rows (or vice versa).
  isPublished?: boolean;
  // Sort applied by SSR — load-more must mirror it or offset-based
  // paging will return overlapping (duplicate) items.
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  // Optional cap from `collectionVariable.limit` when pagination is enabled.
  // Treated as a max total: clamps `totalItems` and stops `load_more` once
  // reached, even if the underlying collection has more matching rows.
  maxTotal?: number;
  // The collection's configured `offset` — number of leading records to skip
  // BEFORE paginating. `totalItems` already excludes these, and the client
  // (load_more) must forward it so continued paging stays past the offset.
  baseOffset?: number;
}

// Conditional Visibility Types
// Operators are grouped by field type for type-aware condition building

export type TextOperator = 'is' | 'is_not' | 'contains' | 'does_not_contain' | 'is_present' | 'is_empty';
export type NumberOperator = 'is' | 'is_not' | 'lt' | 'lte' | 'gt' | 'gte';
export type DateOperator = 'is' | 'is_before' | 'is_after' | 'is_between' | 'is_empty' | 'is_not_empty';
export type BooleanOperator = 'is';
export type ReferenceOperator = 'is_one_of' | 'is_not_one_of' | 'exists' | 'does_not_exist';
export type MultiReferenceOperator = 'is_one_of' | 'is_not_one_of' | 'contains_all_of' | 'contains_exactly' | 'item_count' | 'has_items' | 'has_no_items';
export type PageCollectionOperator = 'item_count' | 'has_items' | 'has_no_items';
// Self filter: compare the item's own ID against a set of IDs (statically picked
// and/or the current dynamic page item). Mirrors reference field semantics.
export type SelfOperator = 'is_one_of' | 'is_not_one_of';

export type VisibilityOperator =
  | TextOperator
  | NumberOperator
  | DateOperator
  | BooleanOperator
  | ReferenceOperator
  | MultiReferenceOperator
  | PageCollectionOperator
  | SelfOperator;

export interface VisibilityCondition {
  id: string;
  source: 'collection_field' | 'page_collection' | 'self';
  // For collection_field source
  fieldId?: string;
  fieldType?: CollectionFieldType;
  referenceCollectionId?: string; // For reference fields - the collection to fetch items from
  operator: VisibilityOperator;
  value?: string; // For is_one_of/is_not_one_of: JSON array of item IDs
  value2?: string; // For 'is_between' date operator
  // For page_collection source
  collectionLayerId?: string;
  collectionLayerName?: string; // Display name for the layer
  compareOperator?: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'; // For 'item_count' operator
  compareValue?: number; // For 'item_count' operator
  // For self source: when true, the current dynamic page item ID is injected
  // into the comparison set alongside any statically picked IDs in `value`.
  includesCurrentPageItem?: boolean;
  // How the compare value is sourced. Defaults to 'static' (uses `value`).
  // 'current_page' binds the compare value to the current dynamic page item:
  //   - reference/multi_reference fields compare against the page item's own ID
  //     (the "Current Category/Tag" pattern)
  //   - scalar fields compare against the value of `currentPageFieldId` on the
  //     current page item
  valueMode?: 'static' | 'current_page';
  // For scalar fields with valueMode 'current_page': the field on the current
  // dynamic page item whose value is used as the compare value.
  currentPageFieldId?: string;
  // For linking filter value to an input layer inside a Filter
  inputLayerId?: string;
  inputLayerId2?: string; // For second bound (e.g. 'is_between')
  // Date fields only: marks the value as sourced from a filter form input
  // (vs. a preset or custom date). Persisted so the UI stays in input mode
  // even before an input is linked. Absent on conditions created before this
  // existed — those fall back to linked-state/custom inference.
  dateInput?: boolean;
  // Same as `dateInput`, but for the second bound (`is_between`).
  dateInput2?: boolean;
}

export interface VisibilityConditionGroup {
  id: string;
  conditions: VisibilityCondition[];
}

export interface ConditionalVisibility {
  groups: VisibilityConditionGroup[];
}

/**
 * A single condition in a serialized dynamic-date visibility rule (static export).
 * Date-preset conditions are re-evaluated against the current date on the client;
 * all other conditions carry their export-time result, baked in.
 */
export type DynamicVisibilityCondition =
  | { dynamic: true; operator: VisibilityOperator; value: string; fieldValue: string; dateOnly?: boolean }
  | { dynamic: false; result: boolean };

// Localisation Types

/**
 * Locale option (predefined locale configuration)
 */
export interface LocaleOption {
  code: string; // Language code (ISO 639-1)
  label: string; // English label
  native_label: string; // Native language label
  rtl?: boolean; // Right-to-left language
}

/**
 * Locale (database entity)
 */
export interface Locale {
  id: string;
  code: string;
  label: string;
  is_default: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateLocaleData {
  code: string;
  label: string;
  is_default?: boolean;
}

export interface UpdateLocaleData {
  code?: string;
  label?: string;
  is_default?: boolean;
}

export type TranslationSourceType = 'page' | 'folder' | 'component' | 'cms'
export type TranslationContentType = 'text' | 'richtext' | 'asset_id' | 'code'

export interface Translation {
  id: string;
  locale_id: string;
  source_type: TranslationSourceType;
  source_id: string;
  content_key: string;
  content_type: TranslationContentType;
  content_value: string;
  is_completed: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateTranslationData {
  locale_id: string;
  source_type: TranslationSourceType;
  source_id: string;
  content_key: string;
  content_type: TranslationContentType;
  content_value: string;
  is_completed?: boolean;
}

export interface UpdateTranslationData {
  content_value?: string;
  is_completed?: boolean;
}

// Version Types (for undo/redo functionality)
export type VersionEntityType = 'page_layers' | 'component' | 'layer_style';
export type VersionActionType = 'create' | 'update' | 'delete';

export interface VersionMetadata {
  // Layer selection - ordered by priority (index 0 = highest priority)
  selection?: {
    layer_ids?: string[];
  };
  // Requirements for undo operations (e.g., components/styles that must exist before undoing)
  requirements?: {
    component_ids?: string[]; // Array of component IDs that must exist/be restored before undoing
    layer_style_ids?: string[]; // Array of layer style IDs that must exist/be restored before undoing
  };
}

export interface Version {
  id: string;
  entity_type: VersionEntityType;
  entity_id: string;
  action_type: VersionActionType;
  description: string | null;
  redo: object; // Forward patch - applies the change (JSON Patch RFC 6902)
  undo: object | null; // Inverse patch - reverts the change
  snapshot: object | null; // Full snapshot (stored periodically)
  previous_hash: string | null;
  current_hash: string;
  session_id: string | null;
  created_at: string;
  metadata: VersionMetadata | null; // Additional context (e.g., selected layer, viewport state)
}

export interface CreateVersionData {
  entity_type: VersionEntityType;
  entity_id: string;
  action_type: VersionActionType;
  description?: string | null;
  redo: object; // Forward patch
  undo?: object | null; // Inverse patch
  snapshot?: object | null;
  previous_hash?: string | null;
  current_hash: string;
  session_id?: string | null;
  metadata?: VersionMetadata | null;
}

export interface VersionHistoryItem {
  id: string;
  action_type: VersionActionType;
  description: string | null;
  created_at: string;
}

// Form Submission Types
export type FormSubmissionStatus = 'new' | 'read' | 'archived' | 'spam';

export interface FormSubmissionMetadata {
  ip?: string;
  user_agent?: string;
  referrer?: string;
  page_url?: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  payload: Record<string, any>;
  metadata: FormSubmissionMetadata | null;
  status: FormSubmissionStatus;
  created_at: string;
}

export interface CreateFormSubmissionData {
  form_id: string;
  payload: Record<string, any>;
  metadata?: FormSubmissionMetadata;
  status?: FormSubmissionStatus;
}

export interface UpdateFormSubmissionData {
  status?: FormSubmissionStatus;
}

// Form summary for listing (grouped by form_id)
export interface FormSummary {
  form_id: string;
  submission_count: number;
  new_count: number;
  latest_submission: string | null;
}

// Font Types
export type FontType = 'google' | 'custom' | 'default';

export interface FontAxis {
  tag: string;
  start: number;
  end: number;
}

export interface Font {
  id: string;
  name: string; // Slug-friendly name (e.g., "open-sans")
  family: string; // Display family name (e.g., "Open Sans")
  type: FontType;
  variants: string[]; // Available variants (e.g., ["regular", "italic", "700"])
  weights: string[]; // Available weights (e.g., ["400", "700"])
  category: string; // Font category (e.g., "sans-serif", "serif")
  axes?: FontAxis[] | null; // Variable font axes (e.g., opsz, wdth)
  kind?: string | null; // Font format for custom fonts (e.g., "woff2", "truetype")
  url?: string | null; // Public URL for custom font file
  storage_path?: string | null; // Storage path for custom font file
  file_hash?: string | null; // File content hash for custom fonts
  content_hash?: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateFontData {
  name: string;
  family: string;
  type: FontType;
  variants: string[];
  weights: string[];
  category: string;
  axes?: FontAxis[] | null;
  kind?: string | null;
  url?: string | null;
  storage_path?: string | null;
  file_hash?: string | null;
}

export interface UpdateFontData {
  name?: string;
  family?: string;
  variants?: string[];
  weights?: string[];
  category?: string;
}

// Sitemap Settings
export type SitemapMode = 'none' | 'auto' | 'custom';
export type SitemapChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export interface SitemapSettings {
  mode: SitemapMode;
  // Auto-generated sitemap options
  includeImages?: boolean;
  defaultChangeFrequency?: SitemapChangeFrequency;
  // Custom XML sitemap (when mode is 'custom')
  customXml?: string;
}

/** Stats for a single table during publishing */
export interface PublishTableStats {
  durationMs: number;
  added: number;
  updated: number;
  deleted: number;
}

/**
 * AI builder chat history, stored server-side so conversations are shared
 * across the team and survive browser data clearing.
 *
 * `messages` is the stripped transcript (text, tool calls, parts, mentions —
 * no image data or revert checkpoints). Its canonical shape is `ChatMessage`
 * in `stores/useAiChatStore.ts`; the server persists it as opaque JSON and
 * never inspects individual entries, hence `unknown[]`.
 */
export interface AiChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface AiChat extends AiChatSummary {
  messages: unknown[];
  created_at: string;
}

export interface UpsertAiChatData {
  id: string;
  title: string;
  messages: unknown[];
}

/** Aggregated publishing statistics returned by the publish API */
export interface PublishStats {
  totalDurationMs: number;
  tables: {
    page_folders: PublishTableStats;
    pages: PublishTableStats;
    page_layers: PublishTableStats;
    collections: PublishTableStats;
    collection_fields: PublishTableStats;
    collection_items: PublishTableStats;
    collection_item_values: PublishTableStats;
    components: PublishTableStats;
    layer_styles: PublishTableStats;
    asset_folders: PublishTableStats;
    assets: PublishTableStats;
    locales: PublishTableStats;
    translations: PublishTableStats;
    global_variables: PublishTableStats;
    css: PublishTableStats;
  };
}
