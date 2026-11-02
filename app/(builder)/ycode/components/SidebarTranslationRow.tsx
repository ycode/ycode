'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import FileManagerDialog from './FileManagerDialog';
import RichTextEditor from './RichTextEditor';
import { extractMultilinePlainTextFromTiptap } from '@/lib/tiptap-utils';
import { useAsset } from '@/hooks/use-asset';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { getAssetIcon, isAssetOfType, getAssetCategoryFromMimeType, ASSET_CATEGORIES } from '@/lib/asset-utils';
import { buildAssetFolderPath } from '@/lib/asset-folder-utils';
import { SIMPLE_TEXT_FIELD_TYPES } from '@/lib/collection-field-utils';
import { toast } from 'sonner';
import type { FieldGroup } from '@/lib/collection-field-utils';
import type { TranslatableItem } from '@/lib/localisation-utils';
import type { Translation, CreateTranslationData, UpdateTranslationData, Asset, AssetCategory, Collection, CollectionField, Layer } from '@/types';
import type { IconProps } from '@/components/ui/icon';

/** Empty Tiptap document used when a rich-text field has no content yet. */
const EMPTY_RICH_TEXT_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as const;

/** Parse a stored rich-text string into a Tiptap doc, falling back to an empty doc. */
function parseRichTextDoc(value: string): Record<string, unknown> {
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Not valid JSON — treat as empty so the editor stays usable.
    }
  }
  return { ...EMPTY_RICH_TEXT_DOC };
}

/** True when a serialized Tiptap doc carries no text/variable content. */
function isEmptyRichTextValue(value: string): boolean {
  if (!value) return true;
  try {
    const doc = JSON.parse(value);
    if (!doc || !Array.isArray(doc.content)) return true;
    return !doc.content.some((block: { content?: unknown[] }) =>
      Array.isArray(block.content) && block.content.length > 0
    );
  } catch {
    return !value.trim();
  }
}

interface SidebarTranslationRowProps {
  item: TranslatableItem;
  /**
   * Which half of the translation pair to render. The right sidebar groups
   * rows under language sections (Default → Active), so each item is rendered
   * twice — once as the read-only source, once as the (usually editable)
   * translation for the selected locale.
   */
  side: 'source' | 'translation';
  selectedLocaleId: string | null;
  localInputValues: Record<string, string>;
  onLocalValueChange: (key: string, value: string) => void;
  onLocalValueClear: (key: string) => void;
  getTranslationByKey: (localeId: string, key: string) => Translation | undefined;
  createTranslation: (data: CreateTranslationData) => Promise<Translation | null>;
  updateTranslation: (translation: Translation, data: UpdateTranslationData) => Promise<void>;
  /**
   * When true, the translation side renders a read-only preview with an
   * "Expand to edit" button instead of an editable surface. Used for the
   * rich-text element layer, which edits in the dedicated RichTextEditorSheet.
   */
  previewOnly?: boolean;
  /** Click handler for the "Expand to edit" button shown in preview-only mode. */
  onExpand?: () => void;
  /** Field context passed to the rich-text editor for inline CMS variables. */
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  /** The layer being translated, for rich-text editor context. */
  layer?: Layer | null;
  /** Label the text content row, for layers with several translatable properties. */
  showContentLabel?: boolean;
}

/**
 * Right-sidebar translation editor for a single (item, side) pair.
 *
 * A lighter take on `TranslationRow` (no completion toggle or slug validation)
 * used while browsing the canvas in a non-default locale. Rich-text values are
 * edited with the shared `RichTextEditor` so line breaks and inline marks are
 * preserved; plain-text and asset values fall back to a `Textarea` / picker.
 */
export default function SidebarTranslationRow({
  item,
  side,
  selectedLocaleId,
  localInputValues,
  onLocalValueChange,
  onLocalValueClear,
  getTranslationByKey,
  createTranslation,
  updateTranslation,
  previewOnly = false,
  onExpand,
  fieldGroups,
  allFields,
  collections,
  layer,
  showContentLabel = false,
}: SidebarTranslationRowProps) {
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);

  const translation = selectedLocaleId
    ? getTranslationByKey(selectedLocaleId, item.key)
    : null;
  const storeValue = translation?.content_value || '';

  // The source side always follows the layer's declared content_type, but the
  // translation side must follow whatever was actually stored in the DB row.
  // Legacy migrations and historical rich-text edits can leave a translation
  // stored as `richtext` (Tiptap JSON) on a layer whose source variable is
  // `dynamic_text` — without this preference the editor would render the raw
  // JSON string instead of the translated text. Mirrors the same logic used
  // by `injectTranslatedText` at render time.
  const isSourceRichText = item.content_type === 'richtext';
  const isTranslationRichText = (translation?.content_type ?? item.content_type) === 'richtext';
  const isAsset = item.content_type === 'asset_id';

  // Sub-label shown beneath each language name when a layer has more than
  // one translatable property (e.g. an image has both source + alt text).
  // Text content is only labelled when other rows sit next to it; on its own,
  // the language name plus the textarea already make it obvious.
  const propertyLabel = (() => {
    const suffix = item.content_key.split(':').pop();
    if (item.content_key.includes(':attribute:')) return suffix || null;
    switch (suffix) {
      case 'text': return showContentLabel ? 'Content' : null;
      case 'image_alt': return 'Image ALT';
      case 'image_src': return 'Image';
      case 'video_src': return 'Video';
      case 'video_poster': return 'Video poster';
      case 'audio_src': return 'Audio';
      case 'icon_src': return 'Icon';
      default: return null;
    }
  })();

  // Plain-text projection of the source, kept as multi-line so line breaks show
  // up. Used for the preview textarea and as the rich-text editor placeholder.
  const sourceDisplayValue = (() => {
    if (!isSourceRichText || !item.content_value) return item.content_value || '';
    try {
      return extractMultilinePlainTextFromTiptap(JSON.parse(item.content_value));
    } catch {
      return item.content_value;
    }
  })();

  // Same plain-text projection for the translation: prefer in-flight local
  // input, fall back to whatever is stored on the server.
  const translationDisplayValue = (() => {
    if (localInputValues[item.key] !== undefined) {
      return localInputValues[item.key];
    }
    if (!isTranslationRichText || !storeValue) return storeValue || '';
    try {
      return extractMultilinePlainTextFromTiptap(JSON.parse(storeValue));
    } catch {
      return storeValue;
    }
  })();

  // Rich-text items are edited with the same RichTextEditor used on the
  // localization page, so paragraph structure and inline marks survive the
  // round-trip instead of being flattened to a single plain paragraph.
  const sourceDoc = isSourceRichText ? parseRichTextDoc(item.content_value) : null;
  const translationDoc = (() => {
    const local = localInputValues[item.key];
    if (local !== undefined) return parseRichTextDoc(local);
    return parseRichTextDoc(storeValue);
  })();

  const sourceAsset = useAsset(isAsset ? item.content_value : null);
  const translatedAsset = useAsset(isAsset ? storeValue : null);
  const displayedAsset = translatedAsset || sourceAsset;
  const assetCategory: AssetCategory | null = sourceAsset
    ? getAssetCategoryFromMimeType(sourceAsset.mime_type)
    : null;
  const assetFolders = useAssetsStore((state) => state.folders);

  // Persist a translation value. The simplified sidebar flow has no explicit
  // "complete" toggle — saving any value here means the user committed it, so
  // we mark it completed so injectTranslatedText / runtime rendering picks it
  // up. Partial translations created elsewhere also flip to completed here.
  const saveTranslationValue = (
    finalValue: string,
    contentType: CreateTranslationData['content_type']
  ) => {
    if (!selectedLocaleId) return;

    const savePromise = translation
      ? updateTranslation(translation, { content_value: finalValue, is_completed: true })
      : createTranslation({
        locale_id: selectedLocaleId,
        source_type: item.source_type as CreateTranslationData['source_type'],
        source_id: item.source_id,
        content_key: item.content_key,
        content_type: contentType,
        content_value: finalValue,
        is_completed: true,
      });

    savePromise.catch((error) => console.error('Failed to save translation:', error));
  };

  const handleTextChange = (value: string) => {
    onLocalValueChange(item.key, value);
  };

  const handleTextBlur = (value: string) => {
    if (!selectedLocaleId) return;

    onLocalValueClear(item.key);

    // Skip the save when nothing actually changed (handles focus-then-blur).
    const previousValue = storeValue;
    if (value === previousValue) return;
    if (!value && !previousValue) return;

    saveTranslationValue(value, item.content_type as CreateTranslationData['content_type']);
  };

  // Rich-text edits stream Tiptap JSON. Serialize to a string for storage and
  // keep the in-flight value in local state so the field stays controlled.
  const handleRichChange = (value: unknown) => {
    onLocalValueChange(
      item.key,
      typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
    );
  };

  const handleRichBlur = (value: unknown) => {
    if (!selectedLocaleId) return;

    // Only persist when the user actually edited this field in-session. Without
    // this guard, a blur on an editor that hasn't received its value yet (or was
    // never touched) could overwrite an existing translation with empty content.
    const userEdited = localInputValues[item.key] !== undefined;

    const finalValue = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

    onLocalValueClear(item.key);

    if (!userEdited) return;

    const previousValue = storeValue;
    if (finalValue === previousValue) return;

    // Clearing a translation reverts to the source: store '' (which the renderer
    // treats as "use original") instead of an empty Tiptap doc, matching the
    // localization page behavior.
    if (isEmptyRichTextValue(finalValue)) {
      if (!previousValue) return;
      saveTranslationValue('', 'richtext');
      return;
    }

    saveTranslationValue(finalValue, 'richtext');
  };

  const handleAssetSelect = (asset: Asset): void | false => {
    if (!selectedLocaleId) return false;

    if (assetCategory && asset.mime_type && !isAssetOfType(asset.mime_type, assetCategory)) {
      const categoryLabels: Record<AssetCategory, string> = {
        images: 'an image',
        videos: 'a video',
        audio: 'an audio file',
        icons: 'an icon',
        documents: 'a document',
      };
      toast.error('Invalid asset type', {
        description: `Please select ${categoryLabels[assetCategory] || 'a file with the correct type'}.`,
      });
      return false;
    }

    onLocalValueChange(item.key, asset.id);

    const savePromise = translation
      ? updateTranslation(translation, { content_value: asset.id, is_completed: true })
      : createTranslation({
        locale_id: selectedLocaleId,
        source_type: item.source_type as CreateTranslationData['source_type'],
        source_id: item.source_id,
        content_key: item.content_key,
        content_type: item.content_type as CreateTranslationData['content_type'],
        content_value: asset.id,
        is_completed: true,
      });

    savePromise
      .catch((error) => console.error('Failed to save asset translation:', error))
      .finally(() => setIsAssetPickerOpen(false));
  };

  const getAssetFolderPath = (asset: Asset | null): string | null => {
    if (!asset) return null;
    if (!asset.asset_folder_id) return 'All files';
    const folder = assetFolders.find((f) => f.id === asset.asset_folder_id);
    if (!folder) return 'All files';
    const folderPath = buildAssetFolderPath(folder, assetFolders) as string;
    return `All files / ${folderPath}`;
  };

  const renderAssetPreview = (asset: Asset) => {
    const isIcon = !!asset.content && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.ICONS);
    const isVideo = isAssetOfType(asset.mime_type, ASSET_CATEGORIES.VIDEOS);
    const isAudio = isAssetOfType(asset.mime_type, ASSET_CATEGORIES.AUDIO);
    const isImage = isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES) && !isIcon;
    const folderPath = getAssetFolderPath(asset);
    const showCheckerboard = isIcon || isImage;

    return (
      <>
        <div className="size-8 rounded overflow-hidden flex-shrink-0 flex items-center justify-center relative">
          {showCheckerboard
            ? <div className="absolute inset-0 opacity-10 bg-checkerboard" />
            : <div className="absolute inset-0 bg-secondary" />
          }
          {isIcon && asset.content ? (
            <div
              data-icon="true"
              className="relative w-full h-full flex items-center justify-center text-foreground p-1 z-10"
              dangerouslySetInnerHTML={{ __html: asset.content }}
            />
          ) : isVideo || isAudio ? (
            <Icon name={getAssetIcon(asset.mime_type) as IconProps['name']} className="size-4 opacity-50 relative z-10" />
          ) : isImage && asset.public_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.public_url}
              alt={asset.filename}
              className="relative w-full h-full object-cover z-10"
            />
          ) : (
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

  // Cap height so long translations scroll inside the field instead of
  // pushing the rest of the inspector down (Textarea uses field-sizing-content
  // by default, which auto-grows).
  const textareaClass = 'resize-none max-h-32 overflow-y-auto';

  // Match the plain Textarea box (padding, min/max height) so the rich-text
  // editor blends in with the other sidebar fields. The editor already supplies
  // its own `bg-input rounded-lg border-transparent` frame in the compact
  // variant, so we only override sizing here.
  const richEditorClass = 'min-h-16 max-h-32 overflow-y-auto px-3 py-2';

  return (
    <div className="flex flex-col gap-1.5">
      {propertyLabel && (
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
          {propertyLabel}
        </Label>
      )}

      {side === 'source' ? (
        isAsset ? (
          <div className="flex items-center gap-2 p-2 border border-border/50 rounded-md bg-secondary/20 opacity-80">
            {sourceAsset && renderAssetPreview(sourceAsset)}
          </div>
        ) : isSourceRichText && sourceDoc && !previewOnly ? (
          <RichTextEditor
            value={sourceDoc}
            onChange={() => {}}
            placeholder=""
            disabled
            withFormatting
            showFormattingToolbar={false}
            className={`${richEditorClass} text-muted-foreground`}
            fieldGroups={fieldGroups}
            allFields={allFields}
            collections={collections}
            layer={layer}
            allowedFieldTypes={SIMPLE_TEXT_FIELD_TYPES}
          />
        ) : (
          <Textarea
            value={sourceDisplayValue}
            readOnly
            tabIndex={-1}
            className={`${textareaClass} text-muted-foreground`}
            rows={3}
          />
        )
      ) : (
        <>
          {isAsset ? (
            <div
              className="flex items-center gap-2 p-2 border border-border/50 rounded-md bg-secondary/20 cursor-pointer hover:bg-secondary/35 transition-colors"
              onClick={() => setIsAssetPickerOpen(true)}
            >
              {displayedAsset && renderAssetPreview(displayedAsset)}
            </div>
          ) : previewOnly ? (
            <Textarea
              value={translationDisplayValue}
              readOnly
              tabIndex={-1}
              placeholder={sourceDisplayValue || 'No translation yet'}
              className={`${textareaClass} text-muted-foreground`}
              rows={3}
            />
          ) : isTranslationRichText ? (
            <RichTextEditor
              value={translationDoc}
              onChange={handleRichChange}
              onBlur={handleRichBlur}
              placeholder={sourceDisplayValue || 'Enter translation...'}
              withFormatting
              showFormattingToolbar={false}
              className={richEditorClass}
              fieldGroups={fieldGroups}
              allFields={allFields}
              collections={collections}
              layer={layer}
              allowedFieldTypes={SIMPLE_TEXT_FIELD_TYPES}
            />
          ) : (
            <Textarea
              value={translationDisplayValue}
              onChange={(e) => handleTextChange(e.target.value)}
              onBlur={(e) => handleTextBlur(e.target.value)}
              placeholder={sourceDisplayValue || 'Enter translation...'}
              className={textareaClass}
              rows={3}
            />
          )}
          {previewOnly && onExpand && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-2.5 mt-1"
              onClick={onExpand}
            >
              Expand to edit
              <span><Icon name="expand" className="size-2.5" /></span>
            </Button>
          )}
        </>
      )}

      {side === 'translation' && isAsset && (
        <FileManagerDialog
          open={isAssetPickerOpen}
          onOpenChange={setIsAssetPickerOpen}
          onAssetSelect={handleAssetSelect}
          assetId={storeValue || item.content_value || null}
          category={assetCategory || undefined}
        />
      )}
    </div>
  );
}
