/**
 * Layer Locking Hook
 * 
 * Manages layer locks for conflict prevention in real-time collaboration.
 * Built on top of the generic useResourceLock hook for unified locking.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useCollaborationPresenceStore } from '@/stores/useCollaborationPresenceStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useResourceLock } from './use-resource-lock';

// Resource type constant for layers
const LAYER_RESOURCE_TYPE = 'layer';

interface UseLayerLocksReturn {
  acquireLock: (layerId: string) => Promise<boolean>;
  releaseLock: (layerId: string) => Promise<void>;
  releaseAllLocks: () => Promise<void>;
  isLayerLocked: (layerId: string) => boolean;
  getLockOwner: (layerId: string) => string | null;
  canEditLayer: (layerId: string) => boolean;
  isLockedByOther: (layerId: string) => boolean;
}

export function useLayerLocks(): UseLayerLocksReturn {
  const currentUserId = useCollaborationPresenceStore((state) => state.currentUserId);
  const updateUser = useCollaborationPresenceStore((state) => state.updateUser);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const editingComponentId = useEditorStore((state) => state.editingComponentId);
  
  const lastActivity = useRef<number>(0);
  
  // Set initial activity timestamp
  useEffect(() => {
    lastActivity.current = Date.now();
  }, []);
  
  // Determine the channel name based on whether we're editing a component or a page
  const channelName = editingComponentId 
    ? `component:${editingComponentId}:locks` 
    : currentPageId 
      ? `page:${currentPageId}:locks` 
      : '';
  
  // Use the generic resource lock hook - this is the core of the locking
  const resourceLock = useResourceLock({
    resourceType: LAYER_RESOURCE_TYPE,
    channelName,
  });
  
  // Update activity timestamp (throttled to prevent excessive updates)
  useEffect(() => {
    if (!currentUserId) return;
    
    let timeoutId: NodeJS.Timeout;
    const updateActivity = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        // Only update if user already exists in store (don't create incomplete users)
        const existingUser = useCollaborationPresenceStore.getState().users[currentUserId];
        if (!existingUser) return;
        
        lastActivity.current = Date.now();
        updateUser(currentUserId, { last_active: Date.now() });
      }, 1000); // Throttle to once per second
    };
    
    // Update activity on mouse move, key press, etc.
    document.addEventListener('mousemove', updateActivity);
    document.addEventListener('keydown', updateActivity);
    document.addEventListener('click', updateActivity);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousemove', updateActivity);
      document.removeEventListener('keydown', updateActivity);
      document.removeEventListener('click', updateActivity);
    };
  }, [currentUserId, updateUser]);
  
  // Delegate to resource lock
  const acquireLock = useCallback(async (layerId: string): Promise<boolean> => {
    return resourceLock.acquireLock(layerId);
  }, [resourceLock]);
  
  const releaseLock = useCallback(async (layerId: string): Promise<void> => {
    return resourceLock.releaseLock(layerId);
  }, [resourceLock]);
  
  const releaseAllLocks = useCallback(async (): Promise<void> => {
    return resourceLock.releaseAllLocks();
  }, [resourceLock]);
  
  const isLayerLocked = useCallback((layerId: string): boolean => {
    return resourceLock.isLocked(layerId);
  }, [resourceLock]);
  
  const getLockOwner = useCallback((layerId: string): string | null => {
    return resourceLock.getLockOwner(layerId);
  }, [resourceLock]);
  
  const canEditLayer = useCallback((layerId: string): boolean => {
    return !resourceLock.isLockedByOther(layerId);
  }, [resourceLock]);
  
  const isLockedByOther = useCallback((layerId: string): boolean => {
    return resourceLock.isLockedByOther(layerId);
  }, [resourceLock]);
  
  return {
    acquireLock,
    releaseLock,
    releaseAllLocks,
    isLayerLocked,
    getLockOwner,
    canEditLayer,
    isLockedByOther,
  };
}

// Export the resource type constant for use in store selectors
export { LAYER_RESOURCE_TYPE };
