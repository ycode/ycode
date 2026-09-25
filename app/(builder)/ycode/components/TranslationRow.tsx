'use client';

import React, { useState, useRef, useCallback } from 'react';
import { CodeEditor } from '@/components/ui/code-editor';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Separator } from '@/components/ui/separator';
import RichTextEditor from './RichTextEditor';
import RichTextEditorSheet from './RichTextEditorSheet';
import type { FieldGroup } from './CollectionFieldSelector';
import FileManagerDialog from './FileManagerDialog';
import { sanitizeSlug, checkDuplicatePageSlug, checkDuplicateFolderSlug, type ValidationResult } from '@/lib/page-utils';
import { looksLikeTiptapJson } from '@/lib/localisation-utils';
import { tiptapDocToCanonicalString } from '@/lib/tiptap-utils';
import { parseValueToContent } from '@/lib/cms-variables-utils';
import { flattenFieldGroups, SIMPLE_TEXT_FIELD_TYPES } from '@/lib/collection-field-utils';
import type { TranslatableItem } from '@/lib/localisation-utils';
import type { Translation, CollectionField, Collection, CreateTranslationData, UpdateTranslationData, Page, PageFolder, Asset, Layer } from '@/types';
import { useAsset } from '@/hooks/use-asset';
import { getAssetIcon, isAssetOfType, getAssetCategoryFromMimeType, ASSET_CATEGORIES } from '@/lib/asset-utils';
import { buildAssetFolderPath } from '@/lib/asset-folder-utils';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { toast } from 'sonner';
import type { IconProps } from '@/components/ui/icon';
import type { AssetCategory } from '@/types';

interface TranslationRowProps {
  item: TranslatableItem;
  selectedLocaleId: string | null;
  localInputValues: Record<string, string>;
  onLocalValueChange: (key: string, value: string) => void;
  onLocalValueClear: (key: string) => void;
  getTranslationByKey: (localeId: string, key: string) => Translation | undefined;
  createTranslation: (data: CreateTranslationData) => Promise<Translation | null>;
  updateTranslation: (translation: Translation, data: UpdateTranslationData) => Promise<void>;
  updateTranslationValue: (translation: Translation, contentValue: string) => Promise<void>;
  updateTranslationStatus: (translation: Translation, isCompleted: boolean) => Promise<void>;
  deleteTranslation: (translation: Translation) => Promise<void>;
  // Optional: For pages with CMS fields and inline variables support
  fieldGroups?: FieldGroup[];
  /** Resolved layer for the item (provides context like pagination variables) */
  layer?: Layer | null;
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  // For slug validation
  pages?: Page[];
  folders?: PageFolder[];
  sourceItem?: Page | PageFolder;
}

/**
 * Reusable component for rendering a translation row
 * Uses RichTextEditor for consistent styling across all content types
 */
export default function TranslationRow({
  item,
  selectedLocaleId,
  localInputValues,
  onLocalValueChange,
  onLocalValueClear,
  getTranslationByKey,
  createTranslation,
  updateTranslationValue,
  updateTranslationStatus,
  deleteTranslation,
  fieldGroups,
  layer,
  allFields,
  collections,
  pages = [],
  folders = [],
  sourceItem,
}: TranslationRowProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [isRichTextSheetOpen, setIsRichTextSheetOpen] = useState(false);
  const richTextValueRef = useRef<string | null>(null);
  const [pendingCompletions, setPendingCompletions] = useState<Record<string, boolean | null>>({});
  const [isUpdatingCompletion, setIsUpdatingCompletion] = useState(false);

  // Get translation from store
  const translation = selectedLocaleId
    ? getTranslationByKey(selectedLocaleId, item.key)
    : null;
  const storeValue = translation?.content_value || '';

  // Check if this is rich text content (stored as JSON string)
  const isRichText = item.content_type === 'richtext';
  const openInSheet = isRichText && item.open_in_sheet === true;

  // Raw HTML/JS (page custom code) — edited in a syntax-highlighted editor
  const isCode = item.content_type === 'code';

  // Flatten field groups for parseValueToContent fallback
  const flatFields = React.useMemo(() => flattenFieldGroups(fieldGroups), [fieldGroups]);

  const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

  // Parse a richtext value (always Tiptap JSON after migration).
  // Falls back to parseValueToContent for legacy inline-variable strings.
  const parseRichTextValue = (val: string): any => {
    const trimmed = val.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(val);
        if (parsed?.type === 'doc') return parsed;
      } catch { /* not valid JSON */ }
    }
    return parseValueToContent(val, flatFields, undefined, allFields);
  };

  // Parse original value if it's rich text (JSON string → Tiptap JSON)
  let originalValueForEditor: string | any = item.content_value;
  if (isRichText) {
    if (item.content_value && typeof item.content_value === 'string') {
      originalValueForEditor = parseRichTextValue(item.content_value);
    } else if (!item.content_value) {
      originalValueForEditor = emptyDoc;
    }
  }

  // Use local value if available, otherwise use store value.
  // Guard against content_type/value-shape mismatches: a plain-text item may
  // carry a legacy translation stored as a Tiptap JSON doc string — flatten it
  // to plain text so the cell shows readable content instead of raw JSON.
  const rawTranslationValue = localInputValues[item.key] !== undefined
    ? localInputValues[item.key]
    : storeValue;
  const translationValue = !isRichText && !isCode && looksLikeTiptapJson(rawTranslationValue)
    ? tiptapDocToCanonicalString(JSON.parse(rawTranslationValue))
    : rawTranslationValue;

  // For rich text, parse JSON string to Tiptap JSON object for RichTextEditor
  let translationValueForEditor: string | any = translationValue;
  if (isRichText) {
    if (translationValue && typeof translationValue === 'string') {
      translationValueForEditor = parseRichTextValue(translationValue);
    } else if (!translationValue) {
      translationValueForEditor = emptyDoc;
    }
  }

  // Check if the rich text translation is empty (no real text content) — only relevant for sheet items
  const isRichTextTranslationEmpty = openInSheet && (
    !translationValue ||
    translationValue === '' ||
    (() => {
      if (typeof translationValueForEditor === 'object' && translationValueForEditor?.content) {
        return !translationValueForEditor.content.some((block: any) =>
          block.content?.some((node: any) =>
            (node.type === 'text' && node.text?.trim()) || node.type === 'dynamicVariable'
          )
        );
      }
      return true;
    })()
  );

  // Build a preview string from the original value for use as the right-side placeholder.
  // Variable references are rendered as `[Label]` so they're clearly distinguished from
  // user-translatable text (mirrors the old localization UI).
  const originalPreviewText = (() => {
    if (isCode) return '';
    const tiptapDoc = isRichText && typeof originalValueForEditor === 'object'
      ? originalValueForEditor
      : (item.content_value ? parseValueToContent(item.content_value, flatFields, undefined, allFields) : null);
    if (!tiptapDoc?.content) return '';
    const walk = (nodes: any[]): string =>
      nodes.map((n: any) => {
        if (n.type === 'text') return n.text || '';
        if (n.type === 'dynamicVariable') {
          const label = n.attrs?.label || n.attrs?.variable?.label || 'variable';
          return `[${label}]`;
        }
        if (n.content) return walk(n.content);
        return '';
      }).join('');
    return walk(tiptapDoc.content).trim();
  })();

  // Check if this is an asset
  const isAsset = item.content_type === 'asset_id';

  // Get asset data for display
  const sourceAsset = useAsset(isAsset ? item.content_value : null);
  const translatedAsset = useAsset(isAsset ? translationValue : null);

  // Determine which asset to display (translated if exists, otherwise source)
  // In asset translation context, we always have at least sourceAsset
  const displayedAsset = translatedAsset || sourceAsset;

  // Get asset category from source asset for filtering
  const assetCategory: AssetCategory | null = sourceAsset
    ? getAssetCategoryFromMimeType(sourceAsset.mime_type)
    : null;

  // Get asset folders from assets store for building folder paths
  const assetFolders = useAssetsStore((state) => state.folders);

  // Check if this is a slug field (supports both old 'slug' format and new 'field:key:slug' format)
  const isSlugField = item.content_key === 'slug' || item.content_key === 'field:key:slug';

  // Update local state on change (immediate UI feedback)
  const handleTranslationChange = (value: string | any) => {
    let processedValue = value;

    // For rich text, stringify Tiptap JSON object to store as string
    if (isRichText && typeof value === 'object') {
      processedValue = JSON.stringify(value);
    } else if (isSlugField && typeof value === 'string') {
      // Slugify if this is a slug field
      processedValue = sanitizeSlug(value, true); // Allow trailing dash for better UX while typing
    }

    onLocalValueChange(item.key, processedValue);

    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError(null);
    }
  };

  // Dedicated handler for the rich text sheet — writes to ref so close handler always reads latest
  const handleRichTextSheetChange = useCallback((value: any) => {
    const stringified = typeof value === 'object' ? JSON.stringify(value) : value;
    richTextValueRef.current = stringified;
    onLocalValueChange(item.key, stringified);
  }, [item.key, onLocalValueChange]);

  // Save to store/API on blur (optimistic update + API call)
  const handleTranslationBlur = (value: string | any) => {
    if (!selectedLocaleId) return;

    let finalValue = value;

    // For rich text, stringify Tiptap JSON object to store as string
    if (isRichText && typeof value === 'object') {
      finalValue = JSON.stringify(value);
    } else if (isSlugField && typeof value === 'string') {
      // Slugify and validate if this is a slug field
      // Finalize slug (remove trailing dashes)
      finalValue = sanitizeSlug(value, false);

      // Validate slug uniqueness
      if (finalValue && sourceItem) {
        let validationResult: ValidationResult = { isValid: true };

        if (item.source_type === 'page') {
          const page = sourceItem as Page;
          validationResult = checkDuplicatePageSlug(
            finalValue,
            pages,
            page.page_folder_id,
            page.is_published,
            page.id
          );
        } else if (item.source_type === 'folder') {
          const folder = sourceItem as PageFolder;
          validationResult = checkDuplicateFolderSlug(
            finalValue,
            folders,
            folder.page_folder_id,
            folder.id
          );
        }

        if (!validationResult.isValid) {
          setValidationError(validationResult.error || 'This slug is already in use');
          // Update local value to show the finalized slug
          onLocalValueChange(item.key, finalValue);
          return; // Don't save if validation fails
        }
      }

      // Update local value to show the finalized slug
      if (finalValue !== value) {
        onLocalValueChange(item.key, finalValue);
      }
    }

    // Clear local value (will use store value after save)
    onLocalValueClear(item.key);

    // Only save if the value actually changed
    if (finalValue === storeValue) {
      return;
    }

    const translationData: CreateTranslationData = {
      locale_id: selectedLocaleId,
      source_type: item.source_type as CreateTranslationData['source_type'],
      source_id: item.source_id,
      content_key: item.content_key,
      content_type: item.content_type as CreateTranslationData['content_type'],
      content_value: finalValue,
    };

    setIsSaving(true);

    const savePromise = translation
      ? updateTranslationValue(translation, finalValue)
      : (() => {
        // Start the creation (which creates optimistic translation synchronously)
        const creationPromise = createTranslation(translationData);

        // Capture temp-id after optimistic translation is created
        const tempTranslation = getTranslationByKey(selectedLocaleId, item.key);
        const tempId = tempTranslation?.id.startsWith('temp-') ? tempTranslation.id : null;

        if (tempId) {
          // Track temp-id with null (no pending completion update)
          setPendingCompletions((prev) => ({
            ...prev,
            [tempId]: null,
          }));
        }

        return creationPromise.then((newTranslation) => {
          if (!newTranslation || !tempId) return;

          // Read the desired completion value and remove from pending list
          let desiredCompletion: boolean | null | undefined;
          setPendingCompletions((prev) => {
            desiredCompletion = prev[tempId];
            const next = { ...prev };
            delete next[tempId];
            return next;
          });

          // Fire update outside of state setter to avoid render issues
          if (desiredCompletion !== null && desiredCompletion !== undefined) {
            setTimeout(() => {
              setIsUpdatingCompletion(true);
              updateTranslationStatus(newTranslation, desiredCompletion!)
                .catch((error) => {
                  console.error('Failed to update completion status after creation:', error);
                })
                .finally(() => {
                  setIsUpdatingCompletion(false);
                });
            }, 0);
          }
        });
      })();

    savePromise
      .catch((error) => {
        console.error('Failed to save translation:', error);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  // Reset translation
  const handleReset = () => {
    if (!selectedLocaleId) return;
    const translation = getTranslationByKey(selectedLocaleId, item.key);
    if (translation) {
      deleteTranslation(translation);
    }
  };

  // Toggle completed status
  const handleToggleCompleted = () => {
    if (!selectedLocaleId || isUpdatingCompletion) return;

    const translation = getTranslationByKey(selectedLocaleId, item.key);

    // Fire and forget - don't block UI
    if (translation) {
      // Check if this translation is pending creation
      if (translation.id.startsWith('temp-') && pendingCompletions[translation.id] !== undefined) {
        // Translation is being created - just update the pending completion value
        setPendingCompletions((prev) => ({
          ...prev,
          [translation.id]: !translation.is_completed,
        }));
        return;
      }

      // Translation exists with real ID - toggle completion status
      if (!translation.id.startsWith('temp-')) {
        setIsUpdatingCompletion(true);
        updateTranslationStatus(translation, !translation.is_completed)
          .catch((error) => {
            console.error('Failed to toggle completion status:', error);
          })
          .finally(() => {
            setIsUpdatingCompletion(false);
          });
      }
    } else {
      // Check if there's a translation being created (has temp-id)
      const tempTranslation = getTranslationByKey(selectedLocaleId, item.key);
      const hasPendingCreation = tempTranslation?.id.startsWith('temp-');

      if (hasPendingCreation && tempTranslation) {
        // Translation is being created - track completion for when it's created
        const tempId = tempTranslation.id;
        setPendingCompletions((prev) => ({
          ...prev,
          [tempId]: true,
        }));
        return;
      }

      // No pending creation - create translation with is_completed in single query
      const translationData: CreateTranslationData = {
        locale_id: selectedLocaleId,
        source_type: item.source_type as CreateTranslationData['source_type'],
        source_id: item.source_id,
        content_key: item.content_key,
        content_type: item.content_type as CreateTranslationData['content_type'],
        content_value: '', // Empty string means "use original"
        is_completed: true, // Set completion status directly
      };

      setIsUpdatingCompletion(true);
      createTranslation(translationData)
        .catch((error) => {
          console.error('Failed to create translation:', error);
        })
        .finally(() => {
          setIsUpdatingCompletion(false);
        });
    }
  };

  // Handle asset selection
  const handleAssetSelect = (asset: Asset): void | false => {
    if (!selectedLocaleId) return false;

    // Validate asset type matches source asset category
    if (assetCategory && asset.mime_type) {
      if (!isAssetOfType(asset.mime_type, assetCategory)) {
        const categoryLabels: Record<AssetCategory, string> = {
          images: 'an image',
          videos: 'a video',
          audio: 'an audio file',
          icons: 'an icon',
          documents: 'a document',
        };

        const expectedType = categoryLabels[assetCategory] || 'file with the correct type';

        toast.error('Invalid asset type', {
          description: `Please select ${expectedType}.`,
        });

        return false; // Don't close file manager
      }
    }

    // Update local value with asset ID
    onLocalValueChange(item.key, asset.id);

    // Save immediately
    const translationData: CreateTranslationData = {
      locale_id: selectedLocaleId,
      source_type: item.source_type as CreateTranslationData['source_type'],
      source_id: item.source_id,
      content_key: item.content_key,
      content_type: item.content_type as CreateTranslationData['content_type'],
      content_value: asset.id,
    };

    setIsSaving(true);

    const savePromise = translation
      ? updateTranslationValue(translation, asset.id)
      : createTranslation(translationData);

    savePromise
      .catch((error) => {
        console.error('Failed to save asset translation:', error);
      })
      .finally(() => {
        setIsSaving(false);
        setIsAssetPickerOpen(false);
      });
  };

  // Get folder path for an asset
  const getAssetFolderPath = (asset: Asset | null): string | null => {
    if (!asset) {
      return null;
    }

    // If asset has no folder, show "All files" as root
    if (!asset.asset_folder_id) {
      return 'All files';
    }

    const folder = assetFolders.find((f) => f.id === asset.asset_folder_id);
    if (!folder) {
      return 'All files';
    }

    // Build folder path and prepend "All files / "
    const folderPath = buildAssetFolderPath(folder, assetFolders) as string;
    return `All files / ${folderPath}`;
  };

  // Render asset preview based on type
  const renderAssetPreview = (asset: Asset) => {
    const isIcon = asset.content && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.ICONS);
    const isVideo = isAssetOfType(asset.mime_type, ASSET_CATEGORIES.VIDEOS);
    const isAudio = isAssetOfType(asset.mime_type, ASSET_CATEGORIES.AUDIO);
    const isImage = isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES) && !isIcon;
    const folderPath = getAssetFolderPath(asset);

    const showCheckerboard = isIcon || isImage;

    return (
      <>
        <div className={`size-8 rounded overflow-hidden shrink-0 flex items-center justify-center relative isolate`}>
          {/* Checkerboard pattern for transparency - only for images and icons */}
          {showCheckerboard
            ? <div className="absolute inset-0 opacity-10 bg-checkerboard" />
            : <div className="absolute inset-0 bg-secondary" />
          }
          {isIcon && asset.content ? (
            // Render SVG icon content
            <div
              data-icon="true"
              className="relative w-full h-full flex items-center justify-center text-foreground p-1 z-10"
              dangerouslySetInnerHTML={{ __html: asset.content }}
            />
          ) : isVideo || isAudio ? (
            // Show icon for video/audio
            <Icon name={getAssetIcon(asset.mime_type) as IconProps['name']} className="size-4 opacity-50 relative z-10" />
          ) : isImage && asset.public_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.public_url}
              alt={asset.filename}
              className="relative w-full h-full object-cover z-10"
            />
          ) : (
            // Fallback icon
            <Icon name={getAssetIcon(asset.mime_type) as IconProps['name']} className="size-4 opacity-50 relative z-10" />
          )}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs truncate text-foreground/80">{asset.filename}</span>
          {folderPath && (
            <span className="text-[11px] text-muted-foreground/70 truncate">{folderPath}</span>
          )}
        </div>
      </>
    );
  };

  return (
    <li key={item.key} className="flex flex-col gap-1.5">
      {/* Item header */}
      <div className="flex items-center gap-1.75">
        {item.info.segments && item.info.segments.length > 0 ? (
          <div className="flex items-center gap-1.25">
            {item.info.segments.map((segment, index) => (
              <React.Fragment key={index}>
                {index > 0 && (
                  <Icon name="chevronRight" className="shrink-0 size-2.5 opacity-40" />
                )}
                <div className="size-5 flex items-center justify-center rounded-[6px] bg-secondary/50">
                  <Icon name={segment.icon} className="shrink-0 size-2.5 opacity-50" />
                </div>
                <span className="text-xs font-medium opacity-60">{segment.label}</span>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <>
            <div className="size-5 flex items-center justify-center rounded-[6px] bg-secondary/50">
              <Icon name={item.info.icon} className="shrink-0 size-2.5 opacity-50" />
            </div>

            <span className="text-xs font-medium opacity-60">{item.info.label}</span>
          </>
        )}

        {item.info.description && (
          <>
            <Separator className="w-3! bg-foreground/8" />
            <div className="text-[11px] text-muted-foreground/70">{item.info.description}</div>
          </>
        )}

        <Separator className="min-w-0 flex-1 bg-foreground/8" />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggleCompleted}
            disabled={isUpdatingCompletion}
            className={`flex items-center justify-center pl-2 pr-2.5 py-0.75 gap-1.25 rounded-sm transition-colors cursor-pointer ${translation?.is_completed === true ? 'bg-green-400/6' : 'bg-secondary/50'} disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isUpdatingCompletion ? 'Updating...' : (translation?.is_completed === true ? 'Mark as not completed' : 'Mark as completed')}
          >
            {isUpdatingCompletion ? (
              <Spinner className="size-3 text-muted-foreground/50" />
            ) : translation?.is_completed === true ? (
              <Icon name="check" className="size-3 text-green-600 dark:text-green-400" />
            ) : (
              <Icon name="block" className="size-2.25 text-muted-foreground/50" />
            )}

            <span className="text-[10px] uppercase font-medium text-muted-foreground">{translation?.is_completed === true ? 'Done' : 'To do'}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-full grid grid-cols-2 gap-2">
          {/* Left side (default locale value, read-only) */}
          {isAsset && sourceAsset ? (
            <div className="flex items-center gap-2 p-2 border border-border/50 rounded-md bg-secondary/20 opacity-80">
              {renderAssetPreview(sourceAsset)}
            </div>
          ) : isCode ? (
            <CodeEditor
              value={item.content_value}
              readOnly={true}
              className="max-h-64 opacity-60"
            />
          ) : (
            <div className="text-sm opacity-50">
              <RichTextEditor
                value={originalValueForEditor}
                onChange={() => {}}
                placeholder=""
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
                disabled={true}
                withFormatting={isRichText}
                showFormattingToolbar={false}
              />
            </div>
          )}

          {/* Right side (translation value, editable) */}
          <div className="flex flex-col gap-1">
            {isAsset ? (
              <div
                className="flex items-center gap-2 p-2 border border-border/50 rounded-md bg-secondary/20 cursor-pointer hover:bg-secondary/35 transition-colors"
                onClick={() => setIsAssetPickerOpen(true)}
              >
                {displayedAsset && (
                  <>
                    {renderAssetPreview(displayedAsset)}
                  </>
                )}
              </div>
            ) : isCode ? (
              // Blur bubbles from the inner textarea, so the wrapper commits the edit
              <div onBlur={() => handleTranslationBlur(translationValue)}>
                <CodeEditor
                  value={translationValue}
                  onValueChange={handleTranslationChange}
                  placeholder={
                    translation?.is_completed === true
                      ? '(Using original)'
                      : 'Enter translation...'
                  }
                  className="max-h-64"
                />
              </div>
            ) : openInSheet ? (
              <div
                className="cursor-pointer"
                onClick={() => setIsRichTextSheetOpen(true)}
              >
                {isRichTextTranslationEmpty ? (
                  <div className="min-h-7 px-2.5 py-1 flex items-center">
                    <span className="text-muted-foreground/50 text-xs">
                      {translation?.is_completed === true ? '(Using original)' : 'Click to edit...'}
                    </span>
                  </div>
                ) : (
                  <div className="pointer-events-none">
                    <RichTextEditor
                      value={translationValueForEditor}
                      onChange={() => {}}
                      placeholder=""
                      fieldGroups={fieldGroups}
                      allFields={allFields}
                      collections={collections}
                      withFormatting={true}
                      showFormattingToolbar={false}
                      disabled={true}
                    />
                  </div>
                )}
              </div>
            ) : isRichText ? (
              <RichTextEditor
                value={translationValueForEditor}
                onChange={handleTranslationChange}
                onBlur={handleTranslationBlur}
                placeholder={
                  translation?.is_completed === true
                    ? '(Using original)'
                    : (originalPreviewText || 'Enter translation...')
                }
                className={`min-h-7 [&_.ProseMirror]:py-1 [&_.ProseMirror]:px-2.5 [&_.ProseMirror]:bg-transparent!`}
                fieldGroups={fieldGroups}
                layer={layer}
                allFields={allFields}
                collections={collections}
                withFormatting={true}
                showFormattingToolbar={false}
                allowedFieldTypes={SIMPLE_TEXT_FIELD_TYPES}
              />
            ) : (
              <RichTextEditor
                value={translationValueForEditor}
                onChange={handleTranslationChange}
                onBlur={handleTranslationBlur}
                placeholder={
                  translation?.is_completed === true
                    ? '(Using original)'
                    : (originalPreviewText || 'Enter translation...')
                }
                className={`min-h-7 [&_.ProseMirror]:py-1 [&_.ProseMirror]:px-2.5 [&_.ProseMirror]:bg-transparent! ${
                  validationError ? '[&_.ProseMirror]:border-destructive!' : ''
                }`}
                fieldGroups={fieldGroups}
                layer={layer}
                allFields={allFields}
                collections={collections}
                allowedFieldTypes={SIMPLE_TEXT_FIELD_TYPES}
              />
            )}
            {validationError && (
              <span className="text-[11px] text-destructive">{validationError}</span>
            )}
          </div>
        </div>
      </div>

      {/* Asset Picker Dialog — only mount when open. FileManagerDialog fetches
          the asset list on mount regardless of `open`, so keeping one mounted
          per asset row would fire a redundant request for every row. */}
      {isAsset && isAssetPickerOpen && (
        <FileManagerDialog
          open={isAssetPickerOpen}
          onOpenChange={setIsAssetPickerOpen}
          onAssetSelect={handleAssetSelect}
          assetId={translationValue || item.content_value || null}
          category={assetCategory || undefined}
        />
      )}

      {/* Rich Text Editor Sheet */}
      {openInSheet && (
        <RichTextEditorSheet
          open={isRichTextSheetOpen}
          onOpenChange={(open) => {
            if (!open && selectedLocaleId) {
              const latestValue = richTextValueRef.current;
              if (latestValue !== null && latestValue !== storeValue) {
                const translationData: CreateTranslationData = {
                  locale_id: selectedLocaleId,
                  source_type: item.source_type as CreateTranslationData['source_type'],
                  source_id: item.source_id,
                  content_key: item.content_key,
                  content_type: item.content_type as CreateTranslationData['content_type'],
                  content_value: latestValue,
                };

                const existingTranslation = getTranslationByKey(selectedLocaleId, item.key);
                const savePromise = existingTranslation
                  ? updateTranslationValue(existingTranslation, latestValue)
                  : createTranslation(translationData);

                savePromise
                  .then(() => onLocalValueClear(item.key))
                  .catch((error) => console.error('Failed to save rich text translation:', error));
              }
              richTextValueRef.current = null;
            }
            setIsRichTextSheetOpen(open);
          }}
          title={item.info.label}
          description={item.info.description || undefined}
          value={translationValueForEditor}
          onChange={handleRichTextSheetChange}
          placeholder="Enter translation..."
          fieldGroups={fieldGroups}
          allFields={allFields}
          collections={collections}
        />
      )}
    </li>
  );
}
