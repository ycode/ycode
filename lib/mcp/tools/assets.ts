import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uploadFile } from '@/lib/file-upload';
import { getAllAssets } from '@/lib/repositories/assetRepository';

export function registerAssetTools(server: McpServer) {
  server.tool(
    'list_assets',
    'List all assets in the library with their IDs, filenames, URLs, and dimensions',
    {},
    async () => {
      const assets = await getAllAssets();
      const summary = assets.map((a) => ({
        id: a.id,
        filename: a.filename,
        public_url: a.public_url,
        mime_type: a.mime_type,
        width: a.width,
        height: a.height,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.tool(
    'upload_asset',
    `Upload an image to YCode's asset library. Accepts either a public URL or base64-encoded image data.

Use url for images already on the internet.
Use base64_data for images generated locally (e.g. AI-generated images in a sandbox).`,
    {
      url: z.string().url().optional().describe('Public URL of the image to upload'),
      base64_data: z.string().optional()
        .describe('Base64-encoded image data (without the data:... prefix). Use when the image is not publicly accessible.'),
      filename: z.string().optional().describe('Custom filename. Auto-detected from URL if omitted.'),
      mime_type: z.string().optional().describe('MIME type (e.g. "image/png", "image/jpeg"). Required for base64, auto-detected for URLs.'),
    },
    async ({ url, base64_data, filename, mime_type }) => {
      try {
        if (!url && !base64_data) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Provide either url or base64_data' }],
            isError: true,
          };
        }

        let file: File;

        if (base64_data) {
          const cleanData = base64_data.replace(/^data:[^;]+;base64,/, '');
          const buffer = Buffer.from(cleanData, 'base64');
          const contentType = mime_type || 'image/png';
          const derivedFilename = filename || `image-${Date.now()}.${extensionFromMime(contentType)}`;
          const blob = new Blob([buffer], { type: contentType });
          file = new File([blob], derivedFilename, { type: contentType });
        } else {
          const res = await fetch(url!);
          if (!res.ok) {
            return {
              content: [{ type: 'text' as const, text: `Error: Failed to download image from ${url}: ${res.status}` }],
              isError: true,
            };
          }

          const contentType = mime_type || res.headers.get('content-type') || 'image/png';
          const buffer = await res.arrayBuffer();
          const blob = new Blob([buffer], { type: contentType });
          const derivedFilename = filename || url!.split('/').pop()?.split('?')[0] || 'image.png';
          file = new File([blob], derivedFilename, { type: contentType });
        }

        const asset = await uploadFile(file, 'mcp');
        if (!asset) {
          return { content: [{ type: 'text' as const, text: 'Error: Failed to upload asset' }], isError: true };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              message: `Uploaded "${asset.filename}" successfully`,
              asset_id: asset.id,
              public_url: asset.public_url,
              width: asset.width,
              height: asset.height,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error uploading image: ${err instanceof Error ? err.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    },
  );
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
  };
  return map[mime] || 'png';
}
