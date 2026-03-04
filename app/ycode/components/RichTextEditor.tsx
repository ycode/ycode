'use client';

/**
 * Rich Text Editor
 *
 * Tiptap-based rich text editor that displays variable badges inline
 * Supports custom objects like { type: 'field', data: { field_id: ... } }
 * Data is stored in data-variable attribute as JSON-encoded string
 */

import React, { useEffect, useState, useImperativeHandle, forwardRef, useCallback, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useEditor, EditorContent } from '@tiptap/react';
import { Mark, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import History from '@tiptap/extension-history';
import { EditorState } from '@tiptap/pm/state';
import Placeholder from '@tiptap/extension-placeholder';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Heading from '@tiptap/extension-heading';
import Blockquote from '@tiptap/extension-blockquote';
import Code from '@tiptap/extension-code';
import { cn } from '@/lib/utils';
import type { CollectionField, Collection } from '@/types';
import {
  parseValueToContent,
  convertContentToValue,
  getVariableLabel,
} from '@/lib/cms-variables-utils';
import type { FieldVariable } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CollectionFieldSelector, type FieldSourceType } from './CollectionFieldSelector';
import { flattenFieldGroups, hasFieldsMatching, DISPLAYABLE_FIELD_TYPES, type FieldGroup } from '@/lib/collection-field-utils';
import { DynamicVariable, getDynamicVariableLabel } from '@/lib/tiptap-extensions/dynamic-variable';
import { RichTextComponent } from '@/lib/tiptap-extensions/rich-text-component';
import { RichTextLink, getLinkSettingsFromMark } from '@/lib/tiptap-extensions/rich-text-link';
import RichTextLinkPopover from './RichTextLinkPopover';
import RichTextComponentPicker from './RichTextComponentPicker';
import RichTextComponentBlock from './RichTextComponentBlock';
import type { Layer, LinkSettings, LinkType } from '@/types';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';

interface RichTextEditorProps {
  value: string | any; // string for simple text, Tiptap JSON when withFormatting=true
  onChange: (value: string | any) => void;
  onBlur?: (value: string | any) => void;
  placeholder?: string;
  className?: string;
  /** Field groups with labels and sources for inline variable selection */
  fieldGroups?: FieldGroup[];
  /** All fields keyed by collection ID for resolving nested references */
  allFields?: Record<string, CollectionField[]>;
  /** All collections for reference field lookups */
  collections?: Collection[];
  /** Disable editing and hide database button */
  disabled?: boolean;
  /** Enable formatting toolbar (bold, italic, underline, strikethrough) - uses Tiptap JSON format */
  withFormatting?: boolean;
  /** Show or hide the formatting toolbar (defaults to true when withFormatting is enabled) */
  showFormattingToolbar?: boolean;
  /** Disable link support (useful when RichTextEditor is used inside link settings) */
  disableLinks?: boolean;
  /** Whether this is inside a collection layer */
  isInsideCollectionLayer?: boolean;
  /** Current layer for context */
  layer?: Layer | null;
  /** UI variant: 'compact' for layer content, 'full' for CMS rich-text fields */
  variant?: 'compact' | 'full';
  /** Size variant for compact mode: 'xs' for smaller text, 'sm' for larger text */
  size?: 'xs' | 'sm';
  /** Link types to exclude from the link settings dropdown */
  excludedLinkTypes?: LinkType[];
  /** Stretch editor to fill parent height (scrolls content instead of growing) */
  fullHeight?: boolean;
  /** Callback to open the full editor sheet (shown as expand button in toolbar) */
  onExpandClick?: () => void;
}

export interface RichTextEditorHandle {
  addFieldVariable: (variableData: FieldVariable) => void;
}

export type { FieldVariable } from '@/types';

/**
 * DynamicVariable with React node view for the sidebar rich-text editor.
 * Extends the shared extension with a Badge-based node view.
 */
const DynamicVariableWithNodeView = DynamicVariable.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('span');
      container.className = 'inline-block';
      container.contentEditable = 'false';

      const variable = node.attrs.variable;
      if (variable) {
        container.setAttribute('data-variable', JSON.stringify(variable));
      }

      const label = getDynamicVariableLabel(node);

      const handleDelete = () => {
        const pos = getPos();
        if (typeof pos === 'number') {
          editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run();
        }
      };

      const root = createRoot(container);

      const renderBadge = () => {
        root.render(
          <Badge variant="secondary">
            <span>{label}</span>
            {editor.isEditable && (
              <Button
                onClick={handleDelete}
                className="size-4! p-0! -mr-1"
                variant="outline"
              >
                <Icon name="x" className="size-2" />
              </Button>
            )}
          </Badge>
        );
      };

      queueMicrotask(renderBadge);

      const updateListener = () => renderBadge();
      editor.on('update', updateListener);

      return {
        dom: container,
        destroy: () => {
          editor.off('update', updateListener);
          setTimeout(() => root.unmount(), 0);
        },
      };
    };
  },
});

/**
 * RichTextComponent with React node view for embedding components.
 * Renders a collapsible block with override controls.
 */
const RichTextComponentWithNodeView = RichTextComponent.extend({
  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      const container = document.createElement('div');
      container.className = 'my-2';
      container.contentEditable = 'false';

      // Mutable ref so renderBlock always reads the latest node
      let currentNode = initialNode;

      const root = createRoot(container);

      const renderBlock = () => {
        const componentId = currentNode.attrs.componentId;
        const componentOverrides = currentNode.attrs.componentOverrides;
        const ctx = (editor.storage as Record<string, any>).richTextComponent?.editorContext ?? {};

        const handleOverridesChange = (overrides: any) => {
          const pos = getPos();
          if (typeof pos === 'number') {
            const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              componentOverrides: overrides,
            });
            editor.view.dispatch(tr);
          }
        };

        const handleDelete = () => {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.chain().focus().deleteRange({ from: pos, to: pos + currentNode.nodeSize }).run();
          }
        };

        root.render(
          <RichTextComponentBlock
            componentId={componentId}
            componentOverrides={componentOverrides}
            onOverridesChange={handleOverridesChange}
            onDelete={handleDelete}
            isEditable={editor.isEditable}
            fieldGroups={ctx.fieldGroups}
            allFields={ctx.allFields}
            collections={ctx.collections}
            isInsideCollectionLayer={ctx.isInsideCollectionLayer}
          />,
        );
      };

      queueMicrotask(renderBlock);

      return {
        dom: container,
        stopEvent: () => true,
        selectNode: () => {
          container.classList.add('ring-1', 'ring-ring/30', 'rounded-md');
        },
        deselectNode: () => {
          container.classList.remove('ring-1', 'ring-ring/30', 'rounded-md');
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'richTextComponent') return false;
          currentNode = updatedNode;
          renderBlock();
          return true;
        },
        destroy: () => {
          setTimeout(() => root.unmount(), 0);
        },
      };
    };
  },
});

/**
 * Custom Tiptap mark for dynamic text styles
 * Preserves the style keys from canvas text editor without applying visual styling
 */
const DynamicStyle = Mark.create({
  name: 'dynamicStyle',

  addAttributes() {
    return {
      styleKeys: {
        default: [],
        parseHTML: (element) => {
          const attr = element.getAttribute('data-style-keys');
          if (!attr) {
            // Backwards compatibility: single styleKey
            const singleKey = element.getAttribute('data-style-key');
            return singleKey ? [singleKey] : [];
          }
          try {
            return JSON.parse(attr);
          } catch {
            return [];
          }
        },
        renderHTML: (attributes) => {
          const keys = attributes.styleKeys || [];
          if (keys.length === 0) return {};
          return { 'data-style-keys': JSON.stringify(keys) };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-style-keys]' },
      { tag: 'span[data-style-key]' }, // Backwards compatibility
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const styleKeys: string[] = mark.attrs.styleKeys || [];
    const lastKey = styleKeys[styleKeys.length - 1] || null;

    return ['span', mergeAttributes(HTMLAttributes, {
      'data-style-keys': JSON.stringify(styleKeys),
      'data-style-key': lastKey,
    }), 0];
  },
});

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(({
  value,
  onChange,
  onBlur: onBlurProp,
  placeholder = '',
  className,
  fieldGroups,
  allFields,
  collections,
  disabled = false,
  withFormatting = false,
  showFormattingToolbar = true,
  disableLinks = false,
  isInsideCollectionLayer = false,
  layer,
  variant = 'compact',
  size = 'xs',
  excludedLinkTypes = [],
  fullHeight = false,
  onExpandClick,
}, ref) => {
  const isFullVariant = variant === 'full';
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  // Track if update is coming from editor to prevent infinite loop
  const isInternalUpdateRef = useRef(false);
  // Refs to avoid stale closures in useEditor's onUpdate callback
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  // Derive a flat list of fields from fieldGroups (for internal use like parseValueToContent)
  const fields = useMemo(() => flattenFieldGroups(fieldGroups), [fieldGroups]);

  // Check if there are any displayable fields (exclude multi_reference)
  const canShowVariables = useMemo(
    () => hasFieldsMatching(fieldGroups, f => DISPLAYABLE_FIELD_TYPES.includes(f.type)),
    [fieldGroups]
  );

  const extensions = useMemo(() => {
    const baseExtensions = [
      Document,
      Paragraph,
      Text,
      History,
      DynamicVariableWithNodeView,
      DynamicStyle,
      RichTextComponentWithNodeView,
      Placeholder.configure({
        placeholder,
      }),
    ];

    if (withFormatting) {
      const formattingExtensions = [
        ...baseExtensions,
        Bold,
        Italic,
        Underline,
        Strike,
        Subscript,
        Superscript,
        BulletList,
        OrderedList,
        ListItem,
        Heading.configure({
          levels: [1, 2, 3, 4, 5, 6],
        }),
        Blockquote,
        Code,
      ];

      // Add link extension unless explicitly disabled
      if (!disableLinks) {
        formattingExtensions.push(
          RichTextLink.extend({
            addOptions() {
              return {
                ...this.parent?.(),
                HTMLAttributes: {
                  class: DEFAULT_TEXT_STYLES.link?.classes || '',
                },
              };
            },
          })
        );
      }

      return formattingExtensions;
    }

    return baseExtensions;
  }, [placeholder, withFormatting, disableLinks, isFullVariant]);

  const editor = useEditor({
    immediatelyRender: true,
    extensions,
    content: (() => {
      if (withFormatting) {
        // For formatting mode, expect TipTap JSON
        if (typeof value === 'object' && value !== null) {
          return value;
        }
        // Try to parse JSON string (in case DB returned stringified JSON)
        if (typeof value === 'string' && value.startsWith('{')) {
          try {
            return JSON.parse(value);
          } catch {
            // Not valid JSON, fall through
          }
        }
        // Return empty doc for empty/invalid values
        return { type: 'doc', content: [{ type: 'paragraph' }] };
      }
      // For non-formatting mode, parse string with inline variables
      return parseValueToContent(typeof value === 'string' ? value : '', fields, undefined, allFields);
    })(),
    editorProps: {
      attributes: {
        class: cn(
          'w-full min-w-0 border border-transparent bg-input transition-[color,box-shadow] outline-none rounded-lg flex flex-col gap-3',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[0px]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'rich-text-editor',
          // Compact variant (default) - size-based text and padding
          !isFullVariant && size === 'xs' && 'min-h-[2rem] text-xs leading-5.5 px-2 py-1',
          !isFullVariant && size === 'sm' && 'min-h-[2.5rem] text-sm leading-6 px-3 py-1.5',
          // Full variant - larger text, more padding
          // Element styles (h1-h6, p, ul, ol, li, blockquote, code) defined in globals.css
          isFullVariant && !fullHeight && 'rich-text-editor-full min-h-[200px] leading-relaxed px-3 py-2.5',
          isFullVariant && fullHeight && 'rich-text-editor-full leading-relaxed px-3 py-2.5 focus-visible:border-ring/30 focus-visible:ring-ring/15',
          className
        ),
      },
      handleKeyDown: (view, event) => {
        // Allow line breaks (Enter key)
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) {
        return;
      }

      // Skip onChange when update was triggered by programmatic setContent
      // (e.g. syncing external value changes from the sync effect)
      if (isInternalUpdateRef.current) {
        return;
      }

      isInternalUpdateRef.current = true;

      const newValue = withFormatting
        ? editor.getJSON()
        : convertContentToValue(editor.getJSON());

      const currentValue = valueRef.current;
      const currentOnChange = onChangeRef.current;

      if (withFormatting) {
        if (JSON.stringify(newValue) !== JSON.stringify(currentValue)) {
          currentOnChange(newValue);
        }
      } else {
        if (newValue !== currentValue) {
          currentOnChange(newValue);
        }
      }
    },
    onCreate: ({ editor }) => {
      // Reset editor state to clear history so initial content isn't undoable
      const { state } = editor;
      editor.view.updateState(EditorState.create({
        doc: state.doc,
        plugins: state.plugins,
      }));
      // updateState may trigger onUpdate which sets isInternalUpdateRef;
      // clear it so the next external value-sync effect is not blocked
      isInternalUpdateRef.current = false;
    },
    onFocus: () => {},
    onBlur: () => {
      if (onBlurProp && editor) {
        const currentValue = withFormatting
          ? editor.getJSON()
          : convertContentToValue(editor.getJSON());
        onBlurProp(currentValue);
      }
    },
  }, [placeholder, extensions, withFormatting]);

  // Update editor editable state when disabled prop changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Sync CMS context into editor storage so node views can access it
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as Record<string, any>;
    storage.richTextComponent = {
      ...storage.richTextComponent,
      editorContext: { fieldGroups, allFields, collections, isInsideCollectionLayer },
    };
  }, [editor, fieldGroups, allFields, collections, isInsideCollectionLayer]);

  // Update editor content when value or fields change externally
  useEffect(() => {
    if (!editor) return;

    // Skip updates when editor is disabled (e.g., during canvas text editing)
    if (!editor.isEditable) {
      return;
    }

    // Skip update if it's coming from the editor itself
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    // Compare current editor content with incoming value
    const currentEditorContent = editor.getJSON();
    let hasChanged = false;

    if (withFormatting) {
      // For formatting mode, compare TipTap JSON
      let incomingContent = value;
      if (typeof value === 'string' && value.startsWith('{')) {
        try {
          incomingContent = JSON.parse(value);
        } catch {
          incomingContent = null;
        }
      }
      if (typeof incomingContent === 'object' && incomingContent !== null) {
        hasChanged = JSON.stringify(currentEditorContent) !== JSON.stringify(incomingContent);
      } else {
        // Empty or invalid value - check if editor has content
        hasChanged = currentEditorContent.content?.some((block: any) =>
          block.content && block.content.length > 0
        ) ?? false;
      }
    } else if (typeof value === 'string') {
      // Compare string representations
      const currentValue = convertContentToValue(currentEditorContent);
      hasChanged = currentValue !== value;
    }

    if (hasChanged) {
      // Check if editor was focused before updating content
      const wasFocused = editor.isFocused;
      let content: any;
      if (withFormatting) {
        if (typeof value === 'object' && value !== null) {
          content = value;
        } else if (typeof value === 'string' && value.startsWith('{')) {
          try {
            content = JSON.parse(value);
          } catch {
            content = { type: 'doc', content: [{ type: 'paragraph' }] };
          }
        } else {
          content = { type: 'doc', content: [{ type: 'paragraph' }] };
        }
      } else {
        content = parseValueToContent(typeof value === 'string' ? value : '', fields, undefined, allFields);
      }
      // Flag as programmatic update so onUpdate skips onChange
      isInternalUpdateRef.current = true;
      editor.commands.setContent(content);
      // Reset flag so next user edit will trigger onChange normally
      isInternalUpdateRef.current = false;

      // Only focus if editor was already focused (user was actively editing)
      if (wasFocused) {
        setTimeout(() => { editor.commands.focus('end'); }, 0);
      }
    } else if (fields) {
      // Update labels for existing nodes when fields change
      const json = editor.getJSON();
      let updated = false;

      const updateNodeLabels = (content: any[]): any[] => {
        return content.map((node: any) => {
          if (node.type === 'dynamicVariable' && node.attrs?.variable) {
            const variable = node.attrs.variable;
            if (variable.type === 'field' && variable.data?.field_id) {
              const newLabel = getVariableLabel(variable, fields, allFields);
              if (node.attrs.label !== newLabel) {
                updated = true;
                return {
                  ...node,
                  attrs: {
                    ...node.attrs,
                    label: newLabel,
                  },
                };
              }
            }
          } else if (node.content) {
            return {
              ...node,
              content: updateNodeLabels(node.content),
            };
          }
          return node;
        });
      };

      if (json.content) {
        const updatedContent = updateNodeLabels(json.content);
        if (updated) {
          editor.commands.setContent({ ...json, content: updatedContent });
          isInternalUpdateRef.current = false;
        }
      }
    }
  }, [value, fields, allFields, editor, withFormatting]);

  // Internal function to add a field variable
  const addFieldVariableInternal = useCallback((variableData: FieldVariable) => {
    if (!editor) return;

    // Save current cursor position
    const { from } = editor.state.selection;
    const doc = editor.state.doc;

    // Check what's before the cursor
    let needsSpaceBefore = false;
    if (from > 0) {
      const nodeBefore = doc.nodeAt(from - 1);
      if (nodeBefore) {
        // Check if it's a variable node
        if (nodeBefore.type.name === 'dynamicVariable') {
          needsSpaceBefore = true;
        } else {
          // Check if it's text that's not a space
          const charBefore = doc.textBetween(from - 1, from);
          needsSpaceBefore = Boolean(charBefore && charBefore !== ' ' && charBefore !== '\n');
        }
      } else {
        // Check character before cursor
        const charBefore = doc.textBetween(from - 1, from);
        needsSpaceBefore = Boolean(charBefore && charBefore !== ' ' && charBefore !== '\n');
      }
    }

    // Check what's after the cursor
    let needsSpaceAfter = false;
    if (from < doc.content.size) {
      const nodeAfter = doc.nodeAt(from);
      if (nodeAfter) {
        // Check if it's a variable node
        if (nodeAfter.type.name === 'dynamicVariable') {
          needsSpaceAfter = true;
        } else {
          // Check if it's text that's not a space
          const charAfter = doc.textBetween(from, from + 1);
          needsSpaceAfter = Boolean(charAfter && charAfter !== ' ' && charAfter !== '\n');
        }
      } else {
        // Check character at cursor position
        const charAfter = doc.textBetween(from, from + 1);
        needsSpaceAfter = Boolean(charAfter && charAfter !== ' ' && charAfter !== '\n');
      }
    }

    // Get label for the variable
    const label = getVariableLabel(variableData, fields, allFields);

    // Build content to insert
    const contentToInsert: any[] = [];

    // Add space before if needed
    if (needsSpaceBefore) {
      contentToInsert.push({ type: 'text', text: ' ' });
    }

    // Add the variable node
    contentToInsert.push({
      type: 'dynamicVariable',
      attrs: {
        variable: variableData,
        label,
      },
    });

    // Add space after if needed
    if (needsSpaceAfter) {
      contentToInsert.push({ type: 'text', text: ' ' });
    }

    // Insert content
    editor.chain().focus().insertContent(contentToInsert).run();

    // Trigger onChange with updated value
    // When withFormatting is enabled, emit full Tiptap JSON
    // Otherwise emit string format for backward compatibility
    const newValue = withFormatting
      ? editor.getJSON()
      : convertContentToValue(editor.getJSON());
    onChange(newValue);

    let finalPosition = from;
    if (needsSpaceBefore) finalPosition += 1;
    finalPosition += 1;
    if (needsSpaceAfter) finalPosition += 1;

    setTimeout(() => {
      editor.commands.focus(finalPosition);
    }, 0);
  }, [editor, fields, allFields, onChange, withFormatting]);

  // Expose addFieldVariable function via ref
  useImperativeHandle(ref, () => ({
    addFieldVariable: addFieldVariableInternal,
  }), [addFieldVariableInternal]);

  if (!editor) {
    return null;
  }

  const handleFieldSelect = (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => {
    const field = fields.find(f => f.id === fieldId);
    addFieldVariableInternal({
      type: 'field',
      data: {
        field_id: fieldId,
        relationships: relationshipPath,
        source,
        field_type: field?.type || null,
        collection_layer_id: layerId,
      },
    });

    // Close the dropdown after selection
    setIsDropdownOpen(false);
  };

  return (
    <div className={cn('flex-1 rich-text-editor relative', isFullVariant && 'flex flex-col gap-2', fullHeight && 'min-h-0')}>
      {/* Formatting toolbar - Full variant (CMS style like original TiptapEditor) */}
      {withFormatting && showFormattingToolbar && isFullVariant && (
        <div className="flex items-center gap-2">
          <Select
            value={
              editor.isActive('heading', { level: 1 }) ? 'h1' :
                editor.isActive('heading', { level: 2 }) ? 'h2' :
                  editor.isActive('heading', { level: 3 }) ? 'h3' :
                    editor.isActive('heading', { level: 4 }) ? 'h4' :
                      editor.isActive('heading', { level: 5 }) ? 'h5' :
                        editor.isActive('heading', { level: 6 }) ? 'h6' :
                          'paragraph'
            }
            onValueChange={(value) => {
              if (value === 'paragraph') {
                editor.chain().focus().setParagraph().run();
              } else {
                const level = parseInt(value.replace('h', '')) as 1 | 2 | 3 | 4 | 5 | 6;
                editor.chain().focus().setHeading({ level }).run();
              }
            }}
            disabled={disabled}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paragraph">Paragraph</SelectItem>
              <SelectItem value="h1">Heading 1</SelectItem>
              <SelectItem value="h2">Heading 2</SelectItem>
              <SelectItem value="h3">Heading 3</SelectItem>
              <SelectItem value="h4">Heading 4</SelectItem>
              <SelectItem value="h5">Heading 5</SelectItem>
              <SelectItem value="h6">Heading 6</SelectItem>
            </SelectContent>
          </Select>

          {/* Link button */}
          {!disableLinks && (
            <ToggleGroup
              type="single"
              size="xs"
              variant="secondary"
              spacing={1}
            >
              <RichTextLinkPopover
                editor={editor}
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
                isInsideCollectionLayer={isInsideCollectionLayer}
                layer={layer}
                open={linkPopoverOpen}
                onOpenChange={setLinkPopoverOpen}
                excludedLinkTypes={excludedLinkTypes}
                trigger={
                  <ToggleGroupItem
                    value="link"
                    data-state={editor.isActive('richTextLink') ? 'on' : 'off'}
                    asChild
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      title="Link"
                      className="w-auto min-w-0 shrink-0"
                    >
                      <Icon name="link" className="size-3" />
                    </button>
                  </ToggleGroupItem>
                }
              />
            </ToggleGroup>
          )}

          {/* Text formatting */}
          <ToggleGroup
            type="multiple"
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <ToggleGroupItem
              value="bold"
              data-state={editor.isActive('bold') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Icon name="bold" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="italic"
              data-state={editor.isActive('italic') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Icon name="italic" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="underline"
              data-state={editor.isActive('underline') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Icon name="underline" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="strike"
              data-state={editor.isActive('strike') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Icon name="strikethrough" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="superscript"
              data-state={editor.isActive('superscript') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleSuperscript().run()}
            >
              <Icon name="superscript" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="subscript"
              data-state={editor.isActive('subscript') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleSubscript().run()}
            >
              <Icon name="subscript" className="size-3" />
            </ToggleGroupItem>
          </ToggleGroup>

          {/* Lists */}
          <ToggleGroup
            type="multiple"
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <ToggleGroupItem
              value="bulletList"
              data-state={editor.isActive('bulletList') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <Icon name="listUnordered" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="orderedList"
              data-state={editor.isActive('orderedList') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <Icon name="listOrdered" className="size-3" />
            </ToggleGroupItem>
          </ToggleGroup>

          {/* Block formatting */}
          <ToggleGroup
            type="multiple"
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <ToggleGroupItem
              value="blockquote"
              data-state={editor.isActive('blockquote') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Icon name="quote" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="code"
              data-state={editor.isActive('code') ? 'on' : 'off'}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Icon name="code" className="size-3" />
            </ToggleGroupItem>
          </ToggleGroup>

          {/* Inline Variable Button */}
          {canShowVariables && (
            <ToggleGroup
              type="single"
              size="xs"
              variant="secondary"
              spacing={1}
            >
              <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <ToggleGroupItem value="variable" asChild>
                    <button
                      type="button"
                      title="Insert Variable"
                      disabled={disabled}
                      className="w-auto min-w-0 shrink-0"
                    >
                      <Icon name="database" className="size-3" />
                    </button>
                  </ToggleGroupItem>
                </DropdownMenuTrigger>
                {fieldGroups && (
                  <DropdownMenuContent
                    className="w-56 py-1 px-1"
                    align="start"
                    sideOffset={4}
                  >
                    <CollectionFieldSelector
                      fieldGroups={fieldGroups}
                      allFields={allFields || {}}
                      collections={collections || []}
                      onSelect={handleFieldSelect}
                    />
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </ToggleGroup>
          )}

          {/* Insert Component Button */}
          <ToggleGroup
            type="single"
            value=""
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <ToggleGroupItem
              value="component"
              asChild
            >
              <button
                type="button"
                title="Insert Component"
                disabled={disabled}
                className="w-auto min-w-0 shrink-0"
                onClick={() => setComponentPickerOpen(true)}
              >
                <Icon name="component" className="size-3" />
              </button>
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="flex-1" />

          {/* Undo / Redo */}
          <ToggleGroup
            type="single"
            value=""
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <ToggleGroupItem
              value="undo"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={disabled || !editor.can().undo()}
              title="Undo (⌘Z)"
            >
              <Icon name="undo" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="redo"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={disabled || !editor.can().redo()}
              title="Redo (⌘⇧Z)"
            >
              <Icon name="redo" className="size-3" />
            </ToggleGroupItem>
          </ToggleGroup>

          {onExpandClick && !fullHeight && (
            <ToggleGroup
              type="single"
              value=""
              size="xs"
              variant="secondary"
            >
              <ToggleGroupItem
                value="expand"
                onClick={onExpandClick}
                title="Open full editor"
              >
                <Icon name="expand" className="size-3" />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      )}

      {/* Formatting toolbar - Compact variant */}
      {withFormatting && showFormattingToolbar && !isFullVariant && (
        <div className="flex gap-0.5 bg-popover border border-border rounded-md shadow-sm p-0.5 mb-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('bold') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().run();
                editor.commands.toggleMark('bold', {}, { extendEmptyMarkRange: true });
              }
            }}
            title="Bold"
          >
            <Icon name="bold" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('italic') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().run();
                editor.commands.toggleMark('italic', {}, { extendEmptyMarkRange: true });
              }
            }}
            title="Italic"
          >
            <Icon name="italic" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('underline') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().run();
                editor.commands.toggleMark('underline', {}, { extendEmptyMarkRange: true });
              }
            }}
            title="Underline"
          >
            <Icon name="underline" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('strike') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().run();
                editor.commands.toggleMark('strike', {}, { extendEmptyMarkRange: true });
              }
            }}
            title="Strikethrough"
          >
            <Icon name="strikethrough" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('superscript') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().run();
                editor.commands.toggleSuperscript();
              }
            }}
            title="Superscript"
          >
            <Icon name="superscript" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('subscript') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().run();
                editor.commands.toggleSubscript();
              }
            }}
            title="Subscript"
          >
            <Icon name="subscript" className="size-3" />
          </Button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('bulletList') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().toggleBulletList().run();
              }
            }}
            title="Bullet List"
          >
            <Icon name="listUnordered" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn('size-6!', editor.isActive('orderedList') && 'bg-accent')}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) {
                editor.chain().focus().toggleOrderedList().run();
              }
            }}
            title="Numbered List"
          >
            <Icon name="listOrdered" className="size-3" />
          </Button>

          {/* Inline Variable Button - in formatting toolbar */}
          <div className="w-px h-4 bg-border mx-0.5" />
          <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="size-6!"
                title={canShowVariables ? 'Insert Variable' : 'No variables available'}
                disabled={!canShowVariables || disabled}
              >
                <Icon name="database" className="size-3" />
              </Button>
            </DropdownMenuTrigger>

            {canShowVariables && fieldGroups && (
              <DropdownMenuContent
                className="w-56 py-1 px-1"
                align="start"
                sideOffset={4}
              >
                <CollectionFieldSelector
                  fieldGroups={fieldGroups}
                  allFields={allFields || {}}
                  collections={collections || []}
                  onSelect={handleFieldSelect}
                />
              </DropdownMenuContent>
            )}
          </DropdownMenu>

          {/* Link Button */}
          {!disableLinks && (
            <>
              <div className="w-px h-4 bg-border mx-0.5" />
              <RichTextLinkPopover
                editor={editor}
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
                isInsideCollectionLayer={isInsideCollectionLayer}
                layer={layer}
                open={linkPopoverOpen}
                onOpenChange={setLinkPopoverOpen}
                excludedLinkTypes={excludedLinkTypes}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={cn('size-6!', editor.isActive('richTextLink') && 'bg-accent')}
                    disabled={disabled}
                    title="Link"
                  >
                    <Icon name="link" className="size-3" />
                  </Button>
                }
              />
            </>
          )}

          {/* Insert Component Button */}
          <div className="w-px h-4 bg-border mx-0.5" />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="size-6!"
            title="Insert Component"
            disabled={disabled}
            onClick={() => setComponentPickerOpen(true)}
          >
            <Icon name="component" className="size-3" />
          </Button>

          <div className="flex-1" />

          {/* Undo / Redo */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="size-6!"
            disabled={disabled || !editor.can().undo()}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) editor.chain().focus().undo().run();
            }}
            title="Undo (⌘Z)"
          >
            <Icon name="undo" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="size-6!"
            disabled={disabled || !editor.can().redo()}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled) editor.chain().focus().redo().run();
            }}
            title="Redo (⌘⇧Z)"
          >
            <Icon name="redo" className="size-3" />
          </Button>
        </div>
      )}

      <div className={cn('relative', fullHeight && 'flex-1 min-h-0 flex flex-col [&>div]:flex-1 [&>div]:min-h-0 [&>div]:flex [&>div]:flex-col [&_.tiptap]:flex-1 [&_.tiptap]:min-h-0 [&_.tiptap]:overflow-y-auto')}>
        <EditorContent editor={editor} />
      </div>

      {/* Inline Variable Button - absolute positioned (when no formatting toolbar is shown) */}
      {!disabled && (!withFormatting || !showFormattingToolbar) && canShowVariables && (
        <div className="absolute top-1 right-1">
          <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                title="Insert Variable"
              >
                <Icon name="database" className="size-2.5" />
              </Button>
            </DropdownMenuTrigger>

            {fieldGroups && (
              <DropdownMenuContent
                className="w-56 py-1 px-1"
                align="end"
                sideOffset={4}
              >
                <CollectionFieldSelector
                  fieldGroups={fieldGroups}
                  allFields={allFields || {}}
                  collections={collections || []}
                  onSelect={handleFieldSelect}
                />
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      )}

      <RichTextComponentPicker
        open={componentPickerOpen}
        onOpenChange={setComponentPickerOpen}
        onSelect={(componentId) => {
          editor?.chain().focus().insertComponent({ componentId }).run();
        }}
        disabled={disabled}
      />
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
