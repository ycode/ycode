/**
 * Block Templates System
 *
 * Provides template definitions and helper functions for creating new layers
 */

import { Layer, LayerTemplate, LayerTemplateRef } from '@/types';
import { IconProps } from '@/components/ui/icon';
import { generateId, cloneDeep } from '@/lib/utils';
import { structureTemplates } from './structure';
import { contentTemplates } from './content';
import { actionTemplates } from './actions';
import { mediaTemplates } from './media';
import { formTemplates } from './forms';
import { authTemplates } from './auth';
import { utilityTemplates } from './utilities';
import { layoutTemplates } from './layouts';

// Merge all template categories
const blocks = {
  ...structureTemplates,
  ...contentTemplates,
  ...actionTemplates,
  ...mediaTemplates,
  ...formTemplates,
  ...authTemplates,
  ...utilityTemplates,
};

/**
 * Get a layer (with IDs) from a template
 */
export function getLayerFromTemplate(
  index: string,
  overrides?: Partial<Layer>
): Layer | null {
  const block = blocks[index as keyof typeof blocks];

  if (!block) return null;

  const template = cloneDeep(block.template);

  // Resolve any template references first
  const resolvedTemplate = resolveTemplateRefs(template);

  // Recursively assign IDs to all nested children
  const assignIds = (layer: Omit<Layer, 'id'>): Layer => {
    const layerWithId = { ...layer, id: generateId('lyr') } as Layer;

    if (layerWithId.children && Array.isArray(layerWithId.children)) {
      layerWithId.children = layerWithId.children.map((child) => assignIds(child as Omit<Layer, 'id'>)) as Layer[];
    }

    return layerWithId;
  };

  const templateWithIds = assignIds(resolvedTemplate as Omit<Layer, 'id'>);

  if (overrides && Object.keys(overrides).length > 0) {
    return { ...templateWithIds, ...overrides };
  }

  return templateWithIds;
}

/**
 * Create a lazy template reference (resolved later, not during initialization)
 * @param index - Template name to reference
 * @param overrides - Optional property overrides to apply to the referenced template
 */
export function getTemplateRef(index: string, overrides?: Partial<LayerTemplate>): LayerTemplateRef {
  return overrides ? { __ref: index, ...overrides } : { __ref: index };
}

/**
 * Resolve template references in a layer structure
 * Replaces { __ref: 'name', ...overrides } objects with actual templates and applies overrides
 */
function resolveTemplateRefs(obj: any): any {
  // Check if this is a template reference
  if (obj && typeof obj === 'object' && '__ref' in obj) {
    const { __ref: refName, ...overrides } = obj;
    const block = blocks[refName as keyof typeof blocks];

    if (!block) {
      console.warn(`Template reference "${refName}" not found`);
      return { name: 'div', classes: [], children: [] };
    }

    // Clone and resolve the referenced template (recursively resolves all children)
    const resolvedTemplate = resolveTemplateRefs(cloneDeep(block.template));

    // Apply overrides if any, and resolve any __ref in overrides too
    if (Object.keys(overrides).length > 0) {
      const resolvedOverrides: any = {};
      for (const key in overrides) {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          // Resolve any __ref in override values (especially important for children arrays)
          resolvedOverrides[key] = resolveTemplateRefs(overrides[key]);
        }
      }
      return { ...resolvedTemplate, ...resolvedOverrides };
    }

    return resolvedTemplate;
  }

  // If it's an array, resolve each item
  if (Array.isArray(obj)) {
    return obj.map(item => resolveTemplateRefs(item));
  }

  // If it's an object, resolve all properties
  if (obj && typeof obj === 'object') {
    const resolved: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        resolved[key] = resolveTemplateRefs(obj[key]);
      }
    }
    return resolved;
  }

  return obj;
}

/**
 * Get icon name for a block type
 */
export function getBlockIcon(
  key: string,
  defaultIcon: IconProps['name'] = 'box'
): IconProps['name'] {
  const block = blocks[key as keyof typeof blocks];
  return (block?.icon as IconProps['name']) || defaultIcon;
}

/**
 * Get display name for a block type
 */
export function getBlockName(index: string): string | null {
  const block = blocks[index as keyof typeof blocks];
  return block?.name || null;
}

/**
 * Get all blocks by category
 */
export function getBlocksByCategory(category: 'structure' | 'content' | 'actions' | 'media' | 'forms' | 'utilities') {
  switch (category) {
    case 'structure':
      return Object.keys(structureTemplates);
    case 'content':
      return Object.keys(contentTemplates);
    case 'actions':
      return Object.keys(actionTemplates);
    case 'media':
      return Object.keys(mediaTemplates);
    case 'forms':
      return Object.keys(formTemplates);
    case 'utilities':
      return Object.keys(utilityTemplates);
    default:
      return [];
  }
}

/**
 * Get all available block types
 */
export function getAllBlockTypes(): string[] {
  return Object.keys(blocks);
}

/**
 * Get layout template by key
 * Assigns new IDs to all layers and remaps interaction tween layer_id references
 * Handles duplicate layer IDs (e.g., multiple instances of same component) correctly
 * by processing each inlined component subtree independently
 */
export function getLayoutTemplate(key: string): Layer | null {
  const layout = layoutTemplates[key as keyof typeof layoutTemplates];
  if (!layout) return null;

  const template = cloneDeep(layout.template);

  // Resolve any template references first
  const resolvedTemplate = resolveTemplateRefs(template);

  /**
   * Process a subtree completely: assign new IDs and remap interactions
   * using a local idMap that's isolated to this subtree
   */
  const processSubtree = (layer: LayerTemplate): Layer => {
    const idMap = new Map<string, string>();
    
    // First pass: assign new IDs to all layers in this subtree
    const assignIds = (l: LayerTemplate): Layer => {
      const oldId = (l as any).id as string | undefined;
      const newId = generateId('lyr');

      if (oldId) {
        idMap.set(oldId, newId);
      }

      const layerWithId = { ...l, id: newId } as Layer;

      if (layerWithId.children && Array.isArray(layerWithId.children)) {
        layerWithId.children = layerWithId.children.map((child) => 
          assignIds(child as LayerTemplate)
        ) as Layer[];
      }

      return layerWithId;
    };

    const layerWithNewIds = assignIds(layer);

    // Second pass: remap interaction layer_id references
    const remapInteractions = (l: Layer): Layer => {
      let updatedLayer = l;

      if (l.interactions && l.interactions.length > 0) {
        updatedLayer = {
          ...updatedLayer,
          interactions: l.interactions.map(interaction => ({
            ...interaction,
            id: generateId('int'),
            tweens: interaction.tweens.map(tween => ({
              ...tween,
              id: generateId('twn'),
              layer_id: idMap.has(tween.layer_id)
                ? idMap.get(tween.layer_id)!
                : tween.layer_id,
            })),
          })),
        };
      }

      if (updatedLayer.children) {
        updatedLayer = {
          ...updatedLayer,
          children: updatedLayer.children.map(remapInteractions),
        };
      }

      return updatedLayer;
    };

    return remapInteractions(layerWithNewIds);
  };

  /**
   * Process the template, treating _inlinedComponentName subtrees as isolated units
   * to prevent ID collisions between multiple instances of the same component
   */
  const processTemplate = (layer: LayerTemplate): Layer => {
    const isInlinedComponent = (layer as any)._inlinedComponentName;
    
    if (isInlinedComponent) {
      // This is an inlined component - process its entire subtree with isolated idMap
      // First process this layer and its children as a unit
      const processed = processSubtree(layer);
      return processed;
    }

    // For regular layers, assign a new ID
    const oldId = (layer as any).id as string | undefined;
    const newId = generateId('lyr');
    
    let processedLayer = { ...layer, id: newId } as Layer;

    // Process children - each child may be an inlined component or regular layer
    if (processedLayer.children && Array.isArray(processedLayer.children)) {
      processedLayer.children = processedLayer.children.map((child) => 
        processTemplate(child as LayerTemplate)
      ) as Layer[];
    }

    // For regular layers with interactions, we need to handle them
    // Build a local idMap from this layer's subtree for interaction remapping
    if (processedLayer.interactions && processedLayer.interactions.length > 0) {
      // Collect all layer IDs in the current subtree (excluding already-processed inlined components)
      const collectIds = (l: Layer, map: Map<string, string>) => {
        if (oldId && l.id === newId) {
          map.set(oldId, newId);
        }
        // Don't recurse into inlined components - they have their own ID namespace
        if (!(l as any)._inlinedComponentName && l.children) {
          l.children.forEach(child => collectIds(child, map));
        }
      };
      
      const localIdMap = new Map<string, string>();
      if (oldId) localIdMap.set(oldId, newId);
      
      processedLayer = {
        ...processedLayer,
        interactions: processedLayer.interactions.map(interaction => ({
          ...interaction,
          id: generateId('int'),
          tweens: interaction.tweens.map(tween => ({
            ...tween,
            id: generateId('twn'),
            layer_id: localIdMap.has(tween.layer_id)
              ? localIdMap.get(tween.layer_id)!
              : tween.layer_id,
          })),
        })),
      };
    }

    return processedLayer;
  };

  return processTemplate(resolvedTemplate as LayerTemplate);
}

/**
 * Get layout icon
 * @deprecated Icons are no longer part of layout templates
 */
export function getLayoutIcon(key: string): IconProps['name'] {
  return 'box';
}

/**
 * Get layout name
 * @deprecated Names are no longer part of layout templates
 */
export function getLayoutName(key: string): string | null {
  return null;
}

/**
 * Get layout description
 * @deprecated Descriptions are no longer part of layout templates
 */
export function getLayoutDescription(key: string): string | undefined {
  return undefined;
}

/**
 * Get layout category
 */
export function getLayoutCategory(key: string): string | undefined {
  const layout = layoutTemplates[key as keyof typeof layoutTemplates];
  return layout?.category;
}

/**
 * Get layout preview image
 */
export function getLayoutPreviewImage(key: string): string | undefined {
  const layout = layoutTemplates[key as keyof typeof layoutTemplates];
  return layout?.previewImage;
}

/**
 * Get all layout keys
 */
export function getAllLayoutKeys(): string[] {
  return Object.keys(layoutTemplates);
}

/**
 * Category display order - categories not in this list appear at the end
 */
const CATEGORY_ORDER = [
  'Navigation',
  'Header',
  'Hero',
  'Features',
  'Content',
  'Blog header',
  'Blog posts',
  'Stats',
  'Team',
  'Testimonials',
  'Pricing',
  'FAQ',
  'CTA',
  'Footer',
  'Custom',
  'Other',
];

/**
 * Get layouts grouped by category
 */
export function getLayoutsByCategory(): Record<string, string[]> {
  const categories: Record<string, string[]> = {};

  Object.keys(layoutTemplates).forEach((key) => {
    const category = layoutTemplates[key as keyof typeof layoutTemplates].category || 'Other';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(key);
  });

  // Sort categories by defined order
  const sortedCategories: Record<string, string[]> = {};
  const categoryKeys = Object.keys(categories);

  // First add categories in the defined order
  CATEGORY_ORDER.forEach((cat) => {
    if (categories[cat]) {
      sortedCategories[cat] = categories[cat];
    }
  });

  // Then add any remaining categories not in the order list
  categoryKeys.forEach((cat) => {
    if (!sortedCategories[cat]) {
      sortedCategories[cat] = categories[cat];
    }
  });

  return sortedCategories;
}
