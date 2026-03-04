'use client';

/**
 * Compact rich-text editor with an "Richtext editor" button that opens
 * a RichTextEditorSheet for full-featured editing.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import RichTextEditor from './RichTextEditor';
import RichTextEditorSheet from './RichTextEditorSheet';
import { hasLinkOrComponent } from '@/lib/tiptap-utils';
import type { CollectionField, Collection } from '@/types';
import type { FieldGroup } from '@/lib/collection-field-utils';

interface ExpandableRichTextEditorProps {
  value: any;
  onChange: (val: any) => void;
  /** Called on blur with the current content — use for deferred persistence */
  onBlur?: (val: any) => void;
  placeholder?: string;
  /** Bold title in the sheet header */
  sheetTitle?: string;
  /** Muted description in the sheet header */
  sheetDescription?: string;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  disabled?: boolean;
  /** Hide the inline compact editor preview, only show the button */
  hidePreview?: boolean;
}

export default function ExpandableRichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder = 'Enter value...',
  sheetTitle,
  sheetDescription,
  fieldGroups,
  allFields,
  collections,
  disabled = false,
  hidePreview = false,
}: ExpandableRichTextEditorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isComplex = useMemo(() => hasLinkOrComponent(value), [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="w-full gap-2.5"
        onClick={() => setSheetOpen(true)}
        disabled={disabled}
      >
        Richtext editor
        <span><Icon name="expand" className="size-2.5" /></span>
      </Button>

      {!hidePreview && !isComplex && !sheetOpen && (
        <RichTextEditor
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          fieldGroups={fieldGroups}
          allFields={allFields}
          collections={collections}
          withFormatting={true}
          showFormattingToolbar={false}
          disabled={disabled}
        />
      )}

      <RichTextEditorSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) onBlur?.(value);
        }}
        title={sheetTitle}
        description={sheetDescription}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        fieldGroups={fieldGroups}
        allFields={allFields}
        collections={collections}
      />
    </div>
  );
}
