'use client';

/**
 * Layer Context Menu Component
 *
 * Right-click context menu for layers with clipboard operations
 * Works in both LayersTree sidebar and canvas
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { remapIframePointerEventToParent, useCanvasPortalContainer, useCanvasZoom } from '@/lib/canvas-portal-context';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useClipboardStore } from '@/stores/useClipboardStore';
import { useExternalPasteStore } from '@/stores/useExternalPasteStore';
import { isClipboardReadGranted, readExternalDesignClipboard } from '@/lib/import/clipboard-detect';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { buildAssetUrlMap, collectLayerAssetIds } from '@/lib/asset-utils';
import { canHaveChildren, canPasteIntoParent, LINK_NESTING_ERROR, findLayerById, getClassesString, regenerateInteractionIds, canCopyLayer, canDeleteLayer, regenerateIdsWithInteractionRemapping, removeLayerById, findParentAndIndex, insertLayerAfter, updateLayerProps, canConvertToCollection, isExcludedFromCollection, getCollectionVariable, getTextHeadingConversion, resetBindingsOnCollectionSourceChange } from '@/lib/layer-utils';
import { getStyleIds } from '@/lib/layer-style-resolve';
import { getLayerIcon, getLayerName } from '@/lib/layer-display-utils';
import { sanitizeSlug } from '@/lib/page-utils';
import { cloneDeep } from 'lodash';
import { toast } from 'sonner';
import { Icon } from '@/components/ui/icon';
import { detachSpecificLayerFromComponent, checkCircularReference } from '@/lib/component-utils';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';
import type { Asset, Layer } from '@/types';
import CreateComponentDialog from './CreateComponentDialog';
import SaveLayoutDialog from './SaveLayoutDialog';
import ImportHtmlDialog from './ImportHtmlDialog';
import ExportHtmlDialog from './ExportHtmlDialog';
import { htmlToLayers, layerToExportHtml } from '@/lib/html-layer-converter';

interface LayerContextMenuProps {
  layerId: string;
  pageId: string;
  children: React.ReactNode;
  readOnly?: boolean;
  isLocked?: boolean;
  onLayerSelect?: (layerId: string) => void;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  /** When set, we're editing a component; resolve layer from component draft so "Detach" works for nested instances */
  editingComponentId?: string | null;
}

let pendingCloseRaf = 0;
let activeMenuDocument: Document | null = null;
let iframeDismissDoc: Document | null = null;
let selectionFromMenu = false;

function clearIframeDismissListener() {
  if (iframeDismissDoc) {
    iframeDismissDoc.removeEventListener('pointerdown', dismissActiveContextMenu, true);
    iframeDismissDoc = null;
  }
}

function dismissActiveContextMenu() {
  clearIframeDismissListener();
  if (activeMenuDocument) {
    activeMenuDocument.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    );
    activeMenuDocument = null;
  }
}

// Close any open context menu when a different layer is selected (e.g. via sidebar or canvas click)
useEditorStore.subscribe((state, prevState) => {
  if (state.selectedLayerId !== prevState.selectedLayerId) {
    if (selectionFromMenu) {
      selectionFromMenu = false;
      return;
    }
    dismissActiveContextMenu();
  }
});

interface LayerContextMenuInnerProps extends Omit<LayerContextMenuProps, 'children'> {
  isComponentDialogOpen: boolean;
  setIsComponentDialogOpen: (open: boolean) => void;
  isLayoutDialogOpen: boolean;
  setIsLayoutDialogOpen: (open: boolean) => void;
  isImportHtmlOpen: boolean;
  setIsImportHtmlOpen: (open: boolean) => void;
  isExportHtmlOpen: boolean;
  setIsExportHtmlOpen: (open: boolean) => void;
  exportHtml: string;
  setExportHtml: (html: string) => void;
  layerName: string;
  setLayerName: (name: string) => void;
}

/**
 * Heavy inner half of the layer context menu: all store subscriptions,
 * memoized layer-tree lookups, handlers, and the rendered menu items / dialogs.
 *
 * Mounted only when the menu (or one of its dialogs) is actually open.
 * Keeping it lazy means each layer row in `LayersTree` carries only a thin
 * `<ContextMenu>` shell at rest — critical when a page has 1000+ layers.
 */
function LayerContextMenuInner({
  layerId,
  pageId,
  isLocked = false,
  onLayerSelect,
  liveLayerUpdates,
  liveComponentUpdates,
  editingComponentId: editingComponentIdProp = null,
  isComponentDialogOpen,
  setIsComponentDialogOpen,
  isLayoutDialogOpen,
  setIsLayoutDialogOpen,
  isImportHtmlOpen,
  setIsImportHtmlOpen,
  isExportHtmlOpen,
  setIsExportHtmlOpen,
  exportHtml,
  setExportHtml,
  layerName,
  setLayerName,
}: LayerContextMenuInnerProps) {
  const canvasPortalContainer = useCanvasPortalContainer();
  // Canvas React trees run in the parent JS realm, so `document.body` is the
  // parent document. Portal there so the menu is not clipped by the iframe
  // (component-edit canvases are sized to content).
  const menuPortalContainer = canvasPortalContainer ? document.body : undefined;

  const copyLayer = usePagesStore((state) => state.copyLayer);
  const deleteLayer = usePagesStore((state) => state.deleteLayer);
  const duplicateLayer = usePagesStore((state) => state.duplicateLayer);
  const pasteAfter = usePagesStore((state) => state.pasteAfter);
  const pasteInside = usePagesStore((state) => state.pasteInside);
  const updateLayer = usePagesStore((state) => state.updateLayer);
  const setDraftLayers = usePagesStore((state) => state.setDraftLayers);
  const draftsByPageId = usePagesStore((state) => state.draftsByPageId);
  const createComponentFromLayer = usePagesStore((state) => state.createComponentFromLayer);

  const loadComponents = useComponentsStore((state) => state.loadComponents);
  const getComponentById = useComponentsStore((state) => state.getComponentById);
  const components = useComponentsStore((state) => state.components);
  const componentDrafts = useComponentsStore((state) => state.componentDrafts);
  const editingComponentVariantId = useEditorStore((state) => state.editingComponentVariantId);
  // Prefer the prop (passed by the layers tree) but fall back to the editor
  // store so the canvas context menu also knows when a component is being
  // edited — otherwise "Create component" on the canvas resolves against the
  // page draft and silently fails for layers inside a component.
  const storeEditingComponentId = useEditorStore((state) => state.editingComponentId);
  const editingComponentId = editingComponentIdProp ?? storeEditingComponentId;
  // Resolve the active variant id for the component being edited. When
  // unspecified (or pointing at a missing variant) we fall back to the first
  // variant so the editor never shows an empty tree.
  const activeVariantId = useMemo(() => {
    if (!editingComponentId) return null;
    const drafts = componentDrafts[editingComponentId];
    if (!drafts) return editingComponentVariantId || null;
    if (editingComponentVariantId && drafts[editingComponentVariantId]) return editingComponentVariantId;
    return Object.keys(drafts)[0] || null;
  }, [editingComponentId, editingComponentVariantId, componentDrafts]);
  const updateComponentDraft = useComponentsStore((state) => state.updateComponentDraft);
  const createComponentFromComponentLayer = useComponentsStore((state) => state.createComponentFromLayer);

  const clipboardLayer = useClipboardStore((state) => state.clipboardLayer);
  const clipboardMode = useClipboardStore((state) => state.clipboardMode);
  const copyToClipboard = useClipboardStore((state) => state.copyLayer);
  const cutToClipboard = useClipboardStore((state) => state.cutLayer);
  const copyStyleToClipboard = useClipboardStore((state) => state.copyStyle);
  const pasteStyleFromClipboard = useClipboardStore((state) => state.pasteStyle);
  const copiedStyle = useClipboardStore((state) => state.copiedStyle);
  const copyInteractionsToClipboard = useClipboardStore((state) => state.copyInteractions);
  const pasteInteractionsFromClipboard = useClipboardStore((state) => state.pasteInteractions);
  const copiedInteractions = useClipboardStore((state) => state.copiedInteractions);

  // Design-tool clipboard (Webflow/Figma) detected when the menu opened, plus
  // the registered runner that imports it at a chosen placement.
  const externalKind = useExternalPasteStore((state) => state.kind);
  const pasteExternalAt = useExternalPasteStore((state) => state.pasteAt);

  const hasClipboard = clipboardLayer !== null;
  const hasExternal = externalKind !== null && pasteExternalAt !== null;
  const hasStyleClipboard = copiedStyle !== null;
  const hasInteractionsClipboard = copiedInteractions !== null;

  // Resolve layers: active variant draft when editing a component, else page draft
  const isComponentContext = !!editingComponentId;
  const layers = useMemo(
    () =>
      isComponentContext && editingComponentId && activeVariantId
        ? (componentDrafts[editingComponentId]?.[activeVariantId] || [])
        : (draftsByPageId[pageId]?.layers || []),
    [isComponentContext, editingComponentId, activeVariantId, componentDrafts, draftsByPageId, pageId]
  );
  const layer = findLayerById(layers, layerId);

  const isComponentInstance = !!(layer && layer.componentId);
  const componentName = isComponentInstance && layer?.componentId
    ? getComponentById(layer.componentId)?.name
    : null;

  // Check if the current layer can have children and link nesting is valid
  const canPasteInside = useMemo(() => {
    const targetLayer = findLayerById(layers, layerId);
    if (!targetLayer) return false;
    if (!canHaveChildren(targetLayer)) return false;
    if (clipboardLayer && !canPasteIntoParent(layers, layerId, clipboardLayer)) return false;
    return true;
  }, [layers, layerId, clipboardLayer]);

  // Check if paste-after would violate link nesting (parent of target has a link)
  const canPasteAfterTarget = useMemo(() => {
    if (!clipboardLayer) return true;
    const result = findParentAndIndex(layers, layerId);
    if (!result || !result.parent) return true;
    return canPasteIntoParent(layers, result.parent.id, clipboardLayer);
  }, [layers, layerId, clipboardLayer]);

  const isBody = layerId === 'body';

  // Check layer restrictions
  const canCopy = useMemo(() => {
    if (!layer) return false;
    return canCopyLayer(layer);
  }, [layer]);

  const canDelete = useMemo(() => {
    if (!layer) return false;
    return canDeleteLayer(layer);
  }, [layer]);

  /** Update active variant draft layers and broadcast to collaborators */
  const updateComponentAndBroadcast = (newLayers: Layer[]) => {
    if (!editingComponentId || !activeVariantId) return;
    updateComponentDraft(editingComponentId, activeVariantId, newLayers);
    if (liveComponentUpdates) {
      liveComponentUpdates.broadcastComponentLayersUpdate(editingComponentId, newLayers);
    }
  };

  /** Get current variant layers for the editing context */
  const getComponentLayers = () =>
    editingComponentId && activeVariantId
      ? (componentDrafts[editingComponentId]?.[activeVariantId] || [])
      : [];

  const handleCopy = () => {
    if (!canCopy) return;

    // In component context, copy from component drafts
    if (isComponentContext && editingComponentId) {
      const layerToCopy = findLayerById(getComponentLayers(), layerId);
      if (layerToCopy) {
        copyToClipboard(cloneDeep(layerToCopy), pageId);
      }
    } else {
      const layer = copyLayer(pageId, layerId);
      if (layer) {
        copyToClipboard(layer, pageId);
      }
    }
  };

  const handleCut = () => {
    if (isLocked || !canCopy || !canDelete) return;

    // In component context, cut from component drafts
    if (isComponentContext && editingComponentId) {
      const layerToCopy = findLayerById(getComponentLayers(), layerId);
      if (layerToCopy) {
        cutToClipboard(cloneDeep(layerToCopy), pageId);
        updateComponentAndBroadcast(removeLayerById(getComponentLayers(), layerId));

        if (onLayerSelect) {
          onLayerSelect(null as any);
        }
      }
    } else {
      const layer = copyLayer(pageId, layerId);
      if (layer) {
        cutToClipboard(layer, pageId);
        deleteLayer(pageId, layerId);

        // Broadcast delete to other collaborators
        if (liveLayerUpdates) {
          liveLayerUpdates.broadcastLayerDelete(pageId, layerId);
        }

        // Clear selection after cut to match keyboard shortcut behavior
        if (onLayerSelect) {
          onLayerSelect(null as any);
        }
      }
    }
  };

  const handlePasteAfter = () => {
    // A Webflow/Figma copy on the OS clipboard means the freshest copy was
    // external (an internal copy stamps the OS clipboard with the Ycode marker,
    // which detection ignores), so it wins over a stale internal clipboard —
    // matching the keyboard ⌘V behaviour. Import it as a sibling after target.
    if (hasExternal) {
      if (!isBody) pasteExternalAt?.({ mode: 'after', layerId });
      return;
    }
    if (!clipboardLayer) return;

    if (isComponentContext && editingComponentId) {
      const circularError = checkCircularReference(editingComponentId, clipboardLayer, components);
      if (circularError) {
        toast.error('Infinite component loop detected', { description: circularError });
        return;
      }

      const componentLayers = getComponentLayers();
      const result = findParentAndIndex(componentLayers, layerId);
      if (!result) return;

      if (result.parent && !canPasteIntoParent(componentLayers, result.parent.id, clipboardLayer)) {
        toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
        return;
      }

      const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(clipboardLayer));
      updateComponentAndBroadcast(insertLayerAfter(componentLayers, result.parent, result.index, newLayer));
    } else {
      const pastedLayer = pasteAfter(pageId, layerId, clipboardLayer);
      if (liveLayerUpdates && pastedLayer) {
        liveLayerUpdates.broadcastLayerAdd(pageId, null, 'paste', pastedLayer);
      } else if (!pastedLayer) {
        toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
      }
    }
  };

  const handlePasteInside = () => {
    // External clipboard wins over a stale internal one (see handlePasteAfter).
    if (hasExternal) {
      if (canPasteInside) pasteExternalAt?.({ mode: 'inside', layerId });
      return;
    }
    if (!clipboardLayer || !canPasteInside) return;

    if (isComponentContext && editingComponentId) {
      const circularError = checkCircularReference(editingComponentId, clipboardLayer, components);
      if (circularError) {
        toast.error('Infinite component loop detected', { description: circularError });
        return;
      }

      const componentLayers = getComponentLayers();
      if (!canPasteIntoParent(componentLayers, layerId, clipboardLayer)) {
        toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
        return;
      }

      const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(clipboardLayer));
      updateComponentAndBroadcast(
        updateLayerProps(componentLayers, layerId, { children: [...(findLayerById(componentLayers, layerId)?.children || []), newLayer] })
      );
    } else {
      const pastedLayer = pasteInside(pageId, layerId, clipboardLayer);
      if (liveLayerUpdates && pastedLayer) {
        liveLayerUpdates.broadcastLayerAdd(pageId, layerId, 'paste', pastedLayer);
      } else if (!pastedLayer) {
        toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
      }
    }
  };

  const handleDuplicate = () => {
    if (!canCopy) return;

    if (isComponentContext && editingComponentId) {
      const componentLayers = getComponentLayers();
      const layerToCopy = findLayerById(componentLayers, layerId);
      if (!layerToCopy) return;

      const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(layerToCopy));
      const result = findParentAndIndex(componentLayers, layerId);
      if (!result) return;

      updateComponentAndBroadcast(insertLayerAfter(componentLayers, result.parent, result.index, newLayer));
    } else {
      const duplicatedLayer = duplicateLayer(pageId, layerId);
      // Broadcast the duplicated layer
      if (liveLayerUpdates && duplicatedLayer) {
        liveLayerUpdates.broadcastLayerAdd(pageId, null, 'duplicate', duplicatedLayer);
      }
    }
  };

  const handleDelete = () => {
    if (isLocked || !canDelete) return;

    if (isComponentContext && editingComponentId) {
      updateComponentAndBroadcast(removeLayerById(getComponentLayers(), layerId));

      if (onLayerSelect) {
        onLayerSelect(null as any);
      }
    } else {
      deleteLayer(pageId, layerId);

      // Broadcast delete to other collaborators
      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerDelete(pageId, layerId);
      }

      // Clear selection after delete to match keyboard shortcut behavior
      if (onLayerSelect) {
        onLayerSelect(null as any);
      }
    }
  };

  const handleRename = () => {
    if (!layer) return;
    useEditorStore.getState().setRenamingLayerId(layerId);
  };

  const handleCopyStyle = () => {
    if (!layer) return;

    const classes = getClassesString(layer);
    const ids = getStyleIds(layer);
    copyStyleToClipboard(classes, layer.design, ids[0], layer.styleOverrides, ids);
  };

  const handlePasteStyle = () => {
    const style = pasteStyleFromClipboard();
    if (!style) return;

    const styleProps = {
      classes: style.classes,
      design: style.design,
      styleId: style.styleIds?.[0] ?? style.styleId,
      styleIds: style.styleIds ?? (style.styleId ? [style.styleId] : undefined),
      styleOverrides: style.styleOverrides,
      styleOverridesByStyle: undefined,
    };

    if (isComponentContext && editingComponentId) {
      updateComponentAndBroadcast(updateLayerProps(getComponentLayers(), layerId, styleProps));
    } else {
      updateLayer(pageId, layerId, styleProps);
    }
  };

  const handleCopyInteractions = () => {
    if (!layer || !layer.interactions || layer.interactions.length === 0) return;

    copyInteractionsToClipboard(layer.interactions, layerId);
  };

  const handlePasteInteractions = () => {
    const copiedData = pasteInteractionsFromClipboard();
    if (!copiedData) return;

    const { interactions, sourceLayerId } = copiedData;

    const layerIdMap = new Map<string, string>();
    layerIdMap.set(sourceLayerId, layerId);
    const updatedInteractions = regenerateInteractionIds(interactions, layerIdMap);

    if (isComponentContext && editingComponentId) {
      updateComponentAndBroadcast(updateLayerProps(getComponentLayers(), layerId, { interactions: updatedInteractions }));
    } else {
      updateLayer(pageId, layerId, { interactions: updatedInteractions });
    }
  };

  const handleCreateComponent = () => {
    // Use the already-resolved layer (works in both page and component context)
    if (!layer) return;

    const defaultName = layer.customName || layer.name || 'Component';
    setLayerName(defaultName);
    setIsComponentDialogOpen(true);
  };

  const handleConfirmCreateComponent = async (componentName: string) => {
    // Use appropriate creation function based on context
    const componentId = isComponentContext && editingComponentId
      ? await createComponentFromComponentLayer(editingComponentId, layerId, componentName)
      : await createComponentFromLayer(pageId, layerId, componentName);

    if (!componentId) return;

    // Broadcast to collaborators
    if (liveComponentUpdates) {
      const component = getComponentById(componentId);
      if (component) {
        liveComponentUpdates.broadcastComponentCreate(component);
      }
    }
  };

  const handleEditMasterComponent = async () => {
    if (!layer?.componentId) return;

    const { setEditingComponentId, setSelectedLayerId, setEditingComponentVariantId, editingComponentVariantId, pushComponentNavigation, editingComponentId } = useEditorStore.getState();
    const { loadComponentDraft, getComponentById, getComponentDraftLayers } = useComponentsStore.getState();
    const { pages } = usePagesStore.getState();

    const component = getComponentById(layer.componentId);
    if (!component) return;

    // Resolve which variant to open — use the instance's configured variant
    const requestedVariantId = layer.componentVariantId;
    const targetVariantId = (requestedVariantId && component.variants?.some(v => v.id === requestedVariantId))
      ? requestedVariantId
      : (component.variants && component.variants.length > 0 ? component.variants[0].id : null);

    // Capture the current layer ID BEFORE clearing selection
    const componentInstanceLayerId = layer.id;

    // Push current context to navigation stack before entering component edit mode
    if (editingComponentId) {
      const currentComponent = getComponentById(editingComponentId);
      if (currentComponent) {
        pushComponentNavigation({
          type: 'component',
          id: editingComponentId,
          name: currentComponent.name,
          layerId: layer.id,
          variantId: editingComponentVariantId ?? null,
        });
      }
    } else if (pageId) {
      const currentPage = pages.find((p) => p.id === pageId);
      if (currentPage) {
        pushComponentNavigation({
          type: 'page',
          id: pageId,
          name: currentPage.name,
          layerId: componentInstanceLayerId,
        });
      }
    }

    // Clear selection FIRST to release lock on current page's channel
    setSelectedLayerId(null);

    // Enter edit mode and set the target variant
    setEditingComponentId(layer.componentId, pageId, componentInstanceLayerId);
    setEditingComponentVariantId(targetVariantId);

    // Load component into draft (async to ensure proper cache sync)
    await loadComponentDraft(layer.componentId);

    // Select root layer of the target variant's tree
    const variantLayers = getComponentDraftLayers(layer.componentId, targetVariantId);
    if (variantLayers && variantLayers.length > 0) {
      const currentSelection = useEditorStore.getState().selectedLayerId;
      const hasValidSelection = currentSelection && findLayerById(variantLayers, currentSelection);
      if (!hasValidSelection) {
        setSelectedLayerId(variantLayers[0].id);
      }
    }
  };

  const handleDetachFromComponent = () => {
    if (!layer || !layer.componentId) return;

    const component = getComponentById(layer.componentId);

    // Use the shared utility function for detaching
    const newLayers = detachSpecificLayerFromComponent(layers, layerId, component || undefined);

    if (isComponentContext && editingComponentId && activeVariantId) {
      updateComponentDraft(editingComponentId, activeVariantId, newLayers);
    } else {
      setDraftLayers(pageId, newLayers);
    }

    if (onLayerSelect) {
      onLayerSelect(null as any);
    }
  };

  const handleShowJSON = () => {
    if (!layer) return;
    console.log('Layer:', layer);
  };

  const handleSaveAsLayout = () => {
    if (!layer) return;

    // Set default name from layer
    const defaultName = layer.customName || layer.name || 'Custom Layout';
    setLayerName(defaultName);

    // Open dialog
    setIsLayoutDialogOpen(true);
  };

  const handleConfirmSaveLayout = async (layoutName: string, category: string, imageFile: File | null) => {
    if (!layer) return;

    try {
      // Collect all layer IDs that are referenced by animations (tween.layer_id)
      // These IDs must be preserved so animations work when layout is loaded
      const collectReferencedLayerIds = (l: Layer): Set<string> => {
        const ids = new Set<string>();

        // Check interactions on this layer
        if (l.interactions) {
          l.interactions.forEach(interaction => {
            interaction.tweens?.forEach(tween => {
              if (tween.layer_id) {
                ids.add(tween.layer_id);
              }
            });
          });
        }

        // Recursively check children
        if (l.children) {
          l.children.forEach(child => {
            collectReferencedLayerIds(child).forEach(id => ids.add(id));
          });
        }

        return ids;
      };

      const referencedLayerIds = collectReferencedLayerIds(layer);

      // Strip IDs to convert Layer to LayerTemplate
      // But preserve IDs that are referenced by animations
      const stripIds = (l: Layer): any => {
        const { id, ...rest } = l;
        const result: any = { ...rest };

        // Preserve ID if it's referenced by an animation
        if (referencedLayerIds.has(id)) {
          result.id = id;
        }

        if (result.children && Array.isArray(result.children)) {
          result.children = result.children.map((child: Layer) => stripIds(child));
        }

        return result;
      };

      const template = stripIds(layer);

      // Generate layout key from name
      const layoutKey = sanitizeSlug(layoutName);

      // Use FormData to send file + data
      const formData = new FormData();
      formData.append('layoutKey', layoutKey);
      formData.append('layoutName', layoutName);
      formData.append('category', category);
      formData.append('template', JSON.stringify(template));
      formData.append('pageId', pageId);
      formData.append('layerId', layerId);

      if (imageFile) {
        formData.append('image', imageFile);
      }

      // Call API to save layout
      const response = await fetch('/ycode/api/layouts', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save layout');
      }
    } catch (error) {
      console.error('Failed to save layout:', error);
      throw error;
    }
  };

  const handleImportHtml = (html: string) => {
    let importedLayers: Layer[];
    try {
      importedLayers = htmlToLayers(html);
    } catch {
      toast.error('Failed to parse HTML');
      return;
    }

    if (importedLayers.length === 0) {
      toast.error('No valid HTML elements found');
      return;
    }

    if (isComponentContext && editingComponentId) {
      const componentLayers = getComponentLayers();
      const targetLayer = findLayerById(componentLayers, layerId);
      if (!targetLayer) return;

      const newChildren = [...(targetLayer.children || []), ...importedLayers];
      updateComponentAndBroadcast(
        updateLayerProps(componentLayers, layerId, { children: newChildren })
      );
    } else {
      const draft = draftsByPageId[pageId];
      if (!draft) return;

      const targetLayer = findLayerById(draft.layers, layerId);
      if (!targetLayer) return;

      const newChildren = [...(targetLayer.children || []), ...importedLayers];
      updateLayer(pageId, layerId, { children: newChildren });

      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerUpdate(layerId, { children: newChildren });
      }
    }

    toast.success('HTML imported successfully');
  };

  const handleExportHtml = () => {
    if (!layer) return;
    const { getAsset } = useAssetsStore.getState();
    const assets = [...collectLayerAssetIds([layer], [])]
      .map((id) => getAsset(id))
      .filter((asset): asset is Asset => asset !== null);
    const html = layerToExportHtml(layer, buildAssetUrlMap(assets));
    setExportHtml(html);
    setIsExportHtmlOpen(true);
  };

  const handleConvertToCollection = () => {
    if (!layer || !canConvertToCollection(layer)) return;

    const updatedVariables = {
      ...layer.variables,
      collection: { id: '' },
    };

    if (isComponentContext && editingComponentId) {
      updateComponentAndBroadcast(
        updateLayerProps(getComponentLayers(), layerId, { variables: updatedVariables })
      );
    } else {
      updateLayer(pageId, layerId, { variables: updatedVariables });
      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerUpdate(layerId, { variables: updatedVariables });
      }
    }
  };

  const handleDetachCollection = () => {
    if (!layer || !getCollectionVariable(layer)) return;

    const { collection, ...restVariables } = layer.variables || {};
    const updatedVariables = { ...restVariables, collection: undefined };

    if (isComponentContext && editingComponentId) {
      const componentLayers = getComponentLayers();
      let newLayers = updateLayerProps(componentLayers, layerId, { variables: updatedVariables });
      newLayers = resetBindingsOnCollectionSourceChange(newLayers, layerId);
      updateComponentAndBroadcast(newLayers);
    } else {
      updateLayer(pageId, layerId, { variables: updatedVariables });

      setTimeout(() => {
        const currentLayers = usePagesStore.getState().draftsByPageId[pageId]?.layers;
        if (!currentLayers) return;

        const cleanedLayers = resetBindingsOnCollectionSourceChange(currentLayers, layerId);
        if (cleanedLayers !== currentLayers) {
          setDraftLayers(pageId, cleanedLayers);
        }
      }, 0);

      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerUpdate(layerId, { variables: updatedVariables });
      }
    }
  };

  const handleConvertTextHeading = () => {
    if (!layer) return;

    const conversion = getTextHeadingConversion(layer);
    if (!conversion) return;

    if (isComponentContext && editingComponentId) {
      updateComponentAndBroadcast(updateLayerProps(getComponentLayers(), layerId, conversion));
    } else {
      updateLayer(pageId, layerId, conversion);
      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerUpdate(layerId, conversion);
      }
    }
  };

  const textHeadingConversion = layer ? getTextHeadingConversion(layer) : null;
  const showConvertTextHeading = !!textHeadingConversion && !isComponentInstance;

  const isCollection = !!(layer && getCollectionVariable(layer));
  const canConvert = !!(layer && canConvertToCollection(layer));
  const showConvertOption = !!(layer && !isCollection && canHaveChildren(layer) && !layer.componentId);
  const isConvertDisabled = isLocked || isComponentInstance || !!(layer && isExcludedFromCollection(layer));

  // Check if we're on localhost
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  return (
    <>
      <ContextMenuContent
        className="w-46"
        container={menuPortalContainer}
      >
        {canvasPortalContainer && layer && (
          <>
            <ContextMenuLabel className="flex items-center gap-1.5 font-normal text-muted-foreground select-none">
              <Icon
                name={getLayerIcon(layer)}
                className="size-3"
              />
              <span className="truncate">{getLayerName(layer)}</span>
            </ContextMenuLabel>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem onClick={handleCut} disabled={isLocked || !canCopy || !canDelete}>
          Cut
          <ContextMenuShortcut>⌘X</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleCopy} disabled={!canCopy}>
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Paste</ContextMenuSubTrigger>
          <ContextMenuSubContent
            container={menuPortalContainer}
          >
            {hasExternal && (externalKind === 'figma' || externalKind === 'webflow') && (
              <>
                <ContextMenuLabel className="flex items-center gap-1.5 font-normal text-muted-foreground select-none">
                  <Icon name={externalKind === 'figma' ? 'figma' : 'webflow'} className="size-3" />
                  <span>From {externalKind === 'figma' ? 'Figma' : 'Webflow'}</span>
                </ContextMenuLabel>
                <ContextMenuSeparator />
              </>
            )}

            <ContextMenuItem onClick={handlePasteAfter} disabled={(!hasClipboard && !hasExternal) || isBody || !canPasteAfterTarget}>
              Paste after
              <ContextMenuShortcut>⌘V</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={handlePasteInside} disabled={(!hasClipboard && !hasExternal) || !canPasteInside}>
              Paste inside
              <ContextMenuShortcut>⌘⇧V</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={handleDuplicate} disabled={!canCopy}>
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleDelete}
          disabled={isLocked || !canDelete}
        >
          Delete
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>

        {!canvasPortalContainer && (
          <>
            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleRename} disabled={isBody}>
              Rename
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}

        {!isComponentInstance && (
          <>
            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleCopyStyle}>
              Copy style
              <ContextMenuShortcut>⌥⌘C</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={handlePasteStyle} disabled={!hasStyleClipboard}>
              Paste style
              <ContextMenuShortcut>⌥⌘V</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleCopyInteractions} disabled={!layer?.interactions || layer.interactions.length === 0}>
              Copy interactions
              <ContextMenuShortcut><Icon name="zap" className="size-3" /></ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={handlePasteInteractions} disabled={!hasInteractionsClipboard}>
              Paste interactions
              <ContextMenuShortcut><Icon name="zap" className="size-3" /></ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => setIsImportHtmlOpen(true)} disabled={!canPasteInside}>
          Import HTML
          <ContextMenuShortcut><Icon name="code" className="size-3" /></ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleExportHtml}>
          Export as HTML
          <ContextMenuShortcut><Icon name="code" className="size-3" /></ContextMenuShortcut>
        </ContextMenuItem>

        {showConvertTextHeading && textHeadingConversion && (
          <>
            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleConvertTextHeading} disabled={isLocked}>
              {textHeadingConversion.name === 'heading' ? 'Convert to heading' : 'Convert to text'}
              <ContextMenuShortcut>
                <Icon
                  name={textHeadingConversion.name === 'heading' ? 'heading' : 'text'}
                  className="size-3"
                />
              </ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}

        {(showConvertOption || isCollection) && (
          <>
            <ContextMenuSeparator />

            {showConvertOption && (
              <ContextMenuItem onClick={handleConvertToCollection} disabled={isConvertDisabled}>
                Convert to collection
                <ContextMenuShortcut><Icon name="database" className="size-3" /></ContextMenuShortcut>
              </ContextMenuItem>
            )}

            {isCollection && (
              <ContextMenuItem onClick={handleDetachCollection} disabled={isLocked || isComponentInstance}>
                Detach collection
                <ContextMenuShortcut><Icon name="database" className="size-3" /></ContextMenuShortcut>
              </ContextMenuItem>
            )}
          </>
        )}

        <ContextMenuSeparator />

        {isComponentInstance ? (
          <>
            <ContextMenuItem onClick={handleEditMasterComponent}>
              Edit master component
              <ContextMenuShortcut><Icon name="edit" className="size-3" /></ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={handleDetachFromComponent}>
              Detach component
              <ContextMenuShortcut><Icon name="detach" className="size-3" /></ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onClick={handleCreateComponent} disabled={isLocked}>
            Create component
            <ContextMenuShortcut><Icon name="component" className="size-3" /></ContextMenuShortcut>
          </ContextMenuItem>
        )}

        {/* Developer tools: dev build or when NEXT_PUBLIC_DEVELOPER_MODE=true */}
        {(process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEVELOPER_MODE === 'true') && (
          <>
            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleShowJSON}>
              Show JSON
              <ContextMenuShortcut><Icon name="code" className="size-3" /></ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuItem onClick={handleSaveAsLayout}>
              Save as Layout
              <ContextMenuShortcut><Icon name="layout" className="size-3" /></ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>

      <CreateComponentDialog
        open={isComponentDialogOpen}
        onOpenChange={setIsComponentDialogOpen}
        onConfirm={handleConfirmCreateComponent}
        layerName={layerName}
      />

      <SaveLayoutDialog
        open={isLayoutDialogOpen}
        onOpenChange={setIsLayoutDialogOpen}
        onConfirm={handleConfirmSaveLayout}
        defaultName={layerName}
      />

      <ImportHtmlDialog
        open={isImportHtmlOpen}
        onOpenChange={setIsImportHtmlOpen}
        onImport={handleImportHtml}
      />

      <ExportHtmlDialog
        open={isExportHtmlOpen}
        onOpenChange={setIsExportHtmlOpen}
        html={exportHtml}
      />
    </>
  );
}

/**
 * Thin always-mounted shell rendered per layer row. Only when the menu opens
 * (or a triggered dialog is active) does it mount {@link LayerContextMenuInner},
 * which carries all Zustand subscriptions and Radix providers.
 *
 * Wrapped in `React.memo` because the layer tree re-renders frequently and
 * the shell only depends on layerId / pageId / lock state / context flags.
 */
function LayerContextMenu({
  layerId,
  pageId,
  children,
  readOnly = false,
  isLocked = false,
  onLayerSelect,
  liveLayerUpdates,
  liveComponentUpdates,
  editingComponentId = null,
}: LayerContextMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isComponentDialogOpen, setIsComponentDialogOpen] = useState(false);
  const [isLayoutDialogOpen, setIsLayoutDialogOpen] = useState(false);
  const [isImportHtmlOpen, setIsImportHtmlOpen] = useState(false);
  const [isExportHtmlOpen, setIsExportHtmlOpen] = useState(false);
  const [exportHtml, setExportHtml] = useState('');
  const [layerName, setLayerName] = useState('');
  const canvasPortalContainer = useCanvasPortalContainer();
  const canvasZoom = useCanvasZoom();

  const anyDialogOpen =
    isComponentDialogOpen || isLayoutDialogOpen || isImportHtmlOpen || isExportHtmlOpen;
  const needsInner = menuOpen || anyDialogOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);

      if (open) {
        dismissActiveContextMenu();
        // Canvas menus portal to the parent document so they sit above the
        // iframe. Dismiss must target that document; iframe clicks are wired
        // separately because they don't bubble across the frame boundary.
        activeMenuDocument = document;
        if (canvasPortalContainer) {
          iframeDismissDoc = canvasPortalContainer.ownerDocument;
          iframeDismissDoc.addEventListener('pointerdown', dismissActiveContextMenu, true);
        }

        // Detect a Webflow/Figma copy on the OS clipboard so the Paste submenu
        // can offer "Paste after / inside". Best-effort and silent: only read
        // when clipboard access is already granted, so a right-click never
        // triggers a permission prompt. When access isn't granted the items
        // stay disabled — the keyboard ⌘V import path is unaffected.
        useExternalPasteStore.getState().setKind(null);
        void isClipboardReadGranted()
          .then((granted) => (granted ? readExternalDesignClipboard() : null))
          .then((data) => useExternalPasteStore.getState().setKind(data?.kind ?? null))
          .catch(() => useExternalPasteStore.getState().setKind(null));
      }

      if (open && onLayerSelect) {
        // Read selectedLayerId from the store on demand rather than via prop.
        // This keeps the shell's prop surface stable across selection changes,
        // letting React.memo skip re-renders for the 700+ wrapped layers in
        // the canvas whenever a different layer is clicked.
        const currentSelection = useEditorStore.getState().selectedLayerId;
        if (currentSelection !== layerId) {
          selectionFromMenu = true;
          onLayerSelect(layerId);
        }
      }

      // Hide the parent-document selection overlay while the canvas context menu is open,
      // and suppress stale clicks that fire on the canvas when the menu dismisses
      if (canvasPortalContainer) {
        if (open) {
          cancelAnimationFrame(pendingCloseRaf);
          useEditorStore.getState().setCanvasContextMenuOpen(true);
        } else {
          clearIframeDismissListener();
          pendingCloseRaf = requestAnimationFrame(() => {
            useEditorStore.getState().setCanvasContextMenuOpen(false);
          });
        }
      }
    },
    [canvasPortalContainer, onLayerSelect, layerId]
  );

  if (readOnly) return <>{children}</>;

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        asChild
        onContextMenu={(e) => {
          e.stopPropagation();
          if (canvasPortalContainer) {
            remapIframePointerEventToParent(e, canvasPortalContainer, canvasZoom);
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      {needsInner && (
        <LayerContextMenuInner
          layerId={layerId}
          pageId={pageId}
          isLocked={isLocked}
          onLayerSelect={onLayerSelect}
          liveLayerUpdates={liveLayerUpdates}
          liveComponentUpdates={liveComponentUpdates}
          editingComponentId={editingComponentId}
          isComponentDialogOpen={isComponentDialogOpen}
          setIsComponentDialogOpen={setIsComponentDialogOpen}
          isLayoutDialogOpen={isLayoutDialogOpen}
          setIsLayoutDialogOpen={setIsLayoutDialogOpen}
          isImportHtmlOpen={isImportHtmlOpen}
          setIsImportHtmlOpen={setIsImportHtmlOpen}
          isExportHtmlOpen={isExportHtmlOpen}
          setIsExportHtmlOpen={setIsExportHtmlOpen}
          exportHtml={exportHtml}
          setExportHtml={setExportHtml}
          layerName={layerName}
          setLayerName={setLayerName}
        />
      )}
    </ContextMenu>
  );
}

export default React.memo(LayerContextMenu);
