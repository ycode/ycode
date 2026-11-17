/**
 * Design property source resolution.
 *
 * Explains where the value a design control shows comes from: every class
 * that sets the property for the active breakpoint/state, across parent
 * inheritance, the layer's style stack and text style, ordered from lowest to
 * highest priority.
 */

import { getLayerName } from '@/lib/layer-display-utils';
import { chipClasses, getStyleIds, hasChipOverride } from '@/lib/layer-style-resolve';
import { getBreakpointInheritanceChain, getInheritedValue, getPropertyClassAt } from '@/lib/tailwind-class-mapper';
import { getTextStyle, getTextStyleLabel } from '@/lib/text-format-utils';
import type { Breakpoint, Layer, LayerStyle, UIState } from '@/types';

export type DesignSourceKind = 'parent' | 'element' | 'elementStyle' | 'layerStyle' | 'textStyle';

export const DESIGN_SOURCE_KIND_LABELS: Record<DesignSourceKind, string> = {
  parent: 'Parent',
  element: 'Element',
  elementStyle: 'Element style',
  layerStyle: 'Layer style',
  textStyle: 'Text style',
};

/** Design properties whose CSS value is inherited from parent elements */
export const INHERITED_DESIGN_PROPERTIES = new Set([
  'color',
  'cursor',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textShadow',
  'textTransform',
]);

/** A class source in the cascade: a parent, a layer style, the element itself or a text style */
export interface DesignSource {
  /** Style, text style or element name */
  label: string;
  kind: DesignSourceKind;
  /** Classes the source renders */
  classes: string[];
  /** Layer style the source belongs to */
  styleId?: string;
  /** Parent layer the source belongs to */
  layerId?: string;
  /** Shared classes of a layer style this element customized; they rank below the customization */
  sharedClasses?: string[];
}

/** What the design panel renders, shared with its setting labels */
export interface DesignPanelSource {
  /** Class sources, low -> high priority */
  sources: DesignSource[];
  /** Parent elements, nearest first, for inherited properties */
  parents: DesignSource[];
}

/** One class in a property's override chain */
export interface DesignSourceStep {
  className: string;
  breakpoint: Breakpoint;
  uiState: UIState;
  label: string;
  kind: DesignSourceKind;
  styleId?: string;
  layerId?: string;
  /** Set by this element's customization of the layer style, not the shared style */
  isCustomized: boolean;
}

function splitClasses(classes: string | string[] | undefined): string[] {
  if (!classes) return [];
  return (Array.isArray(classes) ? classes.join(' ') : classes).split(/\s+/).filter(Boolean);
}

/** The layer's class sources: its style stack (with customizations) or its own classes */
function getLayerSources(layer: Layer, stylesById: Map<string, LayerStyle>): DesignSource[] {
  const layerName = getLayerName(layer);
  const styleIds = getStyleIds(layer).filter((id) => stylesById.has(id));

  if (styleIds.length === 0) {
    return [{ label: layerName, kind: 'element', classes: splitClasses(layer.classes) }];
  }

  const sources: DesignSource[] = styleIds.map((id) => {
    const style = stylesById.get(id)!;
    return {
      label: style.name,
      kind: 'layerStyle',
      classes: splitClasses(chipClasses(layer, id, stylesById)),
      styleId: id,
      sharedClasses: hasChipOverride(layer, id) ? splitClasses(style.classes) : undefined,
    };
  });

  if (layer.styleOverrides?.classes) {
    sources.push({
      label: layerName,
      kind: 'elementStyle',
      classes: splitClasses(layer.styleOverrides.classes),
    });
  }

  return sources;
}

/**
 * Describe the class sources behind a layer's design, low -> high priority.
 * A rich-text text style applies on top of the layer's classes.
 */
export function getDesignPanelSource(
  layer: Layer,
  options: {
    textStyleKey?: string | null;
    stylesById: Map<string, LayerStyle>;
    /** Parent layers, nearest first */
    ancestors?: Layer[];
  },
): DesignPanelSource {
  const { textStyleKey, stylesById, ancestors = [] } = options;
  const sources = getLayerSources(layer, stylesById);
  const parents: DesignSource[] = ancestors.map((ancestor) => ({
    label: getLayerName(ancestor),
    kind: 'parent',
    classes: splitClasses(ancestor.classes),
    layerId: ancestor.id,
  }));

  if (textStyleKey) {
    const textStyle = getTextStyle(layer.textStyles, textStyleKey);
    sources.push({
      label: getTextStyleLabel(textStyleKey, textStyle),
      kind: 'textStyle',
      classes: splitClasses(textStyle?.classes),
    });
  }

  return { sources, parents };
}

/** Readable name of a design property, e.g. 'minWidth' -> 'Min width' */
export function getDesignPropertyLabel(property: string): string {
  const words = property.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Consecutive chain steps that come from the same source */
export interface DesignSourceStepGroup {
  key: string;
  steps: DesignSourceStep[];
}

/**
 * Group consecutive steps from the same source (e.g. a layer style and its
 * customization) so the source is shown once. Order is preserved.
 */
export function groupDesignSourceSteps(steps: DesignSourceStep[]): DesignSourceStepGroup[] {
  const groups: DesignSourceStepGroup[] = [];
  for (const step of steps) {
    const key = [step.kind, step.label, step.styleId ?? '', step.layerId ?? ''].join('|');
    const last = groups.at(-1);
    if (last?.key === key) {
      last.steps.push(step);
    } else {
      groups.push({ key, steps: [step] });
    }
  }
  return groups;
}

/** The nearest parent's class for an inherited property, or null */
function getInheritedParentStep(
  property: string,
  parents: DesignSource[],
  breakpoint: Breakpoint,
): DesignSourceStep | null {
  if (!INHERITED_DESIGN_PROPERTIES.has(property)) return null;

  for (const parent of parents) {
    const inherited = getInheritedValue(parent.classes, property, breakpoint, 'neutral');
    if (!inherited.className || !inherited.source) continue;
    return {
      className: inherited.className,
      breakpoint: inherited.source,
      uiState: 'neutral',
      label: parent.label,
      kind: 'parent',
      layerId: parent.layerId,
      isCustomized: false,
    };
  }
  return null;
}

/** Breakpoint/state slots in cascade order: neutral classes first, then state classes */
function getCascadeSlots(breakpoint: Breakpoint, uiState: UIState): Array<{ breakpoint: Breakpoint; uiState: UIState }> {
  const chain = getBreakpointInheritanceChain(breakpoint);
  const slots = chain.map((bp) => ({ breakpoint: bp, uiState: 'neutral' as UIState }));
  if (uiState !== 'neutral') {
    slots.push(...chain.map((bp) => ({ breakpoint: bp, uiState })));
  }
  return slots;
}

/**
 * Every class setting a property for the active breakpoint and state, low ->
 * high priority, starting with the value inherited from the nearest parent.
 * The last step is the one that renders.
 */
export function resolveDesignPropertyChain(
  property: string,
  { sources, parents }: DesignPanelSource,
  breakpoint: Breakpoint,
  uiState: UIState,
): DesignSourceStep[] {
  const slots = getCascadeSlots(breakpoint, uiState);
  // A text style sits on an inner element, so it beats any class of the layer itself
  const tiers = [
    sources.filter((source) => source.kind !== 'textStyle'),
    sources.filter((source) => source.kind === 'textStyle'),
  ];

  const inherited = getInheritedParentStep(property, parents, breakpoint);
  const steps: DesignSourceStep[] = inherited ? [inherited] : [];
  for (const tier of tiers) {
    for (const slot of slots) {
      for (const source of tier) {
        const className = getPropertyClassAt(source.classes, property, slot.breakpoint, slot.uiState);
        if (!className) continue;

        const base = { ...slot, label: source.label, kind: source.kind, styleId: source.styleId };
        if (!source.sharedClasses) {
          steps.push({ ...base, className, isCustomized: false });
          continue;
        }

        const shared = getPropertyClassAt(source.sharedClasses, property, slot.breakpoint, slot.uiState);
        if (shared) steps.push({ ...base, className: shared, isCustomized: false });
        if (shared !== className) steps.push({ ...base, className, isCustomized: true });
      }
    }
  }
  return steps;
}
