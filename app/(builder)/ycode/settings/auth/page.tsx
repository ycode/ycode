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

export default function AuthSettingsPage() {
  const { pages } = usePagesStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [config, setConfig] = useState({
    enabled: false,
    login_page_id: '',
    register_page_id: '',
  });

  const [providers, setProviders] = useState({
    email: { enabled: true },
    google: { enabled: false, client_id: '', client_secret: '' },
    github: { enabled: false, client_id: '', client_secret: '' },
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await appsApi.getSettings(AUTH_SYSTEM_APP_ID);
        if (response.data) {
          if (response.data.config) setConfig(response.data.config);
          if (response.data.providers) setProviders(response.data.providers);
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
              <h2 className="text-lg font-medium">OAuth Providers</h2>
              
              {/* Google */}
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Google</div>
                  <Switch
                    checked={providers.google.enabled}
                    onCheckedChange={(enabled) => setProviders({
                      ...providers,
                      google: { ...providers.google, enabled }
                    })}
                  />
                </div>
                {providers.google.enabled && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Client ID</Label>
                      <Input
                        value={providers.google.client_id}
                        onChange={(e) => setProviders({
                          ...providers,
                          google: { ...providers.google, client_id: e.target.value }
                        })}
                        placeholder="your-client-id.apps.googleusercontent.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Client Secret</Label>
                      <Input
                        type="password"
                        value={providers.google.client_secret}
                        onChange={(e) => setProviders({
                          ...providers,
                          google: { ...providers.google, client_secret: e.target.value }
                        })}
                        placeholder="••••••••••••••••"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* GitHub */}
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="font-medium">GitHub</div>
                  <Switch
                    checked={providers.github.enabled}
                    onCheckedChange={(enabled) => setProviders({
                      ...providers,
                      github: { ...providers.github, enabled }
                    })}
                  />
                </div>
                {providers.github.enabled && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Client ID</Label>
                      <Input
                        value={providers.github.client_id}
                        onChange={(e) => setProviders({
                          ...providers,
                          github: { ...providers.github, client_id: e.target.value }
                        })}
                        placeholder="Iv1.xxxxxxxxxxxx"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Client Secret</Label>
                      <Input
                        type="password"
                        value={providers.github.client_secret}
                        onChange={(e) => setProviders({
                          ...providers,
                          github: { ...providers.github, client_secret: e.target.value }
                        })}
                        placeholder="••••••••••••••••"
                      />
                    </div>
                  </div>
                )}
              </div>
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
