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

import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

export default function AuthSettings({ layer, onLayerUpdate }: AuthSettingsProps) {
  const { pages } = usePagesStore();
  const [isOpen, setIsOpen] = useState(true);

  if (!layer || (layer.name !== 'auth_form' && layer.name !== 'user_status')) {
    return null;
  }

  const authSettings = (layer.settings?.auth || {}) as any;
  const labels = authSettings.labels || {};
  const styling = authSettings.styling || {
    showAvatar: true,
    backgroundColor: 'transparent',
    textColor: 'inherit',
    dropdownBackgroundColor: 'white',
    dropdownTextColor: 'inherit',
    glassmorphism: false
  };

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

  const handleLabelUpdate = (key: string, value: string) => {
    handleUpdate('labels', { ...labels, [key]: value });
  };

  const handleStylingUpdate = (key: string, value: any) => {
    handleUpdate('styling', { ...styling, [key]: value });
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
            <div className="space-y-4">
              <div className="space-y-2">
                <Label variant="muted">General</Label>
                <div className="flex items-center justify-between p-2 border rounded-md bg-secondary/5">
                  <span className="text-xs">Show Avatar</span>
                  <Switch 
                    size="sm"
                    checked={styling.showAvatar !== false}
                    onCheckedChange={(val) => handleStylingUpdate('showAvatar', val)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label variant="muted">Login Page</Label>
                <Select
                  value={authSettings.loginUrl || 'none'}
                  onValueChange={(val) => handleUpdate('loginUrl', val === 'none' ? '/login' : val)}
                >
                  <SelectTrigger size="sm">
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

              <Separator />

              <div className="space-y-2">
                <Label variant="muted">Custom Labels</Label>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Login</span>
                    <Input 
                      className="col-span-2 h-7 text-xs"
                      value={labels.login || ''} 
                      placeholder="Log in"
                      onChange={(e) => handleLabelUpdate('login', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Logout</span>
                    <Input 
                      className="col-span-2 h-7 text-xs"
                      value={labels.logout || ''} 
                      placeholder="Log out"
                      onChange={(e) => handleLabelUpdate('logout', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label variant="muted">Styling</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 border rounded-md bg-secondary/5 mb-2">
                    <span className="text-xs">Glassmorphism</span>
                    <Switch 
                      size="sm"
                      checked={!!styling.glassmorphism}
                      onCheckedChange={(val) => handleStylingUpdate('glassmorphism', val)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">BG Color</span>
                      <Input 
                        className="h-7 text-xs"
                        value={styling.backgroundColor || ''} 
                        placeholder="transparent"
                        onChange={(e) => handleStylingUpdate('backgroundColor', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">Text Color</span>
                      <Input 
                        className="h-7 text-xs"
                        value={styling.textColor || ''} 
                        placeholder="inherit"
                        onChange={(e) => handleStylingUpdate('textColor', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">Dropdown BG</span>
                      <Input 
                        className="h-7 text-xs"
                        value={styling.dropdownBackgroundColor || ''} 
                        placeholder="white"
                        onChange={(e) => handleStylingUpdate('dropdownBackgroundColor', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">Dropdown Text</span>
                      <Input 
                        className="h-7 text-xs"
                        value={styling.dropdownTextColor || ''} 
                        placeholder="inherit"
                        onChange={(e) => handleStylingUpdate('dropdownTextColor', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

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
                        className="h-7 text-xs"
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
            </div>
          </>
        )}
      </div>
    </SettingsPanel>
  );
}
