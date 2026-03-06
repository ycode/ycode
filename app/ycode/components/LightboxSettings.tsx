'use client';

/**
 * Lightbox Settings Component
 *
 * Settings panel for lightbox layers. Manages image files (manual or CMS-bound),
 * thumbnails, overlay theme, group linking, and animation settings.
 */

import React, { useState, useMemo, useCallback } from 'react';

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import SettingsPanel from './SettingsPanel';
import ToggleGroup from './ToggleGroup';
import { FieldSelectDropdown, type FieldGroup, type FieldSourceType } from './CollectionFieldSelector';

import { DEFAULT_LIGHTBOX_SETTINGS } from '@/lib/templates/utilities';
import { useEditorStore } from '@/stores/useEditorStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { ASSET_CATEGORIES, isAssetOfType } from '@/lib/asset-utils';
import { IMAGE_FIELD_TYPES, filterFieldGroupsByType, flattenFieldGroups } from '@/lib/collection-field-utils';
import { isFieldVariable } from '@/lib/variable-utils';
import { toast } from 'sonner';

import type {
  Layer,
  LightboxSettings as LightboxSettingsType,
  SwiperAnimationEffect,
  LightboxOverlay,
  LightboxFilesSource,
  Asset,
  FieldVariable,
  CollectionField,
  Collection,
} from '@/types';

interface LightboxSettingsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

const ANIMATION_EFFECTS: { label: string; value: SwiperAnimationEffect }[] = [
  { label: 'Slide', value: 'slide' },
  { label: 'Fade', value: 'fade' },
  { label: 'Cube', value: 'cube' },
  { label: 'Flip', value: 'flip' },
  { label: 'Coverflow', value: 'coverflow' },
  { label: 'Cards', value: 'cards' },
];

const EASING_OPTIONS: { label: string; value: string; icon: 'ease-linear' | 'ease-in' | 'ease-in-out' | 'ease-out' }[] = [
  { label: 'Linear', value: 'ease-linear', icon: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in', icon: 'ease-in' },
  { label: 'Ease in out', value: 'ease-in-out', icon: 'ease-in-out' },
  { label: 'Ease out', value: 'ease-out', icon: 'ease-out' },
];

function SortableFileItem({
  fileId,
  index,
  url,
  filename,
  onReplace,
  onRemove,
}: {
  fileId: string;
  index: number;
  url: string | null;
  filename: string;
  onReplace: (index: number) => void;
  onRemove: (fileId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fileId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-1 rounded-md bg-secondary/30 py-1 pr-1 hover:bg-secondary/50"
    >
      <button
        type="button"
        className="flex shrink-0 cursor-grab items-center justify-center pl-2 pr-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <Icon name="grip-vertical" className="size-3" />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
        onClick={() => onReplace(index)}
        aria-label="Replace image"
      >
        <div className="size-6 shrink-0 overflow-hidden rounded bg-secondary/50">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              className="size-full object-cover"
            />
          )}
        </div>
        <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground group-hover:text-foreground">
          {filename}
        </span>
      </button>
      <Button
        variant="ghost"
        size="xs"
        className="size-5 shrink-0 p-0"
        onClick={() => onRemove(fileId)}
        aria-label="Remove file"
      >
        <Icon name="x" className="size-2.5" />
      </Button>
    </div>
  );
}

export default function LightboxSettings({
  layer,
  onLayerUpdate,
  fieldGroups,
  allFields,
  collections,
}: LightboxSettingsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const openFileManager = useEditorStore((state) => state.openFileManager);
  const getAsset = useAssetsStore((state) => state.getAsset);

  // Filter field groups to image-capable types (including multi-asset)
  const imageFieldGroups = useMemo(() => {
    if (!fieldGroups) return [];
    return filterFieldGroupsByType(fieldGroups, IMAGE_FIELD_TYPES);
  }, [fieldGroups]);

  const imageFields = useMemo(() => flattenFieldGroups(imageFieldGroups), [imageFieldGroups]);

  const hasCmsFields = imageFieldGroups.length > 0;

  const currentFieldId = useMemo(() => {
    const filesField = layer?.settings?.lightbox?.filesField;
    if (filesField && isFieldVariable(filesField)) {
      return filesField.data.field_id;
    }
    return null;
  }, [layer?.settings?.lightbox?.filesField]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Guard: only render for lightbox layers
  if (!layer || layer.name !== 'lightbox') return null;

  const settings: LightboxSettingsType = {
    ...DEFAULT_LIGHTBOX_SETTINGS,
    ...layer.settings?.lightbox,
  };

  const updateSetting = (key: keyof LightboxSettingsType, value: LightboxSettingsType[keyof LightboxSettingsType]) => {
    onLayerUpdate(layer.id, {
      settings: {
        ...layer.settings,
        lightbox: { ...settings, [key]: value },
      },
    });
  };

  const updateSettings = (patch: Partial<LightboxSettingsType>) => {
    onLayerUpdate(layer.id, {
      settings: {
        ...layer.settings,
        lightbox: { ...settings, ...patch },
      },
    });
  };

  const handleSourceChange = (source: LightboxFilesSource) => {
    if (source === settings.filesSource) return;
    updateSettings({ filesSource: source });
  };

  const handleFieldSelect = (
    fieldId: string,
    relationshipPath: string[],
    source?: FieldSourceType,
    layerId?: string,
  ) => {
    const field = imageFields.find(f => f.id === fieldId);
    const fieldVariable: FieldVariable = {
      type: 'field',
      data: {
        field_id: fieldId,
        relationships: relationshipPath,
        field_type: field?.type || null,
        source,
        collection_layer_id: layerId,
      },
    };
    updateSettings({ filesField: fieldVariable, filesSource: 'cms' });
  };

  const handleAddFile = () => {
    openFileManager(
      (asset: Asset) => {
        const isImage = asset.mime_type && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES);
        if (!isImage) {
          toast.error('Only image files can be added to a lightbox');
          return false;
        }
        const newFiles = [...settings.files, asset.id];
        updateSetting('files', newFiles);
      },
      null,
      'images',
    );
  };

  const handleReplaceFile = (index: number) => {
    openFileManager(
      (asset: Asset) => {
        const isImage = asset.mime_type && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES);
        if (!isImage) {
          toast.error('Only image files can be added to a lightbox');
          return false;
        }
        const newFiles = [...settings.files];
        newFiles[index] = asset.id;
        updateSetting('files', newFiles);
      },
      null,
      'images',
    );
  };

  const handleRemoveFile = (fileId: string) => {
    updateSetting('files', settings.files.filter((f) => f !== fileId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = settings.files.indexOf(active.id as string);
    const newIndex = settings.files.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    updateSetting('files', arrayMove(settings.files, oldIndex, newIndex));
  };

  const getFileUrl = (fileId: string): string | null => {
    if (fileId.startsWith('http') || fileId.startsWith('/')) return fileId;
    const asset = getAsset(fileId);
    return asset?.public_url ?? null;
  };

  return (
    <SettingsPanel
      title="Lightbox"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      action={settings.filesSource === 'files' ? (
        <Button
          variant="secondary"
          size="xs"
          onClick={handleAddFile}
          aria-label="Add image"
        >
          <Icon name="plus" />
        </Button>
      ) : undefined}
    >
      <div className="flex flex-col gap-2.5">
        {/* Source */}
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Source</Label>
          <div className="col-span-2">
            <Select
              value={settings.filesSource}
              onValueChange={(v) => handleSourceChange(v as LightboxFilesSource)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="files"><Icon name="folder" className="size-3" /> File manager</SelectItem>
                <SelectItem value="cms" disabled={!hasCmsFields}><Icon name="database" className="size-3" /> CMS field</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Files mode: manual file management */}
        {settings.filesSource === 'files' && settings.files.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={settings.files}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-1">
                {settings.files.map((fileId, index) => (
                  <SortableFileItem
                    key={fileId}
                    fileId={fileId}
                    index={index}
                    url={getFileUrl(fileId)}
                    filename={getAsset(fileId)?.filename || fileId}
                    onReplace={handleReplaceFile}
                    onRemove={handleRemoveFile}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* CMS mode: field selector */}
        {settings.filesSource === 'cms' && (
          <div className="grid grid-cols-3 items-center">
            <Label variant="muted">Field</Label>
            <div className="col-span-2">
              <FieldSelectDropdown
                fieldGroups={imageFieldGroups}
                allFields={allFields || {}}
                collections={collections || []}
                value={currentFieldId}
                onSelect={handleFieldSelect}
                placeholder="Select image field"
                allowedFieldTypes={IMAGE_FIELD_TYPES}
              />
            </div>
          </div>
        )}

        {/* Overlay */}
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Overlay</Label>
          <div className="col-span-2 *:w-full">
            <ToggleGroup
              options={[
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]}
              value={settings.overlay}
              onChange={(v) => updateSetting('overlay', v as LightboxOverlay)}
            />
          </div>
        </div>

        {/* Animation Effect */}
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Effect</Label>
          <div className="col-span-2">
            <Select
              value={settings.animationEffect}
              onValueChange={(v) => updateSetting('animationEffect', v as SwiperAnimationEffect)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANIMATION_EFFECTS.map((effect) => (
                  <SelectItem key={effect.value} value={effect.value}>
                    {effect.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Easing */}
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Easing</Label>
          <div className="col-span-2">
            <Select
              value={settings.easing}
              onValueChange={(v) => updateSetting('easing', v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EASING_OPTIONS.map((ease) => (
                  <SelectItem key={ease.value} value={ease.value}>
                    <span className="flex items-center gap-2">
                      <Icon name={ease.icon} className="size-3" />
                      {ease.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Duration */}
        <div className="grid grid-cols-3">
          <Label variant="muted">Duration</Label>
          <div className="col-span-2 *:w-full">
            <InputGroup>
              <InputGroupInput
                stepper
                step="0.1"
                min="0"
                value={settings.duration}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  updateSetting('duration', val);
                }}
                onBlur={() => {
                  const num = parseFloat(settings.duration);
                  if (!Number.isNaN(num) && num >= 0) {
                    updateSetting('duration', String(num));
                  } else {
                    updateSetting('duration', '0.5');
                  }
                }}
                placeholder="0"
              />
              <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                sec
              </InputGroupAddon>
            </InputGroup>
          </div>
        </div>

        {/* Group ID */}
        <div className="grid grid-cols-3 items-center">
          <div className="flex items-center gap-1.5">
            <Label variant="muted">Group</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Icon name="info" className="size-3 cursor-help opacity-70" />
              </TooltipTrigger>
              <TooltipContent align="start">Link multiple lightboxes into one shared gallery</TooltipContent>
            </Tooltip>
          </div>
          <div className="col-span-2 w-full min-w-0">
            <Input
              size="xs"
              className="w-full"
              placeholder="Group ID"
              value={settings.groupId}
              onChange={(e) => updateSetting('groupId', e.target.value)}
            />
          </div>
        </div>

        {/* Behavior */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label variant="muted">Behavior</Label>
          </div>
          <div className="col-span-2 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="lightbox-thumbnails"
                checked={settings.thumbnails}
                onCheckedChange={(v) => updateSetting('thumbnails', v)}
              />
              <Label
                htmlFor="lightbox-thumbnails"
                className="cursor-pointer"
              >Show thumbnails</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="lightbox-navigation"
                checked={settings.navigation}
                onCheckedChange={(v) => updateSetting('navigation', v)}
              />
              <Label
                htmlFor="lightbox-navigation"
                className="cursor-pointer"
              >Show navigation</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="lightbox-pagination"
                checked={settings.pagination}
                onCheckedChange={(v) => updateSetting('pagination', v)}
              />
              <Label
                htmlFor="lightbox-pagination"
                className="cursor-pointer"
              >Show pagination</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="lightbox-zoom"
                checked={settings.zoom}
                onCheckedChange={(v) => updateSetting('zoom', v)}
              />
              <Label
                htmlFor="lightbox-zoom"
                className="cursor-pointer"
              >Pinch to zoom</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="lightbox-double-tap-zoom"
                checked={settings.doubleTapZoom}
                onCheckedChange={(v) => updateSetting('doubleTapZoom', v)}
              />
              <Label
                htmlFor="lightbox-double-tap-zoom"
                className="cursor-pointer"
              >Double-tap zoom</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="lightbox-mousewheel"
                checked={settings.mousewheel}
                onCheckedChange={(v) => updateSetting('mousewheel', v)}
              />
              <Label
                htmlFor="lightbox-mousewheel"
                className="cursor-pointer"
              >Mousewheel</Label>
            </div>
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}
