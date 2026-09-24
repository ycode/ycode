'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldDescription, FieldLabel } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import type { IconProps } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AGENT_MODELS, AGENT_PROVIDERS, providerOfModelFrom } from '@/lib/agent/models';
import { getLayerName } from '@/lib/layer-display-utils';
import { findLayerById } from '@/lib/layer-utils';
import { cn } from '@/lib/utils';
import { useAgentSettingsStore } from '@/stores/useAgentSettingsStore';
import { useAiChatStore } from '@/stores/useAiChatStore';
import type { ChatMessage, ChatMessagePart, ChatSession, ChatToolCall, ImageAttachment, Mention, SelectedLayerRef, TurnChange } from '@/stores/useAiChatStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import type { Layer } from '@/types';

import AgentKeyForm from './AgentKeyForm';
import { toolCallLabel } from './ai-tool-labels';
import ChatComposer from './ChatComposer';

import type { AgentProviderId } from '@/lib/agent/models';

const URL_REGEX = /\bhttps?:\/\/[^\s]+/gi;

/** Distance from the bottom (px) within which the transcript stays auto-pinned. */
const STICK_TO_BOTTOM_THRESHOLD = 80;

function parseUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_REGEX) ?? [])).map((url) => url.replace(/[.,)]+$/, ''));
}

/** Split text on bare URLs and render each as a link opening in a new tab. */
function linkifyText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    // Trailing punctuation belongs to the sentence, not the URL.
    const url = match[0].replace(/[.,)]+$/, '');
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <a
        key={`${url}-${match.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-80"
      >
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/** Error banner shown in the chat transcript; provider errors often contain
 * docs/billing URLs, so bare links render clickable. */
function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 break-words">
      {linkifyText(message)}
    </div>
  );
}

// Configure markdown parsing once rather than passing options on every parse.
marked.setOptions({ gfm: true, breaks: true });

let markdownLinkHookRegistered = false;

/** Render assistant markdown to sanitized HTML (links open in a new tab). */
function renderMarkdown(text: string): string {
  if (!markdownLinkHookRegistered) {
    markdownLinkHookRegistered = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  const html = marked.parse(replaceLayerIdsWithBadges(text), { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** Flatten a layer tree into mention candidates (skips the root Body layer).
 * `componentNameById` resolves a component instance's label to the actual
 * component name (otherwise getLayerName falls back to "Component"). */
function flattenLayerMentions(
  layers: Layer[],
  componentNameById: Map<string, string>,
  acc: Mention[] = [],
): Mention[] {
  for (const layer of layers) {
    if (layer.id !== 'body') {
      const componentName = layer.componentId ? componentNameById.get(layer.componentId) : undefined;
      acc.push({
        type: 'layer',
        id: layer.id,
        label: getLayerName(layer, { component_name: componentName }),
        isComponentInstance: !!layer.componentId,
      });
    }
    if (layer.children?.length) flattenLayerMentions(layer.children, componentNameById, acc);
  }
  return acc;
}

/** Collect every layer id → display name across a tree into the given map. */
function collectLayerNames(layers: Layer[], acc: Map<string, string>): void {
  for (const layer of layers) {
    acc.set(layer.id, getLayerName(layer));
    if (layer.children?.length) collectLayerNames(layer.children, acc);
  }
}

/**
 * Cached id → display-name map so badge resolution doesn't re-walk every page
 * draft for each layer id on every markdown render. Rebuilt only when the drafts
 * object reference changes (i.e. after an edit), and lazily — the walk happens
 * the first time a badge is resolved after a change, not on every edit.
 */
let layerNameCache: { drafts: unknown; map: Map<string, string> } = { drafts: null, map: new Map() };

/** Resolve a layer id to its display name by searching every loaded page draft. */
function resolveLayerName(id: string): string | null {
  const drafts = usePagesStore.getState().draftsByPageId;
  if (layerNameCache.drafts !== drafts) {
    const map = new Map<string, string>();
    for (const pageId in drafts) {
      const layers = drafts[pageId]?.layers;
      if (layers) collectLayerNames(layers, map);
    }
    layerNameCache = { drafts, map };
  }
  return layerNameCache.map.get(id) ?? null;
}

// Match an "lyr-..." id, optionally wrapped in backticks. The model often writes
// ids as inline code (`lyr-...`); we must swallow those backticks so the badge
// HTML isn't injected inside a markdown code span (which marked would escape and
// render as literal text instead of a styled badge).
const LAYER_ID_REGEX = /`?(lyr-[0-9a-z]+)`?/gi;

const LAYER_BADGE_HTML_CLASS =
  'inline-flex items-center align-middle rounded-md bg-secondary px-1 text-[0.92em] font-normal text-secondary-foreground/80';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Swap raw "lyr-..." ids in assistant text for a name badge (falls back to the
 * generic label when the layer can't be resolved in a loaded draft). */
function replaceLayerIdsWithBadges(text: string): string {
  if (!text.includes('lyr-')) return text;
  return text.replace(LAYER_ID_REGEX, (_match, id: string) => {
    const name = resolveLayerName(id) ?? 'layer';
    return `<span class="${LAYER_BADGE_HTML_CLASS}">${escapeHtml(name)}</span>`;
  });
}

const MENTION_ICON: Record<Mention['type'], 'page' | 'database' | 'layers' | 'component'> = {
  page: 'page',
  collection: 'database',
  layer: 'layers',
  component: 'component',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inline reference badge shown inside a sent user message (read-only). */
function MentionBadge({ type, label, isComponentInstance }: { type: Mention['type']; label: string; isComponentInstance?: boolean }) {
  return (
    <Badge
      variant="secondary"
      className="h-4 gap-1 rounded-md px-1 align-middle text-[12px] font-normal [&>svg]:size-2.5"
    >
      <Icon name={isComponentInstance ? 'component' : (MENTION_ICON[type] ?? 'layers')} className="shrink-0" />
      <span className="max-w-[140px] truncate">{label}</span>
    </Badge>
  );
}

/** Render a sent message, swapping each "@label" token for its reference badge. */
function MessageTextWithMentions({ text, mentions }: { text: string; mentions?: Mention[] }) {
  if (!mentions || mentions.length === 0) return <>{text}</>;

  const byLabel = new Map(mentions.map((mention) => [mention.label, mention]));
  // Longest-first so "@Hero Section" wins over a shorter "@Hero" prefix.
  const labels = [...new Set(mentions.map((mention) => mention.label))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (labels.length === 0) return <>{text}</>;

  const regex = new RegExp(`@(${labels.join('|')})`, 'g');
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const mention = byLabel.get(match[1]);
    nodes.push(
      <MentionBadge
        key={key++} type={mention?.type ?? 'layer'}
        label={match[1]}
        isComponentInstance={mention?.isComponentInstance}
      />,
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

/** Collapsed user-bubble height (px). Messages taller than this get clamped
 * behind a "Show more" affordance so long prompts don't dominate the transcript. */
const USER_MESSAGE_COLLAPSED_MAX_HEIGHT = 128;
/** Expanded user-bubble height cap (px) — the full text scrolls within the
 * bubble instead of stretching it to thousands of pixels. */
const USER_MESSAGE_EXPANDED_MAX_HEIGHT = 320;

/**
 * User message bubble that clamps long prompts. Short messages render as-is;
 * long ones collapse to a preview that fades out at the bottom — clicking the
 * faded bubble expands it. Even expanded, the text scrolls inside a
 * capped-height bubble, with a subtle chevron to collapse it again.
 */
function CollapsibleUserMessage({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  // Measure after render: only messages that actually overflow the collapsed
  // height get the toggle. Sent messages never change, so one measure is enough.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setIsClamped(el.scrollHeight > USER_MESSAGE_COLLAPSED_MAX_HEIGHT + 8);
  }, []);

  return (
    <div className="relative rounded-xl rounded-br-sm bg-secondary border border-border text-current overflow-hidden">
      <div
        ref={contentRef}
        className={cn(
          'px-3 py-2 text-xs whitespace-pre-wrap break-words',
          isClamped && !isExpanded && 'overflow-hidden',
          isClamped && isExpanded && 'overflow-y-auto no-scrollbar',
        )}
        style={
          isClamped
            ? {
              maxHeight: isExpanded ? USER_MESSAGE_EXPANDED_MAX_HEIGHT : USER_MESSAGE_COLLAPSED_MAX_HEIGHT,
              // Fade the text itself out at the bottom (the card background
              // stays untouched) — the overlay button is just a click target.
              ...(!isExpanded && {
                maskImage: 'linear-gradient(to bottom, black 55%, transparent 95%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent 95%)',
              }),
            }
            : undefined
        }
      >
        {children}
      </div>
      {isClamped && !isExpanded && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          aria-expanded={false}
          aria-label="Show full message"
          title="Show full message"
          className="absolute inset-0 cursor-pointer"
        />
      )}
      {isClamped && isExpanded && (
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          aria-expanded={true}
          aria-label="Collapse message"
          title="Collapse"
          className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-md bg-secondary/90 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="chevronDown" className="size-3 rotate-180" />
        </button>
      )}
    </div>
  );
}

interface AiChatPanelProps {
  embedded?: boolean;
}

export default function AiChatPanel({ embedded = false }: AiChatPanelProps) {
  const messages = useAiChatStore((s) => s.messages);
  const status = useAiChatStore((s) => s.status);
  const error = useAiChatStore((s) => s.error);
  const model = useAiChatStore((s) => s.model);
  const sendMessage = useAiChatStore((s) => s.sendMessage);
  const setModel = useAiChatStore((s) => s.setModel);
  const revertTurn = useAiChatStore((s) => s.revertTurn);
  const redoTurn = useAiChatStore((s) => s.redoTurn);
  const stop = useAiChatStore((s) => s.stop);
  const close = useAiChatStore((s) => s.close);
  const chats = useAiChatStore((s) => s.chats);
  const currentChatId = useAiChatStore((s) => s.currentChatId);
  const isLoadingChats = useAiChatStore((s) => s.isLoadingChats);
  const loadingChatId = useAiChatStore((s) => s.loadingChatId);
  const loadChats = useAiChatStore((s) => s.loadChats);
  const newChat = useAiChatStore((s) => s.newChat);
  const loadChat = useAiChatStore((s) => s.loadChat);
  const deleteChat = useAiChatStore((s) => s.deleteChat);

  const agentStatus = useAgentSettingsStore((s) => s.status);
  const isLoadingAgentStatus = useAgentSettingsStore((s) => s.isLoading);
  const loadAgentStatus = useAgentSettingsStore((s) => s.loadStatus);

  const selectedLayerIds = useEditorStore((s) => s.selectedLayerIds);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const draftLayers = usePagesStore((s) =>
    currentPageId ? s.draftsByPageId[currentPageId]?.layers : undefined,
  );
  const pages = usePagesStore((s) => s.pages);
  const collections = useCollectionsStore((s) => s.collections);
  const components = useComponentsStore((s) => s.components);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the view is pinned to the bottom. Updated on user scroll so auto-
  // scroll only fires when the user is already at (or near) the latest message —
  // scrolling up to read history mid-stream no longer yanks them back down.
  const stickToBottomRef = useRef(true);
  // Surfaces the "jump to latest" affordance while the user is scrolled up.
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const isStreaming = status === 'streaming';

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_THRESHOLD;
    stickToBottomRef.current = atBottom;
    // React bails out when the value is unchanged, so this only re-renders on a
    // transition into/out of the "scrolled up" state.
    setShowJumpToLatest(!atBottom);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
  };

  const layerMentions = useMemo<Mention[]>(() => {
    if (!draftLayers) return [];
    const componentNameById = new Map(components.map((component) => [component.id, component.name]));
    return flattenLayerMentions(draftLayers, componentNameById);
  }, [draftLayers, components]);

  // Ordered by category (Pages, Layers, Components, CMS) so the mention menu's
  // flat keyboard-nav index matches the grouped visual order.
  const mentionCandidates = useMemo<Mention[]>(() => {
    const fromPages: Mention[] = pages.map((page) => ({ type: 'page', id: page.id, label: page.name }));
    const fromComponents: Mention[] = components.map((component) => ({
      type: 'component',
      id: component.id,
      label: component.name,
    }));
    const fromCollections: Mention[] = collections.map((collection) => ({
      type: 'collection',
      id: collection.id,
      label: collection.name,
    }));
    return [...fromPages, ...layerMentions, ...fromComponents, ...fromCollections];
  }, [pages, layerMentions, components, collections]);

  // The canvas selection is sent to the agent as background context only — it is
  // not shown as a pill. Explicit pills come from the composer's @ menu / picker.
  const selectedRefs = useMemo<SelectedLayerRef[]>(() => {
    if (!selectedLayerIds.length || !draftLayers) return [];
    return selectedLayerIds
      .map((id) => {
        const layer = findLayerById(draftLayers, id);
        return layer ? { id, name: getLayerName(layer) } : null;
      })
      .filter((ref): ref is SelectedLayerRef => ref !== null);
  }, [selectedLayerIds, draftLayers]);

  useEffect(() => {
    void loadAgentStatus();
  }, [loadAgentStatus]);

  // Fetch the server-side chat history (summaries only) when the panel opens;
  // the store de-dupes so this runs at most once per browser session.
  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  // A previously chosen model may have been disabled in Settings → Agent since,
  // or its provider's API key removed; snap the picker back to the configured
  // default so the request isn't silently remapped server-side.
  useEffect(() => {
    if (!agentStatus || !model) return;
    const provider = providerOfModelFrom(agentStatus.modelOptions ?? AGENT_MODELS, model);
    const usable =
      agentStatus.enabledModels.includes(model) &&
      provider !== null &&
      agentStatus.providers[provider]?.configured;
    if (!usable) {
      setModel(agentStatus.model);
    }
  }, [agentStatus, model, setModel]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const submit = (text: string, mentions: Mention[] = [], images: ImageAttachment[] = []) => {
    if ((!text.trim() && images.length === 0) || isStreaming) return;
    // Sending a message always jumps to the latest, even if the user had
    // scrolled up to read earlier history.
    stickToBottomRef.current = true;
    void sendMessage(text, {
      selectedLayers: selectedRefs,
      images,
      mentions,
      referenceUrls: parseUrls(text),
    });
  };

  const composer = (
    <ChatComposer
      model={model}
      onModelChange={setModel}
      isStreaming={isStreaming}
      onStop={stop}
      onSubmit={submit}
      mentionCandidates={mentionCandidates}
      layerMentions={layerMentions}
    />
  );

  // What to show when the active chat has no messages: a spinner while a
  // history chat's transcript is being fetched, otherwise the fresh-chat view.
  const emptyState = loadingChatId === currentChatId ? (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  ) : (
    <div className="flex-1 min-h-0 flex flex-col justify-start gap-4 p-3">
      {composer}
      {error && <ErrorNotice message={error} />}
    </div>
  );

  // No agent connected yet (or status still loading): show the connect
  // instructions instead of the chat. The API key lives in Settings → Agent.
  if (!agentStatus || !agentStatus.configured) {
    return (
      <div
        className={cn(
          'flex flex-col overflow-hidden',
          embedded
            ? 'flex-1 min-h-0'
            : 'w-80 shrink-0 bg-background border-l h-full',
        )}
      >
        {!embedded && (
          <div className="flex items-center justify-between gap-2 px-4 h-12 shrink-0 border-b">
            <span className="text-xs font-medium">AI Agent</span>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              onClick={close}
              aria-label="Close AI panel"
              title="Close"
            >
              <Icon name="x" className="size-3.5" />
            </Button>
          </div>
        )}
        {!agentStatus && isLoadingAgentStatus ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <ConnectAgentState />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden',
        embedded
          ? 'flex-1 min-h-0'
          : 'w-80 shrink-0 bg-background border-l h-full',
      )}
    >
      {embedded ? (
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
          <ChatHistoryMenu
            chats={chats}
            currentChatId={currentChatId}
            isLoading={isLoadingChats}
            onSelect={loadChat}
            onDelete={deleteChat}
          />
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              onClick={newChat}
              variant="secondary"
              aria-label="New chat"
              title="New chat"
            >
              <Icon name="plus" className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-4 h-12 shrink-0 border-b">
          <ChatHistoryMenu
            chats={chats}
            currentChatId={currentChatId}
            isLoading={isLoadingChats}
            onSelect={loadChat}
            onDelete={deleteChat}
          />
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={newChat}
              aria-label="New chat"
              title="New chat"
            >
              <Icon name="plus" className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              onClick={close}
              aria-label="Close AI panel"
              title="Close"
            >
              <Icon name="x" className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        emptyState
      ) : (
        <>
          <div className="relative flex-1 min-h-0">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              aria-live="polite"
              aria-busy={isStreaming}
              className="absolute inset-0 overflow-y-auto no-scrollbar px-4 py-4 flex flex-col gap-4"
            >
              {messages.map((message) => (
                <MessageBubble
                  key={message.id} message={message}
                  isStreaming={isStreaming}
                  onRevert={revertTurn}
                  onRedo={redoTurn}
                />
              ))}

              {/* Turn failures render inside their own bubble (message.error),
                  so the trailing banner only shows errors that never attached
                  to a message (e.g. a failed chat load). */}
              {error && messages[messages.length - 1]?.error !== error && (
                <ErrorNotice message={error} />
              )}
            </div>

            {showJumpToLatest && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full border p-0 shadow-md"
                onClick={scrollToBottom}
                aria-label="Jump to latest message"
                title="Jump to latest"
              >
                <Icon name="chevronDown" className="size-4" />
              </Button>
            )}
          </div>

          <div className="border-t p-3 shrink-0">
            {composer}
          </div>
        </>
      )}
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="text-xs leading-relaxed break-words [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:my-1.5 [&_ol]:ml-4 [&_ol]:list-decimal [&_li]:my-0.5 [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Compact relative timestamp for the history list, e.g. "6h", "7d", "now". */
function compactTime(timestamp: number): string {
  const diffSecs = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSecs < 60) return 'now';
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

function ChatHistoryMenu({
  chats,
  currentChatId,
  isLoading,
  onSelect,
  onDelete,
}: {
  chats: ChatSession[];
  currentChatId: string;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const currentTitle = chats.find((chat) => chat.id === currentChatId)?.title ?? 'New chat';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 min-w-0 flex-1 justify-between gap-2 px-2.5 text-xs font-medium"
        >
          <span className="truncate">{currentTitle}</span>
          <Icon name="chevronDown" className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
        {chats.length === 0 && isLoading && (
          <div className="flex items-center justify-center px-2 py-3">
            <Spinner />
          </div>
        )}
        {chats.length === 0 && !isLoading && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No previous chats</div>
        )}
        {chats.length > 0 && (
          chats.map((chat) => (
            <DropdownMenuItem
              key={chat.id}
              onSelect={() => onSelect(chat.id)}
              className={cn('group gap-2 pr-1.5', chat.id === currentChatId && 'bg-accent')}
            >
              <span className="flex-1 truncate text-xs">{chat.title}</span>
              {/* Fixed-width trailing slot: the delete button overlays the timestamp
                  on hover so the row width never changes (no layout shift). */}
              <span className="relative flex min-w-5 shrink-0 items-center justify-end">
                <span className="text-[11px] text-muted-foreground group-hover:invisible">
                  {compactTime(chat.updatedAt)}
                </span>
                <button
                  type="button"
                  aria-label="Delete chat"
                  title="Delete chat"
                  className="absolute -inset-y-0.5 right-0 hidden w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground group-hover:flex"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(chat.id);
                  }}
                >
                  <Icon name="trash" className="size-3" />
                </button>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Short, user-facing button labels keyed by provider. */
const PROVIDER_SHORT_LABELS: Record<AgentProviderId, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Google Gemini',
  xai: 'Grok',
  ollama: 'Ollama',
};

/** Brand icons keyed by provider (registered in the Icon component). */
const PROVIDER_ICONS: Record<AgentProviderId, IconProps['name']> = {
  anthropic: 'claude',
  openai: 'openai',
  google: 'gemini',
  xai: 'grok',
  ollama: 'ollama',
};

/** Shown when no AI provider is configured: offers a one-click setup dialog for
 * each provider (a faster path than Settings → Agent) plus a link to the full
 * settings page for model selection. */
function ConnectAgentState() {
  const router = useRouter();
  const [setupProvider, setSetupProvider] = useState<AgentProviderId | null>(null);
  // Scope for the key being connected (matches the toggle in Settings → Agent).
  const [connectForAll, setConnectForAll] = useState(true);

  const activeProvider = AGENT_PROVIDERS.find((provider) => provider.id === setupProvider) ?? null;

  const handleOpenSetup = (providerId: AgentProviderId) => {
    setConnectForAll(true);
    setSetupProvider(providerId);
  };

  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-9 items-center justify-center rounded-full bg-muted">
          <Icon name="sparkles" className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Connect your AI agent</p>
          <p className="text-xs text-muted-foreground">
            Choose a provider below and add your API key to start building.
          </p>
        </div>
        <div className="flex w-full max-w-56 flex-col gap-2">
          {AGENT_PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => handleOpenSetup(provider.id)}
            >
              <Icon name={PROVIDER_ICONS[provider.id]} className="size-3.5" />
              {PROVIDER_SHORT_LABELS[provider.id]}
            </Button>
          ))}
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => router.push('/ycode/settings/agent')}
        >
          Open Agent settings
        </button>
      </div>

      <Dialog open={activeProvider !== null} onOpenChange={(open) => !open && setSetupProvider(null)}>
        {activeProvider && (
          <DialogContent width="26rem">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Icon name={PROVIDER_ICONS[activeProvider.id]} className="size-3.5" />
                Connect {PROVIDER_SHORT_LABELS[activeProvider.id]}
              </DialogTitle>
            </DialogHeader>
            <div className="border-t -mt-3 pt-4 flex flex-col gap-5">
              {/* Ollama is configured by endpoint + model (and usually no key),
                  so the key-availability switch doesn't apply to it. */}
              {activeProvider.keyOptional ? null : (
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <FieldLabel
                      htmlFor={`${activeProvider.id}-panel-connect-scope`}
                      className="mb-1"
                    >
                      Available to all users on this project
                    </FieldLabel>
                    <FieldDescription className="mb-0">
                      When off, the key works only for you — other users can connect
                      their own {activeProvider.label} key.
                    </FieldDescription>
                  </div>
                  <Switch
                    id={`${activeProvider.id}-panel-connect-scope`}
                    checked={connectForAll}
                    onCheckedChange={setConnectForAll}
                  />
                </div>
              )}
              <AgentKeyForm
                provider={activeProvider}
                submitLabel="Connect"
                keyScope={connectForAll ? 'all' : 'personal'}
                onDone={() => setSetupProvider(null)}
                onCancel={() => setSetupProvider(null)}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// Memoized so a streamed token (which replaces the `messages` array reference)
// only re-renders the one message whose object actually changed, not the whole
// transcript. Finished messages keep a stable reference and the revert/redo
// callbacks are stable Zustand actions, so the default shallow compare is safe.
const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  onRevert,
  onRedo,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  onRevert: (messageId: string) => void;
  onRedo: (messageId: string) => void;
}) {
  if (message.role === 'user' && message.review) {
    return (
      <div className="self-stretch flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon name="eye" className="size-3 shrink-0" />
        <span>Reviewing the result…</span>
        {message.images?.[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.images[0].dataUrl}
            alt="Review screenshot"
            className="ml-auto size-8 rounded object-cover border"
          />
        )}
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="self-end max-w-[100%] flex flex-col items-end gap-1.5">
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.images.map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.id}
                src={image.dataUrl}
                alt="Attachment"
                className="size-20 rounded-lg object-cover border"
              />
            ))}
          </div>
        )}
        {message.text && (
          <CollapsibleUserMessage>
            <MessageTextWithMentions text={message.text} mentions={message.mentions} />
          </CollapsibleUserMessage>
        )}
      </div>
    );
  }

  // Fall back to text/toolCalls for legacy messages that predate `parts`.
  const parts: ChatMessagePart[] =
    message.parts && message.parts.length > 0
      ? message.parts
      : [
        ...message.toolCalls.map((call) => ({ type: 'tool' as const, call })),
        ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
      ];

  // Once a turn runs tools, the whole transcript (narration, tool steps, and the
  // model's full closing text) collapses under "Thought for Ns". Only a compact
  // Changes card + a one-line summary stay visible so finished replies are short.
  // Turns with no tools (e.g. a clarifying question) render as plain text.
  const hasToolParts = parts.some((part) => part.type === 'tool');
  const lastPart = parts[parts.length - 1];
  const closingText = hasToolParts && lastPart?.type === 'text' ? lastPart.text.trim() : '';
  const shortSummary = clipSummary(closingText);
  const plainText = hasToolParts ? '' : message.text.trim();

  // Global status is shared across bubbles; only the unfinished (no thinkingMs)
  // turn is the one actually streaming right now.
  const isActivelyStreaming = isStreaming && message.thinkingMs === undefined;

  return (
    <div className="flex flex-col gap-2">
      {(hasToolParts || isActivelyStreaming) && (
        <ThoughtDisclosure
          parts={parts} thinkingMs={message.thinkingMs}
          streaming={isActivelyStreaming}
        />
      )}

      {!isActivelyStreaming && message.changes && message.changes.length > 0 && (
        <ChangesCard
          changes={message.changes}
          canRevert={message.canRevert}
          reverted={message.reverted}
          disabled={isStreaming}
          onUndo={() => onRevert(message.id)}
          onRedo={() => onRedo(message.id)}
        />
      )}

      {!isActivelyStreaming && shortSummary && <MarkdownText text={shortSummary} />}

      {!isActivelyStreaming && plainText && <MarkdownText text={plainText} />}

      {!isActivelyStreaming && message.error && <ErrorNotice message={message.error} />}
    </div>
  );
});

function ToolCallRow({ call }: { call: ChatToolCall }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {call.ok === undefined ? (
        <Spinner className="size-3" />
      ) : (
        <Icon
          name="check"
          className="size-3 text-foreground"
        />
      )}
      <span>{toolCallLabel(call.name)}</span>
    </div>
  );
}

type PartGroup =
  | { type: 'tools'; calls: ChatToolCall[] }
  | { type: 'text'; text: string };

/** Collapse an ordered parts list into render groups, merging consecutive tool
 * calls into a single tight checklist. */
function groupParts(parts: ChatMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const part of parts) {
    if (part.type === 'tool') {
      const last = groups[groups.length - 1];
      if (last && last.type === 'tools') {
        last.calls.push(part.call);
      } else {
        groups.push({ type: 'tools', calls: [part.call] });
      }
    } else if (part.text) {
      groups.push({ type: 'text', text: part.text });
    }
  }
  return groups;
}

/**
 * Cheap markdown-syntax stripper for live-streamed narration. Re-parsing real
 * markdown (marked + DOMPurify) on every streamed token is expensive and
 * flickers on half-written syntax, but raw markers like **Publish** must never
 * reach the user either — so streaming text drops the syntax and renders the
 * words plain. Tolerates unterminated markers mid-stream.
 */
function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    // Links: keep the label; a partially streamed "[label](htt" keeps the label.
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)?/g, '$1');
}

/** The intermediate narration + tool steps, shown inside the collapsed trail.
 * Narration text is dimmed so the closing summary below stays the focus.
 *
 * While streaming, narration is rendered as markdown-stripped plain text (see
 * stripMarkdownSyntax). The trail collapses once the turn finishes, so the
 * full markdown render only runs when the user re-expands it. */
function ThinkingTrail({ parts, streaming }: { parts: ChatMessagePart[]; streaming: boolean }) {
  // Failed tool calls are hidden: the agent retries after errors, so showing
  // red X rows only alarms the user about steps that were already recovered.
  // In-flight calls (ok === undefined) stay visible with their spinner.
  const visibleParts = parts.filter((part) => part.type !== 'tool' || part.call.ok !== false);
  const groups = groupParts(visibleParts);
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group, index) =>
        group.type === 'tools' ? (
          <div key={index} className="flex flex-col gap-1">
            {group.calls.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
          </div>
        ) : (
          <div key={index} className="opacity-60">
            {streaming ? (
              <div className="text-xs leading-relaxed break-words whitespace-pre-wrap">{stripMarkdownSyntax(group.text)}</div>
            ) : (
              <MarkdownText text={group.text} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

/** Condense a verbose closing message into a one-line takeaway: first paragraph,
 * at most two sentences, capped in length (the full text lives under "Thought").
 * Headings/bullets the model sometimes emits ("Looks great:") are dropped. */
function clipSummary(text: string): string {
  const firstParagraph = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !/^[#*-]/.test(block) && !/:$/.test(block));
  if (!firstParagraph) return '';

  const normalized = firstParagraph.replace(/\s+/g, ' ').trim();
  const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  let summary = sentences && sentences.length > 2 ? sentences.slice(0, 2).join('').trim() : normalized;

  const MAX = 240;
  if (summary.length > MAX) {
    const clipped = summary.slice(0, MAX);
    const stop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
    summary = `${stop > 80 ? clipped.slice(0, stop + 1) : clipped.trimEnd()}…`;
  }
  return summary;
}

/** Human-readable turn duration: "8s", "1m 5s". */
function formatDuration(ms?: number): string {
  if (!ms || ms < 1000) return '1s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Rotating header phrases for the stretches where the model is working but
 * nothing visible streams (reasoning models can think silently for tens of
 * seconds). Generic on purpose — real actions are narrated by the tool rows
 * underneath; these just keep the header alive between them.
 */
const WORKING_PHRASES = [
  'Working…',
  'Thinking it through…',
  'Planning the changes…',
  'Working out the details…',
  'Putting it together…',
  'Still on it…',
];

/** Seconds each working phrase stays up before rotating to the next. */
const WORKING_PHRASE_SECONDS = 5;

/** Live turn header: rotates through working phrases and ticks the elapsed
 * time every second, so the status visibly moves even while the model is
 * silent. Mounted fresh for each streaming turn (unmounts when it ends). */
function LiveWorkingLabel() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const phrase = WORKING_PHRASES[
    Math.floor(elapsed / WORKING_PHRASE_SECONDS) % WORKING_PHRASES.length
  ];

  return (
    <span>
      {phrase}
      {elapsed > 0 && <span className="tabular-nums text-muted-foreground/70"> {elapsed}s</span>}
    </span>
  );
}

/**
 * Collapsible "Thought for Ns" header wrapping a turn's narration and tool
 * steps. While streaming it stays expanded with a live spinner; once done it
 * collapses by default so only the summary + Changes card remain visible.
 */
function ThoughtDisclosure({
  parts,
  thinkingMs,
  streaming,
}: {
  parts: ChatMessagePart[];
  thinkingMs?: number;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = streaming || open;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (!streaming) setOpen((value) => !value);
        }}
        disabled={streaming}
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default"
      >
        {streaming ? (
          <Spinner className="size-3" />
        ) : (
          <Icon name="chevronRight" className={cn('size-3 transition-transform', open && 'rotate-90')} />
        )}
        {streaming ? <LiveWorkingLabel /> : <span>{`Thought for ${formatDuration(thinkingMs)}`}</span>}
      </button>
      {expanded && (
        <div className="ml-1 border-l border-border pl-2.5">
          <ThinkingTrail parts={parts} streaming={streaming} />
        </div>
      )}
    </div>
  );
}

/** Post-turn summary of which pages changed and how many of their layers were
 * affected, matching the canvas "Changes" card. Offers a one-click Undo that
 * restores every listed page to its pre-turn state. */
function ChangesCard({
  changes,
  canRevert,
  reverted,
  disabled,
  onUndo,
  onRedo,
}: {
  changes: TurnChange[];
  canRevert?: boolean;
  reverted?: boolean;
  disabled?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const pages = usePagesStore((s) => s.pages);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Changes</span>
        {canRevert ? (
          <Button
            variant="ghost"
            size="sm"
            className="-mr-1.5 h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={reverted ? onRedo : onUndo}
            disabled={disabled}
          >
            <Icon name={reverted ? 'redo' : 'undo'} className="size-3" />
            {reverted ? 'Redo' : 'Undo'}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col">
        {changes.map((change) => {
          const page = pages.find((p) => p.id === change.pageId);
          const isHome = page ? page.is_index && page.page_folder_id === null : false;
          return (
            <div
              key={change.pageId}
              className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs"
            >
              <Icon name={isHome ? 'homepage' : 'page'} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{change.pageName}</span>
              <span className="shrink-0 text-muted-foreground">
                {change.layerCount} {change.layerCount === 1 ? 'Layer' : 'Layers'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
