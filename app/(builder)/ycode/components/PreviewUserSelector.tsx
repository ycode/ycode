'use client';

import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { Icon } from '@/components/ui/icon';

import { Input } from '@/components/ui/input';

const USERS_COLLECTION_ID = '550e8400-e29b-41d4-a716-446655440000';

export default function PreviewUserSelector() {
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const previewUserId = usePagesStore((s) => s.previewUserId);
  const setPreviewUserId = usePagesStore((s) => s.setPreviewUserId);
  const adminUser = useAuthStore((s) => s.user);
  
  const items = useCollectionsStore((s) => s.items[USERS_COLLECTION_ID] || []);
  const fields = useCollectionsStore((s) => s.fields[USERS_COLLECTION_ID] || []);
  const loadItems = useCollectionsStore((s) => s.loadItems);
  
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Field IDs
  const supabaseUserIdField = fields.find(f => f.key === 'supabase_user_id');
  const nameField = fields.find(f => f.key === 'name');
  const emailField = fields.find(f => f.key === 'email');

  useEffect(() => {
    if (isPreviewMode && items.length === 0) {
      setIsLoading(true);
      loadItems(USERS_COLLECTION_ID, 1, 100).finally(() => setIsLoading(false));
    }
  }, [isPreviewMode, items.length, loadItems]);

  if (!isPreviewMode) return null;

  const handleUserChange = (value: string) => {
    if (value === 'admin') {
      setPreviewUserId(null);
      // Clear cookie
      document.cookie = 'ycode_preview_user_id=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    } else {
      setPreviewUserId(value);
      // Set session cookie
      document.cookie = `ycode_preview_user_id=${value}; path=/; SameSite=Lax`;
    }

    // Dispatch event to notify components (like UserStatus) that preview user changed
    window.dispatchEvent(new CustomEvent('ycode:preview-user-changed', { 
      detail: { userId: value === 'admin' ? null : value } 
    }));
  };

  // Build options and filter by search query
  const options = items.map(item => {
    const userId = supabaseUserIdField ? item.values[supabaseUserIdField.id] : null;
    const name = nameField ? item.values[nameField.id] : '';
    const email = emailField ? item.values[emailField.id] : '';
    
    return {
      id: userId || item.id,
      label: name || email || `User ${item.id.slice(0, 8)}`,
      email,
    };
  }).filter(opt => {
    if (!opt.id) return false;
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return opt.label.toLowerCase().includes(search) || opt.email.toLowerCase().includes(search);
  });

  const currentValue = previewUserId || 'admin';
  const selectedOption = options.find(o => o.id === currentValue);

  return (
    <div className="flex items-center gap-2 px-2 border-r border-border h-8">
      <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">Preview as:</span>
      <Select value={currentValue} onValueChange={handleUserChange}>
        <SelectTrigger className="h-7 min-w-[120px] max-w-[200px] text-xs bg-transparent border-none hover:bg-accent/50 focus:ring-0">
          <div className="flex items-center gap-1.5 truncate">
            <Icon name="user" className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">
              {currentValue === 'admin' ? 'Admin' : (selectedOption?.label || 'Selected User')}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="w-[260px] p-0">
          <div className="p-2 border-b border-border sticky top-0 bg-popover z-10">
            <div className="relative">
              <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-7 text-xs focus-visible:ring-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          
          <div className="max-h-[300px] overflow-y-auto">
            <SelectGroup>
              <SelectItem value="admin">
                <div className="flex flex-col">
                  <span className="font-medium text-xs">Default (Admin)</span>
                  <span className="text-[10px] text-muted-foreground">{adminUser?.email}</span>
                </div>
              </SelectItem>
              
              {options.length > 0 && <div className="h-px bg-border my-1" />}
              
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  <div className="flex flex-col">
                    <span className="text-xs">{opt.label}</span>
                    {opt.email && opt.label !== opt.email && (
                      <span className="text-[10px] text-muted-foreground">{opt.email}</span>
                    )}
                  </div>
                </SelectItem>
              ))}
              
              {isLoading && (
                <div className="px-2 py-3 text-[10px] text-muted-foreground italic text-center">
                  Loading users...
                </div>
              )}
              
              {!isLoading && options.length === 0 && searchQuery && (
                <div className="px-2 py-3 text-[10px] text-muted-foreground italic text-center">
                  No matches for &quot;{searchQuery}&quot;
                </div>
              )}

              {!isLoading && options.length === 0 && !searchQuery && (
                <div className="px-2 py-3 text-[10px] text-muted-foreground italic text-center">
                  No users found in CMS
                </div>
              )}
            </SelectGroup>
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
