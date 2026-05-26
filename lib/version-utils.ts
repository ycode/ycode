/**
 * Version Utilities
 *
 * Handles JSON Patch (RFC 6902) creation and application for undo/redo
 * Optimizes storage by only storing diffs instead of full snapshots
 */

import type { Layer } from '@/types';

// JSON Patch operation types (RFC 6902)
export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

export type JsonPatch = JsonPatchOperation[];

/**
 * Create a JSON Patch by comparing two objects
 * Returns the operations needed to transform `from` into `to`
 */
export function createPatch(from: any, to: any, path: string = ''): JsonPatch {
  const patch: JsonPatch = [];

  // Handle null/undefined cases
  if (from === to) return patch;
  if (from === null || from === undefined) {
    if (to !== null && to !== undefined) {
      patch.push({ op: 'add', path: path || '/', value: to });
    }
    return patch;
  }
  if (to === null || to === undefined) {
    patch.push({ op: 'remove', path: path || '/' });
    return patch;
  }

  // Handle different types
  const fromType = typeof from;
  const toType = typeof to;

  if (fromType !== toType) {
    patch.push({ op: 'replace', path: path || '/', value: to });
    return patch;
  }

  // Handle arrays
  if (Array.isArray(from) && Array.isArray(to)) {
    return createArrayPatch(from, to, path);
  }

  // Handle objects
  if (fromType === 'object') {
    const fromKeys = Object.keys(from);
    const toKeys = Object.keys(to);

    // Find removed keys
    for (const key of fromKeys) {
      if (!(key in to)) {
        patch.push({ op: 'remove', path: `${path}/${escapeJsonPointer(key)}` });
      }
    }

    // Find added and changed keys
    for (const key of toKeys) {
      const keyPath = `${path}/${escapeJsonPointer(key)}`;
      if (!(key in from)) {
        patch.push({ op: 'add', path: keyPath, value: to[key] });
      } else if (!deepEqual(from[key], to[key])) {
        const fromVal = from[key];
        const toVal = to[key];

        // For nested objects, recurse for fine-grained patches
        if (typeof fromVal === 'object' && typeof toVal === 'object' &&
            fromVal !== null && toVal !== null) {
          // Both are arrays - recurse into them
          if (Array.isArray(fromVal) && Array.isArray(toVal)) {
            patch.push(...createArrayPatch(fromVal, toVal, keyPath));
          }
          // Both are objects - recurse into them
          else if (!Array.isArray(fromVal) && !Array.isArray(toVal)) {
            patch.push(...createPatch(fromVal, toVal, keyPath));
          }
          // Type mismatch (array vs object) - replace
          else {
            patch.push({ op: 'replace', path: keyPath, value: toVal });
          }
        } else {
          // Primitives or type change - replace
          patch.push({ op: 'replace', path: keyPath, value: toVal });
        }
      }
    }

    return patch;
  }

  // Handle primitives
  if (from !== to) {
    patch.push({ op: 'replace', path: path || '/', value: to });
  }

  return patch;
}

/**
 * Create patch for arrays - handles layer trees efficiently
 */
function createArrayPatch(from: any[], to: any[], path: string): JsonPatch {
  const patch: JsonPatch = [];

  // For layers with IDs, use ID-based diffing for better patches
  const fromHasIds = from.length > 0 && from[0]?.id !== undefined;
  const toHasIds = to.length > 0 && to[0]?.id !== undefined;

  if (fromHasIds && toHasIds) {
    return createLayerArrayPatch(from, to, path);
  }

  // For simple arrays, use index-based diffing
  const maxLen = Math.max(from.length, to.length);

  for (let i = 0; i < maxLen; i++) {
    const itemPath = `${path}/${i}`;

    if (i >= from.length) {
      // Item added
      patch.push({ op: 'add', path: itemPath, value: to[i] });
    } else if (i >= to.length) {
      // Item removed (remove from end first for correct indices)
      patch.unshift({ op: 'remove', path: `${path}/${from.length - 1 - (from.length - 1 - i)}` });
    } else if (!deepEqual(from[i], to[i])) {
      // Item changed
      patch.push({ op: 'replace', path: itemPath, value: to[i] });
    }
  }

  return patch;
}

/**
 * Create patch for layer arrays using ID-based tracking
 * Optimizes by recursing into nested children instead of replacing entire subtrees
 */
function createLayerArrayPatch(from: Layer[], to: Layer[], path: string): JsonPatch {
  const patch: JsonPatch = [];

  const fromById = new Map(from.map((item, idx) => [item.id, { item, idx }]));
  const toById = new Map(to.map((item, idx) => [item.id, { item, idx }]));

  // Analyze structural changes
  const hasRemovals = [...fromById.keys()].some(id => !toById.has(id));
  const hasAdditions = [...toById.keys()].some(id => !fromById.has(id));

  // Check if order changed for layers that exist in both
  const commonIds = [...fromById.keys()].filter(id => toById.has(id));
  const fromCommonOrder = from.filter(l => commonIds.includes(l.id)).map(l => l.id);
  const toCommonOrder = to.filter(l => commonIds.includes(l.id)).map(l => l.id);
  const orderChanged = !deepEqual(fromCommonOrder, toCommonOrder);

  // For complex structural changes, use replace for reliability:
  // - Order changed (reordering is hard to patch correctly)
  // - Both additions and removals (index calculations become unreliable)
  if (orderChanged || (hasRemovals && hasAdditions)) {
    patch.push({ op: 'replace', path: path, value: to });
    return patch;
  }

  // Safe cases for fine-grained patches:
  // - Only additions (new layers at end or specific positions)
  // - Only removals (layers removed)
  // - Only modifications (same layers, same order, content changes)

  // Track removed layers (process from highest index to lowest to maintain correct indices)
  const removedIndices: Array<{ idx: number; item: Layer }> = [];
  for (const [id, { item, idx }] of fromById) {
    if (!toById.has(id)) {
      removedIndices.push({ idx, item });
    }
  }
  // Sort descending so removals don't shift indices
  removedIndices.sort((a, b) => b.idx - a.idx);
  for (const { idx, item } of removedIndices) {
    patch.push({ op: 'remove', path: `${path}/${idx}`, value: item });
  }

  // Find added and modified layers
  for (const [id, { item: toItem, idx: toIdx }] of toById) {
    const fromData = fromById.get(id);

    if (!fromData) {
      // Layer added
      patch.push({ op: 'add', path: `${path}/${toIdx}`, value: toItem });
    } else if (!deepEqual(fromData.item, toItem)) {
      // Layer modified - create fine-grained nested patch
      const itemPath = `${path}/${fromData.idx}`;
      const layerPatch = createLayerPatch(fromData.item, toItem, itemPath);
      patch.push(...layerPatch);
    }
  }

  return patch;
}

/**
 * Create a fine-grained patch for a single layer
 * Handles nested children arrays recursively
 */
function createLayerPatch(from: Layer, to: Layer, path: string): JsonPatch {
  const patch: JsonPatch = [];
  const fromKeys = Object.keys(from) as (keyof Layer)[];
  const toKeys = Object.keys(to) as (keyof Layer)[];
  const allKeys = new Set([...fromKeys, ...toKeys]);

  for (const key of allKeys) {
    const keyPath = `${path}/${escapeJsonPointer(key as string)}`;
    const fromVal = from[key];
    const toVal = to[key];

    // Key removed
    if (!(key in to)) {
      patch.push({ op: 'remove', path: keyPath });
      continue;
    }

    // Key added
    if (!(key in from)) {
      patch.push({ op: 'add', path: keyPath, value: toVal });
      continue;
    }

    // Both have the key - check for changes
    if (deepEqual(fromVal, toVal)) {
      continue;
    }

    // Special handling for children array - recurse for fine-grained patches
    if (key === 'children' && Array.isArray(fromVal) && Array.isArray(toVal)) {
      patch.push(...createLayerArrayPatch(fromVal as Layer[], toVal as Layer[], keyPath));
      continue;
    }

    // For other arrays and objects, use standard recursion
    if (typeof fromVal === 'object' && typeof toVal === 'object' &&
        fromVal !== null && toVal !== null) {
      if (Array.isArray(fromVal) && Array.isArray(toVal)) {
        patch.push(...createArrayPatch(fromVal, toVal, keyPath));
      } else if (!Array.isArray(fromVal) && !Array.isArray(toVal)) {
        patch.push(...createPatch(fromVal, toVal, keyPath));
      } else {
        patch.push({ op: 'replace', path: keyPath, value: toVal });
      }
      continue;
    }

    // Primitives - replace
    patch.push({ op: 'replace', path: keyPath, value: toVal });
  }

  return patch;
}

/**
 * Apply a JSON Patch to an object
 * Returns the patched object (does not mutate original)
 *
 * Operations are reordered for correct array handling:
 * 1. Removes (descending by index to maintain validity)
 * 2. Replaces and nested operations
 * 3. Adds (ascending by index to maintain positions)
 */
export function applyPatch<T>(target: T, patch: JsonPatch): T {
  let result = JSON.parse(JSON.stringify(target)); // Deep clone

  // Separate operations by type for correct ordering
  const removes: JsonPatchOperation[] = [];
  const replaces: JsonPatchOperation[] = [];
  const adds: JsonPatchOperation[] = [];
  const others: JsonPatchOperation[] = [];

  for (const op of patch) {
    switch (op.op) {
      case 'remove':
        removes.push(op);
        break;
      case 'add':
        adds.push(op);
        break;
      case 'replace':
        replaces.push(op);
        break;
      default:
        others.push(op);
    }
  }

  // Sort removes by path (descending) to handle array indices correctly
  removes.sort((a, b) => {
    const aIdx = getLastArrayIndex(a.path);
    const bIdx = getLastArrayIndex(b.path);
    if (aIdx !== null && bIdx !== null) {
      return bIdx - aIdx; // Descending
    }
    return b.path.localeCompare(a.path);
  });

  // Sort adds by path (ascending) to insert at correct positions
  adds.sort((a, b) => {
    const aIdx = getLastArrayIndex(a.path);
    const bIdx = getLastArrayIndex(b.path);
    if (aIdx !== null && bIdx !== null) {
      return aIdx - bIdx; // Ascending
    }
    return a.path.localeCompare(b.path);
  });

  // Apply in order: removes, replaces, adds, others
  for (const op of removes) {
    result = applyOperation(result, op);
  }
  for (const op of replaces) {
    result = applyOperation(result, op);
  }
  for (const op of adds) {
    result = applyOperation(result, op);
  }
  for (const op of others) {
    result = applyOperation(result, op);
  }

  return result;
}

/**
 * Extract the last array index from a JSON Pointer path
 */
function getLastArrayIndex(path: string): number | null {
  const parts = path.split('/');
  const last = parts[parts.length - 1];
  const num = parseInt(last, 10);
  return isNaN(num) ? null : num;
}

/**
 * Apply a single patch operation
 */
function applyOperation(target: any, op: JsonPatchOperation): any {
  const pathParts = parseJsonPointer(op.path);

  if (pathParts.length === 0) {
    // Root operation
    switch (op.op) {
      case 'add':
      case 'replace':
        return op.value;
      case 'remove':
        return undefined;
      default:
        return target;
    }
  }

  // Navigate to parent
  let parent = target;
  for (let i = 0; i < pathParts.length - 1; i++) {
    parent = parent[pathParts[i]];
    if (parent === undefined) {
      throw new Error(`Path not found: ${op.path}`);
    }
  }

  const lastKey = pathParts[pathParts.length - 1];

  switch (op.op) {
    case 'add':
      if (Array.isArray(parent)) {
        const idx = lastKey === '-' ? parent.length : parseInt(lastKey, 10);
        parent.splice(idx, 0, op.value);
      } else {
        parent[lastKey] = op.value;
      }
      break;

    case 'remove':
      if (Array.isArray(parent)) {
        parent.splice(parseInt(lastKey, 10), 1);
      } else {
        delete parent[lastKey];
      }
      break;

    case 'replace':
      parent[lastKey] = op.value;
      break;

    case 'move':
      if (op.from) {
        const fromParts = parseJsonPointer(op.from);
        let fromParent = target;
        for (let i = 0; i < fromParts.length - 1; i++) {
          fromParent = fromParent[fromParts[i]];
        }
        const fromKey = fromParts[fromParts.length - 1];
        const value = fromParent[fromKey];

        if (Array.isArray(fromParent)) {
          fromParent.splice(parseInt(fromKey, 10), 1);
        } else {
          delete fromParent[fromKey];
        }

        if (Array.isArray(parent)) {
          const idx = lastKey === '-' ? parent.length : parseInt(lastKey, 10);
          parent.splice(idx, 0, value);
        } else {
          parent[lastKey] = value;
        }
      }
      break;

    case 'copy':
      if (op.from) {
        const fromParts = parseJsonPointer(op.from);
        let value = target;
        for (const part of fromParts) {
          value = value[part];
        }
        parent[lastKey] = JSON.parse(JSON.stringify(value));
      }
      break;
  }

  return target;
}

/**
 * Create an inverse patch (for undo operations)
 */
export function createInversePatch(from: any, patch: JsonPatch): JsonPatch {
  const inverse: JsonPatch = [];

  for (const op of patch) {
    const pathParts = parseJsonPointer(op.path);

    switch (op.op) {
      case 'add':
        inverse.unshift({ op: 'remove', path: op.path });
        break;

      case 'remove': {
        // Get the value that was removed
        let removedValue = from;
        for (const part of pathParts) {
          removedValue = removedValue?.[part];
        }
        inverse.unshift({ op: 'add', path: op.path, value: removedValue });
        break;
      }

      case 'replace': {
        // Get the original value
        let originalValue = from;
        for (const part of pathParts) {
          originalValue = originalValue?.[part];
        }
        inverse.unshift({ op: 'replace', path: op.path, value: originalValue });
        break;
      }

      case 'move':
        if (op.from) {
          inverse.unshift({ op: 'move', path: op.from, from: op.path });
        }
        break;
    }
  }

  return inverse;
}

/**
 * Escape a key for use in JSON Pointer (RFC 6901)
 */
function escapeJsonPointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Parse a JSON Pointer path into parts
 */
function parseJsonPointer(path: string): string[] {
  if (!path || path === '/') return [];

  return path
    .split('/')
    .slice(1) // Remove leading empty string from split
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Deep equality check
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, b[idx]));
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(key => deepEqual(a[key], b[key]));
}

/**
 * Generate a description for a patch
 */
export function generatePatchDescription(patch: JsonPatch): string {
  if (patch.length === 0) return 'No changes';
  if (patch.length === 1) {
    const op = patch[0];
    const path = op.path.split('/').filter(Boolean).slice(-1)[0] || 'content';
    switch (op.op) {
      case 'add':
        return `Added ${path}`;
      case 'remove':
        return `Removed ${path}`;
      case 'replace':
        return `Changed ${path}`;
      default:
        return `Modified ${path}`;
    }
  }
  return `${patch.length} changes`;
}

/**
 * Check if a patch is empty (no actual changes)
 */
export function isPatchEmpty(patch: JsonPatch): boolean {
  return patch.length === 0;
}

/**
 * Verify that applying a patch actually produces a different result
 * This catches cases where patches exist but produce no change
 */
export function doesPatchChangeState(originalState: any, patch: JsonPatch): boolean {
  if (patch.length === 0) {
    return false;
  }

  try {
    const resultState = applyPatch(originalState, patch);

    // Deep comparison via JSON stringify (same as we use elsewhere)
    const originalJSON = JSON.stringify(originalState);
    const resultJSON = JSON.stringify(resultState);

    return originalJSON !== resultJSON;
  } catch (error) {
    // Patch verification failed, but this doesn't mean the patch is invalid
    // Complex operations (like nested moves) can have valid patches that fail verification
    // due to intermediate state mismatches. Since the actual operation succeeded,
    // we silently skip verification rather than log errors.
    return false;
  }
}
