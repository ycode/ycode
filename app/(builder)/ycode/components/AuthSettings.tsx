'use client';

import React, { useState } from 'react';
import { usePagesStore } from '@/stores/usePagesStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import SettingsPanel from './SettingsPanel';
import type { Layer } from '@/types';

interface AuthSettingsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

export default function AuthSettings({ layer, onLayerUpdate }: AuthSettingsProps) {
  const { pages } = usePagesStore();
  const [isOpen, setIsOpen] = useState(true);

  if (!layer || (layer.name !== 'auth_form' && layer.name !== 'user_status')) {
    return null;
  }

  const authSettings = layer.settings?.auth || {};

  const handleUpdate = (key: string, value: any) => {
    onLayerUpdate(layer.id, {
      settings: {
        ...layer.settings,
        auth: {
          ...authSettings,
          [key]: value
        }
      }
    });
  };

  const handleLinkChange = (index: number, field: 'label' | 'url', value: string) => {
    const links = [...(authSettings.profileLinks || [])];
    links[index] = { ...links[index], [field]: value };
    handleUpdate('profileLinks', links);
  };

  const addLink = () => {
    const links = [...(authSettings.profileLinks || [])];
    links.push({ label: 'New Link', url: '/' });
    handleUpdate('profileLinks', links);
  };

  const removeLink = (index: number) => {
    const links = [...(authSettings.profileLinks || [])];
    links.splice(index, 1);
    handleUpdate('profileLinks', links);
  };

  return (
    <SettingsPanel
      title="Authentication Settings"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <div className="flex flex-col gap-4">
        {layer.name === 'auth_form' && (
          <>
            <div className="grid grid-cols-3 items-center">
              <Label variant="muted">Type</Label>
              <div className="col-span-2">
                <Select
                  value={authSettings.type || 'login'}
                  onValueChange={(val) => handleUpdate('type', val)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="login">Login</SelectItem>
                    <SelectItem value="register">Registration</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label variant="muted">Success Redirect</Label>
              <Select
                value={authSettings.redirectUrl || 'none'}
                onValueChange={(val) => handleUpdate('redirectUrl', val === 'none' ? '' : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Current page" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Same page / URL param</SelectItem>
                  {pages.filter(p => !p.is_dynamic).map(p => (
                    <SelectItem key={p.id} value={`/${p.slug}`}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground px-1">
                Where to send the user after successful {authSettings.type === 'register' ? 'registration' : 'login'}.
              </p>
            </div>
          </>
        )}

        {layer.name === 'user_status' && (
          <>
            <div className="space-y-2">
              <Label variant="muted">Login Page</Label>
              <Select
                value={authSettings.loginUrl || 'none'}
                onValueChange={(val) => handleUpdate('loginUrl', val === 'none' ? '/login' : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select login page..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Default (/login)</SelectItem>
                  {pages.filter(p => !p.is_dynamic).map(p => (
                    <SelectItem key={p.id} value={`/${p.slug}`}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label variant="muted">Profile Links</Label>
                <Button
                  variant="ghost" size="xs"
                  onClick={addLink}
                >
                  <Icon name="plus" className="size-3 mr-1" />
                  Add
                </Button>
              </div>
              
              <div className="space-y-2">
                {(authSettings.profileLinks || []).map((link: any, i: number) => (
                  <div key={i} className="flex flex-col gap-2 p-2 border rounded-md relative bg-secondary/5 group">
                    <Button 
                      variant="ghost" 
                      size="xs" 
                      className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full bg-background border opacity-0 group-hover:opacity-100"
                      onClick={() => removeLink(i)}
                    >
                      <Icon name="x" className="size-3" />
                    </Button>
                    <Input 
                      size="sm" 
                      value={link.label} 
                      placeholder="Label" 
                      onChange={(e) => handleLinkChange(i, 'label', e.target.value)}
                    />
                    <Select
                      value={link.url}
                      onValueChange={(val) => handleLinkChange(i, 'url', val)}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue placeholder="Select page..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pages.filter(p => !p.is_dynamic).map(p => (
                          <SelectItem key={p.id} value={`/${p.slug}`}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsPanel>
  );
}
