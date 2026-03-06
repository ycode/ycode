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
import BackgroundsControls from './BackgroundsControls';
import BorderControls from './BorderControls';
import ComponentVariablesDialog from './ComponentVariablesDialog';
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
import SliderSettings from './SliderSettings';
import LightboxSettings from './LightboxSettings';
import InputSettings from './InputSettings';
import SelectOptionsSettings from './SelectOptionsSettings';
import LabelSettings from './LabelSettings';
import LinkSettings, { type LinkSettingsValue } from './LinkSettings';
import ComponentInstanceSidebar from './ComponentInstanceSidebar';
import ComponentVariableOverrides from './ComponentVariableOverrides';
import ExpandableRichTextEditor from './ExpandableRichTextEditor';
import ComponentVariableLabel, { VARIABLE_TYPE_ICONS } from './ComponentVariableLabel';
import InteractionsPanel from './InteractionsPanel';
import LayoutControls from './LayoutControls';
import LayerStylesPanel from './LayerStylesPanel';
import PositionControls from './PositionControls';
import SettingsPanel from './SettingsPanel';
import SizingControls from './SizingControls';
import SpacingControls from './SpacingControls';
import ToggleGroup from './ToggleGroup';
import TypographyControls from './TypographyControls';
import UIStateSelector from './UIStateSelector';

// 5. Stores
import { useEditorStore } from '@/stores/useEditorStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useLayerStylesStore } from '@/stores/useLayerStylesStore';
import { useCanvasTextEditorStore } from '@/stores/useCanvasTextEditorStore';
import { useEditorActions, useEditorUrl } from '@/hooks/use-editor-url';

// 5.5 Hooks
import { useLayerLocks } from '@/hooks/use-layer-locks';

// 6. Utils, APIs, lib
import { classesToDesign, mergeDesign, removeConflictsForClass, getRemovedPropertyClasses } from '@/lib/tailwind-class-mapper';
import { cn } from '@/lib/utils';
import { sanitizeHtmlId } from '@/lib/html-utils';
import { isFieldVariable, getCollectionVariable, findParentCollectionLayer, findAllParentCollectionLayers, isTextEditable, findLayerWithParent, resetBindingsOnCollectionSourceChange, isInputInsideFilter } from '@/lib/layer-utils';
import { detachSpecificLayerFromComponent } from '@/lib/component-utils';
import { convertContentToValue, parseValueToContent } from '@/lib/cms-variables-utils';
import { createTextComponentVariableValue } from '@/lib/variable-utils';
import { getRichTextValue } from '@/lib/tiptap-utils';
import { DEFAULT_TEXT_STYLES, getTextStyle } from '@/lib/text-format-utils';
import { buildFieldGroupsForLayer, getFieldIcon, isMultipleAssetField, MULTI_ASSET_COLLECTION_ID } from '@/lib/collection-field-utils';

// 7. Types
import type { Layer, FieldVariable, CollectionField, CollectionVariable, ComponentVariable } from '@/types';
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
  selectedLayerId: string | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const RightSidebar = React.memo(function RightSidebar({
  selectedLayerId,
  onLayerUpdate,
}: RightSidebarProps) {
  const { openComponent, urlState, updateQueryParams } = useEditorActions();
  const { routeType } = useEditorUrl();

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
  const [attributesOpen, setAttributesOpen] = useState(true);
  const [customId, setCustomId] = useState<string>('');
  const [isHidden, setIsHidden] = useState<boolean>(false);
  const [containerTag, setContainerTag] = useState<string>('div');
  const [textTag, setTextTag] = useState<string>('p');
  const [customAttributesOpen, setCustomAttributesOpen] = useState(false);
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
  const setSelectedLayerId = useEditorStore((state) => state.setSelectedLayerId);
  const setInteractionHighlights = useEditorStore((state) => state.setInteractionHighlights);
  const setActiveInteraction = useEditorStore((state) => state.setActiveInteraction);
  const clearActiveInteraction = useEditorStore((state) => state.clearActiveInteraction);
  const activeTextStyleKey = useEditorStore((state) => state.activeTextStyleKey);
  const showTextStyleControls = useEditorStore((state) => state.showTextStyleControls());
  const startElementPicker = useEditorStore((state) => state.startElementPicker);
  const stopElementPicker = useEditorStore((state) => state.stopElementPicker);
  const isElementPickerActive = useEditorStore((state) => !!state.elementPicker?.active);

  // Check if text is being edited on canvas
  const isTextEditingOnCanvas = useCanvasTextEditorStore((state) => state.isEditing);
  const editingLayerIdOnCanvas = useCanvasTextEditorStore((state) => state.editingLayerId);

  // Collaboration hooks - re-enabled
  const layerLocks = useLayerLocks();
  // Store in ref to avoid dependency changes triggering infinite loops
  const layerLocksRef = useRef(layerLocks);
  layerLocksRef.current = layerLocks;

  const draftsByPageId = usePagesStore((state) => state.draftsByPageId);
  const setDraftLayers = usePagesStore((state) => state.setDraftLayers);
  const pages = usePagesStore((state) => state.pages);

  const getComponentById = useComponentsStore((state) => state.getComponentById);
  const componentDrafts = useComponentsStore((state) => state.componentDrafts);
  const addTextVariable = useComponentsStore((state) => state.addTextVariable);
  const updateTextVariable = useComponentsStore((state) => state.updateTextVariable);

  const collections = useCollectionsStore((state) => state.collections);
  const fields = useCollectionsStore((state) => state.fields);
  const loadFields = useCollectionsStore((state) => state.loadFields);

  // Get all layers (for interactions target selection)
  const allLayers: Layer[] = useMemo(() => {
    if (editingComponentId) {
      return componentDrafts[editingComponentId] || [];
    } else if (currentPageId) {
      const draft = draftsByPageId[currentPageId];
      return draft ? draft.layers : [];
    }
    return [];
  }, [editingComponentId, componentDrafts, currentPageId, draftsByPageId]);

  // Helper to find layer by ID
  const findLayerById = useCallback((layerId: string | null): Layer | null => {
    if (!layerId || !allLayers.length) return null;

    const stack: Layer[] = [...allLayers];
    while (stack.length) {
      const node = stack.shift()!;
      if (node.id === layerId) return node;
      if (node.children) stack.push(...node.children);
    }
    return null;
  }, [allLayers]);

  const selectedLayer: Layer | null = useMemo(() => {
    return findLayerById(selectedLayerId);
  }, [selectedLayerId, findLayerById]);

  const selectedLayerRef = useRef(selectedLayer);
  selectedLayerRef.current = selectedLayer;

  // Get the layer whose interactions we're editing (different from selected layer during target selection)
  const interactionOwnerLayer: Layer | null = useMemo(() => {
    return findLayerById(interactionOwnerLayerId);
  }, [interactionOwnerLayerId, findLayerById]);

  // Check if selected layer is at root level (has no parent) - used to disable pagination
  const isSelectedLayerAtRoot: boolean = useMemo(() => {
    if (!selectedLayerId || !allLayers.length) return false;
    const result = findLayerWithParent(allLayers, selectedLayerId);
    return result?.parent === null;
  }, [selectedLayerId, allLayers]);

  // Check if selected collection is nested inside another collection
  // If so, we hide the pagination option entirely (not just disable it)
  const isNestedInCollection: boolean = useMemo(() => {
    if (!selectedLayer || !selectedLayerId) return false;

    const collectionVar = getCollectionVariable(selectedLayer);
    if (!collectionVar) return false;

    const parentCollection = findParentCollectionLayer(allLayers, selectedLayerId);
    return !!parentCollection;
  }, [selectedLayer, selectedLayerId, allLayers]);

  // Check if link settings should be hidden:
  // - Buttons inside a form (they act as submit buttons)
  // - Any layer inside a button (the button itself handles the link)
  const shouldHideLinkSettings: boolean = useMemo(() => {
    if (!selectedLayer || !selectedLayerId) return false;

    let current = findLayerWithParent(allLayers, selectedLayerId)?.parent ?? null;
    while (current) {
      if (current.name === 'button') return true;
      if (current.name === 'form' && selectedLayer.name === 'button') return true;
      const parentResult = findLayerWithParent(allLayers, current.id);
      current = parentResult?.parent ?? null;
    }
    return false;
  }, [selectedLayer, selectedLayerId, allLayers]);

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

  // Helper function to check if layer is a heading
  const isHeadingLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'heading'];
    return headingTags.includes(layer.name || '') ||
           headingTags.includes(layer.settings?.tag || '');
  };

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

  // Helper function to check if layer is a text element
  const isTextLayer = (layer: Layer | null): boolean => {
    if (!layer) return false;
    return layer.name === 'text';
  };

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
        // Layout controls: show for containers, hide for text-only and image elements
        if (isImageLayer(layer)) return false;
        return !isTextLayer(layer) || isButtonLayer(layer);

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
        // Typography controls: show in text edit mode or for text elements, buttons, icons, form inputs, body, and fraction
        if (showTextStyleControls) return true;
        return isTextLayer(layer) || isButtonLayer(layer) || isIconLayer(layer) || isFormInputLayer(layer) || layer.id === 'body' || layer.name === 'slideFraction';

      case 'backgrounds':
        // Background controls: show for all elements (text layers need it for clip-text effects)
        if (showTextStyleControls) return true;
        return true;

      case 'borders':
        // Border controls: hide for pure text elements (show for buttons and containers)
        // Hidden in text edit mode (block-level property)
        if (showTextStyleControls) return false;
        return !isTextLayer(layer) || isButtonLayer(layer);

      case 'effects':
        // Effect controls (opacity, shadow): show for all elements
        // Opacity is useful in text edit mode for transparency
        return true;

      case 'position':
        // In text style mode, hide position controls
        if (showTextStyleControls) return false;
        // Position controls: show for all
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
    return 'p'; // Default to p
  };

  // Text tag options with labels
  const textTagOptions = [
    { value: 'h1', label: 'Heading 1' },
    { value: 'h2', label: 'Heading 2' },
    { value: 'h3', label: 'Heading 3' },
    { value: 'h4', label: 'Heading 4' },
    { value: 'h5', label: 'Heading 5' },
    { value: 'h6', label: 'Heading 6' },
    { value: 'p', label: 'Paragraph' },
    { value: 'span', label: 'Span' },
    { value: 'label', label: 'Label' },
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

  // Lock-aware update function
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
  const { getStyleById } = useLayerStylesStore();
  const appliedStyle = selectedLayer?.styleId ? getStyleById(selectedLayer.styleId) : undefined;
  const styleClassesArray = useMemo(() => {
    if (!appliedStyle || !appliedStyle.classes) return [];
    const styleClasses = Array.isArray(appliedStyle.classes)
      ? appliedStyle.classes.join(' ')
      : appliedStyle.classes;
    return styleClasses.split(' ').filter(cls => cls.trim() !== '');
  }, [appliedStyle]);

  // Filter layer classes to only show those NOT in the style
  const layerOnlyClasses = useMemo(() => {
    if (styleClassesArray.length === 0) return classesArray;
    return classesArray.filter(cls => !styleClassesArray.includes(cls));
  }, [classesArray, styleClassesArray]);

  // Determine which style classes are overridden by layer's custom classes or explicitly removed
  const overriddenStyleClasses = useMemo(() => {
    if (styleClassesArray.length === 0) return new Set<string>();
    const overridden = new Set<string>();

    // 1. Check for classes overridden by layer's custom classes
    if (layerOnlyClasses.length > 0) {
      for (const layerClass of layerOnlyClasses) {
        // Use the conflict detection utility
        // If adding this layer class would remove any style classes, those are overridden
        const classesWithoutConflicts = removeConflictsForClass(styleClassesArray, layerClass);

        // Find which style classes were removed (those are the overridden ones)
        for (const styleClass of styleClassesArray) {
          if (!classesWithoutConflicts.includes(styleClass)) {
            overridden.add(styleClass);
          }
        }
      }
    }

    // 2. Check for classes from properties explicitly removed on the layer
    if (appliedStyle?.design && selectedLayer) {
      const removedClasses = getRemovedPropertyClasses(
        selectedLayer.design,
        appliedStyle.design,
        styleClassesArray
      );
      removedClasses.forEach(cls => overridden.add(cls));
    }

    return overridden;
  }, [layerOnlyClasses, styleClassesArray, appliedStyle, selectedLayer]);

  // Update local state when selected layer changes (for settings fields)
  const [prevSelectedLayerId, setPrevSelectedLayerId] = useState<string | null>(null);
  if (selectedLayerId !== prevSelectedLayerId) {
    setPrevSelectedLayerId(selectedLayerId);
    setCustomId(sanitizeHtmlId(selectedLayer?.settings?.id || selectedLayer?.attributes?.id || ''));
    setIsHidden(selectedLayer?.settings?.hidden || false);
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
    if (classesArray.includes(trimmedClass)) return; // Don't add duplicates

    // Remove any conflicting classes before adding the new one
    const classesWithoutConflicts = removeConflictsForClass(classesArray, trimmedClass);

    // Add the new class (after removing conflicts)
    const newClasses = [...classesWithoutConflicts, trimmedClass].join(' ');

    // In text edit mode with a text style selected, update the text style
    // Initialize with DEFAULT_TEXT_STYLES if layer doesn't have textStyles yet
    if (showTextStyleControls && activeTextStyleKey) {
      const parsedDesign = classesToDesign([trimmedClass]);
      const currentTextStyles = selectedLayer.textStyles ?? { ...DEFAULT_TEXT_STYLES };
      const currentTextStyle = currentTextStyles[activeTextStyleKey] || { design: {}, classes: '' };
      const updatedDesign = mergeDesign(currentTextStyle.design, parsedDesign);

      handleLayerUpdate(selectedLayer.id, {
        textStyles: {
          ...currentTextStyles,
          [activeTextStyleKey]: {
            ...currentTextStyle,
            classes: newClasses,
            design: updatedDesign,
          },
        },
      });
    } else {
      // Otherwise, update the layer itself
      const parsedDesign = classesToDesign([trimmedClass]);
      const updatedDesign = mergeDesign(selectedLayer.design, parsedDesign);

      handleLayerUpdate(selectedLayer.id, {
        classes: newClasses,
        design: updatedDesign
      });
    }

    setClassesInput(newClasses);
    setCurrentClassInput('');
  }, [classesArray, handleLayerUpdate, selectedLayer, showTextStyleControls, activeTextStyleKey]);

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

  // Handle key press for adding classes
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addClass(currentClassInput);
    }
  }, [addClass, currentClassInput]);

  // Handle custom ID change - store in settings.id (takes priority over attributes.id in renderer)
  const handleIdChange = (value: string) => {
    const sanitizedId = sanitizeHtmlId(value);
    setCustomId(sanitizedId);
    if (selectedLayerId) {
      const currentSettings = selectedLayer?.settings || {};
      handleLayerUpdate(selectedLayerId, {
        settings: { ...currentSettings, id: sanitizedId }
      });
    }
  };

  // Handle visibility toggle
  const handleVisibilityChange = (hidden: boolean) => {
    setIsHidden(hidden);
    if (selectedLayerId) {
      const currentSettings = selectedLayer?.settings || {};
      handleLayerUpdate(selectedLayerId, {
        settings: { ...currentSettings, hidden }
      });
    }
  };

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
      handleLayerUpdate(selectedLayerId, {
        settings: { ...currentSettings, tag }
      });
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

  // Handle collection binding change (also resets child bindings when source changes)
  const handleCollectionChange = (collectionId: string) => {
    if (!selectedLayerId || !selectedLayer) return;

    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    handleLayerUpdate(selectedLayerId, {
      variables: {
        ...selectedLayer?.variables,
        collection: collectionId && collectionId !== 'none' ? {
          id: collectionId,
          sort_by: currentCollectionVariable?.sort_by,
          sort_order: currentCollectionVariable?.sort_order,
          sort_by_inputLayerId: currentCollectionVariable?.sort_by_inputLayerId,
          sort_order_inputLayerId: currentCollectionVariable?.sort_order_inputLayerId,
        } : { id: '', source_field_id: undefined, source_field_type: undefined }
      }
    });

    // Reset invalid CMS bindings on child layers after the source changed
    const layerId = selectedLayerId;
    setTimeout(() => {
      const currentLayers = editingComponentId
        ? useComponentsStore.getState().componentDrafts[editingComponentId]
        : currentPageId
          ? usePagesStore.getState().draftsByPageId[currentPageId]?.layers
          : null;

      if (!currentLayers) return;

      const cleanedLayers = resetBindingsOnCollectionSourceChange(currentLayers, layerId);
      if (cleanedLayers !== currentLayers) {
        if (editingComponentId) {
          useComponentsStore.getState().updateComponentDraft(editingComponentId, cleanedLayers);
        } else if (currentPageId) {
          setDraftLayers(currentPageId, cleanedLayers);
        }
      }
    }, 0);
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

  // Handle reference field selection (for reference, multi-reference, or multi-asset as collection source)
  // Also resets child bindings when source changes
  const handleReferenceFieldChange = (fieldId: string) => {
    if (!selectedLayerId || !selectedLayer) return;

    const currentCollectionVariable = getCollectionVariable(selectedLayer);

    if (fieldId === 'none') {
      // Clear the collection source
      handleLayerUpdate(selectedLayerId, {
        variables: {
          ...selectedLayer?.variables,
          collection: { id: '', source_field_id: undefined, source_field_type: undefined, source_field_source: undefined }
        }
      });
    } else {
      // Find the selected field to get its reference_collection_id and type
      const selectedField = parentCollectionFields.find(f => f.id === fieldId);

      if (selectedField && isMultipleAssetField(selectedField)) {
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              id: MULTI_ASSET_COLLECTION_ID,
              source_field_id: fieldId,
              source_field_type: 'multi_asset',
              source_field_source: 'collection',
            }
          }
        });
      } else if (selectedField?.reference_collection_id) {
        handleLayerUpdate(selectedLayerId, {
          variables: {
            ...selectedLayer?.variables,
            collection: {
              ...currentCollectionVariable,
              id: selectedField.reference_collection_id,
              source_field_id: fieldId,
              source_field_type: selectedField.type as 'reference' | 'multi_reference',
              source_field_source: undefined,
            }
          }
        });
      }
    }

    // Reset invalid CMS bindings on child layers after the source changed
    const layerId = selectedLayerId;
    setTimeout(() => {
      const currentLayers = editingComponentId
        ? useComponentsStore.getState().componentDrafts[editingComponentId]
        : currentPageId
          ? usePagesStore.getState().draftsByPageId[currentPageId]?.layers
          : null;

      if (!currentLayers) return;

      const cleanedLayers = resetBindingsOnCollectionSourceChange(currentLayers, layerId);
      if (cleanedLayers !== currentLayers) {
        if (editingComponentId) {
          useComponentsStore.getState().updateComponentDraft(editingComponentId, cleanedLayers);
        } else if (currentPageId) {
          setDraftLayers(currentPageId, cleanedLayers);
        }
      }
    }, 0);
  };

  // Handle dynamic page source selection (unified handler for field or collection)
  // Value format: "field:{fieldId}" or "collection:{collectionId}" or "none"
  // After changing the source, resets invalid CMS bindings on child layers
  const handleDynamicPageSourceChange = (value: string) => {
    if (!selectedLayerId || !selectedLayer) return;

    const currentCollectionVariable = getCollectionVariable(selectedLayer);
    let newCollectionVar: CollectionVariable | undefined;

    if (value === 'none' || !value) {
      newCollectionVar = { id: '', source_field_id: undefined, source_field_type: undefined };
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

    // Update the collection source on the layer
    handleLayerUpdate(selectedLayerId, {
      variables: { ...selectedLayer?.variables, collection: newCollectionVar }
    });

    // Reset invalid CMS bindings on child layers after the source changed
    // Use setTimeout to ensure the layer update is applied first
    const layerId = selectedLayerId;
    setTimeout(() => {
      const currentLayers = editingComponentId
        ? useComponentsStore.getState().componentDrafts[editingComponentId]
        : currentPageId
          ? usePagesStore.getState().draftsByPageId[currentPageId]?.layers
          : null;

      if (!currentLayers) return;

      const cleanedLayers = resetBindingsOnCollectionSourceChange(currentLayers, layerId);
      if (cleanedLayers !== currentLayers) {
        if (editingComponentId) {
          useComponentsStore.getState().updateComponentDraft(editingComponentId, cleanedLayers);
        } else if (currentPageId) {
          setDraftLayers(currentPageId, cleanedLayers);
        }
      }
    }, 0);
  };

  // Get current value for dynamic page source dropdown
  const getDynamicPageSourceValue = useMemo(() => {
    if (!selectedLayer) return 'none';
    const collectionVariable = getCollectionVariable(selectedLayer);
    if (!collectionVariable?.id) return 'none';

    // If source_field_id is set, check the type
    if (collectionVariable.source_field_id) {
      if (collectionVariable.source_field_type === 'multi_asset') {
        return `multi_asset:${collectionVariable.source_field_id}`;
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
        const freshLayer = selectedLayerRef.current;
        if (!freshLayer) return;
        const freshVariable = getCollectionVariable(freshLayer);
        if (!freshVariable) return;
        handleLayerUpdate(freshLayer.id, {
          variables: {
            ...freshLayer.variables,
            collection: {
              ...freshVariable,
              [key]: layerId,
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
    const inputLayer = findLayerById(inputLayerId);
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
            name: 'span',
            customName: 'Previous Text',
            classes: '',
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
        name: 'span',
        customName: 'Page Info',
        classes: 'text-sm text-[#4b5563]',
        variables: {
          text: {
            type: 'dynamic_text',
            data: { content: 'Page 1 of 1' }
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
            name: 'span',
            customName: 'Next Text',
            classes: '',
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
            name: 'span',
            customName: 'Load More Text',
            classes: '',
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
        name: 'span',
        customName: 'Items Count',
        classes: 'text-sm text-[#4b5563]',
        variables: {
          text: {
            type: 'dynamic_text',
            data: { content: 'Showing items' }
          }
        }
      } as Layer,
    ],
  });

  // Helper: Get current layers from the appropriate store
  const getCurrentLayersFromStore = (): Layer[] => {
    if (editingComponentId) {
      return useComponentsStore.getState().componentDrafts[editingComponentId] || [];
    } else if (currentPageId) {
      const draft = usePagesStore.getState().draftsByPageId[currentPageId];
      return draft ? draft.layers : [];
    }
    return [];
  };

  // Helper: Add or replace pagination wrapper
  const addOrReplacePaginationWrapper = (collectionLayerId: string, mode: 'pages' | 'load_more') => {
    const currentLayers = getCurrentLayersFromStore();
    const parentResult = findLayerWithParent(currentLayers, collectionLayerId);
    const parentLayer = parentResult?.parent;

    if (!parentLayer) {
      console.warn('Pagination at root level not yet supported - collection layer should be inside a container');
      return;
    }

    const paginationWrapperId = `${collectionLayerId}-pagination-wrapper`;
    const paginationWrapper = mode === 'pages'
      ? createPagesWrapper(collectionLayerId)
      : createLoadMoreWrapper(collectionLayerId);

    // Get parent's CURRENT children from fresh lookup
    const freshParentResult = findLayerWithParent(currentLayers, parentLayer.id);
    const freshParent = freshParentResult?.layer || parentLayer;
    const parentChildren = freshParent.children || [];

    const collectionIndex = parentChildren.findIndex(c => c.id === collectionLayerId);
    const existingPaginationIndex = parentChildren.findIndex(c => c.id === paginationWrapperId);

    let newChildren: Layer[];
    if (existingPaginationIndex === -1) {
      // Add new wrapper after collection
      newChildren = [
        ...parentChildren.slice(0, collectionIndex + 1),
        paginationWrapper,
        ...parentChildren.slice(collectionIndex + 1),
      ];
    } else {
      // Replace existing wrapper
      newChildren = parentChildren.map(c => c.id === paginationWrapperId ? paginationWrapper : c);
    }

    handleLayerUpdate(parentLayer.id, { children: newChildren });
  };

  // Helper: Remove pagination wrapper
  const removePaginationWrapper = (collectionLayerId: string) => {
    const currentLayers = getCurrentLayersFromStore();
    const parentResult = findLayerWithParent(currentLayers, collectionLayerId);
    const parentLayer = parentResult?.parent;

    if (!parentLayer) return;

    const paginationWrapperId = `${collectionLayerId}-pagination-wrapper`;
    const freshParentResult = findLayerWithParent(currentLayers, parentLayer.id);
    const freshParent = freshParentResult?.layer || parentLayer;
    const parentChildren = freshParent.children || [];

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

  // Get parent collection layer for the selected layer
  const parentCollectionLayer = useMemo(() => {
    if (!selectedLayerId || !currentPageId) return null;

    // Get layers from either component draft or page draft
    let layers: Layer[] = [];
    if (editingComponentId) {
      layers = componentDrafts[editingComponentId] || [];
    } else {
      const draft = draftsByPageId[currentPageId];
      layers = draft ? draft.layers : [];
    }

    if (!layers.length) return null;

    // Use the utility function from layer-utils
    return findParentCollectionLayer(layers, selectedLayerId);
  }, [selectedLayerId, editingComponentId, componentDrafts, currentPageId, draftsByPageId]);

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

    if (!collectionId && currentPage?.is_dynamic) {
      collectionId = currentPage.settings?.cms?.collection_id || undefined;
    }

    if (!collectionId) return [];
    return fields[collectionId] || [];
  }, [parentCollectionLayer, fields, currentPage]);

  // Build field groups for multi-source inline variable selection
  const fieldGroups = useMemo(() => {
    if (!selectedLayerId) return undefined;
    let layers: Layer[] = [];
    if (editingComponentId) {
      layers = componentDrafts[editingComponentId] || [];
    } else if (currentPageId) {
      const draft = draftsByPageId[currentPageId];
      layers = draft ? draft.layers : [];
    }
    if (!layers.length) return undefined;
    return buildFieldGroupsForLayer(selectedLayerId, layers, currentPage, fields, collections);
  }, [selectedLayerId, editingComponentId, componentDrafts, currentPageId, draftsByPageId, currentPage, fields, collections]);

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
  const dynamicPageReferenceFields = useMemo(() => {
    if (!currentPage?.is_dynamic) return [];
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId) return [];
    const collectionFields = fields[collectionId] || [];
    return collectionFields.filter(
      f => (f.type === 'reference' || f.type === 'multi_reference') && f.reference_collection_id
    );
  }, [currentPage, fields]);

  // Get multi-asset fields from parent context (for multi-asset nested collections)
  const parentMultiAssetFields = useMemo(() => {
    return parentCollectionFields.filter(f => isMultipleAssetField(f));
  }, [parentCollectionFields]);

  // Get multi-asset fields from dynamic page's source collection
  const dynamicPageMultiAssetFields = useMemo(() => {
    if (!currentPage?.is_dynamic) return [];
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId) return [];
    const collectionFields = fields[collectionId] || [];
    return collectionFields.filter(f => isMultipleAssetField(f));
  }, [currentPage, fields]);

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

  if (!selectedLayerId || !selectedLayer) {
    return (
      <div className="w-64 shrink-0 bg-background border-l flex items-center justify-center h-screen">
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
      />
    );
  }

  return (
    <div className="w-64 shrink-0 bg-background border-l flex flex-col p-4 pb-0 h-full overflow-hidden">
      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex flex-col flex-1 min-h-0 gap-0"
      >
        <div className="">
          <TabsList className="w-full">
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="interactions">Interactions</TabsTrigger>
          </TabsList>
        </div>

        <hr className="mt-4" />

        {/* Design tab */}
        <TabsContent value="design" className="flex-1 flex flex-col divide-y overflow-y-auto no-scrollbar data-[state=inactive]:hidden overflow-x-hidden mt-0">

          {/* Layer Styles Panel - only show for default layer style and not in text style mode */}
          {!showTextStyleControls && (
            <LayerStylesPanel
              layer={selectedLayer}
              pageId={currentPageId}
              onLayerUpdate={handleLayerUpdate}
            />
          )}

          {activeTab === 'design' && (
            <UIStateSelector selectedLayer={selectedLayer} />
          )}

          {shouldShowControl('layout', selectedLayer) && !showTextStyleControls && (
            <LayoutControls layer={selectedLayer} onLayerUpdate={handleLayerUpdate} />
          )}

          {shouldShowControl('spacing', selectedLayer) && (
            <SpacingControls
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              activeTextStyleKey={activeTextStyleKey}
            />
          )}

          {shouldShowControl('sizing', selectedLayer) && !showTextStyleControls && (
            <SizingControls layer={selectedLayer} onLayerUpdate={handleLayerUpdate} />
          )}

          {shouldShowControl('typography', selectedLayer) && (
            <TypographyControls
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              activeTextStyleKey={activeTextStyleKey}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('backgrounds', selectedLayer) && (
            <BackgroundsControls
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              activeTextStyleKey={activeTextStyleKey}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('borders', selectedLayer) && (
            <BorderControls
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              activeTextStyleKey={activeTextStyleKey}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
            />
          )}

          {shouldShowControl('effects', selectedLayer) && (
            <EffectControls
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
              activeTextStyleKey={activeTextStyleKey}
            />
          )}

          {shouldShowControl('position', selectedLayer) && !showTextStyleControls && (
            <PositionControls layer={selectedLayer} onLayerUpdate={handleLayerUpdate} />
          )}

          {/* Classes panel - shows classes for active text style or layer */}
          <SettingsPanel
            title="Classes"
            isOpen={classesOpen}
            onToggle={() => setClassesOpen(!classesOpen)}
          >
            <div className="flex flex-col gap-3">
              <Input
                value={currentClassInput}
                onChange={(e) => setCurrentClassInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Type class and press Enter..."
                disabled={isLockedByOther}
                className={isLockedByOther ? 'opacity-50 cursor-not-allowed' : ''}
              />

              {layerOnlyClasses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {/* Layer's own classes (excluding style classes) */}
                  {layerOnlyClasses.map((cls, index) => (
                    <Badge
                      variant="secondary"
                      key={`layer-${index}`}
                    >
                      <span>{cls}</span>
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

              {/* Layer style classes (strikethrough if overridden) */}
              {styleClassesArray.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <div className="py-1 w-full flex items-center gap-2">
                    <Separator className="flex-1" />
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold">{appliedStyle?.name}</span> classes
                    </div>
                    <Separator className="flex-1" />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {styleClassesArray.map((cls, index) => {
                      const isOverridden = overriddenStyleClasses.has(cls);
                      return (
                        <Badge
                          variant="secondary"
                          key={`style-${index}`}
                          className="opacity-60"
                        >
                          <span className={isOverridden ? 'line-through' : ''}>
                            {cls}
                          </span>
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto no-scrollbar mt-0 data-[state=inactive]:hidden">
          <div className="flex flex-col divide-y">
            {/* Attributes Panel */}
            <SettingsPanel
              title="Attributes"
              isOpen={attributesOpen}
              onToggle={() => setAttributesOpen(!attributesOpen)}
            >
              <div className="grid grid-cols-3">
                <Label variant="muted">ID</Label>
                <div className="col-span-2 *:w-full">
                  <Input
                    type="text"
                    value={customId}
                    onChange={(e) => handleIdChange(e.target.value)}
                    placeholder="Identifier"
                    disabled={isLockedByOther}
                  />
                </div>
              </div>

              {/* Element visibility toggle - hide for alert layers (they have built-in show/hide logic) */}
              {!isAlertLayer(selectedLayer) && (
                <div className="grid grid-cols-3">
                  <Label variant="muted">Element</Label>
                  <div className="col-span-2 *:w-full">
                    <ToggleGroup
                      options={[
                        { label: 'Shown', value: false },
                        { label: 'Hidden', value: true },
                      ]}
                      value={isHidden}
                      onChange={(value) => handleVisibilityChange(value as boolean)}
                    />
                  </div>
                </div>
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

              {/* Text Tag Selector - Only for text layers (not containers) */}
              {selectedLayer?.name === 'text' && !isContainerLayer(selectedLayer) && (
                <div className="grid grid-cols-3">
                  <Label variant="muted">Tag</Label>
                  <div className="col-span-2 *:w-full">
                    <Select value={textTag} onValueChange={handleTextTagChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select tag">
                          {textTag && (() => {
                            const option = textTagOptions.find(opt => opt.value === textTag);
                            return option ? option.label : textTag;
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {textTagOptions.map((option) => (
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
              )}
            </SettingsPanel>

            {/* Content Panel - show for text-editable layers */}
            {selectedLayer && isTextEditable(selectedLayer) && (() => {
              // Get component variables if editing a component (only text variables for text content)
              const editingComponent = editingComponentId ? getComponentById(editingComponentId) : undefined;
              const allComponentVariables = editingComponent?.variables || [];
              const componentVariables = allComponentVariables.filter(v => v.type !== 'image');
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
                            const newId = await addTextVariable(editingComponentId, 'Text');
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
                        // Don't render RichTextEditor while canvas text editor is active
                        // to prevent race conditions when saving
                        <Empty className="min-h-8 py-2">
                          <EmptyDescription>You are editing the text directly on canvas.</EmptyDescription>
                        </Empty>
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
                        />
                      )}
                    </div>
                  </div>
                </SettingsPanel>
              );
            })()}

            {/* Link Settings - hide for form-related layers, buttons inside forms, and layers inside buttons */}
            {selectedLayer && !['form', 'select', 'input', 'textarea', 'checkbox', 'radio', 'label'].includes(selectedLayer.name) && selectedLayer.settings?.tag !== 'label' && !shouldHideLinkSettings && (
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

            {/* Collection Binding Panel - only show for collection layers */}
            {selectedLayer && getCollectionVariable(selectedLayer) && (
              <SettingsPanel
                title="CMS"
                isOpen={collectionBindingOpen}
                onToggle={() => setCollectionBindingOpen(!collectionBindingOpen)}
              >
                <div className="flex flex-col gap-2">
                  {/* Source Selector */}
                  <div className="grid grid-cols-3">
                    <Label variant="muted">Source</Label>
                    <div className="col-span-2 *:w-full">
                      {/* When inside a parent collection, show reference fields and multi-asset fields as source options */}
                      {parentCollectionLayer ? (
                        <Select
                          value={getCollectionVariable(selectedLayer)?.source_field_id || 'none'}
                          onValueChange={handleReferenceFieldChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">
                                <span className="flex items-center gap-2">
                                  <Icon name="none" className="size-3 text-muted-foreground shrink-0" />
                                  No source
                                </span>
                              </SelectItem>
                            </SelectGroup>
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
                          </SelectContent>
                        </Select>
                      ) : currentPage?.is_dynamic ? (
                        /* On dynamic pages, show CMS page data fields + all collections */
                        <Select
                          value={getDynamicPageSourceValue}
                          onValueChange={handleDynamicPageSourceChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">
                                <span className="flex items-center gap-2">
                                  <Icon name="none" className="size-3 text-muted-foreground shrink-0" />
                                  No source
                                </span>
                              </SelectItem>
                            </SelectGroup>
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
                          value={getCollectionVariable(selectedLayer)?.id || 'none'}
                          onValueChange={handleCollectionChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a collection" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">
                                <span className="flex items-center gap-2">
                                  <Icon name="none" className="size-3 text-muted-foreground shrink-0" />
                                  No source
                                </span>
                              </SelectItem>
                            </SelectGroup>
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

                  {/* Sort By - only show if collection is selected */}
                  {getCollectionVariable(selectedLayer)?.id && (
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
                                <SelectValue placeholder="Select sorting" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="none">None</SelectItem>
                                  <SelectItem value="manual">Manual</SelectItem>
                                  <SelectItem value="random">Random</SelectItem>
                                  <SelectItem value={SORT_INPUT_VALUE_OPTION}>Input value</SelectItem>
                                </SelectGroup>
                                <SelectSeparator />
                                <SelectGroup>
                                  <SelectLabel>Fields</SelectLabel>
                                  {selectedCollectionFields.length > 0 &&
                                    selectedCollectionFields.map((field) => (
                                      <SelectItem key={field.id} value={field.id}>
                                        <span className="flex items-center gap-2">
                                          <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                          {field.name}
                                        </span>
                                      </SelectItem>
                                    ))}
                                </SelectGroup>
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

                      {/* Pagination - hidden for nested collections */}
                      {!isNestedInCollection && (
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
                      {!isNestedInCollection && getCollectionVariable(selectedLayer)?.pagination?.enabled && (
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
              onLayerUpdate={handleLayerUpdate}
            />

            <SelectOptionsSettings
              layer={selectedLayer}
              onLayerUpdate={handleLayerUpdate}
            />

            {/* Collection Filters - only for collection layers */}
            {selectedLayer && getCollectionVariable(selectedLayer)?.id && (
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

            {/* Custom Attributes Panel */}
            <SettingsPanel
              title="Custom attributes"
              collapsible
              isOpen={customAttributesOpen}
              onToggle={() => setCustomAttributesOpen(!customAttributesOpen)}
              action={
                <Popover open={showAddAttributePopover} onOpenChange={setShowAddAttributePopover}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
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
              {selectedLayer?.settings?.customAttributes &&
               Object.keys(selectedLayer.settings.customAttributes).length > 0 ? (
                <div className="flex flex-col gap-1">
                  {Object.entries(selectedLayer.settings.customAttributes).map(([name, value]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between pl-3 pr-1 h-8 bg-muted text-muted-foreground rounded-lg"
                    >
                      <span>{name}=&quot;{value as string}&quot;</span>
                      <Button
                        onClick={() => handleRemoveAttribute(name)}
                        variant="ghost"
                        size="xs"
                      >
                        <Icon name="x" />
                      </Button>
                    </div>
                  ))}
                </div>
                ) : (
                <Empty>
                  <EmptyDescription>HTML attributes can be used to append additional information to your elements.</EmptyDescription>
                </Empty>
                )}
            </SettingsPanel>
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
