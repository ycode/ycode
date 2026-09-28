'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetActions,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import AgentKeyForm from '@/app/(builder)/ycode/components/ai/AgentKeyForm';
import ProviderLogo from '@/app/(builder)/ycode/components/ai/ProviderLogo';
import { agentSettingsApi } from '@/lib/api';
import { AGENT_MODELS, AGENT_PROVIDERS, OLLAMA_DEFAULT_BASE_URL } from '@/lib/agent/models';
import { cn } from '@/lib/utils';
import { useAgentSettingsStore } from '@/stores/useAgentSettingsStore';

import type { AgentModelOption, AgentProviderOption } from '@/lib/agent/models';
import type { AgentKeyScope, AgentProviderId } from '@/types';

interface KeyFeedback {
  success: boolean;
  message: string;
}

/** A project's model options, falling back to the shipped allowlist before the
 * status has loaded. Includes the configured Ollama model when there is one. */
function projectModelOptions(status: { modelOptions?: AgentModelOption[] } | null): AgentModelOption[] {
  return status?.modelOptions ?? AGENT_MODELS;
}

/** A provider's picker models. Legacy models only show for projects that
 * already have them enabled — new projects can't adopt a superseded model. */
function visibleProviderModels(
  models: AgentModelOption[],
  providerId: AgentProviderId,
  enabledModels: string[],
) {
  return models.filter(
    (option) =>
      option.provider === providerId &&
      (!option.legacy || enabledModels.includes(option.id)),
  );
}

export default function AgentSettingsPage() {
  const status = useAgentSettingsStore((s) => s.status);
  const isLoading = useAgentSettingsStore((s) => s.isLoading);
  const loadStatus = useAgentSettingsStore((s) => s.loadStatus);
  const saveSettings = useAgentSettingsStore((s) => s.saveSettings);

  const [selectedProviderId, setSelectedProviderId] = useState<AgentProviderId | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isSavingModels, setIsSavingModels] = useState(false);
  const [defaultModelError, setDefaultModelError] = useState<string | null>(null);
  const [isSavingDefault, setIsSavingDefault] = useState(false);
  const [providerToRemove, setProviderToRemove] = useState<AgentProviderOption | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isSavingEnabled, setIsSavingEnabled] = useState(false);

  useEffect(() => {
    void loadStatus(true);
  }, [loadStatus]);

  const connectedProviders = AGENT_PROVIDERS.filter(
    (provider) => status?.providers[provider.id]?.configured,
  );

  const enabledModels = status?.enabledModels ?? [];
  const allModels = projectModelOptions(status);
  // Models the agent can actually run: enabled AND from a connected provider.
  const usableModels = allModels.filter(
    (option) =>
      enabledModels.includes(option.id) &&
      status?.providers[option.provider]?.configured,
  );

  const selectedProvider = AGENT_PROVIDERS.find(
    (provider) => provider.id === selectedProviderId,
  ) ?? null;

  const handleToggleAgent = async (checked: boolean) => {
    try {
      setIsSavingEnabled(true);
      await saveSettings({ agentEnabled: checked });
    } finally {
      setIsSavingEnabled(false);
    }
  };

  const handleToggleModel = async (modelId: string, checked: boolean) => {
    if (!status) return;
    setModelsError(null);

    const next = checked
      ? [...new Set([...enabledModels, modelId])]
      : enabledModels.filter((id) => id !== modelId);

    const nextUsable = allModels.filter(
      (option) => next.includes(option.id) && status.providers[option.provider]?.configured,
    );
    if (nextUsable.length === 0) {
      setModelsError('At least one model must stay enabled.');
      return;
    }

    try {
      setIsSavingModels(true);
      const success = await saveSettings({ enabledModels: next });
      if (!success) {
        setModelsError(useAgentSettingsStore.getState().error ?? 'Failed to save models');
      }
    } finally {
      setIsSavingModels(false);
    }
  };

  const handleDefaultModelChange = async (value: string) => {
    setDefaultModelError(null);
    try {
      setIsSavingDefault(true);
      const success = await saveSettings({ model: value });
      if (!success) {
        setDefaultModelError(useAgentSettingsStore.getState().error ?? 'Failed to save default model');
      }
    } finally {
      setIsSavingDefault(false);
    }
  };

  const handleRemoveProvider = async () => {
    if (!providerToRemove) return;
    try {
      setIsRemoving(true);
      await saveSettings({ keys: { [providerToRemove.id]: null } });
    } finally {
      setIsRemoving(false);
      setProviderToRemove(null);
    }
  };

  if (isLoading && !status) {
    return (
      <div className="p-8">
        <div className="max-w-3xl mx-auto">
          <header className="pt-8 pb-3">
            <span className="text-base font-medium">Agent</span>
          </header>
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  const agentEnabled = status?.agentEnabled ?? true;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <header className="pt-8 pb-3">
          <span className="text-base font-medium">Agent</span>
        </header>

        <p className="text-sm text-muted-foreground pb-5">
          Build and edit pages with an AI agent, right inside the builder.
        </p>

        <div className="flex items-start gap-4 bg-secondary/20 p-8 rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FieldLabel htmlFor="agent-enabled" className="mb-0">
                Agent in builder
              </FieldLabel>
              {isSavingEnabled && <Spinner className="size-3.5" />}
            </div>
            <FieldDescription className="mb-0">
              Show the Agent tab in the builder. Turn off to use Ycode in manual mode only.
            </FieldDescription>
          </div>
          <Switch
            id="agent-enabled"
            checked={agentEnabled}
            disabled={isSavingEnabled}
            onCheckedChange={handleToggleAgent}
          />
        </div>

        {agentEnabled && (
          <>
            <header className="pt-10 pb-3">
              <span className="text-base font-medium">AI providers</span>
            </header>

            <p className="text-sm text-muted-foreground pb-5">
              Connect your own AI to power the agent. Usage is billed directly to your
              account with each provider.
            </p>

            <div className="flex flex-col gap-2">
              {AGENT_PROVIDERS.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  models={allModels}
                  enabledModels={enabledModels}
                  isConnected={status?.providers[provider.id]?.configured ?? false}
                  scope={status?.providers[provider.id]?.scope ?? null}
                  onOpenSettings={() => setSelectedProviderId(provider.id)}
                />
              ))}
            </div>
          </>
        )}

        {agentEnabled && connectedProviders.length > 0 && (
          <>
            <header className="pt-10 pb-3">
              <span className="text-base font-medium">Preferences</span>
            </header>

            <div className="flex flex-col gap-6 bg-secondary/20 p-8 rounded-lg">
              <Field>
                <FieldLabel htmlFor="agent-default-model">Default model</FieldLabel>
                <FieldDescription>
                  Preselected in the agent panel — you can still switch per chat
                </FieldDescription>
                <div className="flex items-center gap-2">
                  <Select
                    value={usableModels.some((option) => option.id === status?.model) ? status?.model : usableModels[0]?.id ?? ''}
                    onValueChange={handleDefaultModelChange}
                    disabled={isSavingDefault || usableModels.length === 0}
                  >
                    <SelectTrigger id="agent-default-model" className="w-full max-w-xs">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {usableModels.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isSavingDefault && <Spinner className="size-4" />}
                </div>
              </Field>

              {defaultModelError && (
                <p className="text-xs text-destructive">{defaultModelError}</p>
              )}
            </div>
          </>
        )}

        <Sheet
          open={selectedProvider !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedProviderId(null);
          }}
        >
          <SheetContent className="sm:max-w-lg overflow-y-auto">
            {selectedProvider && (
              <ProviderSheetContent
                key={selectedProvider.id}
                provider={selectedProvider}
                status={status}
                models={allModels}
                enabledModels={enabledModels}
                isSavingModels={isSavingModels}
                modelsError={modelsError}
                onToggleModel={handleToggleModel}
                onRemove={() => setProviderToRemove(selectedProvider)}
              />
            )}
          </SheetContent>
        </Sheet>

        <ConfirmDialog
          open={providerToRemove !== null}
          onOpenChange={(open) => {
            if (!open) setProviderToRemove(null);
          }}
          title={`Disconnect ${providerToRemove?.label}?`}
          description="This removes the stored API key. Models from this provider will no longer be available in the agent panel."
          confirmLabel={isRemoving ? 'Disconnecting…' : 'Disconnect'}
          cancelLabel="Keep"
          confirmVariant="destructive"
          onConfirm={handleRemoveProvider}
          onCancel={() => setProviderToRemove(null)}
        />
      </div>
    </div>
  );
}

// ── Provider status badges ───────────────────────────────────────────────────

interface ProviderStatusBadgeProps {
  isConnected: boolean;
  className?: string;
}

/** Same chip style as the role badges on the Users settings page. */
function ProviderStatusBadge({ isConnected, className }: ProviderStatusBadgeProps) {
  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded',
        isConnected
          ? 'text-green-600 dark:text-green-400 bg-green-400/15'
          : 'text-muted-foreground bg-secondary',
        className,
      )}
    >
      {isConnected ? 'Connected' : 'Not connected'}
    </span>
  );
}

interface ProviderScopeBadgeProps {
  scope: AgentKeyScope | null;
  className?: string;
}

/** Who the connected key is available to: everyone on the project or only
 * the current user. */
function ProviderScopeBadge({ scope, className }: ProviderScopeBadgeProps) {
  if (!scope) return null;

  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded text-muted-foreground bg-secondary',
        className,
      )}
    >
      {scope === 'all' ? 'All users' : 'Only you'}
    </span>
  );
}

// ── Provider card (opens the settings sheet) ─────────────────────────────────

interface ProviderCardProps {
  provider: AgentProviderOption;
  models: AgentModelOption[];
  enabledModels: string[];
  isConnected: boolean;
  scope: AgentKeyScope | null;
  onOpenSettings: () => void;
}

function ProviderCard({ provider, models: allModels, enabledModels, isConnected, scope, onOpenSettings }: ProviderCardProps) {
  const models = visibleProviderModels(allModels, provider.id, enabledModels);
  const ollama = provider.id === 'ollama';
  const summary = ollama
    ? models.map((option) => option.label).join(', ') || 'Cloud or self-hosted endpoint'
    : models.map((option) => option.label).join(', ');

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      className="flex items-center gap-3 w-full p-4 bg-secondary/20 rounded-lg transition-colors text-left hover:bg-secondary/40 cursor-pointer"
    >
      <div className="flex items-center justify-center size-10 rounded-lg bg-secondary shrink-0">
        <ProviderLogo providerId={provider.id} className="size-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm mb-0.5">{provider.label}</div>
        <p className="text-xs text-muted-foreground truncate">{summary}</p>
      </div>

      {isConnected && <ProviderScopeBadge scope={scope} className="shrink-0" />}
      <ProviderStatusBadge isConnected={isConnected} className="shrink-0" />
    </button>
  );
}

// ── Provider settings sheet ──────────────────────────────────────────────────

interface ProviderSheetContentProps {
  provider: AgentProviderOption;
  status: ReturnType<typeof useAgentSettingsStore.getState>['status'];
  models: AgentModelOption[];
  enabledModels: string[];
  isSavingModels: boolean;
  modelsError: string | null;
  onToggleModel: (modelId: string, checked: boolean) => void;
  onRemove: () => void;
}

function ProviderSheetContent({
  provider,
  status,
  models: allModels,
  enabledModels,
  isSavingModels,
  modelsError,
  onToggleModel,
  onRemove,
}: ProviderSheetContentProps) {
  const saveSettings = useAgentSettingsStore((s) => s.saveSettings);

  const [isReplacing, setIsReplacing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingScope, setIsSavingScope] = useState(false);
  const [feedback, setFeedback] = useState<KeyFeedback | null>(null);
  // Scope for a key being connected (the toggle above the connect form).
  const [connectForAll, setConnectForAll] = useState(true);

  const keyStatus = status?.providers[provider.id];
  const isConnected = keyStatus?.configured ?? false;
  const usesEnvKey = keyStatus?.source === 'env';
  const scope = keyStatus?.scope ?? null;
  const models = visibleProviderModels(allModels, provider.id, enabledModels);
  // Ollama is identified by its endpoint + model, not a key; a self-hosted
  // server has no key at all, so the key UI is optional there.
  const isOllama = provider.id === 'ollama';
  const handleScopeChange = async (forAllUsers: boolean) => {
    try {
      setIsSavingScope(true);
      setFeedback(null);
      const success = await saveSettings({
        keyScopes: { [provider.id]: forAllUsers ? 'all' : 'personal' },
      });
      if (!success) {
        setFeedback({
          success: false,
          message: useAgentSettingsStore.getState().error ?? 'Failed to change key availability',
        });
      }
    } finally {
      setIsSavingScope(false);
    }
  };

  const handleTest = async () => {
    try {
      setIsTesting(true);
      setFeedback(null);
      const response = await agentSettingsApi.testKey(provider.id);
      setFeedback(
        response.error
          ? { success: false, message: response.error }
          : { success: true, message: response.message ?? 'API key is valid' },
      );
    } catch {
      setFeedback({ success: false, message: 'Failed to test API key' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="mr-auto flex items-center gap-2">
          {provider.label}
          {isConnected && <ProviderScopeBadge scope={scope} />}
          <ProviderStatusBadge isConnected={isConnected} />
        </SheetTitle>
        {isConnected && (!usesEnvKey || isOllama) && (
          <SheetActions>
            <Button
              variant="secondary"
              size="xs"
              onClick={onRemove}
            >
              Disconnect
            </Button>
          </SheetActions>
        )}
        <SheetDescription className="sr-only">
          {provider.label} provider settings
        </SheetDescription>
      </SheetHeader>

      <div className="mt-3 flex flex-col gap-8">
        {isConnected ? (
          <div>
            {isOllama ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <FieldLabel className="mb-0">Endpoint</FieldLabel>
                </div>
                <FieldDescription className="mb-3">
                  {keyStatus?.baseUrl ?? OLLAMA_DEFAULT_BASE_URL}
                </FieldDescription>
                <div className="flex items-center gap-2 mb-1">
                  <FieldLabel className="mb-0">API key</FieldLabel>
                  {usesEnvKey && (
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                      {provider.envVar}
                    </span>
                  )}
                </div>
                <FieldDescription className="mb-3">
                  {keyStatus?.maskedKey
                    ? `API key ${keyStatus.maskedKey}`
                    : 'No key — a local server doesn\'t need one.'}
                </FieldDescription>

                {isReplacing ? (
                  <AgentKeyForm
                    provider={provider}
                    submitLabel="Save"
                    onDone={() => setIsReplacing(false)}
                    onCancel={() => setIsReplacing(false)}
                  />
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleTest}
                      disabled={isTesting}
                    >
                      {isTesting ? <Spinner className="size-3.5" /> : 'Test connection'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFeedback(null);
                        setIsReplacing(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                )}

                {feedback && (
                  <p
                    className={cn(
                      'text-xs mt-3',
                      feedback.success ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                    )}
                  >
                    {feedback.message}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <FieldLabel className="mb-0">API key</FieldLabel>
                  {usesEnvKey && (
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                      {provider.envVar}
                    </span>
                  )}
                </div>
                <FieldDescription className="mb-3">
                  {usesEnvKey
                    ? 'Key provided by an environment variable on your server.'
                    : `API key ${keyStatus?.maskedKey ?? ''}`}
                </FieldDescription>

                {isReplacing ? (
                  <AgentKeyForm
                    provider={provider}
                    submitLabel="Save key"
                    onDone={() => setIsReplacing(false)}
                    onCancel={() => setIsReplacing(false)}
                  />
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleTest}
                      disabled={isTesting}
                    >
                      {isTesting ? <Spinner className="size-3.5" /> : 'Test API key'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFeedback(null);
                        setIsReplacing(true);
                      }}
                    >
                      {usesEnvKey ? 'Override key' : 'Replace key'}
                    </Button>
                  </div>
                )}

                {feedback && (
                  <p
                    className={cn(
                      'text-xs mt-3',
                      feedback.success ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                    )}
                  >
                    {feedback.message}
                  </p>
                )}

                {!usesEnvKey && (
                  <div className="flex items-start gap-4 border-t mt-6 pt-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FieldLabel htmlFor={`${provider.id}-scope`} className="mb-0">
                          Available to all users
                        </FieldLabel>
                        {isSavingScope && <Spinner className="size-3.5" />}
                      </div>
                      <FieldDescription className="mb-0">
                        When off, this key works only for you — other users can connect
                        their own {provider.label} key.
                      </FieldDescription>
                    </div>
                    <Switch
                      id={`${provider.id}-scope`}
                      checked={scope !== 'personal'}
                      disabled={isSavingScope}
                      onCheckedChange={handleScopeChange}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ) : isOllama ? (
          <div>
            <FieldDescription className="mb-4">
              Point the agent at Ollama Cloud or your own server. Both the endpoint and
              a model name are required; a local server needs no API key.
            </FieldDescription>

            <AgentKeyForm
              provider={provider}
              submitLabel="Connect"
              onDone={() => setFeedback(null)}
            />
          </div>
        ) : (
          <div>
            <FieldDescription className="mb-4">
              Not connected yet. Paste an API key to unlock {provider.label} models in
              the agent panel.
            </FieldDescription>

            <div className="flex items-start gap-4 mb-5">
              <div className="flex-1 min-w-0">
                <FieldLabel htmlFor={`${provider.id}-connect-scope`} className="mb-1">
                  Available to all users
                </FieldLabel>
                <FieldDescription className="mb-0">
                  When off, the key works only for you — other users can connect
                  their own {provider.label} key.
                </FieldDescription>
              </div>
              <Switch
                id={`${provider.id}-connect-scope`}
                checked={connectForAll}
                onCheckedChange={setConnectForAll}
              />
            </div>

            {/* Connecting refreshes the store status, which re-renders this
                sheet into the connected view — nothing to do on done. */}
            <AgentKeyForm
              provider={provider}
              submitLabel="Connect"
              keyScope={connectForAll ? 'all' : 'personal'}
              onDone={() => setFeedback(null)}
            />
          </div>
        )}

        {isConnected && (
          <div className="border-t pt-6">
            <div className="flex items-center gap-2 mb-1">
              <FieldLabel className="mb-0">Models</FieldLabel>
              {isSavingModels && <Spinner className="size-3.5" />}
            </div>
            <FieldDescription className="mb-3">
              {isOllama
                ? 'The model configured for this endpoint'
                : `Choose which ${provider.label} models can be selected in the agent panel`}
            </FieldDescription>
            {models.length === 0 ? (
              <p className="text-xs text-muted-foreground">No model configured yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {models.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-center gap-2 text-xs cursor-pointer w-fit"
                  >
                    <Checkbox
                      checked={enabledModels.includes(option.id)}
                      disabled={isSavingModels}
                      onCheckedChange={(checked) => onToggleModel(option.id, checked === true)}
                    />
                    {option.label}
                    {status?.model === option.id && (
                      <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                        Default
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            {modelsError && (
              <p className="text-xs text-destructive mt-3">{modelsError}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
