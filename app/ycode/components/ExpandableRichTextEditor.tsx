'use client';

/**
 * Compact rich-text editor for inline content editing.
 */

import RichTextEditor from './RichTextEditor';
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
}

export default function ExpandableRichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder = 'Enter value...',
  fieldGroups,
  allFields,
  collections,
  disabled = false,
}: ExpandableRichTextEditorProps) {
  return (
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
  );
}
