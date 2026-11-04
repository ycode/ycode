'use client';

/**
 * Sheet with a full rich-text editor.
 * Controlled via open/onOpenChange — the parent handles the trigger.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import RichTextEditor from './RichTextEditor';
import type { CollectionField, Collection } from '@/types';
import { RICH_TEXT_FIELD_TYPES, type FieldGroup } from '@/lib/collection-field-utils';

interface RichTextEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bold title shown in the header */
  title?: string;
  /** Muted description shown next to the title */
  description?: string;
  value: any;
  onChange: (val: any) => void;
  placeholder?: string;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  /** Hide "Current page item" and "Reference field" options */
  hidePageContextOptions?: boolean;
  /** Tiptap doc whose variable formats are reused for inserted variables */
  variableFormatSource?: unknown;
}

export default function RichTextEditorSheet({
  open,
  onOpenChange,
  title = 'Content editor',
  description,
  value,
  onChange,
  placeholder = 'Enter value...',
  fieldGroups,
  allFields,
  collections,
  hidePageContextOptions = false,
  variableFormatSource,
}: RichTextEditorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <VisuallyHidden>
          <SheetTitle>{title}{description ? ` - ${description}` : ''}</SheetTitle>
        </VisuallyHidden>

        <div className="flex items-center justify-between border-b border-border h-14 -mt-6 -mx-6 px-6 shrink-0 bg-background sticky -top-6 z-10">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium">{title}</span>
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="gap-2"
            onClick={() => onOpenChange(false)}
          >
            Close
            <Icon name="x" className="size-3" />
          </Button>
        </div>

        <RichTextEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          fieldGroups={fieldGroups}
          allFields={allFields}
          collections={collections}
          withFormatting={true}
          showFormattingToolbar={true}
          variant="full"
          fullHeight
          allowedFieldTypes={RICH_TEXT_FIELD_TYPES}
          hidePageContextOptions={hidePageContextOptions}
          variableFormatSource={variableFormatSource}
        />
      </SheetContent>
    </Sheet>
  );
}
