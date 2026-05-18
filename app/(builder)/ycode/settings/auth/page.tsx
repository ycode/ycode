'use client';

import React, { useState, useEffect } from 'react';
import { usePagesStore } from '@/stores/usePagesStore';
import { appsApi } from '@/lib/api';
import { AUTH_SYSTEM_APP_ID } from '@/lib/auth-constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import Icon from '@/components/ui/icon';

export default function AuthSettingsPage() {
  const { pages } = usePagesStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [discoveredProviders, setDiscoveredProviders] = useState<string[]>([]);
  
  const [config, setConfig] = useState({
    enabled: false,
    login_page_id: '',
    register_page_id: '',
  });

  const [providers, setProviders] = useState({
    email: { enabled: true },
    google: { enabled: false },
    github: { enabled: false },
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        const [settingsRes, discoveryRes] = await Promise.all([
          appsApi.getSettings(AUTH_SYSTEM_APP_ID),
          fetch('/api/auth/providers').then(res => res.json())
        ]);

        if (settingsRes.data) {
          if (settingsRes.data.config) setConfig(settingsRes.data.config);
          if (settingsRes.data.providers) setProviders(settingsRes.data.providers);
        }

        if (discoveryRes.providers) {
          setDiscoveredProviders(discoveryRes.providers);
        }
      } catch (error) {
        console.error('Failed to load auth settings:', error);
        toast.error('Failed to load authentication settings');
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await appsApi.updateSettings(AUTH_SYSTEM_APP_ID, {
        config,
        providers,
      });

      if (response.error) {
        toast.error(response.error);
      } else {
        toast.success('Authentication settings saved');
      }
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  const isProviderDiscovered = (id: string) => discoveredProviders.includes(id);

  return (
    <div className="p-8 max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Authentication System</h1>
        <p className="text-sm text-muted-foreground">
          Configure how users register and log in to your published website.
        </p>
      </div>

      <div className="space-y-6">
        {/* Global Toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
          <div className="space-y-0.5">
            <Label className="text-base">Enable Authentication</Label>
            <p className="text-sm text-muted-foreground">
              Allow site visitors to create accounts and log in.
            </p>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
          />
        </div>

        {config.enabled && (
          <>
            {/* Page Configuration */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Login Page</Label>
                <Select
                  value={config.login_page_id || 'none'}
                  onValueChange={(val) => setConfig({ ...config, login_page_id: val === 'none' ? '' : val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select login page" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Default /login)</SelectItem>
                    {pages.filter(p => !p.is_dynamic).map((page) => (
                      <SelectItem key={page.id} value={page.id}>
                        {page.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Registration Page</Label>
                <Select
                  value={config.register_page_id || 'none'}
                  onValueChange={(val) => setConfig({ ...config, register_page_id: val === 'none' ? '' : val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select registration page" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Default /register)</SelectItem>
                    {pages.filter(p => !p.is_dynamic).map((page) => (
                      <SelectItem key={page.id} value={page.id}>
                        {page.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Providers */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">OAuth Providers</h2>
                <a 
                  href="https://supabase.com/dashboard/project/_/auth/providers" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Manage in Supabase
                  <Icon name="external-link" className="size-3" />
                </a>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                {['google', 'github'].map((providerId) => (
                  <div key={providerId} className="flex items-center justify-between p-4 border rounded-lg bg-card">
                    <div className="flex items-center gap-3">
                      <div className="capitalize font-medium">{providerId}</div>
                      {!isProviderDiscovered(providerId) && (
                        <div className="text-[10px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">
                          Not configured in Supabase
                        </div>
                      )}
                    </div>
                    <Switch
                      disabled={!isProviderDiscovered(providerId)}
                      checked={(providers as any)[providerId]?.enabled && isProviderDiscovered(providerId)}
                      onCheckedChange={(enabled) => setProviders({
                        ...providers,
                        [providerId]: { enabled }
                      })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Only providers enabled in your Supabase project can be used. Credentials are managed directly in Supabase for better security.
              </p>
            </div>
          </>
        )}

        <div className="pt-4 flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
