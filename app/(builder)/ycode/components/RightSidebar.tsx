'use client';

/**
 * Right Sidebar - Properties Panel
 *
 * Shows properties for selected layer with Tailwind class editor
 */

// 1. React/Next.js
import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';

// 2. External libraries
import debounce from 'lodash.debounce';
// 3. ShadCN UI
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectLabel,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// 4. Internal components
import AddAttributeModal from './AddAttributeModal';
import AdvancedSettings from './AdvancedSettings';
import BackgroundsControls from './BackgroundsControls';
import CustomAttributeRow from './CustomAttributeRow';
import BorderControls from './BorderControls';
import ComponentVariablesDialog from './ComponentVariablesDialog';
import CursorControls from './CursorControls';
import EffectControls from './EffectControls';
import CollectionFiltersSettings from './CollectionFiltersSettings';
import ConditionalVisibilitySettings from './ConditionalVisibilitySettings';
import ImageSettings, { type ImageSettingsValue } from './ImageSettings';
import VideoSettings, { type VideoSettingsValue } from './VideoSettings';
import AudioSettings, { type AudioSettingsValue } from './AudioSettings';
import IconSettings, { type IconSettingsValue } from './IconSettings';
import FormSettings from './FormSettings';
import FilterSettings from './FilterSettings';
import AlertSettings from './AlertSettings';
import HTMLEmbedSettings from './HTMLEmbedSettings';
import MapSettings from './MapSettings';
import SliderSettings from './SliderSettings';
import LightboxSettings from './LightboxSettings';
import InputSettings from './InputSettings';
import SelectOptionsSettings from './SelectOptionsSettings';
import LabelSettings from './LabelSettings';
import LinkSettings, { type LinkSettingsValue } from './LinkSettings';
import ComponentInstanceSidebar from './ComponentInstanceSidebar';
import ComponentVariableOverrides from './ComponentVariableOverrides';
import ExpandableRichTextEditor from './ExpandableRichTextEditor';
import RichTextEditor from './RichTextEditor';
import ComponentVariableLabel, { VARIABLE_TYPE_ICONS } from './ComponentVariableLabel';
import InteractionsPanel from './InteractionsPanel';
import FlexChildControls from './FlexChildControls';
import LayoutControls from './LayoutControls';
import LayerStylesPanel from './LayerStylesPanel';
import PositionControls from './PositionControls';
import TransformControls from './TransformControls';
import TransitionControls from './TransitionControls';
import SettingsPanel from './SettingsPanel';
import SizingControls from './SizingControls';
import SpacingControls from './SpacingControls';
import ToggleGroup from './ToggleGroup';
import IdSetting from './IdSetting';
import VisibilitySetting from './VisibilitySetting';
import TypographyControls from './TypographyControls';
import UIStateSelector from './UIStateSelector';

// 5. Stores
import { useEditorStore } from '@/stores/useEditorStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useGlobalsStore } from '@/stores/useGlobalsStore';
import { useLayerStylesStore } from '@/stores/useLayerStylesStore';
import { useCanvasTextEditorStore } from '@/stores/useCanvasTextEditorStore';
import { useEditorActions, useEditorUrl } from '@/hooks/use-editor-url';
import { useLocalizationMode } from '@/hooks/use-localization-mode';
import SidebarTranslationRow from './SidebarTranslationRow';
import { extractLayerTranslatableItemsShallow } from '@/lib/localisation-utils';
import { useLocalisationStore } from '@/stores/useLocalisationStore';

// 5.5 Hooks
import { useLayerLocks } from '@/hooks/use-layer-locks';

// 6. Utils, APIs, lib
import { classesToDesign, mergeDesign, removeConflictsForClass, removeRedundantSpacingShorthands } from '@/lib/tailwind-class-mapper';
import { getStyleIds } from '@/lib/layer-style-utils';
import { resolveLayerClasses, chipClasses } from '@/lib/layer-style-resolve';
import { buildDesign } from '@/lib/import/design';
import { cn } from '@/lib/utils';
import { isFieldVariable, getCollectionVariable, findParentCollectionLayer, findAllParentCollectionLayers, isTextEditable, isTextContentLayer, isRichTextLayer, isHeadingLayer, findLayerWithParent, resetBindingsOnCollectionSourceChange, isInputInsideFilter, resolveFilterInputId, getLayerIndexes, indexedFindLayerById, indexedFindLayerWithParent, indexedFindParentCollectionLayer } from '@/lib/layer-utils';
import { sanitizePaginationParamName, stripLayerPrefix } from '@/lib/pagination-url-utils';
import { detachSpecificLayerFromComponent } from '@/lib/component-utils';
import { convertContentToValue, parseValueToContent } from '@/lib/cms-variables-utils';
import { defaultPaginationCountDoc, defaultPaginationInfoDoc } from '@/lib/pagination-text-utils';
import { createTextComponentVariableValue } from '@/lib/variable-utils';
import { getRichTextValue, extractPlainTextFromTiptap, getSoleCmsFieldBinding } from '@/lib/tiptap-utils';
import { DEFAULT_TEXT_STYLES, getTextStyle, getTiptapTextContent } from '@/lib/text-format-utils';
import { buildFieldGroupsForLayer, getFieldIcon, hasBoundCollectionSource, isMultipleAssetField, MULTI_ASSET_COLLECTION_ID, SIMPLE_TEXT_FIELD_TYPES } from '@/lib/collection-field-utils';
import { getInverseReferenceFields } from '@/lib/collection-utils';

// 7. Types
import type { Layer, FieldVariable, CollectionField, CollectionVariable, ComponentVariable, BackgroundsDesign } from '@/types';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface RightSidebarProps {
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  /**
   * When true, the column chrome (width, border, background) is provided by a
   * parent wrapper (RightPanel) and this component only renders its body.
   */
  embedded?: boolean;
}

/**
 * Recursively remove heading/text descendants from a layer subtree.
 * Used when binding a slide to a multi-image field — the assets are typically
 * the focus, so any leftover text/heading scaffolding is auto-pruned.
 */
function pruneTextDescendants(children: Layer[] | undefined): Layer[] {
  if (!children?.length) return [];
  return children
    .filter(c => !isTextContentLayer(c))
    .map(c => (c.children?.length ? { ...c, children: pruneTextDescendants(c.children) } : c));
}

/** The non-empty gradient/image CSS var maps from a backgrounds design object. */
type BgVars = Pick<BackgroundsDesign, 'bgGradientVars' | 'bgImageVars'>;

/**
 * Extract the background gradient/image CSS var maps from a backgrounds design.
 *
 * These live in `design.backgrounds.bgGradientVars` / `bgImageVars` and hold the
 * actual gradient/image values keyed by breakpoint+state. They are NOT encoded
 * in Tailwind classes (the class only references `var(--bg-img)`), so any code
 * that regenerates design from classes via `buildDesign` would drop them. The
 * layer-style system round-trips through classes, so these vars must be carried
 * through explicitly. Returns undefined when neither map has entries.
 */
function extractBgVars(bg: BackgroundsDesign | undefined): BgVars | undefined {
  if (!bg) return undefined;
  const out: BgVars = {};
  if (bg.bgGradientVars && Object.keys(bg.bgGradientVars).length > 0) out.bgGradientVars = bg.bgGradientVars;
  if (bg.bgImageVars && Object.keys(bg.bgImageVars).length > 0) out.bgImageVars = bg.bgImageVars;
  return out.bgGradientVars || out.bgImageVars ? out : undefined;
}

const RightSidebar = React.memo(function RightSidebar({
  onLayerUpdate,
  embedded = false,
}: RightSidebarProps) {
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);

  const { openComponent, urlState, updateQueryParams } = useEditorActions();
  const { routeType } = useEditorUrl();
  const { isLocalizing, currentLocale, defaultLocale } = useLocalizationMode();

  // Translation editor state + store actions used by the per-layer Translate
  // panel rendered inside the Settings tab when a non-default locale is active.
  const selectedLocaleId = useLocalisationStore((state) => state.selectedLocaleId);
  const getTranslationByKey = useLocalisationStore((state) => state.getTranslationByKey);
  const createTranslation = useLocalisationStore((state) => state.createTranslation);
  const updateTranslation = useLocalisationStore((state) => state.updateTranslation);
  const [translationLocalInputValues, setTranslationLocalInputValues] = useState<Record<string, string>>({});
  const handleTranslationLocalValueChange = useCallback((key: string, value: string) => {
    setTranslationLocalInputValues((prev) => ({ ...prev, [key]: value }));
  }, []);
  const handleTranslationLocalValueClear = useCallback((key: string) => {
    setTranslationLocalInputValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Local state for immediate UI feedback
  const [activeTab, setActiveTab] = useState<'design' | 'settings' | 'interactions' | undefined>(
    urlState.rightTab || 'design'
  );

  // Track last user-initiated change to prevent URL→state sync loops
  const lastUserChangeRef = useRef<number>(0);

  // Handle tab change: optimistic UI update + background URL sync
  const handleTabChange = useCallback((value: string) => {
    const newTab = value as 'design' | 'settings' | 'interactions';

    // Immediate UI update
    setActiveTab(newTab);

    // Mark as user-initiated (prevents URL→state sync for 100ms)
    lastUserChangeRef.current = Date.now();

    // Background URL update
    if (routeType === 'page' || routeType === 'layers' || routeType === 'component') {
      updateQueryParams({ tab: newTab });
    }
  }, [routeType, updateQueryParams]);

  // Sync URL→state only for external navigation (back/forward, direct URL)
  useEffect(() => {
    // Skip if this was a recent user-initiated change (within 100ms)
    if (Date.now() - lastUserChangeRef.current < 100) {
      return;
    }

    const urlTab = urlState.rightTab || 'design';
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [urlState.rightTab, activeTab]);

  const [currentClassInput, setCurrentClassInput] = useState<string>('');
  const classInputRef = useRef<HTMLInputElement>(null);
  const [containerTag, setContainerTag] = useState<string>('div');
  const [textTag, setTextTag] = useState<string>('p');
  const [showAddAttributePopover, setShowAddAttributePopover] = useState(false);
  const [newAttributeName, setNewAttributeName] = useState('');
  const [newAttributeValue, setNewAttributeValue] = useState('');
  const [classesOpen, setClassesOpen] = useState(true);
  const [collectionBindingOpen, setCollectionBindingOpen] = useState(true);
  const [fieldBindingOpen, setFieldBindingOpen] = useState(true);
  const [contentOpen, setContentOpen] = useState(true);
  const [localeLabelOpen, setLocaleLabelOpen] = useState(true);
  const [variablesDialogOpen, setVariablesDialogOpen] = useState(false);
  const [variablesDialogInitialId, setVariablesDialogInitialId] = useState<string | null>(null);

  const openVariablesDialog = (variableId?: string) => {
    setVariablesDialogInitialId(variableId ?? null);
    setVariablesDialogOpen(true);
  };
  const [interactionOwnerLayerId, setInteractionOwnerLayerId] = useState<string | null>(null);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);
  const [interactionResetKey, setInteractionResetKey] = useState(0);

  // Optimize store subscriptions - use selective selectors
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const editingComponentId = useEditorStore((state) => state.editingComponentId);
  const editingComponentVariantId = useEditorStore((state) => state.editingComponentVariantId);
  const setSelectedLayerId = useEditorStore((state) => state.setSelectedLayerId);
  const setInteractionHighlights = useEditorStore((state) => state.setInteractionHighlights);
  const setActiveInteraction = useEditorStore((state) => state.setActiveInteraction);
  const clearActiveInteraction = useEditorStore((state) => state.clearActiveInteraction);
  const activeTextStyleKey = useEditorStore((state) => state.activeTextStyleKey);
  const showTextStyleControls = useEditorStore((state) => state.showTextStyleControls());
  const startElementPicker = useEditorStore((state) => state.startElementPicker);
  const stopElementPicker = useEditorStore((state) => state.stopElementPicker);
  const isElementPickerActive = useEditorStore((state) => !!state.elementPicker?.active);
  const openRichTextSheet = useEditorStore((state) => state.openRichTextSheet);

  // Check if text is being edited on canvas
  const isTextEditingOnCanvas = useCanvasTextEditorStore((state) => state.isEditing);
  const editingLayerIdOnCanvas = useCanvasTextEditorStore((state) => state.editingLayerId);

  // Collaboration hooks - re-enabled
  const layerLocks = useLayerLocks();
  // Store in ref to avoid dependency changes triggering infinite loops
  const layerLocksRef = useRef(layerLocks);
  layerLocksRef.current = layerLocks;

  const currentDraft = usePagesStore((state) => currentPageId ? state.draftsByPageId[currentPageId] : null);
  const setDraftLayers = usePagesStore((state) => state.setDraftLayers);
  const pages = usePagesStore((state) => state.pages);

  const getComponentById = useComponentsStore((state) => state.getComponentById);
  const componentDrafts = useComponentsStore((state) => state.componentDrafts);
  const addTextVariable = useComponentsStore((state) => state.addTextVariable);
  const addRichTextVariable = useComponentsStore((state) => state.addRichTextVariable);
  const updateTextVariable = useComponentsStore((state) => state.updateTextVariable);

  const collections = useCollectionsStore((state) => state.collections);
  const fields = useCollectionsStore((state) => state.fields);
  const loadFields = useCollectionsStore((state) => state.loadFields);
  const globals = useGlobalsStore((state) => state.globals);

  // Resolve the active variant id while editing a component, falling back to
  // the first variant if state references a stale id.
  const activeComponentVariantId = useMemo(() => {
    if (!editingComponentId) return null;
    const drafts = componentDrafts[editingComponentId];
    if (!drafts) return editingComponentVariantId || null;
    if (editingComponentVariantId && drafts[editingComponentVariantId]) return editingComponentVariantId;
    return Object.keys(drafts)[0] || null;
  }, [editingComponentId, editingComponentVariantId, componentDrafts]);

  // Get all layers (for interactions target selection)
  const allLayers: Layer[] = useMemo(() => {
    if (editingComponentId && activeComponentVariantId) {
      return componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    } else if (currentPageId) {
      return currentDraft ? currentDraft.layers : [];
    }
    return [];
  }, [editingComponentId, activeComponentVariantId, componentDrafts, currentPageId, currentDraft]);

  const layerIndexes = useMemo(() => {
    return getLayerIndexes(allLayers);
  }, [allLayers]);

  const selectedLayer: Layer | null = useMemo(() => {
    if (!selectedLayerId) return null;
    return indexedFindLayerById(layerIndexes, selectedLayerId);
  }, [selectedLayerId, layerIndexes]);

  const selectedLayerRef = useRef(selectedLayer);
  selectedLayerRef.current = selectedLayer;

  // Translatable items for the selected layer, computed only when actually
  // localizing. The source resolution mirrors the server: layers inside a
  // component are scoped to that component (via _masterComponentId on the
  // server / editingComponentId here) so a single translation propagates to
  // all instances of the component on the site.
  const translationSource = useMemo(() => {
    if (!selectedLayer || !isLocalizing) return null;
    if (editingComponentId) {
      return { sourceType: 'component' as const, sourceId: editingComponentId };
    }
    if (currentPageId) {
      return { sourceType: 'page' as const, sourceId: currentPageId };
    }
    return null;
  }, [selectedLayer, isLocalizing, editingComponentId, currentPageId]);

  const translatableItemsForSelectedLayer = useMemo(() => {
    if (!selectedLayer || !translationSource) return [];
    return extractLayerTranslatableItemsShallow(
      selectedLayer,
      translationSource.sourceType,
      translationSource.sourceId,
    );
  }, [selectedLayer, translationSource]);

  // When the selected layer's text is a single CMS-bound variable (e.g. a
  // heading whose only content is a `[Content]` field reference), the textarea
  // editor in the sidebar would just show "[Content]" — the actual translation
  // happens against the bound CMS item, not against the layer. Detect this so
  // the panel can render a read-only "Content → variable" row instead, and
  // hide the unhelpful textarea pair.
  const layerCmsTextBinding = useMemo(() => {
    if (!selectedLayer || !isLocalizing) return null;
    if (selectedLayer.variables?.text?.type !== 'dynamic_rich_text') return null;
    const richValue = getRichTextValue(selectedLayer.variables);
    return getSoleCmsFieldBinding(richValue);
  }, [selectedLayer, isLocalizing]);

  const translatableItemsExcludingCmsText = useMemo(() => {
    if (!layerCmsTextBinding) return translatableItemsForSelectedLayer;
    return translatableItemsForSelectedLayer.filter((item) => !item.content_key.endsWith(':text'));
  }, [translatableItemsForSelectedLayer, layerCmsTextBinding]);

  const hasCustomAttributes = !!(selectedLayer?.settings?.customAttributes &&
    Object.keys(selectedLayer.settings.customAttributes).length > 0);

  // Get the layer whose interactions we're editing (different from selected layer during target selection)
  const interactionOwnerLayer: Layer | null = useMemo(() => {
    if (!interactionOwnerLayerId) return null;
    return indexedFindLayerById(layerIndexes, interactionOwnerLayerId);
  }, [interactionOwnerLayerId, layerIndexes]);

  // Check if selected layer is at root level (has no parent) - used to disable pagination
  const isSelectedLayerAtRoot: boolean = useMemo(() => {
    if (!selectedLayerId) return false;
    const result = indexedFindLayerWithParent(layerIndexes, selectedLayerId);
    return result?.parent === null;
  }, [selectedLayerId, layerIndexes]);

  // Parent of the selected layer - drives the align-self control (its axis and
  // visibility depend on the parent's flex/grid layout, not the layer's own)
  const selectedLayerParent: Layer | null = useMemo(() => {
    if (!selectedLayerId) return null;
    const result = indexedFindLayerWithParent(layerIndexes, selectedLayerId);
    return result?.parent ?? null;
  }, [selectedLayerId, layerIndexes]);

  // Check if selected collection is nested inside another collection
  const isNestedInCollection: boolean = useMemo(() => {
    if (!selectedLayer || !selectedLayerId) return false;
    const collectionVar = getCollectionVariable(selectedLayer);
    if (!collectionVar) return false;
    return !!indexedFindParentCollectionLayer(layerIndexes, selectedLayerId);
  }, [selectedLayer, selectedLayerId, layerIndexes]);

  // Check if link settings should be hidden:
  // - Buttons inside a form (they act as submit buttons)
  // - Any layer inside a button (the button itself handles the link)
  const shouldHideLinkSettings: boolean = useMemo(() => {
    if (!selectedLayer || !selectedLayerId) return false;
    let parentId = layerIndexes.parentMap.get(selectedLayerId);
    while (parentId) {
      const parent = layerIndexes.layerMap.get(parentId);
      if (!parent) break;
      if (parent.name === 'button') return true;
      if (parent.name === 'lightbox') return true;
      if (parent.name === 'form' && selectedLayer.name === 'button') return true;
      parentId = layerIndexes.parentMap.get(parentId);
    }
    return false;
  }, [selectedLayer, selectedLayerId, layerIndexes]);

  // Check if pagination should be disabled (only for root-level case where we show a message)
  const isPaginationDisabled: boolean = useMemo(() => {
    if (!selectedLayer) return true;

    const collectionVar = getCollectionVariable(selectedLayer);
    if (!collectionVar) return true;

    // If at root level (no parent container at all), pagination is disabled (need a container for sibling)
    return isSelectedLayerAtRoot;
  }, [selectedLayer, isSelectedLayerAtRoot]);

  // Get the reason why pagination is disabled (only for actionable messages)
  const paginationDisabledReason: string | null = useMemo(() => {
    if (!selectedLayer) return null;

    const collectionVar = getCollectionVariable(selectedLayer);
    if (!collectionVar) return null;

    if (isSelectedLayerAtRoot) {
      return 'Wrap collection in a container to enable pagination';
    }

    return null;
  }, [selectedLayer, isSelectedLayerAtRoot]);

  // Set interaction owner when interactions tab becomes active
  useEffect(() => {
    if (activeTab === 'interactions' && selectedLayerId && !interactionOwnerLayerId) {
      setInteractionOwnerLayerId(selectedLayerId);
    }
  }, [activeTab, selectedLayerId, interactionOwnerLayerId]);

  // Update interaction owner layer when selected layer changes (only if no trigger is selected)
  useEffect(() => {
    if (activeTab === 'interactions' && selectedLayerId && !selectedTriggerId) {
      setInteractionOwnerLayerId(selectedLayerId);
    }
  }, [activeTab, selectedLayerId, selectedTriggerId]);

  // Clear interaction owner when tab changes away from interactions
  useEffect(() => {
    if (activeTab !== 'interactions' && interactionOwnerLayerId) {
      setInteractionOwnerLayerId(null);
    }
  }, [activeTab, interactionOwnerLayerId]);

  // Update active interaction (current trigger and its target layers from tweens)
  useEffect(() => {
    if (activeTab === 'interactions' && interactionOwnerLayer) {
      const interactions = interactionOwnerLayer.interactions || [];
      const targetIds = new Set<string>();

      interactions.forEach(interaction => {
        (interaction.tweens || []).forEach(tween => {
          targetIds.add(tween.layer_id);
        });
      });

      if (targetIds.size > 0) {
        setActiveInteraction(interactionOwnerLayer.id, Array.from(targetIds));
      } else {
        clearActiveInteraction();
      }
    } else {
      clearActiveInteraction();
    }
  }, [activeTab, interactionOwnerLayer, setActiveInteraction, clearActiveInteraction]);

  // Compute interaction highlights from all layers (always shown, styling varies by tab)
  useEffect(() => {
    const triggerIds = new Set<string>();
    const targetIds = new Set<string>();

    const collectInteractions = (layers: Layer[]) => {
      layers.forEach(layer => {
        const interactions = layer.interactions || [];
        const hasTweens = interactions.some(i => (i.tweens || []).length > 0);

        if (hasTweens) {
          triggerIds.add(layer.id);
          interactions.forEach(interaction => {
            (interaction.tweens || []).forEach(tween => {
              targetIds.add(tween.layer_id);
            });
          });
        }

        if (layer.children) {
          collectInteractions(layer.children);
        }
      });
    };

    collectInteractions(allLayers);
    setInteractionHighlights(Array.from(triggerIds), Array.from(targetIds));
  }, [allLayers, setInteractionHighlights]);

  // Handle all interaction state changes from InteractionsPanel
  const handleInteractionStateChange = useCallback((state: {
    selectedTriggerId?: string | null;
    shouldRefresh?: boolean;
  }) => {
    // Handle trigger selection
    if (state.selectedTriggerId !== undefined) {
      setSelectedTriggerId(state.selectedTriggerId);
    }

    // Handle refresh request
    if (state.shouldRefresh && selectedLayerId) {
      setInteractionOwnerLayerId(selectedLayerId);
      setSelectedTriggerId(null);
      setInteractionResetKey(prev => prev + 1);
    }
  }, [selectedLayerId]);

  // Helper function to check if layer is a container/section/block
  const isContainerLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    const containerTags = [
      'div', 'container', 'section', 'nav', 'main', 'aside',
      'header', 'footer', 'article', 'figure', 'figcaption',
      'details', 'summary', 'label'
    ];
    return containerTags.includes(layer.name || '') ||
           containerTags.includes(layer.settings?.tag || '');
  };

  const isTextLayer = isTextContentLayer;

  // Helper function to check if layer is a button element
  const isButtonLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    return layer.name === 'button' || layer.settings?.tag === 'button';
  };

  // Helper function to check if layer is an icon element
  const isIconLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    return layer.name === 'icon';
  };

  // Helper function to check if layer is an image element
  const isImageLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    return layer.name === 'image' || layer.settings?.tag === 'img';
  };

  // Helper function to check if layer is a form input element (label, input, textarea, select)
  const isFormInputLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    return layer.name === 'label' || layer.name === 'input' || layer.name === 'textarea' || layer.name === 'select';
  };

  // Helper function to check if layer is an alert element
  const isAlertLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    return !!layer.alertType;
  };

  // Control visibility rules based on layer type
  const shouldShowControl = (controlName: string, layer: Layer | null): boolean => {
    if (!layer) return false;

    switch (controlName) {
      case 'layout':
        // In text style mode, hide layout controls
        if (showTextStyleControls) return false;
        // Layout controls: every element gets a Type row; LayoutControls
        // narrows the options for leaf elements (no flex/grid, inline block)
        return true;

      case 'spacing':
        // Spacing controls (padding/margin): show for all elements
        // Also show in text style mode for inline padding
        return true;

      case 'sizing':
        // In text style mode, hide sizing controls
        if (showTextStyleControls) return false;
        // Sizing controls: show for all elements
        return true;

      case 'typography':
        // Typography controls: show in text edit mode or for text elements, rich text, buttons, icons, form inputs, body, and fraction
        if (showTextStyleControls) return true;
        return isTextLayer(layer) || isRichTextLayer(layer) || isButtonLayer(layer) || isIconLayer(layer) || isFormInputLayer(layer) || layer.id === 'body' || layer.name === 'slideFraction';

      case 'backgrounds':
        // Background controls: hide for text layers (image is in the color picker's image tab)
        if (isTextLayer(layer)) return false;
        if (showTextStyleControls) return true;
        return true;

      case 'borders':
        // Border controls: hide for pure text elements (show for buttons and containers)
        // Show in text edit mode for block elements that need border styling (Separator, Image)
        if (showTextStyleControls) {
          const borderStyleKeys = ['horizontalRule', 'richTextImage', 'table', 'tableHeader', 'tableCell', 'tableRow', 'code'];
          return !!activeTextStyleKey && borderStyleKeys.includes(activeTextStyleKey);
        }
        return !isTextLayer(layer) || isButtonLayer(layer);

      case 'effects':
        // Effect controls (opacity, shadow): show for all elements
        // Opacity is useful in text edit mode for transparency
        return true;

      case 'cursor':
        if (showTextStyleControls) return false;
        return true;

      case 'position':
        // In text style mode, hide position controls
        if (showTextStyleControls) return false;
        // Position controls: show for all
        return true;

      case 'transforms':
        // In text style mode, hide transform controls
        if (showTextStyleControls) return false;
        // Hide for text-only layers (not buttons)
        if (isTextLayer(layer) && !isButtonLayer(layer)) return false;
        return true;

      case 'transitions':
        // In text style mode, hide transition controls
        if (showTextStyleControls) return false;
        // Transitions: show for all non-text layers (and buttons)
        if (isTextLayer(layer) && !isButtonLayer(layer)) return false;
        return true;

      default:
        // In text style mode, hide unknown controls
        if (showTextStyleControls) return false;
        return true;
    }
  };

  // Check if the selected layer is locked by another user
  const isLayerLocked = selectedLayerId ? layerLocks.isLayerLocked(selectedLayerId) : false;
  const canEditLayer = selectedLayerId ? layerLocks.canEditLayer(selectedLayerId) : false;
  const isLockedByOther = isLayerLocked && !canEditLayer;

  // Track previous layer ID to handle lock release
  const previousLayerIdRef = useRef<string | null>(null);

  // Acquire lock when layer is selected, release when deselected
  // Works for both page layers and component layers
  //
  // Note: We only depend on selectedLayerId, not editingComponentId.
  // The channelName change is handled internally by useLayerLocks/useResourceLock.
  // We don't want to release/re-acquire locks just because editingComponentId changed.
  useEffect(() => {
    const prevLayerId = previousLayerIdRef.current;
    const locks = layerLocksRef.current;

    // Release lock on previously selected layer
    if (prevLayerId && prevLayerId !== selectedLayerId) {
      locks.releaseLock(prevLayerId);
    }

    // Acquire lock on newly selected layer (for both pages and components)
    if (selectedLayerId) {
      locks.acquireLock(selectedLayerId);
    }

    previousLayerIdRef.current = selectedLayerId;

    // No cleanup here - locks are released:
    // 1. When switching to a different layer (handled above)
    // 2. When switching tabs (handled in LeftSidebar)
    // 3. When page unloads (handled in useResourceLock)
  }, [selectedLayerId]); // Only selectedLayerId - channel changes are handled internally

  // Get default container tag based on layer type/name
  const getDefaultContainerTag = (layer: Layer | null): string => {
    if (!layer) return 'div';
    if (layer.settings?.tag) return layer.settings.tag;

    // Check if layer.name is already a valid semantic tag
    if (layer.name && ['div', 'section', 'nav', 'main', 'aside', 'header', 'footer', 'article', 'figure', 'figcaption', 'details', 'summary'].includes(layer.name)) {
      return layer.name;
    }

    // Map element types to their default tags:
    // Section = section, Container = div, Block = div
    if (layer.name === 'section') return 'section';

    return 'div'; // Default fallback
  };

  // Get default text tag based on layer settings
  const getDefaultTextTag = (layer: Layer | null): string => {
    if (!layer) return 'p';
    if (layer.settings?.tag) return layer.settings.tag;
    if (layer.name === 'heading') return 'h2';
    return 'p';
  };

  // Tag options for heading elements (h1-h6)
  const headingTagOptions = [
    { value: 'h1', label: 'h1' },
    { value: 'h2', label: 'h2' },
    { value: 'h3', label: 'h3' },
    { value: 'h4', label: 'h4' },
    { value: 'h5', label: 'h5' },
    { value: 'h6', label: 'h6' },
  ] as const;

  // Tag options for text elements (p, span, label)
  const textTagOptions = [
    { value: 'p', label: 'p' },
    { value: 'span', label: 'span' },
    { value: 'label', label: 'label' },
  ] as const;

  // Classes input state (synced with selectedLayer)
  const [classesInput, setClassesInput] = useState<string>('');

  // Sync classesInput when selectedLayer or activeTextStyleKey changes
  useEffect(() => {
    // In text edit mode with a text style selected, show classes for that text style
    if (showTextStyleControls && activeTextStyleKey) {
      const textStyle = getTextStyle(selectedLayer?.textStyles, activeTextStyleKey);
      setClassesInput(textStyle?.classes || '');
    }
    // Otherwise, show classes for the layer
    else if (!selectedLayer?.classes) {
      setClassesInput('');
    } else {
      const classes = Array.isArray(selectedLayer.classes)
        ? selectedLayer.classes.join(' ')
        : selectedLayer.classes;
      setClassesInput(classes);
    }
  }, [selectedLayer, showTextStyleControls, activeTextStyleKey]);

  // Tracks the active chip so design edits route to the right per-chip override.
  // Set during render once `activeLayerStyleId` is computed below.
  const activeStyleIdRef = useRef<string | null>(null);

  // Lock-aware update function.
  const handleLayerUpdate = useCallback((layerId: string, updates: Partial<Layer>) => {
    if (isLockedByOther) {
      console.warn('Cannot update layer - locked by another user');
      return;
    }
    onLayerUpdate(layerId, updates);
  }, [isLockedByOther, onLayerUpdate]);

  // Parse classes into array
  const classesArray = useMemo(() => {
    return classesInput.split(' ').filter(cls => cls.trim() !== '');
  }, [classesInput]);

  // Get applied layer style and its classes
  const getStyleById = useLayerStylesStore((state) => state.getStyleById);
  const allStyles = useLayerStylesStore((state) => state.styles);
  const stylesById = useMemo(
    () => new Map(allStyles.map((s) => [s.id, s])),
    [allStyles]
  );
  // The layer's full applied style stack (combo classes), low -> high priority.
  const appliedStyleIds = useMemo(
    () => (selectedLayer ? getStyleIds(selectedLayer) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedLayer?.styleIds, selectedLayer?.styleId]
  );

  // The "active" style chip — the one whose classes/properties the design panel
  // shows and edits. Clicking a chip in LayerStylesPanel changes it; it defaults
  // to the highest-priority (last) style. Editing a property while a chip is
  // active writes a per-chip override (`styleOverridesByStyle`), so only the
  // selected element changes and the customization is unique to that chip.
  const [activeStyleId, setActiveStyleId] = useState<string | null>(null);
  const activeLayerStyleId = appliedStyleIds.length > 0
    ? (activeStyleId && appliedStyleIds.includes(activeStyleId)
      ? activeStyleId
      : appliedStyleIds[appliedStyleIds.length - 1])
    : null;
  activeStyleIdRef.current = activeLayerStyleId;

  const activeChipStyle = activeLayerStyleId ? getStyleById(activeLayerStyleId) : undefined;

  // The active chip's effective classes for THIS layer: its per-chip override if
  // one exists, else the shared style's own classes.
  const activeChipClassTokens = useMemo(() => {
    if (!selectedLayer || !activeLayerStyleId) return [];
    return chipClasses(selectedLayer, activeLayerStyleId, stylesById)
      .split(' ')
      .filter(cls => cls.trim() !== '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer?.id, activeLayerStyleId, selectedLayer?.styleOverridesByStyle, stylesById]);

  // A proxy layer the design controls bind to when a chip is active: it carries
  // the active chip's classes/design (no style links) so the panel reflects that
  // chip. Edits are intercepted by `handleDesignUpdate` and stored as a per-chip
  // override on the real layer.
  const designLayer = useMemo<Layer | null>(() => {
    if (!selectedLayer) return null;
    if (!activeLayerStyleId) return selectedLayer;
    const cls = activeChipClassTokens.join(' ');
    const { styleId: _s, styleIds: _ss, styleOverrides: _so, styleOverridesByStyle: _sm, ...rest } = selectedLayer;
    const design = buildDesign(cls);
    // Background gradient/image vars can't be reconstructed from classes, so carry
    // the layer's own vars onto the proxy — otherwise the panel wouldn't show an
    // applied gradient and the background handlers would misread the current state.
    const bgVars = extractBgVars(selectedLayer.design?.backgrounds);
    if (bgVars && design) {
      design.backgrounds = { ...design.backgrounds, ...bgVars };
    }
    return { ...rest, classes: cls, design };
  }, [selectedLayer, activeLayerStyleId, activeChipClassTokens]);

  // Store an edited class string as the active chip's override (or clear it when
  // it matches the shared style again), then re-flatten the whole stack so the
  // canvas renders the resolved cascade. Only THIS layer changes.
  const applyChipClasses = useCallback((chipId: string, newClassesStr: string, bgVars?: BgVars) => {
    if (!selectedLayer) return;
    const map: NonNullable<Layer['styleOverridesByStyle']> = { ...(selectedLayer.styleOverridesByStyle ?? {}) };
    const styleTokens = (stylesById.get(chipId)?.classes ?? '').split(' ').filter(Boolean).sort().join(' ');
    const nextTokens = newClassesStr.split(' ').filter(Boolean).sort().join(' ');
    if (nextTokens === styleTokens) {
      delete map[chipId];
    } else {
      map[chipId] = { classes: newClassesStr, design: buildDesign(newClassesStr) };
    }
    const hasMap = Object.keys(map).length > 0;
    // Per-chip overrides supersede the legacy single-blob override; drop it so a
    // stale blob can't mask the edit at the top of the cascade.
    const probe: Pick<Layer, 'styleIds' | 'styleOverridesByStyle' | 'styleOverrides'> = {
      styleIds: appliedStyleIds,
      styleOverridesByStyle: hasMap ? map : undefined,
    };
    const resolved = resolveLayerClasses(probe, stylesById);
    const design = buildDesign(resolved);
    // Reapply the background gradient/image vars, which `buildDesign` can't recover
    // from classes. When the caller supplies `bgVars` (a background edit) it is
    // authoritative — including removals; otherwise preserve the layer's existing
    // vars so unrelated edits don't wipe an applied gradient/image.
    const effectiveBgVars = bgVars !== undefined ? bgVars : extractBgVars(selectedLayer.design?.backgrounds);
    if (design && effectiveBgVars && (effectiveBgVars.bgGradientVars || effectiveBgVars.bgImageVars)) {
      design.backgrounds = { ...design.backgrounds, ...effectiveBgVars };
    }
    handleLayerUpdate(selectedLayer.id, {
      styleOverridesByStyle: hasMap ? map : undefined,
      styleOverrides: undefined,
      classes: resolved,
      design,
    });
  }, [selectedLayer, appliedStyleIds, stylesById, handleLayerUpdate]);

  // Design-control edits while a chip is active are the chip's new classes — store
  // them as that chip's override. Non-style fields (variables, etc.) and edits on
  // style-less layers pass straight through to the layer.
  const handleDesignUpdate = useCallback((layerId: string, updates: Partial<Layer>) => {
    const chip = activeStyleIdRef.current;
    if (!chip || updates.classes === undefined) {
      handleLayerUpdate(layerId, updates);
      return;
    }
    const { classes, design, styleOverrides: _so, ...rest } = updates;
    if (Object.keys(rest).length > 0) handleLayerUpdate(layerId, rest);
    const str = Array.isArray(classes) ? classes.join(' ') : classes;
    // Route background gradient/image vars from the derived design through to the
    // chip write — they aren't in `classes`, so dropping the design here would
    // silently discard an applied gradient/image. When design is present it is
    // authoritative (an empty result removes the vars).
    const bgVars = design !== undefined ? (extractBgVars(design.backgrounds) ?? {}) : undefined;
    applyChipClasses(chip, str, bgVars);
  }, [handleLayerUpdate, applyChipClasses]);

  // Classes section sources. With a style stack, the panel is chip-scoped: it
  // shows the active chip's effective classes. Style-less layers — and rich-text
  // inline-style editing, which edits a text style rather than the layer stack —
  // show their own classes (from `classesInput`) instead.
  const styleClassesArray = showTextStyleControls ? [] : activeChipClassTokens;
  const layerOnlyClasses =
    showTextStyleControls || appliedStyleIds.length === 0 ? classesArray : [];

  // Design controls bind to the active chip's proxy layer (and route edits to a
  // per-chip override) unless we're editing a rich-text inline style, where the
  // text-style path inside useDesignSync owns the update.
  const controlLayer = showTextStyleControls ? selectedLayer : designLayer;
  const controlUpdate = showTextStyleControls ? handleLayerUpdate : handleDesignUpdate;

  // Update local state when selected layer changes (for settings fields)
  const [prevSelectedLayerId, setPrevSelectedLayerId] = useState<string | null>(null);
  // Track element name + tag so the tag selectors resync when the layer's type
  // changes in place (e.g. converting a heading to text via the context menu),
  // where the selection id stays the same.
  const layerTagSignature = `${selectedLayer?.name ?? ''}:${selectedLayer?.settings?.tag ?? ''}`;
  const [prevLayerTagSignature, setPrevLayerTagSignature] = useState<string>('');
  if (selectedLayerId !== prevSelectedLayerId) {
    setPrevSelectedLayerId(selectedLayerId);
    setPrevLayerTagSignature(layerTagSignature);
    setContainerTag(selectedLayer?.settings?.tag || getDefaultContainerTag(selectedLayer));
    setTextTag(selectedLayer?.settings?.tag || getDefaultTextTag(selectedLayer));
  } else if (layerTagSignature !== prevLayerTagSignature) {
    setPrevLayerTagSignature(layerTagSignature);
    setContainerTag(selectedLayer?.settings?.tag || getDefaultContainerTag(selectedLayer));
    setTextTag(selectedLayer?.settings?.tag || getDefaultTextTag(selectedLayer));
  }

  // Debounced updater for classes
  const debouncedUpdate = useMemo(
    () =>
      debounce((layerId: string, classes: string) => {
        handleLayerUpdate(layerId, { classes });
      }, 500),
    [handleLayerUpdate]
  );

  // Handle classes change
  const handleClassesChange = useCallback((newClasses: string) => {
    setClassesInput(newClasses);
    if (selectedLayerId) {
      debouncedUpdate(selectedLayerId, newClasses);
    }
  }, [selectedLayerId, debouncedUpdate]);

  // Add class function
  const addClass = useCallback((newClass: string) => {
    if (!newClass.trim() || !selectedLayer) return;
    const trimmedClass = newClass.trim();

    // Text edit mode with a text style selected: update the text style.
    if (showTextStyleControls && activeTextStyleKey) {
      if (classesArray.includes(trimmedClass)) return;
      const classesWithoutConflicts = removeConflictsForClass(classesArray, trimmedClass);
      const newClasses = removeRedundantSpacingShorthands([...classesWithoutConflicts, trimmedClass]).join(' ');
      const parsedDesign = classesToDesign([trimmedClass]);
      const currentTextStyles = selectedLayer.textStyles ?? { ...DEFAULT_TEXT_STYLES };
      const currentTextStyle = currentTextStyles[activeTextStyleKey] || { design: {}, classes: '' };
      const updatedDesign = mergeDesign(currentTextStyle.design, parsedDesign);

      handleLayerUpdate(selectedLayer.id, {
        textStyles: {
          ...currentTextStyles,
          [activeTextStyleKey]: { ...currentTextStyle, classes: newClasses, design: updatedDesign },
        },
      });
      setClassesInput(newClasses);
      setCurrentClassInput('');
      return;
    }

    // Style stack active: add the class to the active chip's override.
    const chip = activeLayerStyleId;
    if (chip) {
      if (activeChipClassTokens.includes(trimmedClass)) return;
      const withoutConflicts = removeConflictsForClass(activeChipClassTokens, trimmedClass);
      applyChipClasses(chip, removeRedundantSpacingShorthands([...withoutConflicts, trimmedClass]).join(' '));
      setCurrentClassInput('');
      return;
    }

    // Style-less layer: update the layer's own classes.
    if (classesArray.includes(trimmedClass)) return;
    const classesWithoutConflicts = removeConflictsForClass(classesArray, trimmedClass);
    const newClasses = removeRedundantSpacingShorthands([...classesWithoutConflicts, trimmedClass]).join(' ');
    const parsedDesign = classesToDesign([trimmedClass]);
    const updatedDesign = mergeDesign(selectedLayer.design, parsedDesign);
    handleLayerUpdate(selectedLayer.id, { classes: newClasses, design: updatedDesign });
    setClassesInput(newClasses);
    setCurrentClassInput('');
  }, [classesArray, activeChipClassTokens, activeLayerStyleId, applyChipClasses, handleLayerUpdate, selectedLayer, showTextStyleControls, activeTextStyleKey]);

  // Remove class function
  const removeClass = useCallback((classToRemove: string) => {
    if (!selectedLayer) return;
    const newClasses = classesArray.filter(cls => cls !== classToRemove).join(' ');
    setClassesInput(newClasses);

    // In text edit mode with a text style selected, update the text style
    // Initialize with DEFAULT_TEXT_STYLES if layer doesn't have textStyles yet
    if (showTextStyleControls && activeTextStyleKey) {
      const currentTextStyles = selectedLayer.textStyles ?? { ...DEFAULT_TEXT_STYLES };
      const currentTextStyle = currentTextStyles[activeTextStyleKey] || { design: {}, classes: '' };
      handleLayerUpdate(selectedLayer.id, {
        textStyles: {
          ...currentTextStyles,
          [activeTextStyleKey]: {
            ...currentTextStyle,
            classes: newClasses,
          },
        },
      });
    } else {
      // Otherwise, update the layer
      handleClassesChange(newClasses);
    }
  }, [classesArray, handleClassesChange, selectedLayer, showTextStyleControls, activeTextStyleKey, handleLayerUpdate]);

  // Remove a class from the active chip's override (style stack active).
  const removeStyleClass = useCallback((classToRemove: string) => {
    const chip = activeStyleIdRef.current;
    if (!selectedLayer || !chip) return;
    applyChipClasses(chip, activeChipClassTokens.filter(cls => cls !== classToRemove).join(' '));
  }, [selectedLayer, activeChipClassTokens, applyChipClasses]);

  // Copy a class into the input so it can be edited and re-added.
  const editClass = useCallback((classToEdit: string) => {
    setCurrentClassInput(classToEdit);
    classInputRef.current?.focus();
  }, []);

  // Handle key press for adding classes
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addClass(currentClassInput);
    }
  }, [addClass, currentClassInput]);

  // Handle container tag change
  const handleContainerTagChange = (tag: string) => {
    setContainerTag(tag);
    if (selectedLayerId) {
      const currentSettings = selectedLayer?.settings || {};
      handleLayerUpdate(selectedLayerId, {
        settings: { ...currentSettings, tag }
      });
    }
  };

  // Handle text tag change
  const handleTextTagChange = (tag: string) => {
    setTextTag(tag);
    if (selectedLayerId) {
      const currentSettings = selectedLayer?.settings || {};
      // Normalize the element name to match the tag family so legacy headings
      // (stored as text with an h1-h6 tag) migrate to a proper heading.
      const name = headingTagOptions.some(opt => opt.value === tag) ? 'heading' : 'text';
      const updates: Partial<Layer> = { name, settings: { ...currentSettings, tag } };
      // Drop an auto-assigned "Text"/"Heading" label so the layer shows its
      // content again (a user's custom layer name is left untouched).
      if (selectedLayer?.customName === 'Text' || selectedLayer?.customName === 'Heading') {
        updates.customName = undefined;
      }
      handleLayerUpdate(selectedLayerId, updates);
    }
  };

  // Handle content change (with inline variables)
  const handleContentChange = useCallback((value: string | any) => {
    if (!selectedLayerId) return;

    // Create DynamicRichTextVariable with Tiptap JSON content
    const textVariable = value && (typeof value === 'object' || value.trim()) ? {
      type: 'dynamic_rich_text' as const,
      data: {
        content: typeof value === 'object' ? value : {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: value }],
            },
          ],
        },
      },
    } : undefined;

    handleLayerUpdate(selectedLayerId, {
      variables: {
        ...selectedLayer?.variables,
        text: textVariable,
      },
    });
  }, [selectedLayerId, selectedLayer, handleLayerUpdate]);

  // Get content value for display (returns Tiptap JSON or string)
  const getContentValue = useCallback((layer: Layer | null): any => {
    return getRichTextValue(layer?.variables);
  }, []);

  /** Reset CMS bindings on child layers after the collection source changes */
  const resetChildBindings = useCallback((layerId: string) => {
    setTimeout(() => {
      const currentLayers = editingComponentId && activeComponentVariantId
        ? useComponentsStore.getState().componentDrafts[editingComponentId]?.[activeComponentVariantId]
        : currentPageId
          ? usePagesStore.getState().draftsByPageId[currentPageId]?.layers
          : null;

      if (!currentLayers) return;

      const cleanedLayers = resetBindingsOnCollectionSourceChange(currentLayers, layerId);
      if (cleanedLayers !== currentLayers) {
        if (editingComponentId && activeComponentVariantId) {
          useComponentsStore.getState().updateComponentDraft(editingComponentId, activeComponentVariantId, cleanedLayers);
        } else if (currentPageId) {
          setDraftLayers(currentPageId, cleanedLayers);
        }
      }
    }, 0);
  }, [editingComponentId, activeComponentVariantId, currentPageId, setDraftLayers]);

  // Handle collection binding change (also resets child bindings when source changes)
  const handleCollectionChange = (collectionId: string) => {
    if (!selectedLayerId || !selectedLayer) return;

    const currentCollectionVariable = getCollectionVariable(selectedLayer);

    if (!collectionId || collectionId === 'none') {
      handleLayerUpdate(selectedLayerId, {
        variables: {
          ...selectedLayer?.variables,
          collection: { id: '' }
        }
      });
    } else {
      handleLayerUpdate(selectedLayerId, {
        variables: {
          ...selectedLayer?.variables,
          collection: {
            id: collectionId,
            sort_by: currentCollectionVariable?.sort_by,
            sort_order: currentCollectionVariable?.sort_order,
            sort_by_inputLayerId: currentCollectionVariable?.sort_by_inputLayerId,
            sort_order_inputLayerId: currentCollectionVariable?.sort_order_inputLayerId,
          }
        }
      });
    }

    resetChildBindings(selectedLayerId);
  };

  const SORT_INPUT_VALUE_OPTION = '__input_value__';
  const sortByTriggerRef = useRef<HTMLButtonElement>(null);
  const sortOrderTriggerRef = useRef<HTMLButtonElement>(null);

  const handleSortByChange = useCallback((sortBy: string) => {
    if (!selectedLayerId || !selectedLayer) return;
    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    if (!currentCollectionVariable) return;
    handleLayerUpdate(selectedLayerId, {
      variables: {
        ...selectedLayer.variables,
        collection: {
          ...currentCollectionVariable,
          sort_by: sortBy,
          sort_by_inputLayerId: undefined,
          sort_order: (sortBy !== 'none' && sortBy !== 'manual' && sortBy !== 'random') ? 'asc' : currentCollectionVariable.sort_order,
        }
      }
    });
  }, [selectedLayerId, selectedLayer, handleLayerUpdate]);

  // Handle reference field selection (for reference, multi-reference, inverse, or multi-asset as collection source)
  // Also resets child bindings when source changes
  const handleReferenceFieldChange = (value: string) => {
    if (!selectedLayerId || !selectedLayer) return;

    const currentCollectionVariable = getCollectionVariable(selectedLayer);

    if (value === 'none') {
      handleLayerUpdate(selectedLayerId, {
        variables: {
          ...selectedLayer?.variables,
          collection: { id: '' }
        }
      });
    } else if (value.startsWith('inverse:')) {
      // Inverse reference: "inverse:{fieldId}:{collectionId}"
      const [, fieldId, collectionId] = value.split(':');
      handleLayerUpdate(selectedLayerId, {
        variables: {
          ...selectedLayer?.variables,
          collection: {
            ...currentCollectionVariable,
            id: collectionId,
            source_field_id: fieldId,
            source_field_type: 'inverse_reference',
            source_field_source: undefined,
          }
        }
      });
    } else {
      // Find the selected field to get its reference_collection_id and type
      const selectedField = parentCollectionFields.find(f => f.id === value);

      if (selectedField && isMultipleAssetField(selectedField)) {
        const updates: Partial<Layer> = {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              id: MULTI_ASSET_COLLECTION_ID,
              source_field_id: value,
              source_field_type: 'multi_asset',
              source_field_source: 'collection',
            }
          }
        };
        // Slides bound to a multi-image field are typically image-only —
        // strip any leftover heading/text scaffolding so the user starts clean.
        if (selectedLayer.name === 'slide') {
          updates.children = pruneTextDescendants(selectedLayer.children);
        }
        handleLayerUpdate(selectedLayerId, updates);
      } else if (selectedField?.reference_collection_id) {
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              id: selectedField.reference_collection_id,
              source_field_id: value,
              source_field_type: selectedField.type as 'reference' | 'multi_reference',
              source_field_source: undefined,
            }
          }
        });
      }
    }

    resetChildBindings(selectedLayerId);
  };

  // Handle dynamic page source selection (unified handler for field or collection)
  // Value format: "field:{fieldId}" or "collection:{collectionId}" or "none"
  // After changing the source, resets invalid CMS bindings on child layers
  const handleDynamicPageSourceChange = (value: string) => {
    if (!selectedLayerId || !selectedLayer) return;

    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    let newCollectionVar: CollectionVariable | undefined;

    if (value === 'none' || !value) {
      newCollectionVar = { id: '' };
    } else if (value.startsWith('multi_asset:')) {
      const fieldId = value.replace('multi_asset:', '');
      const selectedField = dynamicPageMultiAssetFields.find(f => f.id === fieldId);
      if (selectedField) {
        newCollectionVar = {
          ...currentCollectionVariable,
          id: MULTI_ASSET_COLLECTION_ID,
          source_field_id: fieldId,
          source_field_type: 'multi_asset',
          source_field_source: 'page',
        };
      }
    } else if (value.startsWith('field:')) {
      const fieldId = value.replace('field:', '');
      const selectedField = dynamicPageReferenceFields.find(f => f.id === fieldId);
      if (selectedField?.reference_collection_id) {
        newCollectionVar = {
          ...currentCollectionVariable,
          id: selectedField.reference_collection_id,
          source_field_id: fieldId,
          source_field_type: selectedField.type as 'reference' | 'multi_reference',
          source_field_source: undefined,
        };
      }
    } else if (value.startsWith('inverse:')) {
      // Inverse reference: "inverse:{fieldId}:{collectionId}"
      const [, fieldId, collectionId] = value.split(':');
      newCollectionVar = {
        ...currentCollectionVariable,
        id: collectionId,
        source_field_id: fieldId,
        source_field_type: 'inverse_reference',
        source_field_source: undefined,
      };
    } else if (value.startsWith('collection:')) {
      const collectionId = value.replace('collection:', '');
      newCollectionVar = {
        id: collectionId,
        source_field_id: undefined,
        source_field_type: undefined,
        sort_by: currentCollectionVariable?.sort_by,
        sort_order: currentCollectionVariable?.sort_order,
        sort_by_inputLayerId: currentCollectionVariable?.sort_by_inputLayerId,
        sort_order_inputLayerId: currentCollectionVariable?.sort_order_inputLayerId,
      };
    }

    if (!newCollectionVar) return;

    const updates: Partial<Layer> = {
      variables: { ...selectedLayer?.variables, collection: newCollectionVar },
    };
    // Slides bound to a multi-image field are typically image-only —
    // strip any leftover heading/text scaffolding so the user starts clean.
    if (newCollectionVar.source_field_type === 'multi_asset' && selectedLayer.name === 'slide') {
      updates.children = pruneTextDescendants(selectedLayer.children);
    }
    handleLayerUpdate(selectedLayerId, updates);

    resetChildBindings(selectedLayerId);
  };

  // Get current value for dynamic page source dropdown
  const getDynamicPageSourceValue = useMemo(() => {
    if (!selectedLayer) return 'none';
    const collectionVariable = getCollectionVariable(selectedLayer);
    if (!collectionVariable) return 'none';
    // Treat unbound bindings (e.g. multi-asset placeholder with no field chosen) as empty
    if (!hasBoundCollectionSource(collectionVariable)) return 'none';

    // If source_field_id is set, check the type
    if (collectionVariable.source_field_id) {
      if (collectionVariable.source_field_type === 'multi_asset') {
        return `multi_asset:${collectionVariable.source_field_id}`;
      }
      if (collectionVariable.source_field_type === 'inverse_reference') {
        return `inverse:${collectionVariable.source_field_id}:${collectionVariable.id}`;
      }
      return `field:${collectionVariable.source_field_id}`;
    }

    // Otherwise it's a direct collection
    return `collection:${collectionVariable.id}`;
  }, [selectedLayer]);

  const handleSortOrderChange = useCallback((sortOrder: 'asc' | 'desc') => {
    if (!selectedLayerId || !selectedLayer) return;
    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    if (!currentCollectionVariable) return;
    handleLayerUpdate(selectedLayerId, {
      variables: {
        ...selectedLayer.variables,
        collection: {
          ...currentCollectionVariable,
          sort_order: sortOrder,
          sort_order_inputLayerId: undefined,
        }
      }
    });
  }, [selectedLayerId, selectedLayer, handleLayerUpdate]);

  const handlePickSortInput = useCallback((
    key: 'sort_by_inputLayerId' | 'sort_order_inputLayerId',
    origin?: { x: number; y: number },
  ) => {
    if (!selectedLayerId || !selectedLayer) return;
    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    if (!currentCollectionVariable) return;

    startElementPicker(
      (layerId: string) => {
        const resolvedId = resolveFilterInputId(layerId, allLayers);
        const freshLayer = selectedLayerRef.current;
        if (!freshLayer) return;
        const freshVariable = getCollectionVariable(freshLayer);
        if (!freshVariable) return;
        handleLayerUpdate(freshLayer.id, {
          variables: {
            ...freshLayer.variables,
            collection: {
              ...freshVariable,
              [key]: resolvedId,
              ...(key === 'sort_by_inputLayerId' ? { sort_by: 'none' } : {}),
              ...(key === 'sort_order_inputLayerId' ? { sort_order: undefined } : {}),
            },
          },
        });
        stopElementPicker();
      },
      (layerId: string) => isInputInsideFilter(layerId, allLayers),
      origin,
    );
  }, [selectedLayerId, selectedLayer, startElementPicker, stopElementPicker, allLayers, handleLayerUpdate]);

  const handleSortBySelectValue = (value: string) => {
    if (value === SORT_INPUT_VALUE_OPTION) {
      const rect = sortByTriggerRef.current?.getBoundingClientRect();
      const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
      handlePickSortInput('sort_by_inputLayerId', origin);
      return;
    }
    handleSortByChange(value);
  };

  const handleSortOrderSelectValue = (value: string) => {
    if (value === SORT_INPUT_VALUE_OPTION) {
      const rect = sortOrderTriggerRef.current?.getBoundingClientRect();
      const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
      handlePickSortInput('sort_order_inputLayerId', origin);
      return;
    }
    handleSortOrderChange(value as 'asc' | 'desc');
  };

  const getSortLinkedInputName = (inputLayerId: string): string => {
    const inputLayer = indexedFindLayerById(layerIndexes, inputLayerId);
    if (!inputLayer) return `Unknown [${inputLayerId}]`;
    const layerName = inputLayer.customName || inputLayer.name || 'Input';
    return `${layerName} [${inputLayerId}]`;
  };

  const handleUnlinkSortInput = (key: 'sort_by_inputLayerId' | 'sort_order_inputLayerId') => {
    if (!selectedLayerId || !selectedLayer) return;
    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    if (!currentCollectionVariable) return;
    handleLayerUpdate(selectedLayerId, {
      variables: {
        ...selectedLayer.variables,
        collection: {
          ...currentCollectionVariable,
          [key]: undefined,
          ...(key === 'sort_by_inputLayerId' ? { sort_by: 'none' } : {}),
          ...(key === 'sort_order_inputLayerId' ? { sort_order: 'asc' } : {}),
        },
      },
    });
  };

  // Handle limit change
  const handleLimitChange = (value: string) => {
    if (selectedLayerId && selectedLayer) {
      const currentCollectionVariable = getCollectionVariable(selectedLayer);
      if (currentCollectionVariable) {
        const limit = value === '' ? undefined : parseInt(value, 10);
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              limit: limit && limit > 0 ? limit : undefined,
            }
          }
        });
      }
    }
  };

  // Handle offset change
  const handleOffsetChange = (value: string) => {
    if (selectedLayerId && selectedLayer) {
      const currentCollectionVariable = getCollectionVariable(selectedLayer);
      if (currentCollectionVariable) {
        const offset = value === '' ? undefined : parseInt(value, 10);
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              offset: offset && offset >= 0 ? offset : undefined,
            }
          }
        });
      }
    }
  };

  // Helper: Create pagination wrapper for "pages" mode (Prev/Next buttons)
  const createPagesWrapper = (collectionLayerId: string): Layer => ({
    id: `${collectionLayerId}-pagination-wrapper`,
    name: 'div',
    customName: 'Pagination',
    classes: 'flex items-center justify-center gap-4 mt-4',
    attributes: {
      'data-pagination-for': collectionLayerId,
      'data-pagination-mode': 'pages',
    },
    children: [
      {
        id: `${collectionLayerId}-pagination-prev`,
        name: 'button',
        customName: 'Previous Button',
        classes: 'px-4 py-2 rounded bg-[#e5e7eb] hover:bg-[#d1d5db] transition-colors cursor-pointer',
        settings: { tag: 'button' },
        attributes: {
          'data-pagination-action': 'prev',
          'data-collection-layer-id': collectionLayerId,
        },
        children: [
          {
            id: `${collectionLayerId}-pagination-prev-text`,
            name: 'text',
            customName: 'Previous Text',
            settings: { tag: 'span' },
            classes: '',
            restrictions: { editText: true },
            variables: {
              text: {
                type: 'dynamic_text',
                data: { content: 'Previous' }
              }
            }
          } as Layer,
        ],
      } as Layer,
      {
        id: `${collectionLayerId}-pagination-info`,
        name: 'text',
        customName: 'Page Info',
        settings: { tag: 'span' },
        classes: 'text-sm text-[#4b5563]',
        restrictions: { editText: true },
        variables: {
          text: {
            type: 'dynamic_rich_text',
            data: { content: defaultPaginationInfoDoc() }
          }
        }
      } as Layer,
      {
        id: `${collectionLayerId}-pagination-next`,
        name: 'button',
        customName: 'Next Button',
        classes: 'px-4 py-2 rounded bg-[#e5e7eb] hover:bg-[#d1d5db] transition-colors cursor-pointer',
        settings: { tag: 'button' },
        attributes: {
          'data-pagination-action': 'next',
          'data-collection-layer-id': collectionLayerId,
        },
        children: [
          {
            id: `${collectionLayerId}-pagination-next-text`,
            name: 'text',
            customName: 'Next Text',
            settings: { tag: 'span' },
            classes: '',
            restrictions: { editText: true },
            variables: {
              text: {
                type: 'dynamic_text',
                data: { content: 'Next' }
              }
            }
          } as Layer,
        ],
      } as Layer,
    ],
  });

  // Helper: Create pagination wrapper for "load_more" mode (Load more button + count)
  const createLoadMoreWrapper = (collectionLayerId: string): Layer => ({
    id: `${collectionLayerId}-pagination-wrapper`,
    name: 'div',
    customName: 'Load More',
    classes: 'flex flex-col items-center gap-2 mt-4',
    attributes: {
      'data-pagination-for': collectionLayerId,
      'data-pagination-mode': 'load_more',
    },
    children: [
      {
        id: `${collectionLayerId}-pagination-loadmore`,
        name: 'button',
        customName: 'Load More Button',
        classes: 'px-6 py-2 rounded bg-[#e5e7eb] hover:bg-[#d1d5db] transition-colors cursor-pointer',
        settings: { tag: 'button' },
        attributes: {
          'data-pagination-action': 'load_more',
          'data-collection-layer-id': collectionLayerId,
        },
        children: [
          {
            id: `${collectionLayerId}-pagination-loadmore-text`,
            name: 'text',
            customName: 'Load More Text',
            settings: { tag: 'span' },
            classes: '',
            restrictions: { editText: true },
            variables: {
              text: {
                type: 'dynamic_text',
                data: { content: 'Load More' }
              }
            }
          } as Layer,
        ],
      } as Layer,
      {
        id: `${collectionLayerId}-pagination-count`,
        name: 'text',
        customName: 'Items Count',
        settings: { tag: 'span' },
        classes: 'text-sm text-[#4b5563]',
        restrictions: { editText: true },
        variables: {
          text: {
            type: 'dynamic_rich_text',
            data: { content: defaultPaginationCountDoc() }
          }
        }
      } as Layer,
    ],
  });

  // Helper: Get current layers from the appropriate store
  const getCurrentLayersFromStore = (): Layer[] => {
    if (editingComponentId && activeComponentVariantId) {
      return useComponentsStore.getState().componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    } else if (currentPageId) {
      const draft = usePagesStore.getState().draftsByPageId[currentPageId];
      return draft ? draft.layers : [];
    }
    return [];
  };

  // Helper: Add or replace pagination wrapper
  const addOrReplacePaginationWrapper = (collectionLayerId: string, mode: 'pages' | 'load_more') => {
    const currentLayers = getCurrentLayersFromStore();
    const idx = getLayerIndexes(currentLayers);
    const parentResult = indexedFindLayerWithParent(idx, collectionLayerId);
    const parentLayer = parentResult?.parent;

    if (!parentLayer) {
      console.warn('Pagination at root level not yet supported - collection layer should be inside a container');
      return;
    }

    const paginationWrapperId = `${collectionLayerId}-pagination-wrapper`;
    const paginationWrapper = mode === 'pages'
      ? createPagesWrapper(collectionLayerId)
      : createLoadMoreWrapper(collectionLayerId);

    const parentChildren = parentLayer.children || [];

    const collectionIndex = parentChildren.findIndex(c => c.id === collectionLayerId);
    const existingPaginationIndex = parentChildren.findIndex(c => c.id === paginationWrapperId);

    let newChildren: Layer[];
    if (existingPaginationIndex === -1) {
      newChildren = [
        ...parentChildren.slice(0, collectionIndex + 1),
        paginationWrapper,
        ...parentChildren.slice(collectionIndex + 1),
      ];
    } else {
      newChildren = parentChildren.map(c => c.id === paginationWrapperId ? paginationWrapper : c);
    }

    handleLayerUpdate(parentLayer.id, { children: newChildren });
  };

  // Helper: Remove pagination wrapper
  const removePaginationWrapper = (collectionLayerId: string) => {
    const currentLayers = getCurrentLayersFromStore();
    const idx = getLayerIndexes(currentLayers);
    const parentResult = indexedFindLayerWithParent(idx, collectionLayerId);
    const parentLayer = parentResult?.parent;

    if (!parentLayer) return;

    const paginationWrapperId = `${collectionLayerId}-pagination-wrapper`;
    const parentChildren = parentLayer.children || [];

    const newChildren = parentChildren.filter(c => c.id !== paginationWrapperId);
    handleLayerUpdate(parentLayer.id, { children: newChildren });
  };

  // Handle pagination enabled toggle
  const handlePaginationEnabledChange = (checked: boolean) => {
    if (selectedLayerId && selectedLayer) {
      const currentCollectionVariable = getCollectionVariable(selectedLayer);
      if (currentCollectionVariable) {
        const mode = currentCollectionVariable.pagination?.mode || 'pages';

        if (checked) {
          addOrReplacePaginationWrapper(selectedLayerId, mode);
        } else {
          removePaginationWrapper(selectedLayerId);
        }

        // Update the collection layer's pagination config
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              pagination: checked
                ? { enabled: true, mode, items_per_page: 10 }
                : undefined,
            }
          }
        });
      }
    }
  };

  // Handle items per page change
  const handleItemsPerPageChange = (value: string) => {
    if (selectedLayerId && selectedLayer) {
      const currentCollectionVariable = getCollectionVariable(selectedLayer);
      if (currentCollectionVariable?.pagination) {
        const itemsPerPage = parseInt(value, 10);
        if (!isNaN(itemsPerPage) && itemsPerPage > 0) {
          handleLayerUpdate(selectedLayerId, {
            variables: {
              ...selectedLayer?.variables,
              collection: {
                ...currentCollectionVariable,
                pagination: {
                  ...currentCollectionVariable.pagination,
                  items_per_page: itemsPerPage,
                }
              }
            }
          });
        }
      }
    }
  };

  // Handle pagination URL param change. Stored without the fixed `p_` prefix
  // and sanitized here so an unusable name can never reach a URL.
  const handlePaginationParamNameChange = (value: string) => {
    if (selectedLayerId && selectedLayer) {
      const currentCollectionVariable = getCollectionVariable(selectedLayer);
      if (currentCollectionVariable?.pagination) {
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              pagination: {
                ...currentCollectionVariable.pagination,
                param_name: sanitizePaginationParamName(value) || undefined,
              }
            }
          }
        });
      }
    }
  };

  // Handle pagination mode change
  const handlePaginationModeChange = (mode: 'pages' | 'load_more') => {
    if (selectedLayerId && selectedLayer) {
      const currentCollectionVariable = getCollectionVariable(selectedLayer);
      if (currentCollectionVariable?.pagination) {
        // Recreate the pagination wrapper with the new mode
        addOrReplacePaginationWrapper(selectedLayerId, mode);

        // Update the collection layer's pagination config
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              pagination: {
                ...currentCollectionVariable.pagination,
                mode,
              }
            }
          }
        });
      }
    }
  };

  // Get parent collection layer for the selected layer (O(1) via index)
  const parentCollectionLayer = useMemo(() => {
    if (!selectedLayerId) return null;
    return indexedFindParentCollectionLayer(layerIndexes, selectedLayerId);
  }, [selectedLayerId, layerIndexes]);

  // Get collection fields if parent collection layer exists
  const currentPage = useMemo(() => {
    if (!currentPageId) {
      return null;
    }
    return pages.find((page) => page.id === currentPageId) || null;
  }, [pages, currentPageId]);

  const parentCollectionFields = useMemo(() => {
    const collectionVariable = parentCollectionLayer ? getCollectionVariable(parentCollectionLayer) : null;
    let collectionId = collectionVariable?.id;

    // Skip virtual collections (multi-asset)
    if (collectionId === MULTI_ASSET_COLLECTION_ID) {
      collectionId = undefined;
    }

    if (!collectionId && !editingComponentId && currentPage?.is_dynamic) {
      collectionId = currentPage.settings?.cms?.collection_id || undefined;
    }

    if (!collectionId) return [];
    return fields[collectionId] || [];
  }, [parentCollectionLayer, fields, currentPage, editingComponentId]);

  // Build field groups for multi-source inline variable selection
  // Components are page-agnostic, so exclude dynamic page-collection fields when editing a component
  const fieldGroups = useMemo(() => {
    if (!selectedLayerId || !allLayers.length) return undefined;
    const page = editingComponentId ? null : currentPage;
    return buildFieldGroupsForLayer(selectedLayerId, allLayers, page, fields, collections, globals);
  }, [selectedLayerId, allLayers, currentPage, fields, collections, globals, editingComponentId]);

  // Design bindings (e.g. grid span) resolve per collection item, unlike content/text
  // bindings — so only this picker may also offer the layer's own collection. See the
  // `includeOwnCollection` note on buildFieldGroupsForLayer.
  const designFieldGroups = useMemo(() => {
    if (!selectedLayerId || !allLayers.length) return undefined;
    const page = editingComponentId ? null : currentPage;
    return buildFieldGroupsForLayer(selectedLayerId, allLayers, page, fields, collections, globals, true);
  }, [selectedLayerId, allLayers, currentPage, fields, collections, globals, editingComponentId]);

  // Get collection fields for the currently selected collection layer (for Sort By dropdown)
  const selectedCollectionFields = useMemo(() => {
    if (!selectedLayer) return [];
    const collectionVariable = getCollectionVariable(selectedLayer);
    if (!collectionVariable) return [];

    const collectionId = collectionVariable?.id;
    // Skip virtual collections (multi-asset)
    if (!collectionId || collectionId === MULTI_ASSET_COLLECTION_ID) return [];
    return fields[collectionId] || [];
  }, [selectedLayer, fields]);

  // Ensure fields for all referenced collections are loaded (for nested reference dropdowns)
  useEffect(() => {
    // Recursively find all referenced collection IDs
    const findReferencedCollections = (collectionFields: CollectionField[], visited: Set<string>): string[] => {
      const referencedIds: string[] = [];

      collectionFields.forEach(field => {
        if (field.type === 'reference' && field.reference_collection_id) {
          const refId = field.reference_collection_id;
          if (!visited.has(refId)) {
            visited.add(refId);
            referencedIds.push(refId);

            // Recursively check the referenced collection's fields if we have them
            const refFields = fields[refId];
            if (refFields) {
              referencedIds.push(...findReferencedCollections(refFields, visited));
            }
          }
        }
      });

      return referencedIds;
    };

    // Start with parent collection fields
    if (parentCollectionFields.length > 0) {
      const visited = new Set<string>();
      const referencedIds = findReferencedCollections(parentCollectionFields, visited);

      // Check if any referenced collections are missing fields
      const missingFieldsCollections = referencedIds.filter(id => !fields[id] || fields[id].length === 0);

      // Load missing fields - loadFields(null) loads all fields at once
      if (missingFieldsCollections.length > 0) {
        loadFields(null);
      }
    }
  }, [parentCollectionFields, fields, loadFields]);

  // Get reference fields from parent context (for Reference Field as Source option)
  // Includes both single reference and multi-reference fields
  const parentReferenceFields = useMemo(() => {
    return parentCollectionFields.filter(
      f => (f.type === 'reference' || f.type === 'multi_reference') && f.reference_collection_id
    );
  }, [parentCollectionFields]);

  // Get reference fields from dynamic page's source collection (for top-level collection layers on dynamic pages)
  // Not available when editing a component — components are page-agnostic
  const dynamicPageReferenceFields = useMemo(() => {
    if (editingComponentId || !currentPage?.is_dynamic) return [];
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId) return [];
    const collectionFields = fields[collectionId] || [];
    return collectionFields.filter(
      f => (f.type === 'reference' || f.type === 'multi_reference') && f.reference_collection_id
    );
  }, [editingComponentId, currentPage, fields]);

  // Get multi-asset fields from parent context (for multi-asset nested collections)
  const parentMultiAssetFields = useMemo(() => {
    return parentCollectionFields.filter(f => isMultipleAssetField(f));
  }, [parentCollectionFields]);

  // Get multi-asset fields from dynamic page's source collection
  // Not available when editing a component — components are page-agnostic
  const dynamicPageMultiAssetFields = useMemo(() => {
    if (editingComponentId || !currentPage?.is_dynamic) return [];
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId) return [];
    const collectionFields = fields[collectionId] || [];
    return collectionFields.filter(f => isMultipleAssetField(f));
  }, [editingComponentId, currentPage, fields]);

  // Inverse reference fields: fields in OTHER collections that reference the parent collection
  // E.g., if parent is "Authors" and "Books" has a reference field "author" → Authors,
  // show "Books (via author)" as a connected relation source option
  const parentInverseReferenceFields = useMemo(() => {
    const collectionVariable = parentCollectionLayer ? getCollectionVariable(parentCollectionLayer) : null;
    let collectionId = collectionVariable?.id;
    if (collectionId === MULTI_ASSET_COLLECTION_ID) collectionId = undefined;
    if (!collectionId && !editingComponentId && currentPage?.is_dynamic) {
      collectionId = currentPage.settings?.cms?.collection_id || undefined;
    }
    if (!collectionId) return [];
    return getInverseReferenceFields(collectionId, fields, collections);
  }, [parentCollectionLayer, fields, collections, currentPage, editingComponentId]);

  // Inverse reference fields for dynamic page context (top-level collection layers on dynamic pages)
  // Not available when editing a component — components are page-agnostic
  const dynamicPageInverseReferenceFields = useMemo(() => {
    if (editingComponentId || !currentPage?.is_dynamic) return [];
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId) return [];
    return getInverseReferenceFields(collectionId, fields, collections);
  }, [editingComponentId, currentPage, fields, collections]);

  // Handle adding custom attribute
  const handleAddAttribute = () => {
    if (selectedLayerId && newAttributeName.trim()) {
      const currentSettings = selectedLayer?.settings || {};
      const currentAttributes = currentSettings.customAttributes || {};
      handleLayerUpdate(selectedLayerId, {
        settings: {
          ...currentSettings,
          customAttributes: { ...currentAttributes, [newAttributeName.trim()]: newAttributeValue }
        }
      });
      // Reset form and close popover
      setNewAttributeName('');
      setNewAttributeValue('');
      setShowAddAttributePopover(false);
    }
  };

  // Handle removing custom attribute
  const handleRemoveAttribute = (name: string) => {
    if (selectedLayerId) {
      const currentSettings = selectedLayer?.settings || {};
      const currentAttributes = { ...currentSettings.customAttributes };
      delete currentAttributes[name];
      handleLayerUpdate(selectedLayerId, {
        settings: {
          ...currentSettings,
          customAttributes: currentAttributes
        }
      });
    }
  };

  // Handle editing custom attribute (supports renaming the attribute key)
  const handleEditAttribute = (oldName: string, newName: string, newValue: string) => {
    if (!selectedLayerId || !newName.trim()) return;
    const currentSettings = selectedLayer?.settings || {};
    const currentAttributes = { ...currentSettings.customAttributes };
    if (oldName !== newName) {
      delete currentAttributes[oldName];
    }
    currentAttributes[newName] = newValue;
    handleLayerUpdate(selectedLayerId, {
      settings: {
        ...currentSettings,
        customAttributes: currentAttributes
      }
    });
  };

  if (!selectedLayerId || !selectedLayer) {
    return (
      <div
        className={cn(
          'flex items-center justify-center',
          embedded
            ? 'flex-1 min-h-0'
            : 'w-64 shrink-0 bg-background border-l h-screen',
        )}
      >
        <span className="text-xs text-muted-foreground">Select layer</span>
      </div>
    );
  }

  // Check if selected layer is a component instance
  const isComponentInstance = !!selectedLayer.componentId;
  const component = isComponentInstance ? getComponentById(selectedLayer.componentId!) : null;

  // If it's a component instance, show component sidebar instead of design properties
  if (isComponentInstance && component) {
    return (
      <ComponentInstanceSidebar
        selectedLayerId={selectedLayerId!}
        selectedLayer={selectedLayer}
        component={component}
        onLayerUpdate={onLayerUpdate}
        allLayers={allLayers}
        fieldGroups={fieldGroups}
        fields={fields}
        collections={collections}
        isInsideCollectionLayer={!!parentCollectionLayer}
        embedded={embedded}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col p-4 pb-0 overflow-hidden',
        embedded
          ? 'flex-1 min-h-0'
          : 'w-64 shrink-0 bg-background border-l h-full',
      )}
    >
      {/* Tabs.
          When the user is translating (non-default locale active) we keep the
          tab list visible but disable Design + Interactions and force the
          Settings tab, which is where the per-layer Translate panel renders.
          Mirrors the disabled-tabs pattern used for component instances. */}
      <Tabs
        value={isLocalizing ? 'settings' : activeTab}
        onValueChange={isLocalizing ? () => { } : handleTabChange}
        className="flex flex-col flex-1 min-h-0 gap-0"
      >
        <div className="">
          <TabsList className="w-full">
            <TabsTrigger value="design" disabled={isLocalizing}>Design</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="interactions" disabled={isLocalizing}>Interactions</TabsTrigger>
          </TabsList>
        </div>

        <hr className="mt-4" />

        {/* Design tab */}
        <TabsContent value="design" className="flex-1 flex flex-col divide-y data-[state=inactive]:hidden mt-0 overflow-hidden">

          <div className="flex flex-col divide-y">

            {/* Layer Styles Panel - hide in text style mode except for richText sublayers */}
            {(!showTextStyleControls || (selectedLayer && isRichTextLayer(selectedLayer))) && (
              <LayerStylesPanel
                layer={selectedLayer}
                pageId={currentPageId}
                onLayerUpdate={handleLayerUpdate}
                activeTextStyleKey={selectedLayer && isRichTextLayer(selectedLayer) ? activeTextStyleKey : null}
                activeStyleId={activeLayerStyleId}
                onActiveStyleChange={setActiveStyleId}
              />
            )}

            {activeTab === 'design' && (
              <UIStateSelector selectedLayer={selectedLayer} />
            )}

          </div>

          <div className="overflow-y-auto no-scrollbar overflow-x-hidden divide-y ">

          {shouldShowControl('layout', selectedLayer) && !showTextStyleControls && (
            <LayoutControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
            />
          )}

          {/* How this layer behaves inside a flex parent (renders nothing otherwise) */}
          {!showTextStyleControls && (
            <FlexChildControls
              layer={controlLayer}
              parentLayer={selectedLayerParent}
              onLayerUpdate={controlUpdate}
            />
          )}

          {shouldShowControl('spacing', selectedLayer) && (
            <SpacingControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
              activeTextStyleKey={activeTextStyleKey}
            />
          )}

          {shouldShowControl('sizing', selectedLayer) && !showTextStyleControls && (
            <SizingControls
              layer={controlLayer}
              parentLayer={selectedLayerParent}
              onLayerUpdate={controlUpdate}
              fieldGroups={designFieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('position', selectedLayer) && !showTextStyleControls && (
            <PositionControls layer={controlLayer} onLayerUpdate={controlUpdate} />
          )}

          {shouldShowControl('typography', selectedLayer) && (
            <TypographyControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
              activeTextStyleKey={activeTextStyleKey}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('backgrounds', selectedLayer) && (
            <BackgroundsControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
              activeTextStyleKey={activeTextStyleKey}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('borders', selectedLayer) && (
            <BorderControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
              activeTextStyleKey={activeTextStyleKey}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('effects', selectedLayer) && (
            <EffectControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
              activeTextStyleKey={activeTextStyleKey}
            />
          )}

          {shouldShowControl('cursor', selectedLayer) && (
            <CursorControls
              layer={controlLayer}
              onLayerUpdate={controlUpdate}
            />
          )}

          {shouldShowControl('transforms', selectedLayer) && (
            <TransformControls layer={controlLayer} onLayerUpdate={controlUpdate} />
          )}

          {shouldShowControl('transitions', selectedLayer) && (
            <TransitionControls layer={controlLayer} onLayerUpdate={controlUpdate} />
          )}

          {/* Classes panel - shows classes for active text style or layer */}
          <SettingsPanel
            title="Classes"
            isOpen={classesOpen}
            onToggle={() => setClassesOpen(!classesOpen)}
          >
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Input
                  ref={classInputRef}
                  value={currentClassInput}
                  onChange={(e) => setCurrentClassInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Type class and press Enter..."
                  disabled={isLockedByOther}
                  className={cn('pr-8', isLockedByOther && 'opacity-50 cursor-not-allowed')}
                />
                {currentClassInput && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-6 p-0"
                    onClick={() => setCurrentClassInput('')}
                    disabled={isLockedByOther}
                    aria-label="Clear class input"
                  >
                    <Icon name="x" className="size-3" />
                  </Button>
                )}
              </div>

              {layerOnlyClasses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {/* Layer's own classes (excluding style classes) */}
                  {layerOnlyClasses.map((cls, index) => (
                    <Badge
                      variant="secondary"
                      className="truncate max-w-50"
                      key={`layer-${index}`}
                    >
                      <button
                        type="button"
                        onClick={() => editClass(cls)}
                        disabled={isLockedByOther}
                        className="truncate cursor-pointer select-none disabled:cursor-not-allowed"
                        title="Edit class"
                      >
                        {cls}
                      </button>
                      <Button
                        onClick={() => removeClass(cls)}
                        className="size-4! p-0! -mr-1"
                        variant="outline"
                        disabled={isLockedByOther}
                      >
                        <Icon name="x" className="size-2" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Active chip's classes (the style currently selected above) */}
              {styleClassesArray.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <div className="py-1 w-full flex items-center gap-2">
                    <Separator className="flex-1" />
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold">{activeChipStyle?.name}</span> classes
                    </div>
                    <Separator className="flex-1" />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {styleClassesArray.map((cls, index) => (
                      <Badge
                        variant="secondary"
                        key={`style-${index}`}
                        className="truncate max-w-50"
                      >
                        <button
                          type="button"
                          onClick={() => editClass(cls)}
                          disabled={isLockedByOther}
                          className="truncate cursor-pointer select-none disabled:cursor-not-allowed"
                          title="Edit class"
                        >
                          {cls}
                        </button>
                        <Button
                          onClick={() => removeStyleClass(cls)}
                          className="size-4! p-0! -mr-1"
                          variant="outline"
                          disabled={isLockedByOther}
                        >
                          <Icon name="x" className="size-2" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SettingsPanel>

          </div>

        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto no-scrollbar mt-0 data-[state=inactive]:hidden">
          <div className="flex flex-col divide-y">
            {/* Translate panel — replaces all design/settings controls when a
                non-default locale is active. Stacked Framer-style layout: one
                source + translation Textarea pair per translatable property of
                the selected layer. */}
            {isLocalizing && selectedLayer && currentLocale && (
              <div className="flex flex-col gap-6 py-5">
                {/* CMS-bound text indicator — shown when the layer's text is a
                    single CMS variable. The translation happens on the bound
                    CMS item (via the collection item sheet), not here, so the
                    sidebar just surfaces the connected variable for context.
                    No clear/X button — the binding can't be removed in
                    translation mode. */}
                {layerCmsTextBinding && (
                  <div className="grid grid-cols-3 items-center">
                    <Label variant="muted">Content</Label>
                    <div className="col-span-2 *:w-full">
                      <Button
                        asChild
                        variant="data"
                        className="justify-between! cursor-default"
                      >
                        <div>
                          <span className="flex items-center gap-1.5 truncate">
                            <Icon name="database" className="size-3 opacity-60 shrink-0" />
                            <span className="truncate">{layerCmsTextBinding.label || 'CMS Field'}</span>
                          </span>
                        </div>
                      </Button>
                    </div>
                  </div>
                )}

                {translatableItemsExcludingCmsText.length === 0 && !layerCmsTextBinding ? (
                  <Empty>
                    <EmptyMedia variant="icon">
                      <Icon name="globe" />
                    </EmptyMedia>
                    <EmptyTitle>Nothing to translate</EmptyTitle>
                    <EmptyDescription>
                      This layer has no translatable content. Select a text or media element.
                    </EmptyDescription>
                  </Empty>
                ) : translatableItemsExcludingCmsText.length > 0 ? (
                  // Group rows under language headers: all source values for
                  // the default locale first, then the editable translations
                  // for the active locale. Easier to scan when a layer has
                  // multiple translatable properties (e.g. image src + alt).
                  (['source', 'translation'] as const).map((side) => (
                    <div key={side} className="flex flex-col gap-4">
                      <Label className="text-xs font-medium">
                        {side === 'source'
                          ? defaultLocale?.label || 'Default'
                          : currentLocale.label}
                      </Label>
                      {translatableItemsExcludingCmsText.map((item) => {
                        // Rich-text element layers are previewed read-only and
                        // edited in the dedicated RichTextEditorSheet overlay,
                        // launched via the per-row "Expand to edit" button.
                        const isRichTextElementContent =
                          isRichTextLayer(selectedLayer) && item.content_type === 'richtext';
                        return (
                          <SidebarTranslationRow
                            key={`${side}:${item.key}`}
                            item={item}
                            side={side}
                            selectedLocaleId={selectedLocaleId}
                            localInputValues={translationLocalInputValues}
                            onLocalValueChange={handleTranslationLocalValueChange}
                            onLocalValueClear={handleTranslationLocalValueClear}
                            getTranslationByKey={getTranslationByKey}
                            createTranslation={createTranslation}
                            updateTranslation={updateTranslation}
                            previewOnly={isRichTextElementContent}
                            onExpand={isRichTextElementContent && selectedLayerId
                              ? () => openRichTextSheet(selectedLayerId)
                              : undefined}
                            fieldGroups={fieldGroups}
                            allFields={fields}
                            collections={collections}
                            layer={selectedLayer}
                            showContentLabel={translatableItemsExcludingCmsText.length > 1}
                          />
                        );
                      })}
                    </div>
                  ))
                ) : null}
              </div>
            )}

            {!isLocalizing && selectedLayerId !== 'body' && (<>
            {/* Attributes */}
            <div className="flex flex-col gap-2 pb-5 pt-5">
              {selectedLayer && (
                <IdSetting
                  layer={selectedLayer}
                  onLayerUpdate={handleLayerUpdate}
                  disabled={isLockedByOther}
                  onOpenVariablesDialog={openVariablesDialog}
                />
              )}

              {/* Container Tag Selector - Only for containers/sections/blocks, hide for alerts */}
              {isContainerLayer(selectedLayer) && !isHeadingLayer(selectedLayer) && !isAlertLayer(selectedLayer) && (
                <div className="grid grid-cols-3">
                  <Label variant="muted">Tag</Label>
                  <div className="col-span-2 *:w-full">
                    <Select value={containerTag} onValueChange={handleContainerTagChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="div">Div</SelectItem>
                          <SelectItem value="nav">Nav</SelectItem>
                          <SelectItem value="main">Main</SelectItem>
                          <SelectItem value="aside">Aside</SelectItem>
                          <SelectItem value="header">Header</SelectItem>
                          <SelectItem value="figure">Figure</SelectItem>
                          <SelectItem value="footer">Footer</SelectItem>
                          <SelectItem value="article">Article</SelectItem>
                          <SelectItem value="section">Section</SelectItem>
                          <SelectItem value="figcaption">Figcaption</SelectItem>
                          <SelectItem value="details">Details</SelectItem>
                          <SelectItem value="summary">Summary</SelectItem>
                          <SelectItem value="label">Label</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Tag Selector - For heading and text layers */}
              {(selectedLayer?.name === 'heading' || (selectedLayer?.name === 'text' && !isContainerLayer(selectedLayer))) && (() => {
                // Use isHeadingLayer (not name === 'heading') so legacy headings
                // stored as text with an h1-h6 tag still get heading tag options
                // instead of p/span/label — otherwise changing the tag demotes
                // them to a paragraph.
                const tagOptions = isHeadingLayer(selectedLayer) ? headingTagOptions : textTagOptions;
                return (
                  <div className="grid grid-cols-3">
                    <Label variant="muted">Tag</Label>
                    <div className="col-span-2 *:w-full">
                      <Select value={textTag} onValueChange={handleTextTagChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select...">
                            {textTag && (() => {
                              const option = tagOptions.find(opt => opt.value === textTag);
                              return option ? option.label : textTag;
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {tagOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })()}

              {selectedLayer && (
                <VisibilitySetting
                  layer={selectedLayer}
                  onLayerUpdate={handleLayerUpdate}
                  disabled={isLockedByOther}
                  onOpenVariablesDialog={openVariablesDialog}
                />
              )}
            </div>

            {/* Content Panel - show for text-editable layers */}
            {selectedLayer && isTextEditable(selectedLayer) && (() => {
              // Get component variables filtered to matching type for this layer
              const editingComponent = editingComponentId ? getComponentById(editingComponentId) : undefined;
              const allComponentVariables = editingComponent?.variables || [];
              const isRichText = isRichTextLayer(selectedLayer);
              const componentVariables = allComponentVariables.filter(v =>
                isRichText ? v.type === 'rich_text' : (!v.type || v.type === 'text')
              );
              const linkedVariableId = selectedLayer.variables?.text?.id;
              const linkedVariable = componentVariables.find(v => v.id === linkedVariableId);

              // Handle linking a layer to a variable
              const handleLinkVariable = (variableId: string) => {
                if (!selectedLayerId) return;
                const currentTextVar = selectedLayer.variables?.text;
                handleLayerUpdate(selectedLayerId, {
                  variables: {
                    ...selectedLayer.variables,
                    text: currentTextVar ? { ...currentTextVar, id: variableId } : { type: 'dynamic_text', id: variableId, data: { content: '' } },
                  },
                });
              };

              // Handle unlinking a layer from a variable
              const handleUnlinkVariable = () => {
                if (!selectedLayerId) return;
                const currentTextVar = selectedLayer.variables?.text;
                if (currentTextVar) {
                  const { id: _, ...textWithoutId } = currentTextVar;
                  handleLayerUpdate(selectedLayerId, {
                    variables: {
                      ...selectedLayer.variables,
                      text: textWithoutId as typeof currentTextVar,
                    },
                  });
                }
              };

              return (
                <SettingsPanel
                  title="Element"
                  isOpen={contentOpen}
                  onToggle={() => setContentOpen(!contentOpen)}
                >
                  <div className="grid grid-cols-3">
                    {!(isTextEditingOnCanvas && editingLayerIdOnCanvas === selectedLayerId) && (
                      <div className="flex items-start gap-1 py-1">
                        <ComponentVariableLabel
                          label="Content"
                          isEditingComponent={!!editingComponentId}
                          variables={componentVariables}
                          linkedVariableId={linkedVariableId}
                          onLinkVariable={handleLinkVariable}
                          onManageVariables={() => openVariablesDialog()}
                          onCreateVariable={editingComponentId ? async () => {
                            const contentValue = getContentValue(selectedLayer);
                            const addFn = isRichText ? addRichTextVariable : addTextVariable;
                            const newId = await addFn(editingComponentId, isRichText ? 'Rich text' : 'Text');
                            if (newId) {
                              await updateTextVariable(editingComponentId, newId, {
                                default_value: createTextComponentVariableValue(contentValue),
                              });
                              handleLinkVariable(newId);
                              openVariablesDialog(newId);
                            }
                          } : undefined}
                          className="py-1"
                        />
                      </div>
                    )}

                    <div className={isTextEditingOnCanvas && editingLayerIdOnCanvas === selectedLayerId ? 'col-span-3' : 'col-span-2 *:w-full'}>
                      {linkedVariable ? (
                        <Button
                          asChild
                          variant="purple"
                          className="justify-between!"
                          onClick={() => openVariablesDialog(linkedVariable.id)}
                        >
                          <div>
                            <span className="flex items-center gap-1.5">
                              <Icon name={VARIABLE_TYPE_ICONS[linkedVariable.type || 'text']} className="size-3 opacity-60" />
                              {linkedVariable.name}
                            </span>
                            <Button
                              className="size-4! p-0!"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); handleUnlinkVariable(); }}
                            >
                              <Icon name="x" className="size-2" />
                            </Button>
                          </div>
                        </Button>
                      ) : (isTextEditingOnCanvas && editingLayerIdOnCanvas === selectedLayerId) ? (
                        <Empty className="min-h-8 py-2">
                          <EmptyDescription>You are editing the text directly on canvas.</EmptyDescription>
                        </Empty>
                      ) : isTextLayer(selectedLayer) ? (
                        <RichTextEditor
                          key={selectedLayerId}
                          value={getContentValue(selectedLayer)}
                          onChange={handleContentChange}
                          placeholder="Enter text..."
                          withFormatting={true}
                          showFormattingToolbar={false}
                          fieldGroups={fieldGroups}
                          allFields={fields}
                          collections={collections}
                          layer={selectedLayer}
                          allowedFieldTypes={SIMPLE_TEXT_FIELD_TYPES}
                        />
                      ) : (
                        <ExpandableRichTextEditor
                          key={selectedLayerId}
                          value={getContentValue(selectedLayer)}
                          onChange={handleContentChange}
                          placeholder="Enter text..."
                          sheetDescription="Element content"
                          fieldGroups={fieldGroups}
                          allFields={fields}
                          collections={collections}
                          disabled={showTextStyleControls}
                          buttonOnly={isRichTextLayer(selectedLayer)}
                        />
                      )}
                    </div>
                  </div>
                </SettingsPanel>
              );
            })()}

            {/* Link Settings - hide for form-related layers, buttons inside forms, and layers inside buttons */}
            {selectedLayer && !['form', 'select', 'input', 'textarea', 'checkbox', 'radio', 'label', 'lightbox', 'hr', 'richText'].includes(selectedLayer.name) && selectedLayer.settings?.tag !== 'label' && !shouldHideLinkSettings && (
              <LinkSettings
                layer={selectedLayer}
                onLayerUpdate={handleLayerUpdate}
                fieldGroups={fieldGroups}
                allFields={fields}
                collections={collections}
                isLockedByOther={isLockedByOther}
                isInsideCollectionLayer={!!parentCollectionLayer}
                onOpenVariablesDialog={openVariablesDialog}
              />
            )}

            {/* Locale Label Panel - only show for localeSelector layers */}
            {selectedLayer && selectedLayer.name === 'localeSelector' && (
              <SettingsPanel
                title="Locale selector"
                isOpen={localeLabelOpen}
                onToggle={() => setLocaleLabelOpen(!localeLabelOpen)}
              >
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-3">
                    <Label variant="muted">Display</Label>
                    <div className="col-span-2 *:w-full">
                      <ToggleGroup
                        options={[
                          { label: 'English', value: 'locale' },
                          { label: 'EN', value: 'code' },
                        ]}
                        value={selectedLayer.settings?.locale?.format || 'locale'}
                        onChange={(value) => {
                          const format = value as 'locale' | 'code';

                          // Update the localeSelector settings
                          onLayerUpdate(selectedLayerId!, {
                            settings: {
                              ...selectedLayer.settings,
                              locale: {
                                format,
                              },
                            },
                          });

                          // Find and update the label child's text
                          const labelChild = selectedLayer.children?.find(
                            child => child.key === 'localeSelectorLabel'
                          );

                          if (labelChild) {
                            onLayerUpdate(labelChild.id, {
                              variables: {
                                ...labelChild.variables,
                                text: {
                                  type: 'dynamic_text',
                                  data: {
                                    content: format === 'code' ? 'EN' : 'English'
                                  }
                                }
                              }
                            });
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </SettingsPanel>
            )}

            {/* Collection Binding Panel - only show for collection layers (hide when optionsSource manages it) */}
            {selectedLayer && getCollectionVariable(selectedLayer) && !selectedLayer.settings?.optionsSource && (
              <SettingsPanel
                title="CMS"
                isOpen={collectionBindingOpen}
                onToggle={() => setCollectionBindingOpen(!collectionBindingOpen)}
              >
                <div className="flex flex-col gap-2">
                  {/* Collection Selector */}
                  <div className="grid grid-cols-3">
                    <Label variant="muted">Collection</Label>
                    <div className="col-span-2 *:w-full">
                      {/* When inside a parent collection, show reference fields, multi-asset fields, and inverse reference fields as source options */}
                      {parentCollectionLayer ? (
                        <Select
                          value={(() => {
                            const cv = getCollectionVariable(selectedLayer);
                            if (!cv?.source_field_id) return '';
                            if (cv.source_field_type === 'inverse_reference') {
                              return `inverse:${cv.source_field_id}:${cv.id}`;
                            }
                            return cv.source_field_id;
                          })()}
                          onValueChange={handleReferenceFieldChange}
                        >
                          <SelectTrigger
                            onClear={getCollectionVariable(selectedLayer)?.source_field_id
                              ? () => handleReferenceFieldChange('none')
                              : undefined}
                          >
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {parentMultiAssetFields.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Multi-asset fields</SelectLabel>
                                {parentMultiAssetFields.map((field) => (
                                  <SelectItem key={field.id} value={field.id}>
                                    <span className="flex items-center gap-2">
                                      <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                      {field.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {parentReferenceFields.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Reference fields</SelectLabel>
                                {parentReferenceFields.map((field) => (
                                  <SelectItem key={field.id} value={field.id}>
                                    <span className="flex items-center gap-2">
                                      <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                      {field.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {parentInverseReferenceFields.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Connected relations</SelectLabel>
                                {parentInverseReferenceFields.map(({ field, collection }) => (
                                  <SelectItem
                                    key={`inverse-${field.id}`}
                                    value={`inverse:${field.id}:${field.collection_id}`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <Icon name="database" className="size-3 text-muted-foreground shrink-0" />
                                      {collection.name} (via {field.name})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      ) : !editingComponentId && currentPage?.is_dynamic ? (
                        /* On dynamic pages, show CMS page data fields + all collections (not in component edit mode) */
                        <Select
                          value={getDynamicPageSourceValue === 'none' ? '' : getDynamicPageSourceValue}
                          onValueChange={handleDynamicPageSourceChange}
                        >
                          <SelectTrigger
                            onClear={getDynamicPageSourceValue !== 'none'
                              ? () => handleDynamicPageSourceChange('none')
                              : undefined}
                          >
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {dynamicPageMultiAssetFields.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Multi-asset fields</SelectLabel>
                                {dynamicPageMultiAssetFields.map((field) => (
                                  <SelectItem key={field.id} value={`multi_asset:${field.id}`}>
                                    <span className="flex items-center gap-2">
                                      <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                      {field.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {dynamicPageReferenceFields.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Reference fields</SelectLabel>
                                {dynamicPageReferenceFields.map((field) => (
                                  <SelectItem key={field.id} value={`field:${field.id}`}>
                                    <span className="flex items-center gap-2">
                                      <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                      {field.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {dynamicPageInverseReferenceFields.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Connected relations</SelectLabel>
                                {dynamicPageInverseReferenceFields.map(({ field, collection }) => (
                                  <SelectItem
                                    key={`inverse-${field.id}`}
                                    value={`inverse:${field.id}:${field.collection_id}`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <Icon name="database" className="size-3 text-muted-foreground shrink-0" />
                                      {collection.name} (via {field.name})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            <SelectGroup>
                              <SelectLabel>Collections</SelectLabel>
                              {collections.length > 0 ? (
                                collections.map((collection) => (
                                  <SelectItem key={collection.id} value={`collection:${collection.id}`}>
                                    <span className="flex items-center gap-2">
                                      <Icon name="database" className="size-3 text-muted-foreground shrink-0" />
                                      {collection.name}
                                    </span>
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                  No collections available
                                </div>
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : (
                        /* When not inside a parent collection and not dynamic, show collections as source options */
                        <Select
                          value={hasBoundCollectionSource(getCollectionVariable(selectedLayer)) ? getCollectionVariable(selectedLayer)?.id || '' : ''}
                          onValueChange={handleCollectionChange}
                        >
                          <SelectTrigger
                            onClear={hasBoundCollectionSource(getCollectionVariable(selectedLayer))
                              ? () => handleCollectionChange('none')
                              : undefined}
                          >
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Collections</SelectLabel>
                              {collections.length > 0 ? (
                                collections.map((collection) => (
                                  <SelectItem key={collection.id} value={collection.id}>
                                    <span className="flex items-center gap-2">
                                      <Icon name="database" className="size-3 text-muted-foreground shrink-0" />
                                      {collection.name}
                                    </span>
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                  No collections available
                                </div>
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  {/* Sort By - only show if a real collection source is selected */}
                  {hasBoundCollectionSource(getCollectionVariable(selectedLayer)) && (
                    <>
                      {/* Sort by/order are hidden for multi-asset: order is the
                          image order in the field and there are no fields to sort by. */}
                      {getCollectionVariable(selectedLayer)?.source_field_type !== 'multi_asset' && (
                      <>
                      <div className="grid grid-cols-3">
                        <Label variant="muted">Sort by</Label>
                        <div className="col-span-2 *:w-full flex">
                          {getCollectionVariable(selectedLayer)?.sort_by_inputLayerId ? (
                              <div className="flex items-center gap-1">
                                <Input value={getSortLinkedInputName(getCollectionVariable(selectedLayer)!.sort_by_inputLayerId!)} disabled />
                                <div className="shrink-0">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="secondary" onClick={() => handleUnlinkSortInput('sort_by_inputLayerId')}>
                                        <Icon name="x" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Unlink filter input</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                          ) : isElementPickerActive ? (
                            <Button
                              variant="secondary" onClick={stopElementPicker}
                            />
                          ) : (
                            <Select
                              value={getCollectionVariable(selectedLayer)?.sort_by || 'none'}
                              onValueChange={handleSortBySelectValue}
                            >
                              <SelectTrigger ref={sortByTriggerRef}>
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="none">None</SelectItem>
                                  <SelectItem value="manual">Manual</SelectItem>
                                  <SelectItem value="random">Random</SelectItem>
                                  <SelectItem value={SORT_INPUT_VALUE_OPTION}>Input value</SelectItem>
                                </SelectGroup>
                                {selectedCollectionFields.length > 0 && (
                                  <>
                                    <SelectSeparator />
                                    <SelectGroup>
                                      <SelectLabel>Fields</SelectLabel>
                                      {selectedCollectionFields.map((field) => (
                                        <SelectItem key={field.id} value={field.id}>
                                          <span className="flex items-center gap-2">
                                            <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                            {field.name}
                                          </span>
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>

                      {/* Sort Order - show when field sort is selected or order is input-linked */}
                      {(getCollectionVariable(selectedLayer)?.sort_order_inputLayerId ||
                        getCollectionVariable(selectedLayer)?.sort_by_inputLayerId ||
                        (getCollectionVariable(selectedLayer)?.sort_by &&
                          getCollectionVariable(selectedLayer)?.sort_by !== 'none' &&
                          getCollectionVariable(selectedLayer)?.sort_by !== 'manual' &&
                          getCollectionVariable(selectedLayer)?.sort_by !== 'random')) && (
                          <div className="grid grid-cols-3">
                            <Label variant="muted">Sort order</Label>
                            <div className="col-span-2 *:w-full flex">
                              {getCollectionVariable(selectedLayer)?.sort_order_inputLayerId ? (

                                  <div className="flex items-center gap-1">
                                    <Input value={getSortLinkedInputName(getCollectionVariable(selectedLayer)!.sort_order_inputLayerId!)} disabled />
                                    <div className="shrink-0">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button variant="secondary" onClick={() => handleUnlinkSortInput('sort_order_inputLayerId')}>
                                            <Icon name="x" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Unlink filter input</TooltipContent>
                                      </Tooltip>
                                    </div>
                                  </div>

                              ) : isElementPickerActive ? (
                                <Button variant="secondary" onClick={stopElementPicker} />
                              ) : (
                                <Select
                                  value={getCollectionVariable(selectedLayer)?.sort_order || 'asc'}
                                  onValueChange={handleSortOrderSelectValue}
                                >
                                  <SelectTrigger ref={sortOrderTriggerRef}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="asc">Ascending</SelectItem>
                                      <SelectItem value="desc">Descending</SelectItem>
                                      <SelectSeparator />
                                      <SelectItem value={SORT_INPUT_VALUE_OPTION}>Input value</SelectItem>
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          </div>
                      )}
                      </>
                      )}

                      {/* Total Limit */}
                      <div className="grid grid-cols-3">
                        <Label variant="muted">Total limit</Label>
                        <div className="col-span-2 *:w-full">
                          <Input
                            type="number"
                            min="1"
                            value={getCollectionVariable(selectedLayer)?.limit || ''}
                            onChange={(e) => handleLimitChange(e.target.value)}
                            placeholder="No limit"
                          />
                        </div>
                      </div>

                      {/* Offset */}
                      <div className="grid grid-cols-3">
                        <Label variant="muted">Offset</Label>
                        <div className="col-span-2 *:w-full">
                          <Input
                            type="number"
                            min="0"
                            value={getCollectionVariable(selectedLayer)?.offset || ''}
                            onChange={(e) => handleOffsetChange(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>

                      {/* Pagination - hidden for nested collections and slides */}
                      {!isNestedInCollection && selectedLayer.name !== 'slide' && (
                        <div className="grid grid-cols-3">
                          <Label variant="muted">Pagination</Label>
                          <div className="col-span-2 *:w-full">
                            <ToggleGroup
                              options={[
                                { label: 'Off', value: false },
                                { label: 'On', value: true },
                              ]}
                              value={getCollectionVariable(selectedLayer)?.pagination?.enabled ?? false}
                              onChange={(value) => handlePaginationEnabledChange(value as boolean)}
                              disabled={isPaginationDisabled}
                            />
                            {paginationDisabledReason && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {paginationDisabledReason}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Pagination type and items per page - only show when pagination enabled */}
                      {!isNestedInCollection && selectedLayer.name !== 'slide' && getCollectionVariable(selectedLayer)?.pagination?.enabled && (
                        <>
                          <div className="grid grid-cols-3">
                            <Label variant="muted">Type</Label>
                            <div className="col-span-2 *:w-full">
                              <Select
                                value={getCollectionVariable(selectedLayer)?.pagination?.mode ?? 'pages'}
                                onValueChange={(value) => handlePaginationModeChange(value as 'pages' | 'load_more')}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="pages">Pages (Previous / Next)</SelectItem>
                                    <SelectItem value="load_more">Load More</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid grid-cols-3">
                            <Label variant="muted">Per page</Label>
                            <div className="col-span-2 *:w-full">
                              <Input
                                type="number"
                                min={1}
                                max={100}
                                value={getCollectionVariable(selectedLayer)?.pagination?.items_per_page ?? 10}
                                onChange={(e) => handleItemsPerPageChange(e.target.value)}
                              />
                            </div>
                          </div>
                          {getCollectionVariable(selectedLayer)?.pagination?.mode !== 'load_more' && (
                            <div className="grid grid-cols-3">
                              <Label variant="muted">URL param</Label>
                              <div className="col-span-2 *:w-full">
                                <div className="relative">
                                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    p_
                                  </span>
                                  <Input
                                    className="pl-[26px]"
                                    value={getCollectionVariable(selectedLayer)?.pagination?.param_name ?? ''}
                                    placeholder={stripLayerPrefix(selectedLayer.id)}
                                    onChange={(e) => handlePaginationParamNameChange(e.target.value)}
                                    disableKeyboardStep
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </SettingsPanel>
            )}

            <ImageSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
              onOpenVariablesDialog={openVariablesDialog}
            />

            <VideoSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
              onOpenVariablesDialog={openVariablesDialog}
            />

            <AudioSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
              onOpenVariablesDialog={openVariablesDialog}
            />

            <IconSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              onOpenVariablesDialog={openVariablesDialog}
            />

            <HTMLEmbedSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            <MapSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            <FormSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            <FilterSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            <AlertSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            <SliderSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              allLayers={allLayers}
              fieldGroups={fieldGroups}
            />

            <LightboxSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />

            <LabelSettings
              layer={selectedLayer}
              allLayers={allLayers}
              onLayerUpdate={handleLayerUpdate}
            />

            <InputSettings
              layer={selectedLayer}
              allLayers={allLayers}
              onLayerUpdate={handleLayerUpdate}
            />

            <SelectOptionsSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            {/* Collection Filters - only for layers bound to a real collection source */}
            {selectedLayer && hasBoundCollectionSource(getCollectionVariable(selectedLayer)) && (
              <CollectionFiltersSettings
                layer={selectedLayer}
                onLayerUpdate={handleLayerUpdate}
                collectionId={getCollectionVariable(selectedLayer)!.id}
              />
            )}

            <ConditionalVisibilitySettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              fieldGroups={fieldGroups}
            />
            </>)}

            {/* Custom Attributes Panel — hide while translating */}
            {!isLocalizing && (
            <SettingsPanel
              title="Custom attributes"
              isOpen={hasCustomAttributes}
              onToggle={() => {}}
              action={
                <Popover open={showAddAttributePopover} onOpenChange={setShowAddAttributePopover}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="xs"
                    >
                      <Icon name="plus" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64" align="end">
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-3">
                          <Label variant="muted">Name</Label>
                          <div className="col-span-2 *:w-full">
                            <Input
                              value={newAttributeName}
                              onChange={(e) => setNewAttributeName(e.target.value)}
                              placeholder="e.g., data-id"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleAddAttribute();
                                }
                              }}
                            />
                          </div>
                      </div>

                      <div className="grid grid-cols-3">
                        <Label>Value</Label>
                          <div className="col-span-2 *:w-full">
                            <Input
                              value={newAttributeValue}
                              onChange={(e) => setNewAttributeValue(e.target.value)}
                              placeholder="e.g., 123"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleAddAttribute();
                                }
                              }}
                            />
                          </div>
                      </div>

                      <Button
                        onClick={handleAddAttribute}
                        disabled={!newAttributeName.trim()}
                        size="sm"
                        variant="secondary"
                      >
                        Add attribute
                      </Button>

                    </div>
                  </PopoverContent>
                </Popover>
              }
            >
              {selectedLayer?.settings?.customAttributes && (
                <div className="flex flex-col gap-1">
                  {Object.entries(selectedLayer.settings.customAttributes).map(([name, value]) => (
                    <CustomAttributeRow
                      key={name}
                      name={name}
                      value={value as string}
                      onEdit={handleEditAttribute}
                      onRemove={handleRemoveAttribute}
                    />
                  ))}
                </div>
              )}
            </SettingsPanel>
            )}

            {/* Advanced — hide while translating and for body */}
            {!isLocalizing && selectedLayer && selectedLayerId !== 'body' && (
              <AdvancedSettings
                layer={selectedLayer}
                onLayerUpdate={handleLayerUpdate}
                disabled={isLockedByOther}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="interactions" className="flex-1 overflow-y-auto no-scrollbar mt-0 data-[state=inactive]:hidden">
          {interactionOwnerLayer ? (
            <InteractionsPanel
              triggerLayer={interactionOwnerLayer}
              allLayers={allLayers}
              onLayerUpdate={handleLayerUpdate}
              selectedLayerId={selectedLayerId}
              resetKey={interactionResetKey}
              activeBreakpoint={activeBreakpoint}
              onStateChange={handleInteractionStateChange}
              onSelectLayer={setSelectedLayerId}
            />
          ) : (
            <Empty>
              <EmptyTitle>No Layer Selected</EmptyTitle>
              <EmptyDescription>
                Select a layer to edit its interactions
              </EmptyDescription>
            </Empty>
          )}
        </TabsContent>
      </Tabs>

      {/* Component Variables Dialog */}
      <ComponentVariablesDialog
        open={variablesDialogOpen}
        onOpenChange={(open) => {
          setVariablesDialogOpen(open);
          if (!open) setVariablesDialogInitialId(null);
        }}
        componentId={editingComponentId}
        initialVariableId={variablesDialogInitialId}
      />
    </div>
  );
});

export default RightSidebar;
