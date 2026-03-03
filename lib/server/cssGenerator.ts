/**
 * Server-Side CSS Generator using Tailwind CSS Node API
 *
 * Mirrors the client-side cssGenerator but runs on the server.
 * Used by the /ycode/api/css/generate endpoint so that MCP-created
 * layers (or any API-driven changes) get their CSS generated without
 * needing the browser editor open.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { compile } from 'tailwindcss';
import type { Layer, Component } from '@/types';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';
import { getAllDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { getAllComponents } from '@/lib/repositories/componentRepository';
import { setSetting } from '@/lib/repositories/settingsRepository';

/**
 * Extract all Tailwind classes from a layer tree.
 * Replicates the client-side extractClassesFromLayers logic.
 */
function extractClassesFromLayers(layers: Layer[]): Set<string> {
  const classes = new Set<string>();
  const processedComponentIds = new Set<string>();

  const extractClasses = (classValue: string | string[] | undefined) => {
    if (!classValue) return;

    if (Array.isArray(classValue)) {
      classValue.forEach(cls => {
        if (cls && typeof cls === 'string') {
          cls.split(/\s+/).forEach(c => c.trim() && classes.add(c.trim()));
        }
      });
    } else if (typeof classValue === 'string') {
      classValue.split(/\s+/).forEach(cls => cls.trim() && classes.add(cls.trim()));
    }
  };

  function processLayer(layer: Layer): void {
    if (layer.settings?.hidden) return;

    if (layer.componentId) {
      if (processedComponentIds.has(layer.componentId)) return;
      processedComponentIds.add(layer.componentId);
    }

    extractClasses(layer.classes);

    if (layer.textStyles) {
      Object.values(layer.textStyles).forEach((style: { classes?: string | string[] }) => {
        extractClasses(style.classes);
      });
    }

    if (layer.variables?.text) {
      Object.values(DEFAULT_TEXT_STYLES).forEach(style => {
        extractClasses(style.classes);
      });
    }

    if (layer.children && Array.isArray(layer.children)) {
      layer.children.forEach(child => processLayer(child));
    }
  }

  layers.forEach(layer => processLayer(layer));
  return classes;
}

let compilerCache: { build: (candidates: string[]) => string } | null = null;

/**
 * Get or create a cached Tailwind compiler instance.
 * The compiler only needs to be created once since we always
 * use the same Tailwind config (the default).
 */
async function getCompiler() {
  if (compilerCache) return compilerCache;

  const twPath = join(process.cwd(), 'node_modules/tailwindcss/index.css');
  const input = await readFile(twPath, 'utf-8');

  compilerCache = await compile(input, {
    base: process.cwd(),
    async loadStylesheet(id: string, base: string) {
      const fullPath = join(dirname(base), id);
      const content = await readFile(fullPath, 'utf-8');
      return { path: fullPath, content, base: dirname(fullPath) };
    },
  });

  return compilerCache;
}

/**
 * Generate CSS from an array of Tailwind class names.
 */
async function compileCss(classNames: string[]): Promise<string> {
  if (classNames.length === 0) return '/* No classes to generate */';
  const compiler = await getCompiler();
  return compiler.build(classNames);
}

/**
 * Generate CSS from all draft layers and component layers,
 * then save it to the draft_css setting.
 *
 * This is the server-side equivalent of the client's generateAndSaveCSS.
 */
export async function generateAndSaveDraftCSS(): Promise<string> {
  const allLayers: Layer[] = [];

  const draftPageLayers = await getAllDraftLayers();
  for (const pl of draftPageLayers) {
    if (pl.layers && Array.isArray(pl.layers)) {
      allLayers.push(...pl.layers);
    }
  }

  const components: Component[] = await getAllComponents(false);
  for (const component of components) {
    if (component.layers && Array.isArray(component.layers)) {
      allLayers.push(...component.layers);
    }
  }

  const classes = extractClassesFromLayers(allLayers);
  const classNames = Array.from(classes);
  const css = await compileCss(classNames);

  await setSetting('draft_css', css);

  return css;
}
