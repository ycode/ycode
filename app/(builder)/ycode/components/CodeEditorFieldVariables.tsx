'use client';

import React, { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { CollectionFieldSelector } from './CollectionFieldSelector';
import { buildFieldTokenPath, DISPLAYABLE_FIELD_TYPES, flattenFieldGroups, type FieldGroup } from '@/lib/collection-field-utils';
import type { Collection, CollectionField } from '@/types';

interface CodeEditorFieldVariablesProps {
  /** Collection fields available in this context — no button renders when empty. */
  fieldGroups: FieldGroup[] | undefined;
  allFields: Record<string, CollectionField[]> | undefined;
  collections: Collection[] | undefined;
  /** Textarea of the `CodeEditor` this dropdown writes into. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Overlay button for a `CodeEditor` that inserts a `{{Field}}` placeholder at
 * the cursor. Position it inside a `relative` wrapper around the editor.
 */
export default function CodeEditorFieldVariables({
  fieldGroups,
  allFields,
  collections,
  textareaRef,
  value,
  onValueChange,
}: CodeEditorFieldVariablesProps) {
  const rootFields = React.useMemo(() => flattenFieldGroups(fieldGroups), [fieldGroups]);

  const handleSelect = useCallback((fieldId: string, relationshipPath: string[]) => {
    const tokenPath = buildFieldTokenPath(fieldId, relationshipPath, rootFields, allFields || {});
    if (!tokenPath) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart: start, selectionEnd: end } = textarea;
    const token = `{{${tokenPath}}}`;
    onValueChange(value.substring(0, start) + token + value.substring(end));

    // Restore focus after the controlled re-render swaps the textarea value
    setTimeout(() => {
      const caret = start + token.length;
      textarea.setSelectionRange(caret, caret);
      textarea.focus();
    }, 0);
  }, [rootFields, allFields, textareaRef, value, onValueChange]);

  if (!fieldGroups || rootFields.length === 0) return null;

  return (
    <div className="absolute top-1 right-1 pointer-events-none">
      <div className="pointer-events-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-6 w-6 p-0"
              aria-label="Insert collection field"
            >
              <Icon name="database" className="size-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 max-h-none!"
          >
            <CollectionFieldSelector
              fieldGroups={fieldGroups}
              allFields={allFields || {}}
              collections={collections || []}
              allowedTypes={DISPLAYABLE_FIELD_TYPES}
              onSelect={handleSelect}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
