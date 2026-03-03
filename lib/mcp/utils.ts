/**
 * Self-contained layer tree utilities for the embedded MCP server.
 * These are simplified versions focused on the MCP tool use case.
 */

import type { Layer, DesignProperties } from '@/types';
import { generateId } from '@/lib/utils';
import { designToClassString } from '@/lib/tailwind-class-mapper';

export { generateId } from '@/lib/utils';
export { designToClassString } from '@/lib/tailwind-class-mapper';

export function findLayerById(layers: Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.children) {
      const found = findLayerById(layer.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateLayerById(
  layers: Layer[],
  id: string,
  updater: (layer: Layer) => Layer,
): Layer[] {
  return layers.map((layer) => {
    if (layer.id === id) return updater(layer);
    if (layer.children) {
      return { ...layer, children: updateLayerById(layer.children, id, updater) };
    }
    return layer;
  });
}

export function insertLayer(
  layers: Layer[],
  parentId: string,
  child: Layer,
  position?: number,
): Layer[] {
  return layers.map((layer) => {
    if (layer.id === parentId) {
      const children = [...(layer.children || [])];
      const idx = position !== undefined
        ? Math.min(position, children.length)
        : children.length;
      children.splice(idx, 0, child);
      return { ...layer, children };
    }
    if (layer.children) {
      return { ...layer, children: insertLayer(layer.children, parentId, child, position) };
    }
    return layer;
  });
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers
    .filter((layer) => layer.id !== id)
    .map((layer) => {
      if (layer.children) {
        return { ...layer, children: removeLayer(layer.children, id) };
      }
      return layer;
    });
}

export function moveLayer(
  layers: Layer[],
  layerId: string,
  newParentId: string,
  position?: number,
): Layer[] {
  const layer = findLayerById(layers, layerId);
  if (!layer) return layers;
  const withoutLayer = removeLayer(layers, layerId);
  return insertLayer(withoutLayer, newParentId, layer, position);
}

const LEAF_ELEMENTS = new Set([
  'icon', 'image', 'audio', 'video', 'iframe',
  'text', 'span', 'label', 'hr',
  'input', 'textarea', 'select', 'checkbox', 'radio',
  'htmlEmbed',
]);

export function canHaveChildren(layer: Layer): boolean {
  if (layer.componentId) return false;
  return !LEAF_ELEMENTS.has(layer.name);
}

export interface TiptapDoc {
  type: 'doc';
  content: Array<{ type: 'paragraph'; content: Array<{ type: 'text'; text: string }> }>;
}

export function getTiptapTextContent(text: string): TiptapDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
}

export function applyDesignToLayer(
  layer: Layer,
  design: Record<string, Record<string, unknown>>,
): Layer {
  const mergedDesign: DesignProperties = { ...layer.design };

  for (const [cat, props] of Object.entries(design)) {
    if (props && typeof props === 'object') {
      mergedDesign[cat as keyof DesignProperties] = {
        ...(mergedDesign[cat as keyof DesignProperties] || {}),
        ...props,
      } as DesignProperties[keyof DesignProperties];
    }
  }

  const classes = designToClassString(mergedDesign);
  return { ...layer, design: mergedDesign, classes };
}

// ── Element Templates ────────────────────────────────────────────────────────

function textLayerTemplate(
  text: string,
  tag: string,
  design: DesignProperties,
  classes: string | string[],
): Omit<Layer, 'id'> {
  return {
    name: 'text',
    settings: { tag },
    classes,
    restrictions: { editText: true },
    design,
    variables: {
      text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(text) } },
    },
  };
}

export const ELEMENT_TEMPLATES: Record<string, { name: string; description: string; template: Omit<Layer, 'id'> }> = {
  div: {
    name: 'Block',
    description: 'Generic container element (div)',
    template: {
      name: 'div',
      classes: ['flex', 'flex-col'],
      children: [],
      design: { layout: { isActive: true, display: 'Flex', flexDirection: 'column' } },
    },
  },
  section: {
    name: 'Section',
    description: 'Full-width section wrapper',
    template: {
      name: 'section',
      classes: ['flex', 'flex-col', 'w-[100%]', 'pt-[80px]', 'pb-[80px]', 'items-center'],
      children: [],
      design: {
        layout: { isActive: true, display: 'Flex', flexDirection: 'column', alignItems: 'center' },
        sizing: { isActive: true, width: '100%' },
        spacing: { isActive: true, paddingTop: '80px', paddingBottom: '80px' },
      },
    },
  },
  container: {
    name: 'Container',
    description: 'Max-width container (1280px)',
    template: {
      name: 'div',
      classes: ['flex', 'flex-col', 'max-w-[1280px]', 'w-[100%]', 'pl-[32px]', 'pr-[32px]'],
      children: [],
      design: {
        layout: { isActive: true, display: 'Flex', flexDirection: 'column' },
        sizing: { isActive: true, width: '100%', maxWidth: '1280px' },
        spacing: { isActive: true, paddingLeft: '32px', paddingRight: '32px' },
      },
    },
  },
  hr: {
    name: 'Separator',
    description: 'Horizontal rule / divider',
    template: {
      name: 'hr',
      classes: ['border-t', 'border-[#d1d5db]'],
      design: { borders: { isActive: true, borderWidth: '1px 0 0 0', borderColor: '#d1d5db' } },
    },
  },
  heading: {
    name: 'Heading',
    description: 'Large heading text (h1)',
    template: textLayerTemplate('Heading', 'h1', {
      typography: { isActive: true, fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.01' },
    }, ['text-[48px]', 'font-[700]', 'leading-[1.1]', 'tracking-[-0.01em]']),
  },
  text: {
    name: 'Text',
    description: 'Paragraph text',
    template: textLayerTemplate('Text', 'p', {
      typography: { isActive: true, fontSize: '16px' },
    }, ['text-[16px]']),
  },
  image: {
    name: 'Image',
    description: 'Image element',
    template: {
      name: 'image',
      settings: { tag: 'img' },
      classes: ['w-[100%]', 'object-cover'],
      attributes: { loading: 'lazy' },
      design: { sizing: { isActive: true, width: '100%', objectFit: 'cover' } },
      variables: {
        image: {
          src: { type: 'asset', data: { asset_id: null } },
          alt: { type: 'dynamic_text', data: { content: 'Image description' } },
        },
      },
    },
  },
  icon: {
    name: 'Icon',
    description: 'SVG icon element',
    template: {
      name: 'icon',
      classes: ['w-[24px]', 'h-[24px]'],
      settings: { tag: 'div' },
      design: { sizing: { isActive: true, width: '24px', height: '24px' } },
      variables: { icon: { src: { type: 'asset', data: { asset_id: null } } } },
    },
  },
  video: {
    name: 'Video',
    description: 'Video element',
    template: {
      name: 'video',
      classes: ['w-full', 'h-auto', 'aspect-[16/9]', 'overflow-hidden'],
      attributes: { controls: true, preload: 'metadata' },
      design: { sizing: { isActive: true, width: '100%', height: 'auto', aspectRatio: '16/9' } },
      variables: { video: { src: { type: 'asset', data: { asset_id: null } } } },
    },
  },
  audio: {
    name: 'Audio',
    description: 'Audio player element',
    template: {
      name: 'audio',
      classes: [],
      attributes: { controls: true, preload: 'metadata' },
      variables: { audio: { src: { type: 'asset', data: { asset_id: null } } } },
    },
  },
  button: {
    name: 'Button',
    description: 'Button element with text',
    template: {
      name: 'button',
      classes: [
        'flex', 'flex-row', 'items-center', 'justify-center',
        'text-[#FFFFFF]', 'pr-[16px]', 'pl-[16px]', 'pt-[8px]', 'pb-[8px]',
        'text-[14px]', 'rounded-[12px]', 'bg-[#171717]',
      ],
      attributes: { type: 'button' },
      design: {
        typography: { isActive: true, color: '#ffffff', fontSize: '16px' },
        spacing: { isActive: true, paddingLeft: '16px', paddingRight: '16px', paddingTop: '8px', paddingBottom: '8px' },
        backgrounds: { backgroundColor: '#171717', isActive: true },
      },
      children: [],
    },
  },
  form: {
    name: 'Form',
    description: 'Form container',
    template: {
      name: 'form',
      classes: ['flex', 'flex-col', 'gap-8', 'w-full'],
      settings: { id: 'contact-form' },
      attributes: { method: 'POST', action: '' },
      design: {
        sizing: { isActive: true, width: '100%' },
        layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '2rem' },
      },
      children: [],
    },
  },
  input: {
    name: 'Input',
    description: 'Text input with label',
    template: {
      name: 'div',
      classes: ['w-full', 'flex', 'flex-col', 'gap-1'],
      design: {
        sizing: { isActive: true, width: '100%' },
        layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '0.25rem' },
      },
      children: [],
    },
  },
  textarea: {
    name: 'Textarea',
    description: 'Multi-line text area',
    template: {
      name: 'div',
      classes: ['w-full', 'flex', 'flex-col', 'gap-1'],
      design: {
        sizing: { isActive: true, width: '100%' },
        layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '0.25rem' },
      },
      children: [],
    },
  },
  htmlEmbed: {
    name: 'Code Embed',
    description: 'Custom HTML/CSS/JS embed',
    template: {
      name: 'htmlEmbed',
      classes: ['w-full'],
      settings: { tag: 'div', htmlEmbed: { code: '<div>Custom HTML here</div>' } },
      design: { sizing: { isActive: true, width: '100%' } },
    },
  },
  iframe: {
    name: 'Embed',
    description: 'Iframe embed',
    template: {
      name: 'iframe',
      classes: ['w-full', 'h-[400px]'],
      design: { sizing: { isActive: true, width: '100%', height: '400px' } },
      variables: { iframe: { src: { type: 'dynamic_text', data: { content: '' } } } },
    },
  },
};

export function createLayerFromTemplate(
  templateKey: string,
  overrides?: { customName?: string; textContent?: string },
): Layer | null {
  const entry = ELEMENT_TEMPLATES[templateKey];
  if (!entry) return null;

  const assignIds = (layerData: Omit<Layer, 'id'> & { id?: string }): Layer => {
    const layer = { ...layerData, id: generateId('lyr') } as Layer;
    if (Array.isArray(layer.children)) {
      layer.children = layer.children.map((child) => assignIds(child));
    }
    return layer;
  };

  const layer = assignIds({ ...entry.template });

  if (overrides?.customName) {
    layer.customName = overrides.customName;
  }

  if (overrides?.textContent && layer.name === 'text') {
    layer.variables = {
      ...layer.variables,
      text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(overrides.textContent) } },
    };
  }

  if (templateKey === 'button') {
    const buttonText = overrides?.textContent || 'Button';
    const textChild = assignIds({
      name: 'text',
      settings: { tag: 'span' },
      classes: [],
      design: {},
      restrictions: { editText: true },
      variables: {
        text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(buttonText) } },
      },
    } as Omit<Layer, 'id'>);
    layer.children = [textChild];
  }

  return layer;
}
