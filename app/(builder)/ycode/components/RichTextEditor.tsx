'use client';

/**
 * Rich Text Editor
 *
 * Tiptap-based rich text editor that displays variable badges inline
 * Supports custom objects like { type: 'field', data: { field_id: ... } }
 * Data is stored in data-variable attribute as JSON-encoded string
 */

import React, { useEffect, useState, useImperativeHandle, forwardRef, useCallback, useMemo, useReducer, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useEditor, EditorContent } from '@tiptap/react';
import { Mark, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import History from '@tiptap/extension-history';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
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
import HardBreak from '@tiptap/extension-hard-break';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { cn } from '@/lib/utils';
import type { CollectionField, Collection } from '@/types';
import {
  parseValueToContent,
  convertContentToValue,
  getVariableLabel,
} from '@/lib/cms-variables-utils';
import type { FieldVariable, InlineVariable } from '@/types';
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { CollectionFieldSelector, type FieldSourceType } from './CollectionFieldSelector';
import { flattenFieldGroups, filterFieldGroupsByType, RICH_TEXT_ONLY_FIELD_TYPES, type FieldGroup } from '@/lib/collection-field-utils';
import { buildFieldVariableData, collectFieldVariableFormats, withMatchingVariableFormat } from '@/lib/variable-format-utils';
import { getPaginationLayerKind, PAGINATION_VARIABLE_LABELS, type PaginationVariableKey } from '@/lib/pagination-text-utils';
import { createDynamicVariableNodeView } from '@/lib/dynamic-variable-view';
import { parseRichTextDoc, toEditorJSON } from '@/lib/tiptap-utils';
import { RichTextComponent } from '@/lib/tiptap-extensions/rich-text-component';
import { RichTextLink, getLinkSettingsFromMark } from '@/lib/tiptap-extensions/rich-text-link';
import { RichTextImage } from '@/lib/tiptap-extensions/rich-text-image';
import { RichTextTable, RichTextTableRow, RichTextTableCell, RichTextTableHeader } from '@/lib/tiptap-extensions/rich-text-table';
import { RichTextHtmlEmbed } from '@/lib/tiptap-extensions/rich-text-html-embed';
import RichTextLinkPopover from './RichTextLinkPopover';
import RichTextImagePopover from './RichTextImagePopover';
import RichTextComponentPicker from './RichTextComponentPicker';
import RichTextComponentBlock from './RichTextComponentBlock';
import RichTextImageBlock from './RichTextImageBlock';
import RichTextHtmlEmbedBlock from './RichTextHtmlEmbedBlock';
import RichTextHtmlEmbedDialog from './RichTextHtmlEmbedDialog';
import type { CollectionFieldType, Layer, LinkSettings, LinkType, Asset } from '@/types';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';
import { useEditorStore } from '@/stores/useEditorStore';

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
  /** Hide "Current page item" and "Reference field" options (e.g. when editing CMS item content) */
  hidePageContextOptions?: boolean;
  /** Stretch editor to fill parent height (scrolls content instead of growing) */
  fullHeight?: boolean;
  /** Callback to open the full editor sheet (shown as expand button in toolbar) */
  onExpandClick?: () => void;
  /** CMS field types allowed for variable binding (defaults to RICH_TEXT_FIELD_TYPES) */
  allowedFieldTypes?: CollectionFieldType[];
  /** Tiptap doc whose variable formats are reused for inserted variables (e.g. a translation's original text) */
  variableFormatSource?: unknown;
}

export interface RichTextEditorHandle {
  addFieldVariable: (variableData: InlineVariable) => void;
}

export type { FieldVariable } from '@/types';

/**
 * DynamicVariable with React node view for the sidebar rich-text editor.
 * Extends the shared extension with a Badge-based node view.
 */
const DynamicVariableWithNodeView = createDynamicVariableNodeView('sidebar');

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
 * RichTextImage with React node view for inline image editing.
 * Renders the image with a selection ring; alt editing is handled by the toolbar popover.
 */
const RichTextImageWithNodeView = RichTextImage.extend({
  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      const container = document.createElement('div');
      container.contentEditable = 'false';

      let currentNode = initialNode;
      let isSelected = false;

      const root = createRoot(container);

      const renderBlock = () => {
        root.render(
          <RichTextImageBlock
            src={currentNode.attrs.src}
            alt={currentNode.attrs.alt || ''}
            isSelected={isSelected}
          />,
        );
      };

      container.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos === 'number' && editor.isEditable) {
          const tr = editor.state.tr.setSelection(
            NodeSelection.create(editor.state.doc, pos)
          );
          editor.view.dispatch(tr);
        }
      });

      queueMicrotask(renderBlock);

      return {
        dom: container,
        stopEvent: () => true,
        selectNode: () => {
          isSelected = true;
          renderBlock();
        },
        deselectNode: () => {
          isSelected = false;
          renderBlock();
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'richTextImage') return false;
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
 * RichTextHtmlEmbed with React node view for inline HTML embed editing.
 * Renders a placeholder block with edit/delete controls.
 */
const RichTextHtmlEmbedWithNodeView = RichTextHtmlEmbed.extend({
  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      const container = document.createElement('div');
      container.className = 'my-2';
      container.contentEditable = 'false';

      let currentNode = initialNode;
      let isSelected = false;

      const root = createRoot(container);

      const renderBlock = () => {
        const code = currentNode.attrs.code || '';

        const handleEditClick = () => {
          const ctx = (editor.storage as Record<string, any>).richTextHtmlEmbed ?? {};
          ctx.openDialog?.(code, getPos());
        };

        const handleDelete = () => {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.chain().focus().deleteRange({ from: pos, to: pos + currentNode.nodeSize }).run();
          }
        };

        root.render(
          <RichTextHtmlEmbedBlock
            code={code}
            isEditable={editor.isEditable}
            isSelected={isSelected}
            onEditClick={handleEditClick}
            onDelete={handleDelete}
          />,
        );
      };

      queueMicrotask(renderBlock);

      return {
        dom: container,
        stopEvent: () => true,
        selectNode: () => {
          isSelected = true;
          renderBlock();
        },
        deselectNode: () => {
          isSelected = false;
          renderBlock();
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'richTextHtmlEmbed') return false;
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
  hidePageContextOptions = false,
  fullHeight = false,
  onExpandClick,
  allowedFieldTypes = RICH_TEXT_ONLY_FIELD_TYPES,
  variableFormatSource,
}, ref) => {
  const isFullVariant = variant === 'full';
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [tableContextMenuOpen, setTableContextMenuOpen] = useState(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const [htmlEmbedDialogOpen, setHtmlEmbedDialogOpen] = useState(false);
  const [htmlEmbedDialogCode, setHtmlEmbedDialogCode] = useState('');
  const htmlEmbedDialogPosRef = useRef<number | null>(null);
  const openFileManager = useEditorStore((s) => s.openFileManager);
  // Track if update is coming from editor to prevent infinite loop
  const isInternalUpdateRef = useRef(false);

  // Refs to avoid stale closures in useEditor's onUpdate callback
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  // Derive a flat list of fields from fieldGroups (for internal use like parseValueToContent)
  const fields = useMemo(() => flattenFieldGroups(fieldGroups), [fieldGroups]);

  const sourceVariableFormats = useMemo(
    () => (variableFormatSource ? collectFieldVariableFormats(variableFormatSource) : undefined),
    [variableFormatSource]
  );

  const textFieldGroups = useMemo(
    () => filterFieldGroupsByType(fieldGroups, allowedFieldTypes),
    [fieldGroups, allowedFieldTypes]
  );

  // Pagination count/info layers expose dynamic number variables (Shown/Total or
  // Current page/Total pages) so they can be placed and translated within the text.
  const paginationVariableKeys = useMemo<PaginationVariableKey[]>(() => {
    const kind = getPaginationLayerKind(layer?.id);
    if (kind === 'count') return ['shown', 'total'];
    if (kind === 'info') return ['current', 'pages'];
    return [];
  }, [layer?.id]);

  const canShowVariables = textFieldGroups.length > 0 || paginationVariableKeys.length > 0;

  const extensions = useMemo(() => {
    const baseExtensions = [
      Document,
      Paragraph,
      Text,
      HardBreak,
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
        Blockquote,
        Code,
        RichTextImageWithNodeView,
        RichTextHtmlEmbedWithNodeView,
        HorizontalRule,
        RichTextTable.configure({ resizable: false }),
        RichTextTableRow,
        RichTextTableCell,
        RichTextTableHeader,
      ];

      // Always include heading extension so content with headings is preserved
      // even in compact variant (toolbar visibility is controlled separately)
      formattingExtensions.push(
        Heading.configure({
          levels: [1, 2, 3, 4, 5, 6],
        })
      );

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
  }, [placeholder, withFormatting, disableLinks]);

  const editor = useEditor({
    immediatelyRender: true,
    extensions,
    content: withFormatting
      ? parseRichTextDoc(value)
      : parseValueToContent(typeof value === 'string' ? value : '', fields, undefined, allFields),
    editorProps: {
      attributes: {
        class: cn(
          'w-full min-w-0 border border-transparent bg-input transition-[color,box-shadow] outline-none rounded-lg flex flex-col',
          // Block nodes must keep their natural height: `overflow` on a flex
          // item (the table wrapper) zeroes its automatic minimum size, so it
          // would otherwise absorb all negative free space and collapse to 0px
          // once the document outgrows a fixed-height editor.
          '[&>*]:shrink-0',
          // Full variant gets `gap-3` for doc-style paragraph spacing; compact
          // variant (sidebar inputs / translation rows) matches the canvas,
          // which flattens multi-paragraph simple-text content into one
          // paragraph with line breaks — no inter-paragraph gap.
          isFullVariant && 'gap-3',
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
      // Don't trigger updates if editor is disabled (e.g., during canvas text editing)
      if (!editor.isEditable) {
        return;
      }

      // Mark that this update is coming from the editor
      isInternalUpdateRef.current = true;

      // When withFormatting is enabled, emit full Tiptap JSON
      // Otherwise emit string format for backward compatibility
      const newValue = withFormatting
        ? editor.getJSON()
        : convertContentToValue(editor.getJSON());

      if (withFormatting) {
        if (JSON.stringify(newValue) !== JSON.stringify(valueRef.current)) {
          onChangeRef.current(newValue);
        }
      } else {
        if (newValue !== valueRef.current) {
          onChangeRef.current(newValue);
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

  // Tiptap v3's useEditor no longer re-renders on every transaction, so toolbar
  // state read via editor.isActive(...) (e.g. the heading Select) goes stale when
  // the selection moves. Force a re-render on each transaction to keep it in sync.
  const [, forceToolbarUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', forceToolbarUpdate);
    return () => { editor.off('transaction', forceToolbarUpdate); };
  }, [editor]);

  // Sync CMS context into editor storage so node views can access it, then
  // force every dynamic-variable badge to re-render. Badges resolve their label
  // from this live context, so a renamed/deleted field or global is reflected
  // instantly without rebuilding the document (which doesn't reliably re-render
  // the React-rooted atom node views).
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as Record<string, any>;
    storage.richTextComponent = {
      ...storage.richTextComponent,
      editorContext: { fieldGroups, allFields, collections, isInsideCollectionLayer },
    };
    const dvStorage = storage.dynamicVariable as { renderers?: Set<() => void> } | undefined;
    dvStorage?.renderers?.forEach((render) => render());
  }, [editor, fieldGroups, allFields, collections, isInsideCollectionLayer]);

  // Sync HTML embed dialog opener into editor storage so the node view can trigger it
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as Record<string, any>;
    storage.richTextHtmlEmbed = {
      ...storage.richTextHtmlEmbed,
      openDialog: (code: string, pos: number | (() => number | undefined)) => {
        const resolvedPos = typeof pos === 'function' ? pos() : pos;
        setHtmlEmbedDialogCode(code);
        htmlEmbedDialogPosRef.current = typeof resolvedPos === 'number' ? resolvedPos : null;
        setHtmlEmbedDialogOpen(true);
      },
    };
  }, [editor]);

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
    const incomingDoc = withFormatting ? parseRichTextDoc(value) : null;

    if (incomingDoc) {
      // Compare through the schema: the editor fills in default attrs (e.g.
      // ordered list `start`), which a raw stored doc may lack
      hasChanged = JSON.stringify(currentEditorContent) !== JSON.stringify(toEditorJSON(editor.schema, incomingDoc));
    } else if (typeof value === 'string') {
      // Compare string representations
      const currentValue = convertContentToValue(currentEditorContent);
      hasChanged = currentValue !== value;
    }

    // Walk a Tiptap doc and replace `attrs.label` on every `dynamicVariable` node
    // with the live label resolved from current fields. The stored label is only a
    // fallback so the chip stays accurate even when field names change.
    const refreshNodeLabels = (content: any[]): { content: any[]; updated: boolean } => {
      let updated = false;
      const walked = content.map((node: any) => {
        if (node.type === 'dynamicVariable' && node.attrs?.variable) {
          const variable = node.attrs.variable;
          if (variable.type === 'field' && variable.data?.field_id) {
            const newLabel = getVariableLabel(variable, fields, allFields);
            if (newLabel && node.attrs.label !== newLabel) {
              updated = true;
              return { ...node, attrs: { ...node.attrs, label: newLabel } };
            }
          }
        } else if (node.content) {
          const childResult = refreshNodeLabels(node.content);
          if (childResult.updated) {
            updated = true;
            return { ...node, content: childResult.content };
          }
        }
        return node;
      });
      return { content: walked, updated };
    };

    if (hasChanged) {
      // Check if editor was focused before updating content
      const wasFocused = editor.isFocused;
      let content: any = incomingDoc
        ?? parseValueToContent(typeof value === 'string' ? value : '', fields, undefined, allFields);
      // Refresh cached labels on initial set as well — the stored value may have
      // stale labels from migrations or older edits.
      if (fields && content?.content) {
        const refreshed = refreshNodeLabels(content.content);
        if (refreshed.updated) {
          content = { ...content, content: refreshed.content };
        }
      }
      // Loading an external value is not a user edit: emitting it would hand
      // the editor's re-serialized doc back as a change and mark it dirty
      editor.commands.setContent(content, { emitUpdate: false });

      // Only focus if editor was already focused (user was actively editing)
      if (wasFocused) {
        setTimeout(() => { editor.commands.focus('end'); }, 0);
      }
    } else if (fields) {
      // Update labels for existing nodes when fields change without a value change
      const json = editor.getJSON();
      if (json.content) {
        const refreshed = refreshNodeLabels(json.content);
        if (refreshed.updated) {
          editor.commands.setContent({ ...json, content: refreshed.content }, { emitUpdate: false });
        }
      }
    }
  }, [value, fields, allFields, editor, withFormatting]);

  // Auto-open image popover when an image node is selected
  useEffect(() => {
    if (!editor || !withFormatting) return;

    const handleSelectionUpdate = () => {
      const { selection } = editor.state;
      const node = editor.state.doc.nodeAt(selection.from);
      const isImage = node?.type.name === 'richTextImage';
      if (isImage && !imagePopoverOpen) {
        setImagePopoverOpen(true);
      } else if (!isImage && imagePopoverOpen) {
        setImagePopoverOpen(false);
      }
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => { editor.off('selectionUpdate', handleSelectionUpdate); };
  }, [editor, withFormatting, imagePopoverOpen]);

  // Internal function to add a field variable
  const addFieldVariableInternal = useCallback((variableData: InlineVariable) => {
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

  // Check if the link button should appear active (text link mark OR image with link)
  const selectedNode = editor.state.doc.nodeAt(editor.state.selection.from);
  const isLinkActive = editor.isActive('richTextLink')
    || (selectedNode?.type.name === 'richTextImage' && !!selectedNode.attrs.link);

  const handleFieldSelect = (fieldId: string, relationshipPath: string[], source?: FieldSourceType, layerId?: string) => {
    const field = fields.find(f => f.id === fieldId);
    addFieldVariableInternal(withMatchingVariableFormat(
      buildFieldVariableData(fieldId, relationshipPath, field?.type ?? null, source, layerId),
      sourceVariableFormats
    ));

    setIsDropdownOpen(false);
  };

  const handlePaginationSelect = (key: PaginationVariableKey) => {
    addFieldVariableInternal({ type: 'pagination', data: { key } });
    setIsDropdownOpen(false);
  };

  // Shared dropdown body: pagination variables (when applicable) above CMS fields.
  const variablesDropdownInner = (
    <>
      {paginationVariableKeys.length > 0 && (
        <>
          <DropdownMenuLabel className="text-xs text-foreground/80">Pagination</DropdownMenuLabel>
          {paginationVariableKeys.map((key) => (
            <DropdownMenuItem
              key={key}
              className="gap-2"
              onClick={() => handlePaginationSelect(key)}
            >
              <Icon name="hash" className="size-3 text-muted-foreground shrink-0" />
              <span className="truncate">{PAGINATION_VARIABLE_LABELS[key]}</span>
            </DropdownMenuItem>
          ))}
          {textFieldGroups.length > 0 && <DropdownMenuSeparator />}
        </>
      )}
      {textFieldGroups.length > 0 && (
        <CollectionFieldSelector
          fieldGroups={textFieldGroups}
          allFields={allFields || {}}
          collections={collections || []}
          onSelect={handleFieldSelect}
        />
      )}
    </>
  );

  return (
    <div className={cn('flex-1 rich-text-editor relative', isFullVariant && 'flex flex-col gap-2', fullHeight && 'min-h-0')}>
      {/* Formatting toolbar - Full variant (CMS style like original TiptapEditor) */}
      {withFormatting && showFormattingToolbar && isFullVariant && (
        <div className="flex flex-wrap items-center gap-2 sticky top-8 bg-background z-10 py-2 -my-2">
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
                hidePageContextOptions={hidePageContextOptions}
                trigger={
                  <ToggleGroupItem
                    value="link"
                    data-state={isLinkActive ? 'on' : 'off'}
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
                {canShowVariables && (
                  <DropdownMenuContent
                    className="w-56 py-1 px-1"
                    align="start"
                    sideOffset={4}
                  >
                    {variablesDropdownInner}
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </ToggleGroup>
          )}

          {/* Insert Image / Component */}
          <ToggleGroup
            type="single"
            value=""
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <RichTextImagePopover
              editor={editor}
              open={imagePopoverOpen}
              onOpenChange={setImagePopoverOpen}
              disabled={disabled}
              trigger={
                <ToggleGroupItem
                  value="image"
                  data-state={editor.isActive('richTextImage') ? 'on' : 'off'}
                  asChild
                >
                  <button
                    type="button"
                    title={editor.isActive('richTextImage') ? 'Image settings' : 'Insert Image'}
                    disabled={disabled}
                    className="w-auto min-w-0 shrink-0"
                    onClick={(e) => {
                      if (!editor.isActive('richTextImage')) {
                        e.preventDefault();
                        openFileManager(
                          (asset: Asset) => {
                            if (!editor || !asset.public_url) return;
                            editor.chain().focus().setRichTextImage({
                              src: asset.public_url,
                              alt: asset.filename,
                              assetId: asset.id,
                            }).run();
                          },
                          undefined,
                          'images'
                        );
                      }
                    }}
                  >
                    <Icon name="image" className="size-3" />
                  </button>
                </ToggleGroupItem>
              }
            />
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
            <ToggleGroupItem
              value="table"
              asChild
            >
              <button
                type="button"
                title="Insert Table"
                disabled={disabled}
                className="w-auto min-w-0 shrink-0"
                onClick={() => editor.chain().focus().insertRichTextTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              >
                <Icon name="table" className="size-3" />
              </button>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="htmlEmbed"
              asChild
            >
              <button
                type="button"
                title="Insert HTML Embed"
                disabled={disabled}
                className="w-auto min-w-0 shrink-0"
                onClick={() => editor.chain().focus().insertHtmlEmbed().run()}
              >
                <Icon name="code-block" className="size-3" />
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

            {canShowVariables && (
              <DropdownMenuContent
                className="w-56 py-1 px-1"
                align="start"
                sideOffset={4}
              >
                {variablesDropdownInner}
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
                hidePageContextOptions={hidePageContextOptions}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={cn('size-6!', isLinkActive && 'bg-accent')}
                    disabled={disabled}
                    title="Link"
                  >
                    <Icon name="link" className="size-3" />
                  </Button>
                }
              />
            </>
          )}

          {/* Insert Image / Component */}
          <div className="w-px h-4 bg-border mx-0.5" />
          <RichTextImagePopover
            editor={editor}
            open={imagePopoverOpen}
            onOpenChange={setImagePopoverOpen}
            disabled={disabled}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn('size-6!', editor.isActive('richTextImage') && 'bg-accent')}
                disabled={disabled}
                title={editor.isActive('richTextImage') ? 'Image settings' : 'Insert Image'}
                onClick={(e) => {
                  if (!editor.isActive('richTextImage')) {
                    e.preventDefault();
                    openFileManager(
                      (asset: Asset) => {
                        if (!editor || !asset.public_url) return;
                        editor.chain().focus().setRichTextImage({
                          src: asset.public_url,
                          alt: asset.filename,
                          assetId: asset.id,
                        }).run();
                      },
                      undefined,
                      'images'
                    );
                  }
                }}
              >
                <Icon name="image" className="size-3" />
              </Button>
            }
          />
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
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="size-6!"
            title="Insert Table"
            disabled={disabled}
            onClick={() => editor.chain().focus().insertRichTextTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          >
            <Icon name="table" className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="size-6!"
            title="Insert HTML Embed"
            disabled={disabled}
            onClick={() => editor.chain().focus().insertHtmlEmbed().run()}
          >
            <Icon name="code" className="size-3" />
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

      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setTableContextMenuOpen(false);
        }}
      >
        <ContextMenuTrigger
          asChild
          disabled={disabled || !withFormatting}
          onContextMenu={(e) => {
            if (!editor || !withFormatting || disabled) return;
            const target = e.target as HTMLElement;
            const isInTable = !!target.closest('table');
            if (!isInTable) {
              e.preventDefault();
              setTableContextMenuOpen(false);
              return;
            }
            const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
            if (pos) {
              editor.chain().focus().setTextSelection(pos.pos).run();
            }
            setTableContextMenuOpen(true);
          }}
        >
          <div className={cn('relative', fullHeight && 'flex-1 min-h-0 flex flex-col [&>div]:flex-1 [&>div]:min-h-0 [&>div]:flex [&>div]:flex-col [&_.tiptap]:flex-1 [&_.tiptap]:min-h-0 [&_.tiptap]:overflow-y-auto')}>
            <EditorContent editor={editor} />
          </div>
        </ContextMenuTrigger>
        {tableContextMenuOpen && editor && (
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => editor.chain().focus().addColumnBefore().run()}
              disabled={!editor.can().addColumnBefore()}
            >
              Insert column before
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              disabled={!editor.can().addColumnAfter()}
            >
              Insert column after
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => editor.chain().focus().addRowBefore().run()}
              disabled={!editor.can().addRowBefore()}
            >
              Insert row above
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => editor.chain().focus().addRowAfter().run()}
              disabled={!editor.can().addRowAfter()}
            >
              Insert row below
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => editor.chain().focus().deleteColumn().run()}
              disabled={!editor.can().deleteColumn()}
            >
              Delete column
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => editor.chain().focus().deleteRow().run()}
              disabled={!editor.can().deleteRow()}
            >
              Delete row
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => editor.chain().focus().toggleCurrentRowHeader().run()}
              disabled={!editor.can().toggleCurrentRowHeader()}
            >
              Toggle header row
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => editor.chain().focus().deleteTable().run()}
              disabled={!editor.can().deleteTable()}
            >
              Delete table
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

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

            {canShowVariables && (
              <DropdownMenuContent
                className="w-56 py-1 px-1"
                align="end"
                sideOffset={4}
              >
                {variablesDropdownInner}
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

      <RichTextHtmlEmbedDialog
        open={htmlEmbedDialogOpen}
        onOpenChange={setHtmlEmbedDialogOpen}
        code={htmlEmbedDialogCode}
        onSave={(newCode) => {
          if (!editor) return;
          const pos = htmlEmbedDialogPosRef.current;
          if (typeof pos === 'number') {
            const node = editor.state.doc.nodeAt(pos);
            if (node?.type.name === 'richTextHtmlEmbed') {
              const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                code: newCode,
              });
              editor.view.dispatch(tr);
            }
          }
          htmlEmbedDialogPosRef.current = null;
        }}
      />
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
