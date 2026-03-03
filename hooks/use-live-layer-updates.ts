/**
 * Live Layer Updates Hook
 *
 * Manages real-time synchronization of layer changes using Supabase Realtime
 */

import { useCallback, useEffect, useRef } from 'react';
import { useCollaborationPresenceStore, getResourceLockKey } from '../stores/useCollaborationPresenceStore';
import { useAuthStore } from '../stores/useAuthStore';
import { usePagesStore, markPageMcpSynced } from '../stores/usePagesStore';
import { useEditorStore } from '../stores/useEditorStore';
import { createClient } from '@/lib/supabase-browser';
import { debounce } from '../lib/collaboration-utils';
import type { Layer, LayerUpdate } from '../types';

// Helper function to find layer in draft
function findLayerInDraft(layers: Layer[], layerId: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === layerId) return layer;
    if (layer.children) {
      const found = findLayerInDraft(layer.children, layerId);
      if (found) return found;
    }
  }
  return null;
}

export interface UseLiveLayerUpdatesReturn {
  broadcastLayerUpdate: (layerId: string, changes: Partial<Layer>) => void;
  broadcastLayerAdd: (pageId: string, parentLayerId: string | null, layerName: string, newLayer: Layer) => void;
  broadcastLayerDelete: (pageId: string, layerId: string) => void;
  broadcastLayerMove: (pageId: string, layerId: string, targetParentId: string | null, targetIndex: number) => void;
  isReceivingUpdates: boolean;
  lastUpdateTime: number | null;
}

export function useLiveLayerUpdates(
  pageId: string | null
): UseLiveLayerUpdatesReturn {
  const { user } = useAuthStore();
  const { updateLayer, draftsByPageId } = usePagesStore();
  const updateUser = useCollaborationPresenceStore((state) => state.updateUser);
  const currentUserId = useCollaborationPresenceStore((state) => state.currentUserId);

  const channelRef = useRef<any>(null);
  const isReceivingUpdates = useRef(false);
  const lastUpdateTime = useRef<number | null>(null);
  const updateQueue = useRef<LayerUpdate[]>([]);
  const pageIdRef = useRef<string | null>(pageId);

  // Update pageIdRef whenever pageId changes
  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);

  // Debounced broadcast function
  const debouncedBroadcast = useRef(
    debounce((layerId: string, changes: Partial<Layer>) => {
      // Get fresh values from refs and store
      const channel = channelRef.current;
      const userId = useCollaborationPresenceStore.getState().currentUserId;

      if (!channel || !userId) {
        return;
      }

      const update: LayerUpdate = {
        layer_id: layerId,
        user_id: userId,
        changes,
        timestamp: Date.now()
      };

      channel.send({
        type: 'broadcast',
        event: 'layer_update',
        payload: update
      });
    }, 100) // 100ms debounce - faster sync
  );

  // Initialize Supabase channel
  useEffect(() => {
    if (!pageId || !user) {
      return;
    }

    const initializeChannel = async () => {
      try {
        const supabase = await createClient();
        const channel = supabase.channel(`page:${pageId}:updates`);

        // Listen for layer updates
        channel.on('broadcast', { event: 'layer_update' }, (payload) => {
          handleIncomingUpdate(payload.payload);
        });

        // Listen for layer structure changes
        channel.on('broadcast', { event: 'layer_added' }, (payload) => {
          handleIncomingLayerAdd(payload.payload);
        });

        channel.on('broadcast', { event: 'layer_deleted' }, (payload) => {
          handleIncomingLayerDelete(payload.payload);
        });

        channel.on('broadcast', { event: 'layer_moved' }, (payload) => {
          handleIncomingLayerMove(payload.payload);
        });

        // Listen for full layer sync (from MCP / server-side changes)
        channel.on('broadcast', { event: 'layers_full_sync' }, (payload) => {
          handleIncomingFullSync(payload.payload);
        });

        // Listen for user activity
        channel.on('broadcast', { event: 'user_activity' }, (payload) => {
          handleUserActivity(payload.payload);
        });

        // Listen for lock changes
        channel.on('broadcast', { event: 'lock_change' }, (payload) => {
          handleLockChange(payload.payload);
        });

        await channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            isReceivingUpdates.current = true;
          }
        });

        channelRef.current = channel;
      } catch (error) {
        console.error('Failed to initialize live updates:', error);
      }
    };

    initializeChannel();

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      isReceivingUpdates.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable refs, adding would cause reconnect loops
  }, [pageId, user]);

  const handleIncomingUpdate = useCallback((update: LayerUpdate) => {
    // Get fresh current user ID from store
    const freshCurrentUserId = useCollaborationPresenceStore.getState().currentUserId;

    if (!freshCurrentUserId || update.user_id === freshCurrentUserId) {
      return;
    }

    // Add to update queue
    updateQueue.current.push(update);

    // Process updates in order
    processUpdateQueue();

    // Update last update time
    lastUpdateTime.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- processUpdateQueue is a ref, adding would cause infinite loop
  }, []);

  const handleUserActivity = useCallback((activity: any) => {
    if (!currentUserId || activity.user_id === currentUserId) return;

    // Update user activity
    updateUser(activity.user_id, {
      last_active: Date.now(),
      is_editing: activity.is_editing || false
    });
  }, [currentUserId, updateUser]);

  const handleLockChange = useCallback((lockChange: any) => {
    // Lock changes are handled silently - no toast notifications
    // The lock indicator UI shows lock status visually
  }, []);

  const handleIncomingLayerAdd = useCallback((payload: any) => {
    // Get fresh current user ID from store
    const freshCurrentUserId = useCollaborationPresenceStore.getState().currentUserId;

    if (!freshCurrentUserId || payload.user_id === freshCurrentUserId) {
      return;
    }

    // Get fresh state from store
    const { addLayerWithId: freshAddLayerWithId } = usePagesStore.getState();

    // Apply the layer addition with the exact same layer object
    if (pageId && payload.page_id === pageId) {
      freshAddLayerWithId(pageId, payload.parent_layer_id, payload.new_layer);
    }
  }, [pageId]);

  const handleIncomingLayerDelete = useCallback((payload: any) => {
    // Get fresh current user ID from store
    const freshCurrentUserId = useCollaborationPresenceStore.getState().currentUserId;

    if (!freshCurrentUserId || payload.user_id === freshCurrentUserId) {
      return;
    }

    // Get fresh state from store
    const { deleteLayer: freshDeleteLayer } = usePagesStore.getState();

    // Apply the layer deletion
    if (pageId && payload.page_id === pageId) {
      freshDeleteLayer(pageId, payload.layer_id);
    }
  }, [pageId]);

  const handleIncomingLayerMove = useCallback((payload: any) => {
    // Get fresh current user ID from store
    const freshCurrentUserId = useCollaborationPresenceStore.getState().currentUserId;

    if (!freshCurrentUserId || payload.user_id === freshCurrentUserId) {
      return;
    }

    // Get fresh state from store
    const { moveLayer: freshMoveLayer } = usePagesStore.getState();

    // Apply the layer move
    if (pageId && payload.page_id === pageId) {
      freshMoveLayer(pageId, payload.layer_id, payload.target_parent_id, payload.target_index);
    }
  }, [pageId]);

  const handleIncomingFullSync = useCallback((payload: { page_id: string; layers: Layer[]; user_id: string }) => {
    const freshCurrentUserId = useCollaborationPresenceStore.getState().currentUserId;
    if (!freshCurrentUserId || payload.user_id === freshCurrentUserId) {
      return;
    }

    const currentPageId = pageIdRef.current;
    if (currentPageId && payload.page_id === currentPageId) {
      markPageMcpSynced(currentPageId);
      const { setDraftLayers } = usePagesStore.getState();
      setDraftLayers(currentPageId, payload.layers);

      // Set a 10-second page lock so the UI shows MCP is editing
      const lockKey = getResourceLockKey('page', currentPageId);
      useCollaborationPresenceStore.setState((state) => ({
        resourceLocks: {
          ...state.resourceLocks,
          [lockKey]: {
            resource_type: 'page',
            resource_id: currentPageId,
            user_id: payload.user_id,
            acquired_at: Date.now(),
            expires_at: Date.now() + 10_000,
          },
        },
      }));
    }
  }, []);

  const processUpdateQueue = useCallback(() => {
    // Get fresh pageId from the ref (this will be the current value)
    const currentPageId = pageIdRef.current;

    if (updateQueue.current.length === 0) {
      return;
    }

    const update = updateQueue.current.shift();
    if (!update) return;

    // Get fresh state from store
    const { draftsByPageId: freshDrafts, updateLayer: freshUpdateLayer } = usePagesStore.getState();
    const currentDraft = freshDrafts[currentPageId || ''];

    if (!currentPageId) {
      return;
    }

    if (!currentDraft) {
      return;
    }

    // Apply the update to the store (without broadcasting back)
    if (currentPageId) {
      try {
        freshUpdateLayer(currentPageId, update.layer_id, update.changes);
      } catch (error) {
        console.error(`[LIVE-UPDATES] Error applying update:`, error);
      }
    }

    // Process next update
    if (updateQueue.current.length > 0) {
      setTimeout(processUpdateQueue, 16); // Process at 60fps
    }
  }, []); // No dependencies since we use refs

  const broadcastLayerUpdate = useCallback((layerId: string, changes: Partial<Layer>) => {
    if (!channelRef.current || !currentUserId) {
      return;
    }

    // Don't update local state - that's already done by the caller
    // Just broadcast the update to others

    // Broadcast the update
    debouncedBroadcast.current(layerId, changes);

    // Only set is_editing for text content changes, not class changes
    const isTextContentChange = 'content' in changes;

    // Update user activity
    updateUser(currentUserId, {
      last_active: Date.now(),
      is_editing: isTextContentChange
    });

    // Broadcast activity
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'user_activity',
        payload: {
          user_id: currentUserId,
          is_editing: isTextContentChange,
          timestamp: Date.now()
        }
      });
    }
  }, [currentUserId, updateUser]);

  const broadcastLayerAdd = useCallback((pageId: string, parentLayerId: string | null, layerName: string, newLayer: Layer) => {
    if (!channelRef.current) {
      console.warn('[COLLAB] Cannot broadcast layer add - channel not ready');
      return;
    }
    if (!currentUserId) {
      console.warn('[COLLAB] Cannot broadcast layer add - currentUserId not set');
      return;
    }

    // Broadcast the layer addition
    channelRef.current.send({
      type: 'broadcast',
      event: 'layer_added',
      payload: {
        page_id: pageId,
        parent_layer_id: parentLayerId,
        layer_name: layerName,
        new_layer: newLayer,
        user_id: currentUserId,
        timestamp: Date.now()
      }
    });

    // Update user activity
    updateUser(currentUserId, {
      last_active: Date.now(),
      is_editing: false
    });
  }, [currentUserId, updateUser]);

  const broadcastLayerDelete = useCallback((pageId: string, layerId: string) => {
    if (!channelRef.current || !currentUserId) {
      return;
    }

    // Broadcast the layer deletion
    channelRef.current.send({
      type: 'broadcast',
      event: 'layer_deleted',
      payload: {
        page_id: pageId,
        layer_id: layerId,
        user_id: currentUserId,
        timestamp: Date.now()
      }
    });

    // Update user activity
    updateUser(currentUserId, {
      last_active: Date.now(),
      is_editing: false
    });
  }, [currentUserId, updateUser]);

  const broadcastLayerMove = useCallback((pageId: string, layerId: string, targetParentId: string | null, targetIndex: number) => {
    if (!channelRef.current || !currentUserId) {
      return;
    }

    // Broadcast the layer move
    channelRef.current.send({
      type: 'broadcast',
      event: 'layer_moved',
      payload: {
        page_id: pageId,
        layer_id: layerId,
        target_parent_id: targetParentId,
        target_index: targetIndex,
        user_id: currentUserId,
        timestamp: Date.now()
      }
    });

    // Update user activity
    updateUser(currentUserId, {
      last_active: Date.now(),
      is_editing: false
    });
  }, [currentUserId, updateUser]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
    };
  }, []);

  return {
    broadcastLayerUpdate,
    broadcastLayerAdd,
    broadcastLayerDelete,
    broadcastLayerMove,
    isReceivingUpdates: isReceivingUpdates.current,
    lastUpdateTime: lastUpdateTime.current
  };
}
