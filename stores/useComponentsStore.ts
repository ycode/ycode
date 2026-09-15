/**
 * Components Store
 *
 * Global state management for components
 * Components are reusable layer trees stored globally
 */

import { create } from 'zustand';
import {
  replaceLayerWithComponentInstance,
  findLayerById,
  cleanLayersForComponentCreation,
  regenerateIdsWithInteractionRemapping,
} from '@/lib/layer-utils';
import { createComponentViaApi } from '@/lib/component-api';
import { detachStyleFromLayers, updateLayersWithStyle } from '@/lib/layer-style-utils';
import { scheduleIdle } from '@/lib/schedule-idle';
import { generateId } from '@/lib/utils';
import type { Component, ComponentVariable, ComponentVariant, Layer, LayerStyle } from '@/types';

/**
 * Per-component, per-variant working copy of layers used while editing a
 * component. Outer key = componentId, inner key = variantId.
 */
type ComponentDraftMap = Record<string, Record<string, Layer[]>>;

/**
 * Build a fresh `variants` array from the latest draft layers, falling back to
 * each variant's persisted layers when no draft exists for it (e.g. the user
 * never switched to that variant during this edit session).
 */
function buildVariantsFromDrafts(
  component: Component,
  drafts: Record<string, Layer[]> | undefined,
): ComponentVariant[] {
  const variants = component.variants && component.variants.length > 0
    ? component.variants
    : [{ id: generateId('cmpvar'), name: 'Default', layers: component.layers ?? [] }];
  return variants.map(v => ({ ...v, layers: drafts?.[v.id] ?? v.layers }));
}

/** Pick the first variant id of a component, used as the safe default. */
function getPrimaryVariantId(component: Component | undefined): string | null {
  if (!component) return null;
  const variants = component.variants;
  if (variants && variants.length > 0) return variants[0].id;
  return null;
}

/** Remove variableLinks entries that point TO a given variable ID (as parent target). */
function removeVariableLinksPointingTo(layer: Layer, targetVariableId: string): Layer {
  const links = layer.componentOverrides?.variableLinks;
  if (!links) return layer;

  const filtered = { ...links };
  let changed = false;
  for (const [childId, parentId] of Object.entries(filtered)) {
    if (parentId === targetVariableId) {
      delete filtered[childId];
      changed = true;
    }
  }
  if (!changed) return layer;

  return {
    ...layer,
    componentOverrides: {
      ...layer.componentOverrides,
      variableLinks: Object.keys(filtered).length > 0 ? filtered : undefined,
    },
  };
}

/**
 * Fire-and-forget thumbnail generation for a component.
 * Dynamically imports the capture module to avoid bundling it in the initial load.
 * Updates the components store when the thumbnail is ready.
 */
export function triggerThumbnailGeneration(
  componentId: string,
  layers: Layer[],
  allComponents: Component[]
): void {
  if (typeof window === 'undefined') return;

  import('@/lib/client/thumbnail-capture').then(({ generateComponentThumbnail }) => {
    generateComponentThumbnail(componentId, layers, allComponents).then((thumbnailUrl) => {
      if (thumbnailUrl) {
        const state = useComponentsStore.getState();
        state.setComponents(
          state.components.map((c) =>
            c.id === componentId
              ? { ...c, thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() }
              : c
          )
        );
      }
    });
  }).catch((err) => console.error('Failed to generate thumbnail:', err));
}

interface ComponentsState {
  components: Component[];
  isLoading: boolean;
  error: string | null;
  /**
   * Per-component, per-variant working copy of layers used while editing a
   * component. Outer key = componentId, inner key = variantId.
   */
  componentDrafts: ComponentDraftMap;
  /**
   * True when any variant draft for this component has been mutated since it
   * was last loaded or persisted. Used to skip no-op saves and cross-page
   * sync passes when leaving the component editor without making any changes.
   * Tracked at component granularity (not per-variant) because saves always
   * persist the whole `variants` array as one unit.
   */
  componentDraftDirty: Record<string, boolean>;
  isSaving: boolean;
  saveTimeouts: Record<string, NodeJS.Timeout>;
}

/**
 * Preview info for component deletion
 */
export interface DeletePreviewInfo {
  affectedCount: number;
  affectedEntities: Array<{
    type: 'page' | 'component';
    id: string;
    name: string;
    pageId?: string;
  }>;
}

/**
 * Result of deleting a component
 */
export interface DeleteComponentResult {
  success: boolean;
  affectedEntities?: Array<{
    type: 'page' | 'component';
    id: string;
    name: string;
    pageId?: string;
    previousLayers: Layer[];
    newLayers: Layer[];
  }>;
}

interface ComponentsActions {
  // Data loading
  setComponents: (components: Component[]) => void;
  loadComponents: () => Promise<void>;
  /**
   * Apply an authoritative component snapshot from the server (e.g. after the AI
   * agent edits it). Replaces the record in `components` and rebuilds the
   * component's drafts from its variants so the open canvas reflects the change
   * without a manual reload. Marks the drafts clean so it doesn't trigger a save.
   */
  applyServerComponent: (component: Component) => void;

  // CRUD operations
  createComponent: (name: string, layers: Layer[]) => Promise<Component | null>;
  updateComponent: (id: string, updates: Partial<Pick<Component, 'name' | 'layers'>>) => Promise<void>;
  deleteComponent: (id: string) => Promise<DeleteComponentResult>;
  getDeletePreview: (id: string) => Promise<DeletePreviewInfo | null>;

  // Draft management (for editing mode)
  loadComponentDraft: (componentId: string) => Promise<void>;
  updateComponentDraft: (componentId: string, variantId: string, layers: Layer[]) => void;
  saveComponentDraft: (componentId: string) => Promise<void>;
  clearComponentDraft: (componentId: string) => void;
  /**
   * Read the current draft layers for a component+variant, falling back to
   * the persisted variant layers (or the legacy `layers` field) when no
   * working copy exists yet for that variant.
   */
  getComponentDraftLayers: (componentId: string, variantId?: string | null) => Layer[];

  // Variant management
  addVariant: (componentId: string, fromVariantId?: string | null) => Promise<string | null>;
  renameVariant: (componentId: string, variantId: string, name: string) => Promise<void>;
  duplicateVariant: (componentId: string, variantId: string) => Promise<string | null>;
  deleteVariant: (componentId: string, variantId: string) => Promise<void>;
  /** Persist a new ordering of a component's variants. Order matters because
   *  the first variant is the implicit "default" instances fall back to. */
  reorderVariants: (componentId: string, orderedVariantIds: string[]) => Promise<void>;

  // Convenience actions
  renameComponent: (id: string, newName: string) => Promise<void>;
  getComponentById: (id: string) => Component | undefined;
  createComponentFromLayer: (componentId: string, layerId: string, componentName: string) => Promise<string | null>;
  restoreComponents: (componentIds: string[]) => Promise<string[]>;

  // Component variables
  addTextVariable: (componentId: string, name: string) => Promise<string | null>;
  addRichTextVariable: (componentId: string, name: string) => Promise<string | null>;
  addImageVariable: (componentId: string, name: string) => Promise<string | null>;
  addLinkVariable: (componentId: string, name: string) => Promise<string | null>;
  addAudioVariable: (componentId: string, name: string) => Promise<string | null>;
  addVideoVariable: (componentId: string, name: string) => Promise<string | null>;
  addIconVariable: (componentId: string, name: string) => Promise<string | null>;
  /** Add a `'variant'` typed variable. Variant variables expose a parent
   *  variable that drives the `componentVariantId` of any nested-instance layer
   *  whose `componentVariantVariableId` points at it. */
  addVariantVariable: (componentId: string, name: string) => Promise<string | null>;
  /** Add a `'visibility'` typed variable (defaults to visible). Drives
   *  `settings.hidden` of any layer whose `settings.visibilityVariableId`
   *  points at it, so instances can show or hide parts of the component. */
  addVisibilityVariable: (componentId: string, name: string) => Promise<string | null>;
  updateTextVariable: (componentId: string, variableId: string, updates: { name?: string; placeholder?: string; default_value?: any }) => Promise<void>;
  reorderVariables: (componentId: string, orderedIds: string[]) => Promise<void>;
  deleteTextVariable: (componentId: string, variableId: string) => Promise<void>;

  // Layer style operations
  updateStyleOnLayers: (styleId: string, stylesById: Map<string, LayerStyle>) => void;
  detachStyleFromAllLayers: (styleId: string, stylesById?: Map<string, LayerStyle>) => void;

  // State management
  setError: (error: string | null) => void;
  clearError: () => void;
  setSaving: (value: boolean) => void;
}

type ComponentsStore = ComponentsState & ComponentsActions;

export const useComponentsStore = create<ComponentsStore>((set, get) => {
  /**
   * Apply a layer transform to every variant on every component (and to every
   * working draft). Used by global style sync helpers below.
   */
  const updateComponentLayers = (updateLayers: (layers: Layer[]) => Layer[]) => {
    const { components, componentDrafts } = get();

    const updatedComponents = components.map(component => {
      const transformedVariants = (component.variants && component.variants.length > 0)
        ? component.variants.map(v => ({ ...v, layers: updateLayers(v.layers) }))
        : undefined;
      return {
        ...component,
        layers: updateLayers(component.layers),
        ...(transformedVariants ? { variants: transformedVariants } : {}),
      };
    });

    const updatedDrafts: ComponentDraftMap = {};
    Object.entries(componentDrafts).forEach(([componentId, variantDrafts]) => {
      updatedDrafts[componentId] = {};
      Object.entries(variantDrafts).forEach(([variantId, layers]) => {
        updatedDrafts[componentId][variantId] = updateLayers(layers);
      });
    });

    set({ components: updatedComponents, componentDrafts: updatedDrafts });
  };

  return {
    // Initial state
    components: [],
    isLoading: false,
    error: null,
    componentDrafts: {},
    componentDraftDirty: {},
    isSaving: false,
    saveTimeouts: {},

    // Set components (used by unified init)
    setComponents: (components) => set({ components }),

    // Apply an authoritative server snapshot (e.g. after AI edits a component).
    applyServerComponent: (component) => {
      const variants = component.variants && component.variants.length > 0
        ? component.variants
        : [{ id: generateId('cmpvar'), name: 'Default', layers: component.layers ?? [] }];

      // Rebuild the per-variant drafts so the open component canvas re-renders
      // with the AI's changes. Deep-clone so later local edits don't mutate the
      // stored component record.
      const variantDrafts: Record<string, Layer[]> = {};
      for (const variant of variants) {
        variantDrafts[variant.id] = JSON.parse(JSON.stringify(variant.layers ?? []));
      }

      set((state) => ({
        components: state.components.some((c) => c.id === component.id)
          ? state.components.map((c) => (c.id === component.id ? component : c))
          : [component, ...state.components],
        componentDrafts: {
          ...state.componentDrafts,
          [component.id]: variantDrafts,
        },
        componentDraftDirty: {
          ...state.componentDraftDirty,
          [component.id]: false,
        },
      }));
    },

    // Load all components
    loadComponents: async () => {
      set({ isLoading: true, error: null });

      try {
        const response = await fetch('/ycode/api/components');
        const result = await response.json();

        if (result.error) {
          set({ error: result.error, isLoading: false });
          return;
        }

        set({ components: result.data || [], isLoading: false });
      } catch (error) {
        console.error('Failed to load components:', error);
        set({ error: 'Failed to load components', isLoading: false });
      }
    },

    // Create a new component
    createComponent: async (name, layers) => {
      set({ isLoading: true, error: null });

      try {
        const response = await fetch('/ycode/api/components', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            layers,
          }),
        });

        const result = await response.json();

        if (result.error) {
          set({ error: result.error, isLoading: false });
          return null;
        }

        const newComponent = result.data;
        set((state) => ({
          components: [newComponent, ...state.components],
          isLoading: false,
        }));

        // Generate thumbnail in the background (fire-and-forget)
        triggerThumbnailGeneration(newComponent.id, newComponent.layers, get().components);

        return newComponent;
      } catch (error) {
        console.error('Failed to create component:', error);
        set({ error: 'Failed to create component', isLoading: false });
        return null;
      }
    },

    // Update a component
    updateComponent: async (id, updates) => {
      set({ isLoading: true, error: null });

      try {
        const response = await fetch(`/ycode/api/components/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        const result = await response.json();

        if (result.error) {
          set({ error: result.error, isLoading: false });
          return;
        }

        const updatedComponent = result.data;
        set((state) => ({
          components: state.components.map((c) => (c.id === id ? updatedComponent : c)),
          isLoading: false,
        }));
      } catch (error) {
        console.error('Failed to update component:', error);
        set({ error: 'Failed to update component', isLoading: false });
      }
    },

    // Get preview of what will be affected by deleting a component
    getDeletePreview: async (id) => {
      try {
        const response = await fetch(`/ycode/api/components/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview-delete' }),
        });

        const result = await response.json();

        if (result.error) {
          console.error('Failed to get delete preview:', result.error);
          return null;
        }

        return result.data as DeletePreviewInfo;
      } catch (error) {
        console.error('Failed to get delete preview:', error);
        return null;
      }
    },

    // Delete a component (soft delete with undo/redo support)
    deleteComponent: async (id) => {
      set({ isLoading: true, error: null });

      try {
        const response = await fetch(`/ycode/api/components/${id}`, {
          method: 'DELETE',
        });

        const result = await response.json();

        if (result.error) {
          set({ error: result.error, isLoading: false });
          return { success: false };
        }

        const { component, affectedEntities } = result.data;

        // Update pages store for affected pages
        if (affectedEntities && affectedEntities.length > 0) {
          const { usePagesStore } = await import('./usePagesStore');
          const pagesStore = usePagesStore.getState();

          for (const entity of affectedEntities) {
            if (entity.type === 'page' && entity.pageId) {
              // Update the page draft with new layers (component detached)
              const currentDraft = pagesStore.draftsByPageId[entity.pageId];
              if (currentDraft) {
                pagesStore.setDraftLayers(entity.pageId, entity.newLayers);
              }
            } else if (entity.type === 'component') {
              // Update component in local store
              set((state) => ({
                components: state.components.map((c) =>
                  c.id === entity.id ? { ...c, layers: entity.newLayers } : c
                ),
              }));

              // Also update component draft if it's currently being edited.
              // The legacy `layers` field mirrors the primary variant, so the
              // detached layers replace that variant's draft.
              const currentDraft = get().componentDrafts[entity.id];
              const primaryVariantId = getPrimaryVariantId(get().getComponentById(entity.id));
              if (currentDraft && primaryVariantId) {
                get().updateComponentDraft(entity.id, primaryVariantId, entity.newLayers);
              }
            }
          }

          // Record undo/redo versions for affected entities
          const { recordVersionViaApi, initializeVersionTracking } = await import('@/lib/version-tracking');
          const { useEditorStore } = await import('./useEditorStore');

          // Get current editor state to check if any affected entity is currently being edited
          const editorState = useEditorStore.getState();
          const currentPageId = editorState.currentPageId;
          const editingComponentId = editorState.editingComponentId;
          const selectedLayerId = editorState.selectedLayerId;
          const lastSelectedLayerId = editorState.lastSelectedLayerId;

          // Helper: Find all layer IDs of component instances in a layer tree
          const findComponentInstanceLayerIds = (layers: Layer[], componentId: string): string[] => {
            const instanceIds: string[] = [];
            const traverse = (layerList: Layer[]) => {
              for (const layer of layerList) {
                if (layer.componentId === componentId) {
                  instanceIds.push(layer.id);
                }
                if (layer.children && layer.children.length > 0) {
                  traverse(layer.children);
                }
              }
            };
            traverse(layers);
            return instanceIds;
          };

          // Record versions with component requirement metadata
          for (const entity of affectedEntities) {
            // Note: Component requirements are now auto-detected from layers
            // We still explicitly add the deleted component ID for clarity and as a safety measure
            const metadata: any = {
              requirements: {
                component_ids: [id], // The deleted component must be restored before undoing
              },
            };

            // Build prioritized selection list
            const layerIds: string[] = [];

            // If this entity is currently being edited, capture current selection first
            const isCurrentlyEditing =
              (entity.type === 'page' && entity.pageId === currentPageId) ||
              (entity.type === 'component' && entity.id === editingComponentId);

            if (isCurrentlyEditing) {
              if (selectedLayerId) layerIds.push(selectedLayerId);
              if (lastSelectedLayerId && lastSelectedLayerId !== selectedLayerId) {
                layerIds.push(lastSelectedLayerId);
              }
            }

            // Always add the component instance layer IDs that are being detached
            // These will be restored when undoing, so they're good selection candidates
            const componentInstanceIds = findComponentInstanceLayerIds(entity.previousLayers, id);
            for (const instanceId of componentInstanceIds) {
              if (!layerIds.includes(instanceId)) {
                layerIds.push(instanceId);
              }
            }

            // Store selection metadata if we have any layer IDs
            if (layerIds.length > 0) {
              metadata.selection = {
                layer_ids: layerIds,
              };
            }

            if (entity.type === 'page' && entity.pageId) {
              // Initialize cache with previous state (before detachment) if not already cached
              initializeVersionTracking('page_layers', entity.pageId, entity.previousLayers);
              // Record version with new state (after detachment)
              await recordVersionViaApi('page_layers', entity.pageId, entity.newLayers, metadata);
            } else if (entity.type === 'component') {
              // Initialize cache with previous state (before detachment) if not already cached
              initializeVersionTracking('component', entity.id, entity.previousLayers);
              // Record version with new state (after detachment)
              await recordVersionViaApi('component', entity.id, entity.newLayers, metadata);
            }
          }
        }

        // Remove the component from local store
        set((state) => ({
          components: state.components.filter((c) => c.id !== id),
          isLoading: false,
        }));

        return { success: true, affectedEntities };
      } catch (error) {
        console.error('Failed to delete component:', error);
        set({ error: 'Failed to delete component', isLoading: false });
        return { success: false };
      }
    },

    // Load component into draft for editing — clones every variant so the
    // user can switch between them in the editor without losing edits.
    loadComponentDraft: async (componentId) => {
      const component = get().components.find((c) => c.id === componentId);
      if (component) {
        // Backfill a "Default" variant for components that pre-date the
        // variants migration so the editor always has at least one entry.
        const variants = component.variants && component.variants.length > 0
          ? component.variants
          : [{ id: generateId('cmpvar'), name: 'Default', layers: component.layers ?? [] }];

        const variantDrafts: Record<string, Layer[]> = {};
        for (const variant of variants) {
          variantDrafts[variant.id] = JSON.parse(JSON.stringify(variant.layers ?? []));
        }

        // Mark each variant as initializing BEFORE updating store to prevent
        // false change detection. Undo/redo is scoped per variant.
        try {
          const { markEntityInitializing, updatePreviousState } = await import('@/hooks/use-undo-redo');
          const { componentVersionEntityId } = await import('@/lib/version-tracking');
          for (const variant of variants) {
            const versionId = componentVersionEntityId(componentId, variant.id);
            markEntityInitializing('component', versionId);
            updatePreviousState('component', versionId, variantDrafts[variant.id]);
          }
        } catch (err) {
          console.error('Failed to mark component as initializing:', err);
        }

        set((state) => ({
          componentDrafts: {
            ...state.componentDrafts,
            [componentId]: variantDrafts,
          },
          componentDraftDirty: {
            ...state.componentDraftDirty,
            [componentId]: false,
          },
        }));

        // Initialize version tracking with loaded state (per variant)
        import('@/lib/version-tracking').then(({ initializeVersionTracking, componentVersionEntityId }) => {
          for (const variant of variants) {
            initializeVersionTracking(
              'component',
              componentVersionEntityId(componentId, variant.id),
              variantDrafts[variant.id]
            );
          }
        }).catch((err) => {
          console.error('Failed to initialize component version tracking:', err);
        });
      }
    },

    // Update component variant draft (triggers auto-save). All variant drafts
    // for the same component share a single debounced save so we always
    // persist them together as one `variants` payload.
    updateComponentDraft: (componentId, variantId, layers) => {
      set((state) => ({
        componentDrafts: {
          ...state.componentDrafts,
          [componentId]: {
            ...(state.componentDrafts[componentId] || {}),
            [variantId]: layers,
          },
        },
        componentDraftDirty: {
          ...state.componentDraftDirty,
          [componentId]: true,
        },
      }));

      // Clear existing timeout for this component
      const { saveTimeouts } = get();
      if (saveTimeouts[componentId]) {
        clearTimeout(saveTimeouts[componentId]);
      }

      // Set new timeout for auto-save (500ms debounce)
      const timeout = setTimeout(() => {
        get().saveComponentDraft(componentId);
      }, 500);

      set((state) => ({
        saveTimeouts: {
          ...state.saveTimeouts,
          [componentId]: timeout,
        },
      }));
    },

    getComponentDraftLayers: (componentId, variantId) => {
      const component = get().components.find(c => c.id === componentId);
      const drafts = get().componentDrafts[componentId];
      const targetVariantId = variantId ?? getPrimaryVariantId(component);
      if (drafts && targetVariantId && drafts[targetVariantId]) {
        return drafts[targetVariantId];
      }
      // Fall back to persisted variant layers, then to the legacy `layers`.
      if (component?.variants && component.variants.length > 0) {
        const match = targetVariantId
          ? component.variants.find(v => v.id === targetVariantId)
          : undefined;
        return (match ?? component.variants[0]).layers ?? [];
      }
      return component?.layers ?? [];
    },

    // Save the entire variants payload for a component to the database.
    saveComponentDraft: async (componentId) => {
      const { componentDrafts, componentDraftDirty, components } = get();
      const variantDrafts = componentDrafts[componentId];

      if (!variantDrafts || Object.keys(variantDrafts).length === 0) {
        console.warn(`No draft found for component ${componentId}`);
        return;
      }

      // Skip the round-trip entirely when nothing has changed since the draft
      // was loaded or last persisted.
      if (!componentDraftDirty[componentId]) {
        return;
      }

      const component = components.find(c => c.id === componentId);
      if (!component) {
        console.warn(`Component ${componentId} not found in store while saving draft`);
        return;
      }

      // Rebuild the variants payload from the latest drafts. Variants the user
      // never opened during this session keep their persisted layers.
      const variantsBeingSaved = buildVariantsFromDrafts(component, variantDrafts);
      // Snapshot the primary variant's layers for change-detection / undo.
      const layersBeingSaved = variantsBeingSaved[0]?.layers ?? [];

      set({ isSaving: true });

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: variantsBeingSaved }),
        });

        const result = await response.json();

        if (result.error) {
          console.error('Failed to save component draft:', result.error);
          set({ isSaving: false });
          return;
        }

        const updatedComponent = result.data;

        // Detect whether any variant changed during the save (e.g. undo/redo).
        const currentDrafts = get().componentDrafts[componentId];
        const currentVariantsJSON = JSON.stringify(buildVariantsFromDrafts(updatedComponent, currentDrafts));
        const savedVariantsJSON = JSON.stringify(variantsBeingSaved);

        if (currentVariantsJSON === savedVariantsJSON) {
          set((state) => ({
            components: state.components.map((c) => (c.id === componentId ? updatedComponent : c)),
            componentDraftDirty: { ...state.componentDraftDirty, [componentId]: false },
            isSaving: false,
          }));

          // Record a version per variant for undo/redo. Each variant has its
          // own history; unchanged variants produce an empty patch and are
          // skipped inside recordVersionViaApi.
          import('@/lib/version-tracking').then(({ recordVersionViaApi, componentVersionEntityId }) => {
            for (const variant of variantsBeingSaved) {
              recordVersionViaApi(
                'component',
                componentVersionEntityId(componentId, variant.id),
                variant.layers
              );
            }
          }).catch((err) => {
            console.error('Failed to record component version:', err);
          });
        } else {
          // Variants changed mid-save — keep the local copy and let the next
          // debounced save record the version.
          set((state) => ({
            components: state.components.map((c) => (c.id === componentId ? updatedComponent : c)),
            isSaving: false,
          }));
        }

        // Trigger component sync across all pages — pages render the primary
        // variant for back-compat and per-instance variant resolution happens
        // at render time.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('componentUpdated', {
            detail: { componentId, layers: layersBeingSaved }
          }));

          triggerThumbnailGeneration(componentId, layersBeingSaved, get().components);
        }

        // Regenerate CSS to include updated component classes. Collect layers
        // from every variant so styles unique to a non-default variant are
        // also captured. Run this off the critical path so navigation/UI is
        // not blocked.
        scheduleIdle(async () => {
          try {
            const { usePagesStore } = await import('./usePagesStore');
            const { collectComponentIds } = await import('@/lib/component-utils');

            // `collectComponentIds` (unlike `containsComponent`) also finds
            // components embedded inside rich-text content and override text
            // values, so a page that uses this component only inside a Rich
            // Text block is still flagged for per-page CSS regeneration.
            const referencesComponent = (layers: Layer[]) =>
              collectComponentIds(layers).has(componentId);

            const allDrafts = usePagesStore.getState().draftsByPageId;
            const affectedPageIds: string[] = [];
            Object.entries(allDrafts).forEach(([pid, pageDraft]) => {
              if (pageDraft.layers && referencesComponent(pageDraft.layers)) {
                affectedPageIds.push(pid);
              }
            });

            if (affectedPageIds.length > 0) {
              fetch('/ycode/api/css/generate-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageIds: affectedPageIds }),
              }).catch(() => {});
            }

            // Also regenerate global draft_css for builder preview.
            // Start from all variant layers so non-default variant styles are
            // included, then append affected page layers.
            const { generateAndSaveCSS } = await import('@/lib/client/cssGenerator');
            const allLayers: Layer[] = variantsBeingSaved.flatMap(v => v.layers);
            Object.values(allDrafts).forEach((pageDraft) => {
              if (pageDraft.layers && referencesComponent(pageDraft.layers)) {
                allLayers.push(...pageDraft.layers);
              }
            });
            await generateAndSaveCSS(allLayers);
          } catch (cssError) {
            console.error('Failed to generate CSS after component save:', cssError);
          }
        });
      } catch (error) {
        console.error('Failed to save component draft:', error);
        set({ isSaving: false });
      }
    },

    // Clear component draft from memory
    clearComponentDraft: (componentId) => {
      set((state) => {
        const newDrafts = { ...state.componentDrafts };
        delete newDrafts[componentId];

        const newDirty = { ...state.componentDraftDirty };
        delete newDirty[componentId];

        const newTimeouts = { ...state.saveTimeouts };
        if (newTimeouts[componentId]) {
          clearTimeout(newTimeouts[componentId]);
          delete newTimeouts[componentId];
        }

        return {
          componentDrafts: newDrafts,
          componentDraftDirty: newDirty,
          saveTimeouts: newTimeouts,
        };
      });
    },

    // Rename a component with optimistic update (rolls back on failure)
    renameComponent: async (id, newName) => {
      const previousName = get().components.find((c) => c.id === id)?.name;

      set((state) => ({
        components: state.components.map((c) => (c.id === id ? { ...c, name: newName } : c)),
      }));

      try {
        const response = await fetch(`/ycode/api/components/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error);

        set((state) => ({
          components: state.components.map((c) => (c.id === id ? result.data : c)),
        }));
      } catch (error) {
        console.error('Failed to rename component:', error);
        if (previousName !== undefined) {
          set((state) => ({
            components: state.components.map((c) => (c.id === id ? { ...c, name: previousName } : c)),
            error: 'Failed to rename component',
          }));
        }
      }
    },

    // Get component by ID (convenience method)
    getComponentById: (id) => {
      return get().components.find((c) => c.id === id);
    },

    /**
     * Create a component from a layer in a component draft.
     *
     * The action targets whichever variant the editor is currently focused on;
     * extracting a sub-tree from one variant doesn't change the others.
     */
    createComponentFromLayer: async (componentId, layerId, componentName) => {
      const { componentDrafts, components } = get();
      const variantDrafts = componentDrafts[componentId];
      if (!variantDrafts) return null;

      // Find the variant that actually contains the layer being extracted.
      let activeVariantId: string | null = null;
      let layers: Layer[] | null = null;
      for (const [variantId, variantLayers] of Object.entries(variantDrafts)) {
        if (findLayerById(variantLayers, layerId)) {
          activeVariantId = variantId;
          layers = variantLayers;
          break;
        }
      }
      if (!activeVariantId || !layers) return null;

      const layerToCopy = findLayerById(layers, layerId);
      if (!layerToCopy) return null;

      // Regenerate IDs so the component's internal layers don't collide with
      // the instance layer that keeps the original id in the parent tree.
      const regeneratedLayer = regenerateIdsWithInteractionRemapping(layerToCopy);
      // Strip CMS bindings that won't be valid inside a standalone component
      const cleanedLayers = cleanLayersForComponentCreation([regeneratedLayer]);
      const newComponent = await createComponentViaApi(componentName, cleanedLayers);
      if (!newComponent) return null;

      // Add to local store
      set((state) => ({
        components: [newComponent, ...state.components],
      }));

      // Replace the original layer with the new component instance in the
      // variant we extracted from.
      const newLayers = replaceLayerWithComponentInstance(layers, layerId, newComponent.id);
      get().updateComponentDraft(componentId, activeVariantId, newLayers);

      // Generate thumbnail in the background (fire-and-forget)
      triggerThumbnailGeneration(newComponent.id, newComponent.layers, [...components, newComponent]);

      return newComponent.id;
    },

    /**
     * Restore required components for undo operations
     * Checks if components exist, restores them if deleted
     */
    restoreComponents: async (componentIds) => {
      const { loadComponents } = get();
      const restoredIds: string[] = [];

      for (const componentId of componentIds) {
        try {
          // Check if component exists/is deleted
          const response = await fetch(`/ycode/api/components/${componentId}`);
          const result = await response.json();

          // If component doesn't exist or is deleted, restore it
          if (!result.data || result.error) {
            // Restore the component via API
            const restoreResponse = await fetch(`/ycode/api/components/${componentId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'restore' }),
            });

            const restoreResult = await restoreResponse.json();

            if (restoreResult.data) {
              restoredIds.push(componentId);
            }
          }
        } catch (error) {
          console.error(`[Store] Failed to check/restore required component ${componentId}:`, error);
          // Continue with other components
        }
      }

      // Reload all components if any were restored
      if (restoredIds.length > 0) {
        await loadComponents();
      }

      return restoredIds;
    },

    // Add a text variable to a component
    addTextVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv'); // CPV = Component Variable
      const newVariable = { id: variableId, name };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add text variable:', result.error);
          return null;
        }

        // Update local state
        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add text variable:', error);
        return null;
      }
    },

    addRichTextVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv');
      const newVariable = { id: variableId, name, type: 'rich_text' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add rich text variable:', result.error);
          return null;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add rich text variable:', error);
        return null;
      }
    },

    addImageVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv'); // CPV = Component Variable
      const newVariable = { id: variableId, name, type: 'image' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add image variable:', result.error);
          return null;
        }

        // Update local state
        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add image variable:', error);
        return null;
      }
    },

    // Add a link variable to a component
    addLinkVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv'); // CPV = Component Variable
      const newVariable = { id: variableId, name, type: 'link' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add link variable:', result.error);
          return null;
        }

        // Update local state
        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add link variable:', error);
        return null;
      }
    },

    addAudioVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv');
      const newVariable = { id: variableId, name, type: 'audio' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add audio variable:', result.error);
          return null;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add audio variable:', error);
        return null;
      }
    },

    addVideoVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv');
      const newVariable = { id: variableId, name, type: 'video' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add video variable:', result.error);
          return null;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add video variable:', error);
        return null;
      }
    },

    addIconVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv');
      const newVariable = { id: variableId, name, type: 'icon' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add icon variable:', result.error);
          return null;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add icon variable:', error);
        return null;
      }
    },

    addVariantVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv');
      const newVariable = { id: variableId, name, type: 'variant' as const };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add variant variable:', result.error);
          return null;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add variant variable:', error);
        return null;
      }
    },

    addVisibilityVariable: async (componentId, name) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const variableId = generateId('cpv');
      const newVariable: ComponentVariable = {
        id: variableId,
        name,
        type: 'visibility',
        default_value: { visible: true },
      };
      const updatedVariables = [...(component.variables || []), newVariable];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to add visibility variable:', result.error);
          return null;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));

        return variableId;
      } catch (error) {
        console.error('Failed to add visibility variable:', error);
        return null;
      }
    },

    // Update a text variable's name and/or default value
    updateTextVariable: async (componentId, variableId, updates) => {
      const component = get().getComponentById(componentId);
      if (!component) return;

      const updatedVariables = (component.variables || []).map((v) =>
        v.id === variableId ? { ...v, ...updates } : v
      );

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: updatedVariables }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to update text variable:', result.error);
          return;
        }

        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: updatedVariables } : c
          ),
        }));
      } catch (error) {
        console.error('Failed to update text variable:', error);
      }
    },

    reorderVariables: async (componentId, orderedIds) => {
      const component = get().getComponentById(componentId);
      if (!component) return;

      const previous = component.variables || [];
      const varMap = new Map(previous.map(v => [v.id, v]));
      const reordered = orderedIds.map(id => varMap.get(id)).filter(Boolean) as typeof previous;

      // Optimistic update
      set((state) => ({
        components: state.components.map((c) =>
          c.id === componentId ? { ...c, variables: reordered } : c
        ),
      }));

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: reordered }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to reorder variables:', result.error);
          // Rollback on error
          set((state) => ({
            components: state.components.map((c) =>
              c.id === componentId ? { ...c, variables: previous } : c
            ),
          }));
        }
      } catch (error) {
        console.error('Failed to reorder variables:', error);
        // Rollback on error
        set((state) => ({
          components: state.components.map((c) =>
            c.id === componentId ? { ...c, variables: previous } : c
          ),
        }));
      }
    },

    // Delete a text variable
    deleteTextVariable: async (componentId, variableId) => {
      const component = get().getComponentById(componentId);
      if (!component) return;

      const updatedVariables = (component.variables || []).filter((v) => v.id !== variableId);

      const deletedVar = (component.variables || []).find(v => v.id === variableId);
      const deletedVarType = deletedVar?.type || 'text';

      // Helper to unlink layers from the deleted variable
      const unlinkLayersFromVariable = (layers: Layer[]): Layer[] => {
        return layers.map(layer => {
          let updatedLayer = { ...layer };

          // Unlink if this layer's text variable references the deleted variable
          const textVar = layer.variables?.text;
          if (textVar?.id === variableId) {
            const { id: _, ...textWithoutId } = textVar;
            updatedLayer.variables = {
              ...layer.variables,
              text: textWithoutId as typeof textVar,
            };
          }

          // Drop the variant-variable link if it points at the deleted variable.
          // The layer's own `componentVariantId` (set when the user picked a
          // variant manually) is preserved as the local fallback.
          if (updatedLayer.componentVariantVariableId === variableId) {
            const { componentVariantVariableId: _, ...rest } = updatedLayer;
            updatedLayer = rest;
          }

          // Drop the visibility link; the layer falls back to its static `hidden` flag
          if (updatedLayer.settings?.visibilityVariableId === variableId) {
            const { visibilityVariableId: _, ...restSettings } = updatedLayer.settings;
            updatedLayer = { ...updatedLayer, settings: restSettings };
          }

          updatedLayer = removeVariableLinksPointingTo(updatedLayer, variableId);

          // Recursively process children
          if (updatedLayer.children && updatedLayer.children.length > 0) {
            updatedLayer.children = unlinkLayersFromVariable(updatedLayer.children);
          }

          return updatedLayer;
        });
      };

      // Clean up component's own layers across every variant — variables are
      // shared across variants so a deleted variable must be unlinked from all
      // of them. The legacy `layers` field is kept in sync with variants[0].
      const baselineVariants: ComponentVariant[] = component.variants && component.variants.length > 0
        ? component.variants
        : [{ id: generateId('cmpvar'), name: 'Default', layers: component.layers ?? [] }];
      const updatedVariants = baselineVariants.map(v => ({
        ...v,
        layers: unlinkLayersFromVariable(v.layers ?? []),
      }));
      const updatedLayers = updatedVariants[0]?.layers ?? [];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variables: updatedVariables,
            variants: updatedVariants,
          }),
        });

        const result = await response.json();
        if (result.error) {
          console.error('Failed to delete text variable:', result.error);
          return;
        }

        // Update local state — clean every variant draft for this component.
        set((state) => {
          const existingDrafts = state.componentDrafts[componentId];
          let updatedDrafts: Record<string, Layer[]> | undefined;
          if (existingDrafts) {
            updatedDrafts = {};
            for (const [variantId, layers] of Object.entries(existingDrafts)) {
              updatedDrafts[variantId] = unlinkLayersFromVariable(layers);
            }
          }
          return {
            components: state.components.map((c) =>
              c.id === componentId
                ? { ...c, variables: updatedVariables, layers: updatedLayers, variants: updatedVariants }
                : c
            ),
            componentDrafts: updatedDrafts
              ? { ...state.componentDrafts, [componentId]: updatedDrafts }
              : state.componentDrafts,
          };
        });

        // Clean up orphaned overrides from page instances
        // Import pages store and clean up componentOverrides that reference the deleted variable
        const { usePagesStore } = await import('./usePagesStore');
        const pagesState = usePagesStore.getState();

        // Helper to clean overrides from layers
        const cleanOverridesFromLayers = (layers: Layer[]): Layer[] => {
          return layers.map(layer => {
            let updatedLayer = { ...layer };

            if (layer.componentId === componentId && layer.componentOverrides) {
              const overrides = { ...layer.componentOverrides };

              // Clean the override value for the deleted variable's type category
              const category = deletedVarType as keyof typeof overrides;
              if (category !== 'variableLinks' && overrides[category]) {
                const catOverrides = overrides[category] as Record<string, unknown>;
                if (catOverrides[variableId] !== undefined) {
                  const { [variableId]: _, ...remaining } = catOverrides;
                  (overrides as Record<string, unknown>)[category] = Object.keys(remaining).length > 0 ? remaining : undefined;
                }
              }

              // Clean variableLinks that reference the deleted variable (as child key)
              if (overrides.variableLinks?.[variableId]) {
                const { [variableId]: _, ...remainingLinks } = overrides.variableLinks;
                overrides.variableLinks = Object.keys(remainingLinks).length > 0 ? remainingLinks : undefined;
              }

              updatedLayer.componentOverrides = overrides;
            }

            // Mirror of the editor-side strip: drop dangling variant-variable
            // links so a deleted variant variable doesn't keep pointing into a
            // nonexistent parent variable.
            if (updatedLayer.componentVariantVariableId === variableId) {
              const { componentVariantVariableId: _, ...rest } = updatedLayer;
              updatedLayer = rest;
            }

            updatedLayer = removeVariableLinksPointingTo(updatedLayer, variableId);

            // Recursively process children
            if (updatedLayer.children && updatedLayer.children.length > 0) {
              updatedLayer.children = cleanOverridesFromLayers(updatedLayer.children);
            }

            return updatedLayer;
          });
        };

        // Update all page drafts that might have instances of this component
        Object.entries(pagesState.draftsByPageId).forEach(([pageId, draft]) => {
          if (draft && draft.layers) {
            const cleanedLayers = cleanOverridesFromLayers(draft.layers);
            // Only update if something changed (simple stringify comparison)
            if (JSON.stringify(cleanedLayers) !== JSON.stringify(draft.layers)) {
              pagesState.setDraftLayers(pageId, cleanedLayers);
            }
          }
        });
      } catch (error) {
        console.error('Failed to delete text variable:', error);
      }
    },

    /**
     * Add a new variant to a component. Optionally seeds it from the layer
     * tree of an existing variant (the user's "duplicate current variant"
     * affordance). The variant is persisted via `PUT /api/components/:id` and
     * appended to the working draft so the editor can switch to it
     * immediately. Returns the new variant id.
     */
    addVariant: async (componentId, fromVariantId) => {
      const component = get().getComponentById(componentId);
      if (!component) return null;

      const baseline: ComponentVariant[] = component.variants && component.variants.length > 0
        ? component.variants
        : [{ id: generateId('cmpvar'), name: 'Default', layers: component.layers ?? [] }];

      // Pick the variant to clone (caller-specified, otherwise the first).
      const fromVariant = (fromVariantId && baseline.find(v => v.id === fromVariantId)) || baseline[0];

      // Generate fresh layer IDs so animations / interactions inside the new
      // variant target its own layers rather than the source variant's.
      const clonedLayers: Layer[] = (fromVariant.layers ?? []).map(layer =>
        regenerateIdsWithInteractionRemapping(JSON.parse(JSON.stringify(layer)))
      );

      // Pick a unique "Variant N" name based on existing variants.
      const existingNames = new Set(baseline.map(v => v.name));
      let suffix = baseline.length + 1;
      let proposedName = `Variant ${suffix}`;
      while (existingNames.has(proposedName)) {
        suffix += 1;
        proposedName = `Variant ${suffix}`;
      }

      const newVariant: ComponentVariant = {
        id: generateId('cmpvar'),
        name: proposedName,
        layers: clonedLayers,
      };

      const updatedVariants = [...baseline, newVariant];

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: updatedVariants }),
        });
        const result = await response.json();
        if (result.error) {
          console.error('Failed to add variant:', result.error);
          return null;
        }

        const updatedComponent: Component = result.data;

        // Seed the working draft for the new variant so the editor can switch
        // to it without a reload, and refresh the canonical store entry.
        set((state) => ({
          components: state.components.map(c => (c.id === componentId ? updatedComponent : c)),
          componentDrafts: {
            ...state.componentDrafts,
            [componentId]: {
              ...(state.componentDrafts[componentId] || {}),
              [newVariant.id]: JSON.parse(JSON.stringify(clonedLayers)),
            },
          },
          componentDraftDirty: {
            ...state.componentDraftDirty,
            [componentId]: false,
          },
        }));

        return newVariant.id;
      } catch (error) {
        console.error('Failed to add variant:', error);
        return null;
      }
    },

    renameVariant: async (componentId, variantId, name) => {
      const component = get().getComponentById(componentId);
      if (!component?.variants) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      const updatedVariants = component.variants.map(v =>
        v.id === variantId ? { ...v, name: trimmed } : v
      );

      // Optimistic update so the rename feels instant in the sidebar.
      set((state) => ({
        components: state.components.map(c => (c.id === componentId ? { ...c, variants: updatedVariants } : c)),
      }));

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: updatedVariants }),
        });
        const result = await response.json();
        if (result.error) {
          console.error('Failed to rename variant:', result.error);
          // Roll back on failure.
          set((state) => ({
            components: state.components.map(c => (c.id === componentId ? component : c)),
          }));
        } else {
          set((state) => ({
            components: state.components.map(c => (c.id === componentId ? result.data : c)),
          }));
        }
      } catch (error) {
        console.error('Failed to rename variant:', error);
        set((state) => ({
          components: state.components.map(c => (c.id === componentId ? component : c)),
        }));
      }
    },

    duplicateVariant: async (componentId, variantId) => {
      return get().addVariant(componentId, variantId);
    },

    /**
     * Delete a variant. Refuses to delete the last remaining variant.
     *
     * Existing instances that referenced the deleted variant fall back to the
     * first variant automatically via `getComponentVariantLayers` — no extra
     * page-level rewriting needed.
     */
    deleteVariant: async (componentId, variantId) => {
      const component = get().getComponentById(componentId);
      if (!component?.variants || component.variants.length <= 1) return;

      const updatedVariants = component.variants.filter(v => v.id !== variantId);
      if (updatedVariants.length === component.variants.length) return; // not found

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: updatedVariants }),
        });
        const result = await response.json();
        if (result.error) {
          console.error('Failed to delete variant:', result.error);
          return;
        }

        const updatedComponent: Component = result.data;

        set((state) => {
          // Drop the variant draft from the working copy too.
          const existingDrafts = state.componentDrafts[componentId];
          let nextDrafts = state.componentDrafts;
          if (existingDrafts && existingDrafts[variantId]) {
            const { [variantId]: _, ...rest } = existingDrafts;
            nextDrafts = { ...state.componentDrafts, [componentId]: rest };
          }
          return {
            components: state.components.map(c => (c.id === componentId ? updatedComponent : c)),
            componentDrafts: nextDrafts,
          };
        });
      } catch (error) {
        console.error('Failed to delete variant:', error);
      }
    },

    /**
     * Reorder variants in-place. Persists via the standard component PUT and
     * mirrors the new order optimistically so the sidebar repaints instantly.
     * Falls back to the previous order if the server rejects the update.
     */
    reorderVariants: async (componentId, orderedVariantIds) => {
      const component = get().getComponentById(componentId);
      if (!component?.variants?.length) return;

      const byId = new Map(component.variants.map(v => [v.id, v]));
      const next = orderedVariantIds
        .map(id => byId.get(id))
        .filter((v): v is ComponentVariant => Boolean(v));
      // Append any variants the caller didn't specify so we never lose data
      // if the UI somehow sends a partial order.
      for (const v of component.variants) {
        if (!orderedVariantIds.includes(v.id)) next.push(v);
      }

      // Bail if nothing actually changed.
      const same = next.length === component.variants.length
        && next.every((v, i) => v.id === component.variants![i].id);
      if (same) return;

      const previousVariants = component.variants;
      // Optimistic reorder.
      set((state) => ({
        components: state.components.map(c => (c.id === componentId ? { ...c, variants: next } : c)),
      }));

      try {
        const response = await fetch(`/ycode/api/components/${componentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: next }),
        });
        const result = await response.json();
        if (result.error) {
          console.error('Failed to reorder variants:', result.error);
          // Roll back on failure.
          set((state) => ({
            components: state.components.map(c => (c.id === componentId ? { ...c, variants: previousVariants } : c)),
          }));
          return;
        }

        set((state) => ({
          components: state.components.map(c => (c.id === componentId ? result.data : c)),
        }));
      } catch (error) {
        console.error('Failed to reorder variants:', error);
        set((state) => ({
          components: state.components.map(c => (c.id === componentId ? { ...c, variants: previousVariants } : c)),
        }));
      }
    },

    /**
     * Update all layers using a specific style across all components
     * Used when a style is updated
     */
    updateStyleOnLayers: (styleId, stylesById) => {
      updateComponentLayers((layers) => updateLayersWithStyle(layers, styleId, stylesById));
    },

    /**
     * Detach a style from all layers across all components
     * Used when a style is deleted
     */
    detachStyleFromAllLayers: (styleId, stylesById) => {
      updateComponentLayers((layers) => detachStyleFromLayers(layers, styleId, stylesById));
    },

    // Error management
    setError: (error) => set({ error }),
    clearError: () => set({ error: null }),
    setSaving: (value) => set({ isSaving: value }),
  };
});
