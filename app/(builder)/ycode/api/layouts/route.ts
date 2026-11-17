import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { getAssetsByIds } from '@/lib/repositories/assetRepository';
import { getComponentsByIds } from '@/lib/repositories/componentRepository';
import { getDraftLayers, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import type { Asset, Layer } from '@/types';
import { collectComponentIds } from '@/lib/component-utils';
import {
  LAYOUT_PREVIEWS_DIR,
  getLayoutPreviewExtension,
  getLayoutPreviewPath,
  isLayoutsApiEnabled,
  isValidLayoutKey,
  toTsObjectLiteral,
  toTsStringLiteral,
} from '@/lib/layout-file-utils';

const LAYOUTS_FILE_PATH = path.join(process.cwd(), 'lib', 'templates', 'layouts.ts');
const LAYOUT_ASSETS_DIR = path.join(process.cwd(), 'public', 'ycode', 'layouts', 'assets');

/**
 * Collect all asset IDs from icon layers in the template
 */
function collectIconAssetIds(layer: Layer): string[] {
  const assetIds: string[] = [];

  // Check if this layer has an icon with asset reference
  if (layer.name === 'icon' && layer.variables?.icon?.src) {
    const iconSrc = layer.variables.icon.src as { type: string; data?: { asset_id?: string } };
    if (iconSrc.type === 'asset' && iconSrc.data?.asset_id) {
      assetIds.push(iconSrc.data.asset_id);
    }
  }

  // Recursively check children
  if (layer.children) {
    for (const child of layer.children) {
      assetIds.push(...collectIconAssetIds(child));
    }
  }

  return assetIds;
}

/**
 * Replace asset references with inline SVG content for portability
 * This makes layouts work across different projects/databases
 */
function inlineIconAssets(layer: Layer, assetsMap: Record<string, { content?: string | null }>): Layer {
  const newLayer = { ...layer };

  // If this is an icon layer with asset reference, convert to static_text with inline content
  if (newLayer.name === 'icon' && newLayer.variables?.icon?.src) {
    const iconSrc = newLayer.variables.icon.src as { type: string; data?: { asset_id?: string } };
    if (iconSrc.type === 'asset' && iconSrc.data?.asset_id) {
      const asset = assetsMap[iconSrc.data.asset_id];
      if (asset?.content) {
        // Convert to static_text with inline SVG
        newLayer.variables = {
          ...newLayer.variables,
          icon: {
            ...newLayer.variables.icon,
            src: {
              type: 'static_text',
              data: { content: asset.content },
            },
          },
        };
      }
    }
  }

  // Recursively process children
  if (newLayer.children) {
    newLayer.children = newLayer.children.map(child => inlineIconAssets(child, assetsMap));
  }

  return newLayer;
}

/**
 * Replace component instances with inlined component layers for portability.
 * Stores the component name and variables in _inlinedComponentName and _inlinedComponentVariables
 * so it can be recreated as a component when the layout is used in another project.
 */
function inlineComponents(
  layer: Layer,
  componentsMap: Record<string, { name: string; layers: Layer[]; variables?: any[] }>
): Layer {
  const newLayer = { ...layer };

  // If this is a component instance, inline its layers
  if (newLayer.componentId) {
    const component = componentsMap[newLayer.componentId];
    if (component && component.layers?.length > 0) {
      // Store the component name for recreation later
      (newLayer as any)._inlinedComponentName = component.name;
      // Store component variables if they exist
      if (component.variables?.length) {
        (newLayer as any)._inlinedComponentVariables = component.variables;
      }
      // Remove the componentId (it won't be valid in other projects)
      delete newLayer.componentId;
      // Set the component's layers as children (deep copy and process recursively)
      newLayer.children = component.layers.map(child =>
        inlineComponents({ ...child }, componentsMap)
      );
    }
  }

  // Recursively process existing children (non-component layers)
  if (newLayer.children && !newLayer.componentId) {
    newLayer.children = newLayer.children.map(child => inlineComponents(child, componentsMap));
  }

  return newLayer;
}

/**
 * Collect all media asset IDs (image, video, audio, backgroundImage) from a layer tree.
 * Icon assets are handled separately by collectIconAssetIds/inlineIconAssets.
 */
function collectMediaAssetIds(layer: Layer): string[] {
  const assetIds: string[] = [];

  const checkVar = (variable: any) => {
    if (variable?.type === 'asset' && variable?.data?.asset_id) {
      assetIds.push(variable.data.asset_id);
    }
  };

  checkVar(layer.variables?.image?.src);
  checkVar(layer.variables?.video?.src);
  checkVar(layer.variables?.video?.poster);
  checkVar(layer.variables?.audio?.src);
  checkVar(layer.variables?.backgroundImage?.src);

  if (layer.children) {
    for (const child of layer.children) {
      assetIds.push(...collectMediaAssetIds(child));
    }
  }

  return assetIds;
}

/**
 * Build a hash→filename map of all existing files in the assets directory.
 */
async function buildExistingAssetsHashMap(): Promise<Record<string, string>> {
  const hashMap: Record<string, string> = {};

  try {
    const files = await fs.readdir(LAYOUT_ASSETS_DIR);
    for (const filename of files) {
      const filePath = path.join(LAYOUT_ASSETS_DIR, filename);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const content = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      hashMap[hash] = filename;
    }
  } catch {
    // Directory doesn't exist yet
  }

  return hashMap;
}

/**
 * Download assets from their public URLs, convert raster images to webp,
 * and save them to /public/ycode/layouts/assets/.
 * Skips files that already exist with identical content (matched by hash).
 * Returns a map of asset_id → local URL path.
 */
async function downloadAndLocalizeAssets(
  assetIds: string[],
  assetsMap: Record<string, Asset>
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(assetIds)];
  const localUrlMap: Record<string, string> = {};

  await fs.mkdir(LAYOUT_ASSETS_DIR, { recursive: true });
  const existingHashes = await buildExistingAssetsHashMap();

  for (const assetId of uniqueIds) {
    const asset = assetsMap[assetId];
    if (!asset?.public_url) continue;

    try {
      const response = await fetch(asset.public_url);
      if (!response.ok) continue;

      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const isRasterImage = asset.mime_type?.startsWith('image/') &&
        !asset.mime_type?.includes('svg');

      // Convert to final format in memory first so we can hash the output
      let outputBuffer: Buffer;
      let ext: string;
      if (isRasterImage) {
        outputBuffer = await sharp(sourceBuffer).webp({ quality: 85 }).toBuffer();
        ext = '.webp';
      } else {
        outputBuffer = sourceBuffer;
        ext = path.extname(asset.filename) || '.bin';
      }

      // Check if identical content already exists on disk
      const hash = crypto.createHash('sha256').update(outputBuffer).digest('hex');
      const existingFilename = existingHashes[hash];

      if (existingFilename) {
        localUrlMap[assetId] = `/ycode/layouts/assets/${existingFilename}`;
        continue;
      }

      // Write new file
      const baseName = asset.filename.replace(/\.[^.]+$/, '');
      const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      let finalFilename = `${safeName}${ext}`;

      // Avoid overwriting a different file that has the same name but different content
      try {
        await fs.access(path.join(LAYOUT_ASSETS_DIR, finalFilename));
        const shortHash = hash.substring(0, 8);
        finalFilename = `${safeName}-${shortHash}${ext}`;
      } catch {
        // File doesn't exist, name is available
      }

      await fs.writeFile(path.join(LAYOUT_ASSETS_DIR, finalFilename), outputBuffer);
      existingHashes[hash] = finalFilename;
      localUrlMap[assetId] = `/ycode/layouts/assets/${finalFilename}`;
    } catch (error) {
      console.warn(`Failed to download asset ${assetId}:`, error);
    }
  }

  return localUrlMap;
}

/**
 * Replace media asset variable references with static_text pointing to local URLs.
 */
function localizeMediaAssets(
  layer: Layer,
  localUrlMap: Record<string, string>
): Layer {
  const newLayer = { ...layer };

  const replaceAssetVar = (variable: any): any => {
    if (variable?.type === 'asset' && variable?.data?.asset_id) {
      const localUrl = localUrlMap[variable.data.asset_id];
      if (localUrl) {
        return { type: 'dynamic_text', data: { content: localUrl } };
      }
    }
    return variable;
  };

  if (newLayer.variables) {
    const vars = { ...newLayer.variables };

    if (vars.image?.src) {
      vars.image = { ...vars.image, src: replaceAssetVar(vars.image.src) };
    }
    if (vars.video?.src) {
      vars.video = { ...vars.video, src: replaceAssetVar(vars.video.src) };
    }
    if (vars.video?.poster) {
      vars.video = { ...vars.video, poster: replaceAssetVar(vars.video.poster) };
    }
    if (vars.audio?.src) {
      vars.audio = { ...vars.audio, src: replaceAssetVar(vars.audio.src) };
    }
    if (vars.backgroundImage?.src) {
      vars.backgroundImage = { ...vars.backgroundImage, src: replaceAssetVar(vars.backgroundImage.src) };
    }

    newLayer.variables = vars;
  }

  if (newLayer.children) {
    newLayer.children = newLayer.children.map(child =>
      localizeMediaAssets(child, localUrlMap)
    );
  }

  return newLayer;
}

export async function POST(request: NextRequest) {
  if (!isLayoutsApiEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const formData = await request.formData();

    const layoutKey = formData.get('layoutKey') as string;
    const layoutName = formData.get('layoutName') as string;
    const category = formData.get('category') as string;
    const templateStr = formData.get('template') as string;
    const imageFile = formData.get('image') as File | null;
    const pageId = formData.get('pageId') as string | null;
    const layerId = formData.get('layerId') as string | null;

    if (!layoutKey || !layoutName || typeof category !== 'string' || !category || typeof templateStr !== 'string' || !templateStr) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!isValidLayoutKey(layoutKey)) {
      return NextResponse.json(
        { error: 'Layout key may only contain lowercase letters, numbers and dashes' },
        { status: 400 }
      );
    }

    const imageExtension = imageFile ? getLayoutPreviewExtension(imageFile.name) : '.webp';
    if (!imageExtension) {
      return NextResponse.json(
        { error: 'Preview image must be a webp, png, jpg or gif file' },
        { status: 400 }
      );
    }

    let template = JSON.parse(templateStr);

    // Make components portable: inline component layers with metadata for recreation
    const componentIds = Array.from(collectComponentIds([template]));
    if (componentIds.length > 0) {
      try {
        const componentsMap = await getComponentsByIds(componentIds);
        template = inlineComponents(template, componentsMap);

        // After inlining components, re-collect icon asset IDs since components may have icons
        // We need to inline those icons too
      } catch (error) {
        console.warn('Warning: Could not inline components:', error);
        // Continue without inlining - layout will still save but may not be portable
      }
    }

    // Make icons portable: collect asset IDs and inline the SVG content
    // This runs after component inlining to catch icons inside components
    // Uses draft assets (isPublished: false) since layouts are exported from the builder
    const iconAssetIds = collectIconAssetIds(template);
    if (iconAssetIds.length > 0) {
      try {
        const assetsMap = await getAssetsByIds(iconAssetIds, false);
        template = inlineIconAssets(template, assetsMap);
      } catch (error) {
        console.warn('Warning: Could not inline icon assets:', error);
      }
    }

    // Make media portable: download image/video/audio assets and store locally
    // Replaces asset ID references with local static URLs
    let assetUrlMap: Record<string, string> = {};
    const mediaAssetIds = collectMediaAssetIds(template);
    if (mediaAssetIds.length > 0) {
      try {
        const assetsMap = await getAssetsByIds(mediaAssetIds, false);
        assetUrlMap = await downloadAndLocalizeAssets(mediaAssetIds, assetsMap);
        template = localizeMediaAssets(template, assetUrlMap);
      } catch (error) {
        console.warn('Warning: Could not localize media assets:', error);
      }
    }

    // Persist asset URL replacements to the page layers in DB
    // Done server-side so changes survive the HMR reload triggered by layouts.ts write
    if (pageId && layerId && Object.keys(assetUrlMap).length > 0) {
      try {
        const pageLayers = await getDraftLayers(pageId);
        if (pageLayers) {
          const applyUrlMap = (l: Layer): Layer => {
            const updated = { ...l };
            if (updated.variables) {
              const vars = { ...updated.variables };
              const replace = (v: any) => {
                if (v?.type === 'asset' && v?.data?.asset_id && assetUrlMap[v.data.asset_id]) {
                  return { type: 'dynamic_text', data: { content: assetUrlMap[v.data.asset_id] } };
                }
                return v;
              };
              if (vars.image?.src) vars.image = { ...vars.image, src: replace(vars.image.src) };
              if (vars.video?.src) vars.video = { ...vars.video, src: replace(vars.video.src) };
              if (vars.video?.poster) vars.video = { ...vars.video, poster: replace(vars.video.poster) };
              if (vars.audio?.src) vars.audio = { ...vars.audio, src: replace(vars.audio.src) };
              if (vars.backgroundImage?.src) vars.backgroundImage = { ...vars.backgroundImage, src: replace(vars.backgroundImage.src) };
              updated.variables = vars;
            }
            if (updated.children) {
              updated.children = updated.children.map(applyUrlMap);
            }
            return updated;
          };

          const updateTree = (layers: Layer[]): Layer[] =>
            layers.map(l => l.id === layerId ? applyUrlMap(l) : {
              ...l,
              children: l.children ? updateTree(l.children) : undefined,
            });

          await upsertDraftLayers(pageId, updateTree(pageLayers.layers));
        }
      } catch (error) {
        console.warn('Warning: Could not update page layers with asset URLs:', error);
      }
    }

    // Handle image upload if provided
    if (imageFile) {
      await fs.mkdir(LAYOUT_PREVIEWS_DIR, { recursive: true });

      const bytes = await imageFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      await fs.writeFile(getLayoutPreviewPath(layoutKey, imageExtension), buffer);
    }

    // Read the existing file
    let fileContent = await fs.readFile(LAYOUTS_FILE_PATH, 'utf-8');

    // Find the closing brace of layoutTemplates object
    const layoutTemplatesMatch = fileContent.match(/export const layoutTemplates: Record<string, LayoutTemplate> = \{([\s\S]*?)\n\};/);

    if (!layoutTemplatesMatch) {
      return NextResponse.json(
        { error: 'Could not find layoutTemplates in layouts.ts' },
        { status: 500 }
      );
    }

    const existingLayouts = layoutTemplatesMatch[1];

    // Make layout key unique if it already exists
    let uniqueLayoutKey = layoutKey;
    let counter = 2;
    while (existingLayouts.includes(`'${uniqueLayoutKey}':`)) {
      uniqueLayoutKey = `${layoutKey}-${counter}`;
      counter++;
    }

    // Update image extension if key was modified
    const finalImagePath = `/ycode/layouts/previews/${uniqueLayoutKey}${imageExtension}`;

    // If we had to make the key unique, also rename the saved image file
    if (uniqueLayoutKey !== layoutKey && imageFile) {
      try {
        await fs.rename(
          getLayoutPreviewPath(layoutKey, imageExtension),
          getLayoutPreviewPath(uniqueLayoutKey, imageExtension)
        );
      } catch (error) {
        console.error('Failed to rename image file:', error);
      }
    }

    // Format the new layout entry with single quotes and 2-space indentation
    const templateLiteral = toTsObjectLiteral(template);
    const newLayoutEntry = `  '${uniqueLayoutKey}': {
    category: ${toTsStringLiteral(category)},
    previewImage: '${finalImagePath}',
    template: ${templateLiteral.replace(/\n/g, '\n    ')},
  },`;

    // Insert the new layout before the closing brace
    const updatedLayouts = existingLayouts.trimEnd() + '\n\n' + newLayoutEntry;

    // Replace in file content
    fileContent = fileContent.replace(
      /export const layoutTemplates: Record<string, LayoutTemplate> = \{[\s\S]*?\n\};/,
      () => `export const layoutTemplates: Record<string, LayoutTemplate> = {${updatedLayouts}\n};`
    );

    // Write back to file
    await fs.writeFile(LAYOUTS_FILE_PATH, fileContent, 'utf-8');

    return NextResponse.json({
      data: { layoutKey, layoutName, category, assetUrlMap },
      message: 'Layout saved successfully',
    });
  } catch (error) {
    console.error('Error saving layout:', error);
    return NextResponse.json(
      { error: 'Failed to save layout' },
      { status: 500 }
    );
  }
}
