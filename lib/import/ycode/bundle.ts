'use client';

/**
 * Ycode internal clipboard bundle.
 *
 * Unlike Webflow/Figma (which arrive as foreign payloads), an internal copy is
 * a full-fidelity Ycode `Layer` tree. To make copy/paste work across tabs and
 * browsers we serialize that tree PLUS the project-scoped entities it depends on
 * (layer styles, components, assets, fonts) onto the OS clipboard as signed
 * JSON. On paste the dependencies are re-materialized in the target project and
 * every foreign id is remapped — exactly the way the Webflow/Figma importer
 * recreates its dependencies.
 *
 * Assets travel as URLs (or inline SVG content), never bytes, so the bundle
 * stays small; the paste side re-hosts them like an import does.
 */

import type { Asset, ColorVariable, Component, Layer, LayerStyle } from '@/types';
import { useLayerStylesStore } from '@/stores/useLayerStylesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';
import { colorVarIdsFromClasses } from '@/lib/color-variable-utils';
import { getStyleIds } from '@/lib/layer-style-resolve';

export const YCODE_CLIPBOARD_SIGNATURE = '__ycode_clipboard__';
export const YCODE_CLIPBOARD_VERSION = 1;

/**
 * Legacy bare marker. Written when the full bundle can't be (build failed or
 * oversized) so a stale Webflow/Figma payload on the OS clipboard is still
 * cleared and same-tab paste falls through to the in-memory clipboard. Must stay
 * in sync with `YCODE_LAYER_CLIPBOARD_SIGNATURE` in `useClipboardStore`.
 */
const YCODE_LEGACY_MARKER = '__ycode-internal-clipboard__';

/**
 * Hard cap on the serialized bundle size. The OS clipboard (and especially the
 * async Clipboard API under some browsers) chokes on very large strings, and
 * the import side already has a "truncated" failure mode. Past this we fall back
 * to the in-memory clipboard (same-tab paste still works).
 */
export const YCODE_CLIPBOARD_MAX_BYTES = 4_000_000;

/** Minimal asset payload — enough to re-host or recreate in the target. */
export interface YcodeClipboardAsset {
  id: string;
  public_url: string | null;
  filename: string;
  mime_type: string;
  /** Inline SVG body for icon assets (no storage_path/public_url). */
  content?: string | null;
  width?: number | null;
  height?: number | null;
}

/** A CMS reference we record only so the paste side can warn (data can't move). */
export interface YcodeClipboardCmsRef {
  type: 'collection' | 'field';
}

/** A color-variable token definition referenced by the copied classes. */
export interface YcodeClipboardColorVariable {
  id: string;
  name: string;
  value: string;
}

export interface YcodeClipboardBundle {
  signature: typeof YCODE_CLIPBOARD_SIGNATURE;
  version: number;
  /** Identity of the source project; lets paste take a no-op fast path. */
  sourceProjectId: string;
  /**
   * Identity of the source TAB. When a same-project paste comes from a different
   * tab, shared token stores (fonts, color variables) may be stale here and are
   * refreshed; a same-tab paste already has everything loaded.
   */
  sourceTabId: string;
  layers: Layer[];
  styles: LayerStyle[];
  components: Component[];
  assets: YcodeClipboardAsset[];
  fonts: string[];
  /** Color-variable tokens (design tokens) referenced via `var(--id)` in classes. */
  colorVariables: YcodeClipboardColorVariable[];
  cms: YcodeClipboardCmsRef[];
}

/**
 * Stable identity for "the same project". In the self-hosted/opensource build
 * each deployment is one project backed by one database, so the page origin is
 * a reliable discriminator: two tabs (or Chrome vs Safari) pointed at the same
 * deployment share an origin and thus all ids; a different deployment has a
 * different origin and needs full materialization.
 */
export function getProjectIdentity(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/** Stable per-tab (per page-load) identity, used to detect cross-tab pastes. */
let cachedTabId: string | null = null;
export function getTabIdentity(): string {
  if (cachedTabId) return cachedTabId;
  cachedTabId = `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  return cachedTabId;
}

export function isYcodeClipboard(text: string): boolean {
  return text.includes(YCODE_CLIPBOARD_SIGNATURE);
}

/** Parse + validate a bundle off the OS clipboard. Returns null when it isn't one. */
export function parseYcodeClipboard(text: string): YcodeClipboardBundle | null {
  if (!isYcodeClipboard(text)) return null;
  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      parsed.signature === YCODE_CLIPBOARD_SIGNATURE &&
      Array.isArray(parsed.layers)
    ) {
      return {
        signature: YCODE_CLIPBOARD_SIGNATURE,
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        sourceProjectId: typeof parsed.sourceProjectId === 'string' ? parsed.sourceProjectId : '',
        sourceTabId: typeof parsed.sourceTabId === 'string' ? parsed.sourceTabId : '',
        layers: parsed.layers,
        styles: Array.isArray(parsed.styles) ? parsed.styles : [],
        components: Array.isArray(parsed.components) ? parsed.components : [],
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        fonts: Array.isArray(parsed.fonts) ? parsed.fonts : [],
        colorVariables: Array.isArray(parsed.colorVariables) ? parsed.colorVariables : [],
        cms: Array.isArray(parsed.cms) ? parsed.cms : [],
      };
    }
  } catch {
    /* not JSON / truncated */
  }
  return null;
}

export function serializeBundle(bundle: YcodeClipboardBundle): string {
  return JSON.stringify(bundle);
}

// ---------------------------------------------------------------------------
// Shared tree walkers (used by both copy-time collection and paste-time remap)
// ---------------------------------------------------------------------------

/** Depth-first visit of a layer tree (the node and all descendants). */
export function walkLayerTree(layers: Layer[], visit: (layer: Layer) => void): void {
  for (const layer of layers) {
    visit(layer);
    if (layer.children && layer.children.length > 0) walkLayerTree(layer.children, visit);
  }
}

/** The layer trees backing a component across all its variants. */
export function componentVariantLayers(component: Component): Layer[][] {
  const variants = component.variants && component.variants.length > 0
    ? component.variants
    : [{ id: '', name: 'Default', layers: component.layers ?? [] }];
  return variants.map((v) => v.layers ?? []);
}

/**
 * Resolve every component (transitively, following nested instances) referenced
 * by a set of root layers, keyed by id.
 */
export function collectComponentClosure(
  rootLayers: Layer[],
  getComponent: (id: string) => Component | undefined,
): Map<string, Component> {
  const result = new Map<string, Component>();
  const queue: Layer[][] = [rootLayers];

  while (queue.length > 0) {
    const layers = queue.shift()!;
    walkLayerTree(layers, (layer) => {
      const id = layer.componentId;
      if (!id || result.has(id)) return;
      const component = getComponent(id);
      if (!component) return;
      result.set(id, component);
      for (const tree of componentVariantLayers(component)) queue.push(tree);
    });
  }

  return result;
}

/** Style ids a single layer references (stack + per-chip override keys + text styles). */
export function layerStyleIds(layer: Layer): string[] {
  const ids = new Set<string>(getStyleIds(layer));
  if (layer.styleOverridesByStyle) {
    for (const id of Object.keys(layer.styleOverridesByStyle)) ids.add(id);
  }
  // Rich-text "text styles" (bold/italic/etc.) can each reference a LayerStyle.
  if (layer.textStyles) {
    for (const textStyle of Object.values(layer.textStyles)) {
      if (textStyle.styleId) ids.add(textStyle.styleId);
    }
  }
  return [...ids];
}

/**
 * Recursively find every asset id referenced anywhere in an arbitrary value.
 * Covers the two shapes assets appear in: `AssetVariable` (`{ type: 'asset',
 * data: { asset_id } }`) and link assets (`asset: { id }`).
 */
export function collectAssetIds(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectAssetIds(item, out);
    return;
  }

  const obj = value as Record<string, unknown>;

  if (obj.type === 'asset' && obj.data && typeof obj.data === 'object') {
    const id = (obj.data as Record<string, unknown>).asset_id;
    if (typeof id === 'string') out.add(id);
  }

  const asset = obj.asset as Record<string, unknown> | undefined;
  if (asset && typeof asset === 'object' && typeof asset.id === 'string') {
    out.add(asset.id);
  }

  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue; // skip SSR-only resolved data
    collectAssetIds(obj[key], out);
  }
}

/** True when an arbitrary value contains a CMS field/collection binding. */
export function hasCmsBinding(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasCmsBinding(item));

  const obj = value as Record<string, unknown>;
  if (obj.type === 'field') return true;
  if (obj.collection && typeof obj.collection === 'object') return true;

  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue;
    if (hasCmsBinding(obj[key])) return true;
  }
  return false;
}

const FONT_CLASS_RE = /font-\[([^\]]+)\]/g;

/** Pull Google-font family names out of a class string (skips numeric weights). */
export function fontFamiliesFromClasses(classes: string | string[] | undefined, out: Set<string>): void {
  if (!classes) return;
  const str = Array.isArray(classes) ? classes.join(' ') : classes;
  let match: RegExpExecArray | null;
  FONT_CLASS_RE.lastIndex = 0;
  while ((match = FONT_CLASS_RE.exec(str)) !== null) {
    const raw = match[1];
    if (/^\d/.test(raw)) continue; // font-[700] is a weight, not a family
    const family = raw.replace(/_/g, ' ').trim();
    if (family && family !== 'sans' && family !== 'serif' && family !== 'mono') {
      out.add(family);
    }
  }
}

// ---------------------------------------------------------------------------
// Bundle construction (copy time)
// ---------------------------------------------------------------------------

function toClipboardAsset(asset: Asset): YcodeClipboardAsset {
  return {
    id: asset.id,
    public_url: absoluteUrl(asset.public_url),
    filename: asset.filename,
    mime_type: asset.mime_type,
    content: asset.content ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

/** Make a possibly-relative asset URL absolute so another origin can fetch it. */
function absoluteUrl(url: string | null): string | null {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

/**
 * Build a self-contained clipboard bundle for the given layers, gathering all
 * project-scoped dependencies (styles, components, assets, fonts) so the paste
 * side can recreate them in another project.
 */
export function buildYcodeClipboardBundle(layers: Layer[]): YcodeClipboardBundle {
  const stylesStore = useLayerStylesStore.getState();
  const componentsStore = useComponentsStore.getState();
  const assetsStore = useAssetsStore.getState();
  const colorVariablesStore = useColorVariablesStore.getState();

  const components = collectComponentClosure(layers, (id) => componentsStore.getComponentById(id));

  // Every tree we must scan for dependencies: the roots plus all component variants.
  const allTrees: Layer[][] = [layers];
  for (const component of components.values()) {
    for (const tree of componentVariantLayers(component)) allTrees.push(tree);
  }

  const styleIds = new Set<string>();
  const assetIds = new Set<string>();
  const fonts = new Set<string>();
  const colorVarIds = new Set<string>();
  let collectionRefs = 0;
  let fieldRefs = 0;

  for (const tree of allTrees) {
    walkLayerTree(tree, (layer) => {
      for (const id of layerStyleIds(layer)) styleIds.add(id);
      if (layer.variables) {
        collectAssetIds(layer.variables, assetIds);
        if (layer.variables.collection) collectionRefs += 1;
        if (hasCmsBinding(layer.variables)) fieldRefs += 1;
      }
      if (layer.componentOverrides) collectAssetIds(layer.componentOverrides, assetIds);
      if (layer.settings) collectAssetIds(layer.settings, assetIds);
      fontFamiliesFromClasses(layer.classes, fonts);
      fontFamiliesFromClasses(layer.styleOverrides?.classes, fonts);
      colorVarIdsFromClasses(layer.classes, colorVarIds);
      colorVarIdsFromClasses(layer.styleOverrides?.classes, colorVarIds);
      if (layer.styleOverridesByStyle) {
        for (const override of Object.values(layer.styleOverridesByStyle)) {
          fontFamiliesFromClasses(override.classes, fonts);
          colorVarIdsFromClasses(override.classes, colorVarIds);
        }
      }
      if (layer.textStyles) {
        for (const textStyle of Object.values(layer.textStyles)) {
          fontFamiliesFromClasses(textStyle.classes, fonts);
          fontFamiliesFromClasses(textStyle.styleOverrides?.classes, fonts);
          colorVarIdsFromClasses(textStyle.classes, colorVarIds);
          colorVarIdsFromClasses(textStyle.styleOverrides?.classes, colorVarIds);
        }
      }
    });
  }

  const styles: LayerStyle[] = [];
  for (const id of styleIds) {
    const style = stylesStore.getStyleById(id);
    if (style) {
      styles.push(style);
      fontFamiliesFromClasses(style.classes, fonts);
      colorVarIdsFromClasses(style.classes, colorVarIds);
    }
  }

  // Only embed ids that resolve to a real token (skips Tailwind `--tw-*` vars).
  const colorVariables: YcodeClipboardColorVariable[] = [];
  for (const id of colorVarIds) {
    const variable = colorVariablesStore.getVariableById(id);
    if (variable) {
      colorVariables.push({ id: variable.id, name: variable.name, value: variable.value });
    }
  }

  const assets: YcodeClipboardAsset[] = [];
  for (const id of assetIds) {
    const asset = assetsStore.getAsset(id);
    if (asset) assets.push(toClipboardAsset(asset));
  }

  const cms: YcodeClipboardCmsRef[] = [
    ...Array.from({ length: collectionRefs }, () => ({ type: 'collection' as const })),
    ...Array.from({ length: fieldRefs }, () => ({ type: 'field' as const })),
  ];

  return {
    signature: YCODE_CLIPBOARD_SIGNATURE,
    version: YCODE_CLIPBOARD_VERSION,
    sourceProjectId: getProjectIdentity(),
    sourceTabId: getTabIdentity(),
    layers,
    styles,
    components: [...components.values()],
    assets,
    fonts: [...fonts],
    colorVariables,
    cms,
  };
}

/**
 * Build + serialize a bundle and write it to the OS clipboard (best effort).
 * Returns false when the bundle is too large or the clipboard is unavailable,
 * so the caller can leave the in-memory clipboard as the only path.
 */
export async function writeYcodeClipboard(layers: Layer[]): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;

  // Build the bundle up front; on failure or oversize we fall back to the marker.
  let text: string | null = null;
  try {
    const serialized = serializeBundle(buildYcodeClipboardBundle(layers));
    if (serialized.length <= YCODE_CLIPBOARD_MAX_BYTES) text = serialized;
  } catch {
    text = null;
  }

  try {
    if (text) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Too big / unbuildable: still claim the OS clipboard so a stale Webflow or
    // Figma payload isn't re-imported on paste; same-tab in-memory paste works.
    await navigator.clipboard.writeText(YCODE_LEGACY_MARKER);
    return false;
  } catch {
    return false;
  }
}
