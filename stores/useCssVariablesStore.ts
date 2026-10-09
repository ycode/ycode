/**
 * CSS Variables Store
 *
 * Holds the entire CSS variables graph (sets, modes, groups, variables, values)
 * and exposes CRUD methods + selectors + a client-side stylesheet generator
 * mirroring the server-side `buildCssVariablesStylesheet`.
 *
 * Listeners subscribe to `version` to know when the graph changes (used by the
 * canvas iframe injector and the preview).
 */

import { create } from 'zustand';
import { cssVariablesApi } from '@/lib/api';
import { buildCssVariablesStylesheet } from '@/lib/css-variables-stylesheet';
import type {
  CssVariable,
  CssVariableGroup,
  CssVariableSet,
  CssVariableSetActivationKind,
  CssVariableSetMode,
  CssVariableType,
  CssVariableValue,
  CssVariablesGraph,
} from '@/types';

const emptyGraph = (): CssVariablesGraph => ({
  sets: [],
  modes: [],
  groups: [],
  variables: [],
  values: [],
});

interface PreviewOverride {
  cssVariableId: string;
  modeId: string;
  value: string;
}

interface CssVariablesState {
  graph: CssVariablesGraph;
  /** Bumps every time the graph changes; canvas listeners read this to re-inject. */
  version: number;
  isLoading: boolean;
  error: string | null;
  /** Optional in-memory value override used while a user is typing in the editor. */
  previewOverride: PreviewOverride | null;
}

interface CssVariablesActions {
  loadGraph: () => Promise<void>;

  // Sets
  createSet: (data: { name: string; activation_kind?: CssVariableSetActivationKind }) => Promise<CssVariableSet | null>;
  updateSet: (id: string, data: { name?: string; activation_kind?: CssVariableSetActivationKind }) => Promise<CssVariableSet | null>;
  deleteSet: (id: string) => Promise<boolean>;
  reorderSets: (orderedIds: string[]) => Promise<void>;

  // Modes
  createMode: (data: { set_id: string; name: string; is_default?: boolean; data_theme?: string | null; min_width?: number | null }) => Promise<CssVariableSetMode | null>;
  updateMode: (id: string, data: { name?: string; is_default?: boolean; data_theme?: string | null; min_width?: number | null }) => Promise<CssVariableSetMode | null>;
  deleteMode: (id: string) => Promise<boolean>;
  reorderModes: (orderedIds: string[]) => Promise<void>;

  // Groups
  createGroup: (data: { set_id: string; name: string }) => Promise<CssVariableGroup | null>;
  updateGroup: (id: string, data: { name?: string }) => Promise<CssVariableGroup | null>;
  deleteGroup: (id: string) => Promise<boolean>;
  reorderGroups: (orderedIds: string[]) => Promise<void>;

  // Variables (items)
  createItem: (data: { set_id: string; type: CssVariableType; name: string; group_id?: string | null }) => Promise<CssVariable | null>;
  updateItem: (id: string, data: { name?: string; group_id?: string | null; type?: CssVariableType }) => Promise<CssVariable | null>;
  deleteItem: (id: string) => Promise<boolean>;
  reorderItems: (orderedIds: string[]) => Promise<void>;

  // Values
  setValue: (data: { css_variable_id: string; mode_id: string; value: string }) => Promise<CssVariableValue | null>;
  deleteValue: (cssVariableId: string, modeId: string) => Promise<boolean>;

  // Selectors
  getDefaultModeForSet: (setId: string) => CssVariableSetMode | undefined;
  getValue: (cssVariableId: string, modeId: string) => string;
  getCssVariablesByType: (type: CssVariableType) => CssVariable[];
  getCssVariableById: (id: string) => CssVariable | undefined;

  // Preview + stylesheet
  setPreviewOverride: (override: PreviewOverride | null) => void;
  generateStylesheet: () => string;
}

type CssVariablesStore = CssVariablesState & CssVariablesActions;

function bump(state: CssVariablesState): Partial<CssVariablesState> {
  return { version: state.version + 1 };
}

/** Merge or insert a row by id, preserving sort order. */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((r) => r.id === item.id);
  if (index === -1) return [...list, item];
  const copy = list.slice();
  copy[index] = item;
  return copy;
}

const pendingValues = new Map<string, Promise<unknown>>();

export const useCssVariablesStore = create<CssVariablesStore>((set, get) => ({
  graph: emptyGraph(),
  version: 0,
  isLoading: false,
  error: null,
  previewOverride: null,

  loadGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await cssVariablesApi.getGraph();
      if (response.error) throw new Error(response.error);
      set((state) => ({
        graph: response.data ?? emptyGraph(),
        isLoading: false,
        ...bump(state),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load CSS variables';
      set({ error: message, isLoading: false });
    }
  },

  // ----- Sets ---------------------------------------------------------------

  createSet: async (data) => {
    try {
      const response = await cssVariablesApi.createSet(data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to create CSS variable set' });
        return null;
      }
      // The backend also creates a Default mode. Reload to pick it up.
      await get().loadGraph();
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create CSS variable set';
      set({ error: message });
      return null;
    }
  },

  updateSet: async (id, data) => {
    try {
      const response = await cssVariablesApi.updateSet(id, data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to update CSS variable set' });
        return null;
      }
      set((state) => ({
        graph: { ...state.graph, sets: upsertById(state.graph.sets, response.data!) },
        ...bump(state),
      }));
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update CSS variable set';
      set({ error: message });
      return null;
    }
  },

  deleteSet: async (id) => {
    try {
      const response = await cssVariablesApi.deleteSet(id);
      if (response.error) {
        set({ error: response.error });
        return false;
      }
      set((state) => ({
        graph: {
          ...state.graph,
          sets: state.graph.sets.filter((s) => s.id !== id),
          modes: state.graph.modes.filter((m) => m.set_id !== id),
          groups: state.graph.groups.filter((g) => g.set_id !== id),
          variables: state.graph.variables.filter((v) => v.set_id !== id),
          values: state.graph.values.filter((v) =>
            !state.graph.variables.some((variable) => variable.id === v.css_variable_id && variable.set_id === id)
          ),
        },
        ...bump(state),
      }));
      await get().loadGraph();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete CSS variable set';
      set({ error: message });
      return false;
    }
  },

  reorderSets: (orderedIds) => persistGraphOrder('sets', orderedIds, cssVariablesApi.reorderSets),

  // ----- Modes --------------------------------------------------------------

  createMode: async (data) => {
    try {
      const response = await cssVariablesApi.createMode(data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to create mode' });
        return null;
      }
      set((state) => ({
        graph: { ...state.graph, modes: [...state.graph.modes, response.data!] },
        ...bump(state),
      }));
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create mode';
      set({ error: message });
      return null;
    }
  },

  updateMode: async (id, data) => {
    try {
      const response = await cssVariablesApi.updateMode(id, data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to update mode' });
        return null;
      }
      set((state) => {
        let modes = upsertById(state.graph.modes, response.data!);
        if (data.is_default) {
          modes = modes.map((m) =>
            m.set_id === response.data!.set_id ? { ...m, is_default: m.id === response.data!.id } : m
          );
        }
        return { graph: { ...state.graph, modes }, ...bump(state) };
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update mode';
      set({ error: message });
      return null;
    }
  },

  deleteMode: async (id) => {
    try {
      const response = await cssVariablesApi.deleteMode(id);
      if (response.error) {
        set({ error: response.error });
        return false;
      }
      set((state) => ({
        graph: {
          ...state.graph,
          modes: state.graph.modes.filter((m) => m.id !== id),
          values: state.graph.values.filter((v) => v.mode_id !== id),
        },
        ...bump(state),
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete mode';
      set({ error: message });
      return false;
    }
  },

  reorderModes: async (orderedIds) => {
    const { graph } = get();
    const reordered = graph.modes.map((m) => {
      const index = orderedIds.indexOf(m.id);
      return index === -1 ? m : { ...m, sort_order: index };
    });
    set((state) => ({ graph: { ...state.graph, modes: reordered }, ...bump(state) }));
    try {
      await cssVariablesApi.reorderModes(orderedIds);
    } catch (error) {
      console.error('Failed to persist mode order:', error);
      set({ graph });
    }
  },

  // ----- Groups -------------------------------------------------------------

  createGroup: async (data) => {
    try {
      const response = await cssVariablesApi.createGroup(data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to create group' });
        return null;
      }
      set((state) => ({
        graph: { ...state.graph, groups: [...state.graph.groups, response.data!] },
        ...bump(state),
      }));
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create group';
      set({ error: message });
      return null;
    }
  },

  updateGroup: async (id, data) => {
    try {
      const response = await cssVariablesApi.updateGroup(id, data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to update group' });
        return null;
      }
      set((state) => ({
        graph: { ...state.graph, groups: upsertById(state.graph.groups, response.data!) },
        ...bump(state),
      }));
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update group';
      set({ error: message });
      return null;
    }
  },

  deleteGroup: async (id) => {
    try {
      const response = await cssVariablesApi.deleteGroup(id);
      if (response.error) {
        set({ error: response.error });
        return false;
      }
      set((state) => ({
        graph: {
          ...state.graph,
          groups: state.graph.groups.filter((g) => g.id !== id),
          // Reload after deletion because variables move to a surviving group.
          variables: state.graph.variables.map((v) => (v.group_id === id ? { ...v, group_id: null } : v)),
        },
        ...bump(state),
      }));
      await get().loadGraph();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete group';
      set({ error: message });
      return false;
    }
  },

  reorderGroups: (orderedIds) => persistGraphOrder('groups', orderedIds, cssVariablesApi.reorderGroups),

  // ----- Variables (items) --------------------------------------------------

  createItem: async (data) => {
    try {
      const response = await cssVariablesApi.createItem(data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to create CSS variable' });
        return null;
      }
      set((state) => ({
        graph: { ...state.graph, variables: [...state.graph.variables, response.data!] },
        ...bump(state),
      }));
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create CSS variable';
      set({ error: message });
      return null;
    }
  },

  updateItem: async (id, data) => {
    try {
      const response = await cssVariablesApi.updateItem(id, data);
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to update CSS variable' });
        return null;
      }
      set((state) => ({
        graph: { ...state.graph, variables: upsertById(state.graph.variables, response.data!) },
        ...bump(state),
      }));
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update CSS variable';
      set({ error: message });
      return null;
    }
  },

  deleteItem: async (id) => {
    try {
      const response = await cssVariablesApi.deleteItem(id);
      if (response.error) {
        set({ error: response.error });
        return false;
      }
      set((state) => ({
        graph: {
          ...state.graph,
          variables: state.graph.variables.filter((v) => v.id !== id),
          values: state.graph.values.filter((v) => v.css_variable_id !== id),
        },
        ...bump(state),
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete CSS variable';
      set({ error: message });
      return false;
    }
  },

  reorderItems: (orderedIds) => persistGraphOrder('variables', orderedIds, cssVariablesApi.reorderItems),

  // ----- Values -------------------------------------------------------------

  setValue: async (data) => {
    try {
      const key = `${data.css_variable_id}:${data.mode_id}`;
      const request = (pendingValues.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => cssVariablesApi.setValue(data));
      pendingValues.set(key, request);
      const response = await request.finally(() => {
        if (pendingValues.get(key) === request) pendingValues.delete(key);
      });
      if (response.error || !response.data) {
        set({ error: response.error ?? 'Failed to set CSS variable value' });
        return null;
      }
      const saved = response.data;
      set(state => ({ graph: { ...state.graph, values: [
        ...state.graph.values.filter(v => !(v.css_variable_id === saved.css_variable_id && v.mode_id === saved.mode_id)), saved,
      ] }, error: null, ...bump(state) }));
      return saved;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to set CSS variable value' });
      return null;
    }
  },

  deleteValue: async (cssVariableId, modeId) => {
    try {
      const response = await cssVariablesApi.deleteValue(cssVariableId, modeId);
      if (response.error) {
        set({ error: response.error });
        return false;
      }
      set((state) => ({
        graph: {
          ...state.graph,
          values: state.graph.values.filter(
            (v) => !(v.css_variable_id === cssVariableId && v.mode_id === modeId)
          ),
        },
        ...bump(state),
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete CSS variable value';
      set({ error: message });
      return false;
    }
  },

  // ----- Selectors ----------------------------------------------------------

  getDefaultModeForSet: (setId) => {
    const modes = get().graph.modes.filter((m) => m.set_id === setId);
    return modes.find((m) => m.is_default) ?? modes.slice().sort((a, b) => a.sort_order - b.sort_order)[0];
  },

  getValue: (cssVariableId, modeId) => {
    const row = get().graph.values.find(
      (v) => v.css_variable_id === cssVariableId && v.mode_id === modeId
    );
    return row?.value ?? '';
  },

  getCssVariablesByType: (type) => {
    return get().graph.variables.filter((v) => v.type === type);
  },

  getCssVariableById: (id) => {
    return get().graph.variables.find((v) => v.id === id);
  },

  // ----- Preview + stylesheet ----------------------------------------------

  setPreviewOverride: (override) => {
    set((state) => ({ previewOverride: override, ...bump(state) }));
  },

  generateStylesheet: () => {
    const { graph, previewOverride } = get();
    if (graph.sets.length === 0 && !previewOverride) return '';

    if (!previewOverride) return buildCssVariablesStylesheet(graph);

    // Apply the preview override on top of the live graph
    const values = graph.values.map((v) =>
      v.css_variable_id === previewOverride.cssVariableId && v.mode_id === previewOverride.modeId
        ? { ...v, value: previewOverride.value }
        : v
    );
    const hasOverride = values.some(
      (v) => v.css_variable_id === previewOverride.cssVariableId && v.mode_id === previewOverride.modeId
    );
    if (!hasOverride) {
      values.push({
        css_variable_id: previewOverride.cssVariableId,
        mode_id: previewOverride.modeId,
        value: previewOverride.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return buildCssVariablesStylesheet({ ...graph, values });
  },
}));

type SortableGraphField = 'sets' | 'groups' | 'variables';
const pendingOrders = new Map<SortableGraphField, Promise<void>>();

/** Serialize saves and roll back ordering alone, preserving edits made in flight. */
async function persistGraphOrder(
  field: SortableGraphField,
  orderedIds: string[],
  persist: (ids: string[]) => Promise<{ error?: string; data?: { success: boolean } }>
): Promise<void> {
  const request = (pendingOrders.get(field) ?? Promise.resolve()).then(async () => {
    const before = useCssVariablesStore.getState().graph[field];
    const positions = new Map(orderedIds.map((id, index) => [id, index]));
    const previousOrder = new Map(before.filter(row => positions.has(row.id)).map(row => [row.id, row.sort_order]));
    useCssVariablesStore.setState(state => ({
      graph: { ...state.graph, [field]: state.graph[field].map(row => positions.has(row.id) ? { ...row, sort_order: positions.get(row.id)! } : row) },
      error: null,
      ...bump(state),
    }));
    try {
      const response = await persist(orderedIds);
      if (response.error || !response.data?.success) throw new Error(response.error ?? 'Failed to save list order');
    } catch (error) {
      useCssVariablesStore.setState(state => ({
        graph: { ...state.graph, [field]: state.graph[field].map(row => previousOrder.has(row.id) ? { ...row, sort_order: previousOrder.get(row.id)! } : row) },
        error: error instanceof Error ? error.message : 'Failed to save list order',
        ...bump(state),
      }));
    }
  });
  pendingOrders.set(field, request);
  await request.finally(() => {
    if (pendingOrders.get(field) === request) pendingOrders.delete(field);
  });
}
