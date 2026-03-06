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
  textTransform?: string;
  textDecoration?: string;
  textDecorationColor?: string;
  textDecorationThickness?: string;
  underlineOffset?: string;
  verticalAlign?: string;
  color?: string;
  placeholderColor?: string;
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
  aspectRatio?: string | null;
  objectFit?: string | null;
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

export interface DesignProperties {
  layout?: LayoutDesign;
  typography?: TypographyDesign;
  spacing?: SpacingDesign;
  sizing?: SizingDesign;
  borders?: BordersDesign;
  backgrounds?: BackgroundsDesign;
  effects?: EffectsDesign;
  positioning?: PositioningDesign;
}

export interface FormSettings {
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

export interface SliderSettings {
  navigation: boolean;
  groupSlide: number;
  slidesPerGroup: number;
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
  hidden?: boolean; // Element visibility in canvas
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
    defaultItemId?: string; // item ID to pre-select as default
    sortFieldId?: string; // field ID to sort options by (undefined = manual/insertion order)
    sortOrder?: 'asc' | 'desc'; // sort direction (defaults to 'asc')
  };
  selectOptionsMode?: 'list' | 'sort_by' | 'sort_order'; // Builder source mode for select options
  sortByCollectionId?: string; // Collection to source sort-by field options from
  sortByFieldIds?: string[]; // Which field IDs are enabled as sort-by options
}

// Layer Style Types
export interface LayerStyle {
  id: string;
  name: string;

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

export type TweenPropertyKey = 'x' | 'y' | 'rotation' | 'scale' | 'skewX' | 'skewY' | 'autoAlpha' | 'display';

export type InteractionApplyStyles = Record<TweenPropertyKey, ApplyStyles>;

export type TweenProperties = {
  [K in TweenPropertyKey]?: string | null;
};

export interface TextStyle {
  label?: string; // Display label for the style (e.g., "Bold", "Italic")
  classes?: string;
  design?: DesignProperties;
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
  styleId?: string; // Reference to applied LayerStyle
  styleOverrides?: {
    classes?: string;
    design?: DesignProperties;
  }; // Tracks local changes after style applied

  // Components (reusable layer trees)
  componentId?: string; // Reference to applied Component
  componentOverrides?: {
    text?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (text)
    image?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (image)
    link?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (link)
    audio?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (audio)
    video?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (video)
    icon?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (icon)
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
  // SSR-only property for pagination metadata (when pagination is enabled)
  _paginationMeta?: CollectionPaginationMeta;
  // SSR-only property for dynamic inline styles from CMS color field bindings
  _dynamicStyles?: Record<string, string>;
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
    paginationMode?: 'pages' | 'load_more';
    layerTemplate: Layer[];
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
export type CollectionLinkType = 'url' | 'page';

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
  type?: 'text' | 'image' | 'link' | 'audio' | 'video' | 'icon'; // Variable type (defaults to 'text' for backwards compatibility)
  placeholder?: string; // Placeholder text shown in text override inputs
  default_value?: ComponentVariableValue; // Default value
}

// Component Types (Reusable Layer Trees)
export interface Component {
  id: string;
  name: string;

  // Component data - complete layer tree
  layers: Layer[];

  // Component variables - exposed properties for overrides
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
  created_at: string;
  updated_at: string;
  deleted_at: string | null; // Soft delete timestamp
}

export interface PageSettings {
  cms?: {
    collection_id: string;
    slug_field_id: string;
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

export interface EmailSettings {
  enabled: boolean;
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
}

// Internal credentials structure (derived from SupabaseConfig)
export interface SupabaseCredentials {
  anonKey: string;
  serviceRoleKey: string;
  connectionUrl: string; // Original with placeholder
  dbPassword: string;
  // Derived properties
  projectId: string;
  projectUrl: string; // API URL: https://[PROJECT_ID].supabase.co
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
export type CollectionFieldType = 'text' | 'number' | 'boolean' | 'date' | 'color' | 'reference' | 'multi_reference' | 'rich_text' | 'image' | 'audio' | 'video' | 'document' | 'link' | 'email' | 'phone' | 'status';
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
  csv_data: Record<string, string>[]; // Array of row objects
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

export interface VariableType {
  id?: string; // Reference to ComponentVariable.id (for component variable linking)
  type: 'field' | 'asset' | 'video'  | 'dynamic_rich_text' | 'dynamic_text'| 'static_text';
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
    /** Source of the field data: 'page' for page collection, 'collection' for collection layer */
    source?: 'page' | 'collection';
    /** ID of the collection layer this field belongs to (for nested collections) */
    collection_layer_id?: string;
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

export type InlineVariable = FieldVariable;

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

// Component variable value type (text, image, link, audio, video, and icon variables)
export type ComponentVariableValue = DynamicTextVariable | DynamicRichTextVariable | ImageSettingsValue | LinkSettingsValue | AudioSettingsValue | VideoSettingsValue | IconSettingsValue;

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
  source_field_id?: string; // Field ID from parent item (reference or multi-asset field)
  source_field_type?: 'reference' | 'multi_reference' | 'multi_asset'; // Type of source field
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

export type VisibilityOperator =
  | TextOperator
  | NumberOperator
  | DateOperator
  | BooleanOperator
  | ReferenceOperator
  | MultiReferenceOperator
  | PageCollectionOperator;

export interface VisibilityCondition {
  id: string;
  source: 'collection_field' | 'page_collection';
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
  // For linking filter value to an input layer inside a Filter
  inputLayerId?: string;
  inputLayerId2?: string; // For second bound (e.g. 'is_between')
}

export interface VisibilityConditionGroup {
  id: string;
  conditions: VisibilityCondition[];
}

export interface ConditionalVisibility {
  groups: VisibilityConditionGroup[];
}

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
export type TranslationContentType = 'text' | 'richtext' | 'asset_id'

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
    css: PublishTableStats;
  };
}
