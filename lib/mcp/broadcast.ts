/**
 * Server-side Supabase Realtime broadcast for MCP changes.
 *
 * Sends messages on the same channels that the browser collaboration
 * hooks (use-live-layer-updates, use-live-page-updates) listen on,
 * so the editor UI updates in real time when an AI agent makes changes.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { Component, Layer, Page } from '@/types';

const MCP_USER_ID = '__mcp_agent__';

/**
 * Cache subscribed realtime channels by name so successive broadcasts on the
 * same channel skip the ~50-300ms subscribe round trip. A failed subscription
 * removes itself from the cache so the next call retries from scratch.
 *
 * Stored on globalThis so the cache survives Next.js HMR in dev (same pattern
 * as the Supabase admin client itself).
 */
const globalForChannels = globalThis as unknown as {
  __mcpBroadcastChannels?: Map<string, Promise<RealtimeChannel>>;
};

const channelCache = globalForChannels.__mcpBroadcastChannels ?? new Map<string, Promise<RealtimeChannel>>();
globalForChannels.__mcpBroadcastChannels = channelCache;

async function getOrCreateChannel(channelName: string): Promise<RealtimeChannel> {
  const cached = channelCache.get(channelName);
  if (cached) return cached;

  const promise = (async () => {
    const client = await getSupabaseAdmin();
    if (!client) throw new Error('Supabase not configured');

    const channel = client.channel(channelName);

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reject(new Error(`Realtime subscribe failed: ${status}`));
        }
      });
    });

    return channel;
  })();

  channelCache.set(channelName, promise);
  promise.catch(() => channelCache.delete(channelName));

  return promise;
}

async function broadcast(
  channelName: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const channel = await getOrCreateChannel(channelName);
    await channel.send({ type: 'broadcast', event, payload });
  } catch (error) {
    console.error(`[MCP-BROADCAST] Failed to broadcast ${event}:`, error);
    channelCache.delete(channelName);
  }
}

/**
 * Broadcast a full layer tree replacement to browser clients.
 * The hook picks this up via `layers_full_sync` and calls setDraftLayers.
 */
export async function broadcastLayersChanged(
  pageId: string,
  layers: Layer[],
): Promise<void> {
  await broadcast(`page:${pageId}:updates`, 'layers_full_sync', {
    page_id: pageId,
    layers,
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

export async function broadcastPageCreated(page: Page): Promise<void> {
  await broadcast('pages:updates', 'page_created', page as unknown as Record<string, unknown>);
}

export async function broadcastPageUpdated(
  pageId: string,
  changes: Partial<Page>,
): Promise<void> {
  await broadcast('pages:updates', 'page_update', {
    page_id: pageId,
    user_id: MCP_USER_ID,
    changes,
    timestamp: Date.now(),
  });
}

export async function broadcastPageDeleted(pageId: string): Promise<void> {
  await broadcast('pages:updates', 'page_deleted', {
    pageId,
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

// Component broadcasts (channel: components:updates)

export async function broadcastComponentCreated(component: Component): Promise<void> {
  await broadcast('components:updates', 'component_created', {
    component: component as unknown as Record<string, unknown>,
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

export async function broadcastComponentUpdated(
  componentId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  await broadcast('components:updates', 'component_updated', {
    component_id: componentId,
    user_id: MCP_USER_ID,
    changes,
    timestamp: Date.now(),
  });
}

export async function broadcastComponentDeleted(componentId: string): Promise<void> {
  await broadcast('components:updates', 'component_deleted', {
    component_id: componentId,
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

export async function broadcastComponentLayersUpdated(
  componentId: string,
  layers: Layer[],
): Promise<void> {
  await broadcast('components:updates', 'component_layers_updated', {
    component_id: componentId,
    layers,
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

// Font broadcasts (channel: fonts:updates)

/**
 * Tell open builders the installed font set changed (agent add_font call or a
 * design-edit auto-install). The client hook refetches /api/fonts and
 * re-injects the font CSS into the canvas, so agent-installed fonts render
 * without a page reload.
 */
export async function broadcastFontsChanged(): Promise<void> {
  await broadcast('fonts:updates', 'fonts_changed', {
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

// Color variable broadcasts (channel: color-variables:updates)

/**
 * Tell open builders the color variable set changed (agent create/update/
 * delete/reorder). The canvas resolves var(--<id>) references from CSS
 * generated out of the CLIENT store, so without this refetch signal an
 * agent-created variable renders as nothing until a full page reload.
 */
export async function broadcastColorVariablesChanged(): Promise<void> {
  await broadcast('color-variables:updates', 'color_variables_changed', {
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}

// Global variable broadcasts (channel: global-variables:updates)

/**
 * Tell open builders the global variable set changed (agent create/update/
 * delete). Pills resolve their value and label from the client globals store,
 * so without this an agent-created global renders empty until a reload.
 */
export async function broadcastGlobalVariablesChanged(): Promise<void> {
  await broadcast('global-variables:updates', 'global_variables_changed', {
    user_id: MCP_USER_ID,
    timestamp: Date.now(),
  });
}
