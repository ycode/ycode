'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { agentSettingsApi } from '@/lib/api';
import { OLLAMA_DEFAULT_BASE_URL_LABEL } from '@/lib/agent/models';
import { useAgentSettingsStore } from '@/stores/useAgentSettingsStore';

import type { AgentProviderOption } from '@/lib/agent/models';
import type { AgentKeyScope } from '@/types';

interface AgentKeyFormProps {
  provider: AgentProviderOption;
  submitLabel: string;
  /** Where to store the key: 'all' (project-wide) or 'personal' (only the
   * current user). Omit to keep the scope of the key being replaced. */
  keyScope?: AgentKeyScope;
  onDone: () => void;
  onCancel?: () => void;
}

/**
 * Provider connection form: endpoint + key (the key alone for hosted vendors),
 * verified against the provider before it's stored. On verification failure
 * (e.g. a network restriction on the server), a "save anyway" escape hatch
 * appears.
 *
 * Ollama is endpoint-based: the base URL and model name are what make it
 * usable, and a self-hosted server has no API key at all, so its form requires
 * neither a key nor a successful key test.
 */
export default function AgentKeyForm({ provider, submitLabel, keyScope, onDone, onCancel }: AgentKeyFormProps) {
  const saveSettings = useAgentSettingsStore((s) => s.saveSettings);
  const status = useAgentSettingsStore((s) => s.status);

  const isOllama = provider.id === 'ollama';
  const storedOllama = status?.providers.ollama;

  const [keyInput, setKeyInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState(
    isOllama ? status?.ollamaBaseUrl ?? '' : '',
  );
  const [modelInput, setModelInput] = useState(isOllama ? status?.ollamaModel ?? '' : '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowUnverified, setAllowUnverified] = useState(false);

  const inputId = `${provider.id}-key-input`;
  const requiresModel = isOllama && modelInput.trim().length === 0;
  const canSubmit = isOllama
    ? !requiresModel
    : keyInput.trim().length > 0;

  const handleSubmit = async (skipVerification: boolean) => {
    const trimmed = keyInput.trim();
    const trimmedBaseUrl = baseUrlInput.trim();
    const trimmedModel = modelInput.trim();
    if (!canSubmit) return;
    // A hosted vendor has nothing to connect without a key.
    if (!isOllama && !trimmed) return;

    try {
      setIsSubmitting(true);
      setError(null);

      // Ollama is verified against the values in the form (endpoint + model),
      // so a configuration can be tested before it's written.
      const test = await agentSettingsApi.testKey(
        provider.id,
        trimmed || undefined,
        isOllama ? { baseUrl: trimmedBaseUrl, model: trimmedModel } : undefined,
      );
      if (!skipVerification && test.error) {
        setError(test.error);
        setAllowUnverified(true);
        return;
      }

      const success = await saveSettings({
        ...(trimmed ? { keys: { [provider.id]: trimmed } } : {}),
        ...(keyScope && trimmed ? { keyScopes: { [provider.id]: keyScope } } : {}),
        ...(isOllama
          ? { ollamaBaseUrl: trimmedBaseUrl, ollamaModel: trimmedModel }
          : {}),
      });
      if (!success) {
        setError(useAgentSettingsStore.getState().error ?? 'Failed to save configuration');
        return;
      }
      onDone();
    } catch (err) {
      console.error('Error saving API key:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {isOllama && (
        <>
          <Field>
            <FieldLabel htmlFor={`${provider.id}-base-url`}>Endpoint URL</FieldLabel>
            <FieldDescription>
              Ollama Cloud ({OLLAMA_DEFAULT_BASE_URL_LABEL}) or your own server
            </FieldDescription>
            <Input
              id={`${provider.id}-base-url`}
              placeholder={OLLAMA_DEFAULT_BASE_URL_LABEL}
              value={baseUrlInput}
              onChange={(e) => {
                setBaseUrlInput(e.target.value);
                setError(null);
                setAllowUnverified(false);
              }}
              autoComplete="off"
              disabled={isSubmitting}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${provider.id}-model`}>Model name</FieldLabel>
            <FieldDescription>
              A model on that endpoint, e.g. gpt-oss:120b
            </FieldDescription>
            <Input
              id={`${provider.id}-model`}
              placeholder="gpt-oss:120b"
              value={modelInput}
              onChange={(e) => {
                setModelInput(e.target.value);
                setError(null);
                setAllowUnverified(false);
              }}
              autoComplete="off"
              disabled={isSubmitting}
            />
          </Field>
        </>
      )}

      <Field>
        <FieldLabel htmlFor={inputId}>
          API key{isOllama ? ' (optional)' : ''}
        </FieldLabel>
        <FieldDescription>
          {isOllama ? (
            'Required for Ollama Cloud only — leave empty for a local server.'
          ) : (
            <>
              Create a key in the{' '}
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {provider.consoleLabel}
              </a>
              .
            </>
          )}
        </FieldDescription>
        <div className="flex gap-2">
          <Input
            id={inputId}
            type="password"
            placeholder={
              isOllama && storedOllama?.maskedKey
                ? storedOllama.maskedKey
                : provider.keyPlaceholder
            }
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value);
              setError(null);
              setAllowUnverified(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isSubmitting && canSubmit) {
                void handleSubmit(false);
              }
            }}
            autoComplete="off"
            disabled={isSubmitting}
            className="flex-1"
          />
          <Button onClick={() => handleSubmit(false)} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? <Spinner className="size-4" /> : submitLabel}
          </Button>
          {onCancel && (
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <Icon name="info" />
            <AlertDescription>
              <p>{error}</p>
              {allowUnverified && (
                <Button
                  variant="secondary"
                  size="xs"
                  className="mt-1"
                  onClick={() => handleSubmit(true)}
                  disabled={isSubmitting}
                >
                  Save anyway
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </Field>
    </div>
  );
}
