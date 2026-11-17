'use client';

import { useCallback, useMemo, memo } from 'react';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DesignPropertyLabel from './DesignPropertyLabel';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useEditorStore } from '@/stores/useEditorStore';
import { removeSpaces } from '@/lib/utils';
import { setBreakpointClass, propertyToClass, buildBgImgVarName, buildBgImgClass } from '@/lib/tailwind-class-mapper';
import { ASSET_CATEGORIES, isAssetOfType } from '@/lib/asset-utils';
import { IMAGE_FIELD_TYPES, filterFieldGroupsByType, flattenFieldGroups, buildMultiAssetVirtualFields, isVirtualAssetField } from '@/lib/collection-field-utils';
import { isFieldVariable } from '@/lib/variable-utils';
import { getCollectionVariable, isTextContentLayer } from '@/lib/layer-utils';
import {
  createAssetVariable,
  createDynamicTextVariable,
} from '@/lib/variable-utils';
import { buildStyledUpdate } from '@/lib/layer-style-utils';
import { toast } from 'sonner';
import { FieldSelectDropdown } from './CollectionFieldSelector';
import type { Collection, CollectionField, FieldVariable, Layer } from '@/types';
import type { FieldGroup, FieldSourceType } from '@/lib/collection-field-utils';
import type { BackgroundImageSourceType } from './BackgroundImageSettings';
import BackgroundImageSettings from './BackgroundImageSettings';
import ColorPropertyField from './ColorPropertyField';

interface BackgroundsControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

/** Wrap a URL in css url() if not already wrapped */
function wrapCssUrl(value: string): string {
  if (!value) return '';
  return value.startsWith('url(') ? value : `url(${value})`;
}

/** Parse layer classes into a mutable array */
function getClassesArray(layer: Layer): string[] {
  return Array.isArray(layer.classes)
    ? [...layer.classes]
    : (layer.classes || '').split(' ').filter(Boolean);
}

/** Remove a key from a vars record; returns undefined when empty */
function removeVarEntry(vars: Record<string, string> | undefined, key: string): Record<string, string> | undefined {
  if (!vars) return undefined;
  const updated = { ...vars };
  delete updated[key];
  return Object.keys(updated).length > 0 ? updated : undefined;
}

/** Background image design properties that accompany the image URL */
const BG_IMAGE_PROPS = ['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat'] as const;

const isTextLayer = isTextContentLayer;

const BackgroundsControls = memo(function BackgroundsControls({ layer, onLayerUpdate, activeTextStyleKey, fieldGroups, allFields, collections }: BackgroundsControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const openFileManager = useEditorStore((state) => state.openFileManager);
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  // Get current values from layer (no inheritance - only exact breakpoint values)
  const backgroundSize = getDesignProperty('backgrounds', 'backgroundSize') || 'cover';
  const backgroundPosition = getDesignProperty('backgrounds', 'backgroundPosition') || 'center';
  const backgroundRepeat = getDesignProperty('backgrounds', 'backgroundRepeat') || 'no-repeat';
  const backgroundClip = useMemo(() => {
    if (!layer) return '';
    const classes = getClassesArray(layer);
    return classes.some(c => c === 'bg-clip-text' || c.endsWith(':bg-clip-text')) ? 'text' : '';
  }, [layer]);

  // CSS variable name for the active breakpoint/state (shared by image + gradient)
  const bgImgVarName = buildBgImgVarName(activeBreakpoint, activeUIState);
  const bgImageVars = layer?.design?.backgrounds?.bgImageVars;
  const bgGradientVars = layer?.design?.backgrounds?.bgGradientVars;
  const backgroundImage = bgImageVars?.[bgImgVarName] || '';

  // Background color: gradient from bgGradientVars, solid color from design property
  const solidColor = getDesignProperty('backgrounds', 'backgroundColor') || '';
  const gradientValue = bgGradientVars?.[bgImgVarName] || '';
  const backgroundColor = gradientValue || solidColor;

  // Get the background image variable from the layer
  const bgImageVariable = layer?.variables?.backgroundImage?.src;

  // Derive source type from the variable type
  const sourceType = useMemo((): BackgroundImageSourceType => {
    if (!bgImageVariable) return 'none';
    if (bgImageVariable.type === 'field') return 'cms';
    if (bgImageVariable.type === 'dynamic_text') return 'custom_url';
    if (bgImageVariable.type === 'asset') return 'file_manager';
    return 'none';
  }, [bgImageVariable]);

  // Include the layer's own collection fields if it is a collection layer
  // (fieldGroups from parent only includes ancestor collections, not the layer itself)
  const effectiveFieldGroups = useMemo((): FieldGroup[] | undefined => {
    const groups: FieldGroup[] = [...(fieldGroups || [])];

    const collectionVar = layer ? getCollectionVariable(layer) : null;
    const isMultiAssetLayer = collectionVar?.source_field_type === 'multi_asset';

    // Expose virtual per-asset fields whenever this layer (or its existing background
    // binding) is in a multi-asset context, so the picker stays consistent and the
    // current binding can always be restored.
    const bgIsVirtualAsset = !!(
      bgImageVariable && isFieldVariable(bgImageVariable) && bgImageVariable.data.field_id && isVirtualAssetField(bgImageVariable.data.field_id)
    );

    if (isMultiAssetLayer || bgIsVirtualAsset) {
      // Virtual asset field values live in the per-iteration item data only
      // (never in pageCollectionItemData). Always use 'collection' so the
      // value resolves correctly even if the parent multi-image field is page-bound.
      groups.unshift({
        fields: buildMultiAssetVirtualFields(),
        label: 'File fields',
        source: 'collection',
        layerId: layer?.id,
      });
    } else if (collectionVar?.id && allFields) {
      const ownFields = allFields[collectionVar.id] || [];
      const alreadyIncluded = groups.some(g =>
        g.fields.length > 0 && ownFields.length > 0 && g.fields[0]?.id === ownFields[0]?.id
      );
      if (ownFields.length > 0 && !alreadyIncluded) {
        groups.unshift({
          fields: ownFields,
          label: 'Collection fields',
          source: 'collection',
          layerId: layer!.id,
        });
      }
    }

    return groups.length > 0 ? groups : undefined;
  }, [fieldGroups, layer, allFields, bgImageVariable]);

  // Filter field groups to image-bindable types
  const imageFieldGroups = useMemo(() => {
    return filterFieldGroupsByType(effectiveFieldGroups, IMAGE_FIELD_TYPES, { excludeMultipleAsset: true });
  }, [effectiveFieldGroups]);

  const imageFields = useMemo(() => flattenFieldGroups(imageFieldGroups), [imageFieldGroups]);
  const hasCmsFields = imageFields.length > 0;

  /**
   * Atomically clear background design props, Tailwind classes, and variables.
   * @param includeColor - Also clear backgroundColor (used by the X button)
   */
  const clearBackgroundImage = useCallback((includeColor = false) => {
    if (!layer) return;
    const propsToRemove = [...BG_IMAGE_PROPS, ...(includeColor ? ['backgroundColor'] as const : [])];

    // Clean design object and remove bgImageVars + bgGradientVars for the active breakpoint/state
    const cleanedBg = { ...(layer.design?.backgrounds || {}) };
    for (const prop of propsToRemove) {
      delete cleanedBg[prop as keyof typeof cleanedBg];
    }
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    cleanedBg.bgImageVars = removeVarEntry(cleanedBg.bgImageVars, varName);
    if (includeColor) {
      cleanedBg.bgGradientVars = removeVarEntry(cleanedBg.bgGradientVars, varName);
    }

    // Remove corresponding Tailwind classes
    let classes = getClassesArray(layer);
    for (const prop of propsToRemove) {
      // Keep background-image var class if gradient still exists for this breakpoint/state
      if (prop === 'backgroundImage' && !includeColor && cleanedBg.bgGradientVars?.[varName]) continue;
      classes = setBreakpointClass(classes, prop, null, activeBreakpoint, activeUIState);
    }

    // For text layers, also remove bg-clip-text + text-transparent
    if (isTextLayer(layer)) {
      delete cleanedBg.backgroundClip;
      classes = setBreakpointClass(classes, 'backgroundClip', null, activeBreakpoint, activeUIState);
      classes = setBreakpointClass(classes, 'color', null, activeBreakpoint, activeUIState);
    }

    // Build variable updates — always remove backgroundImage variable
    const variableUpdates: Record<string, unknown> = { backgroundImage: undefined };

    // When clearing everything (X button), also remove CMS color design bindings
    if (includeColor) {
      const designVars = { ...layer.variables?.design } as Record<string, unknown> | undefined;
      if (designVars) delete designVars.backgroundColor;
      variableUpdates.design = (designVars && Object.keys(designVars).length > 0) ? designVars : undefined;
    }

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: cleanedBg },
      classes: classes.join(' '),
      variables: { ...layer.variables, ...variableUpdates },
    }));
  }, [layer, onLayerUpdate, activeBreakpoint, activeUIState]);

  /** Update the background image variable on the layer */
  const updateBgImageVariable = useCallback((src: typeof bgImageVariable | undefined) => {
    if (!layer) return;
    onLayerUpdate(layer.id, {
      variables: {
        ...layer.variables,
        backgroundImage: src ? { src } : undefined,
      },
    });
  }, [layer, onLayerUpdate]);

  /**
   * Update background color/gradient.
   * Solid colors → normal backgroundColor class (bg-[#hex]).
   * Gradients → bgGradientVars + background-image CSS variable class (shares slot with image).
   */
  const handleBackgroundColorChange = useCallback((value: string, immediate = false) => {
    if (!layer) return;
    const sanitized = removeSpaces(value) || null;
    const isGradient = sanitized?.includes('gradient(');

    if (isGradient) {
      // Store gradient in bgGradientVars and use background-image CSS variable class
      const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
      const currentBg = layer.design?.backgrounds || {};
      const updatedBg = {
        ...currentBg,
        bgGradientVars: { ...currentBg.bgGradientVars, [varName]: sanitized! },
        isActive: true,
      };

      let classes = getClassesArray(layer);
      classes = setBreakpointClass(classes, 'backgroundImage', buildBgImgClass(varName), activeBreakpoint, activeUIState);
      // Remove any leftover solid bg-[#hex] class — gradient replaces it
      classes = setBreakpointClass(classes, 'backgroundColor', null, activeBreakpoint, activeUIState);

      onLayerUpdate(layer.id, buildStyledUpdate(layer, {
        design: { ...layer.design, backgrounds: updatedBg },
        classes: classes.join(' '),
      }));
    } else {
      // Solid color — clear gradient for this breakpoint/state if present
      const currentBg = layer.design?.backgrounds || {};
      const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
      const hadGradient = !!currentBg.bgGradientVars?.[varName];

      if (hadGradient) {
        const updatedBg = {
          ...currentBg,
          bgGradientVars: removeVarEntry(currentBg.bgGradientVars, varName),
        };
        // Remove background-image var class only if no image exists for this breakpoint/state either
        let classes = getClassesArray(layer);
        if (!currentBg.bgImageVars?.[varName]) {
          classes = setBreakpointClass(classes, 'backgroundImage', null, activeBreakpoint, activeUIState);
        }

        const bgClass = sanitized ? propertyToClass('backgrounds', 'backgroundColor', sanitized) : null;
        classes = setBreakpointClass(classes, 'backgroundColor', bgClass, activeBreakpoint, activeUIState);

        onLayerUpdate(layer.id, buildStyledUpdate(layer, {
          design: { ...layer.design, backgrounds: { ...updatedBg, backgroundColor: sanitized || undefined } },
          classes: classes.join(' '),
        }));
      } else {
        (immediate ? updateDesignProperty : debouncedUpdateDesignProperty)('backgrounds', 'backgroundColor', sanitized);
      }
    }
  }, [layer, onLayerUpdate, updateDesignProperty, debouncedUpdateDesignProperty, activeBreakpoint, activeUIState]);

  /**
   * Update the background image URL.
   * Stores the CSS variable class and the URL value in bgImageVars.
   */
  const handleBackgroundImageChange = useCallback((value: string, immediate = false) => {
    if (!layer) return;
    const isDataUrl = value.startsWith('data:') || value.startsWith('url(data:');
    const processedValue = isDataUrl ? wrapCssUrl(value) : wrapCssUrl(removeSpaces(value));

    // Build CSS variable name for the active breakpoint/state
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    const cssVarClass = buildBgImgClass(varName);

    // Update design: store var name as backgroundImage and URL in bgImageVars
    const currentBg = layer.design?.backgrounds || {};
    const newVars = { ...currentBg.bgImageVars };
    if (processedValue) {
      newVars[varName] = processedValue;
    } else {
      delete newVars[varName];
    }
    const updatedBg = {
      ...currentBg,
      backgroundImage: varName,
      bgImageVars: Object.keys(newVars).length > 0 ? newVars : undefined,
      isActive: true,
    };

    // Update Tailwind class
    let classes = getClassesArray(layer);
    classes = setBreakpointClass(classes, 'backgroundImage', processedValue ? cssVarClass : null, activeBreakpoint, activeUIState);

    // Keep variable in sync for custom_url
    let variableUpdates: Partial<Layer['variables']> | undefined;
    if (bgImageVariable?.type === 'dynamic_text') {
      const plainUrl = processedValue.startsWith('url(') ? processedValue.slice(4, -1) : processedValue;
      variableUpdates = {
        ...layer.variables,
        backgroundImage: { src: createDynamicTextVariable(plainUrl) },
      };
    }

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: updatedBg },
      classes: classes.join(' '),
      ...(variableUpdates ? { variables: variableUpdates } : {}),
    }));
  }, [layer, onLayerUpdate, activeBreakpoint, activeUIState, bgImageVariable]);

  /** Generic handler for any background design property (size, position, repeat) */
  const handleBackgroundPropChange = useCallback(
    (property: string, value: string) => updateDesignProperty('backgrounds', property, value),
    [updateDesignProperty],
  );

  /** Toggle background-clip: text (also manages text-transparent for the effect to be visible) */
  const handleBackgroundClipToggle = useCallback((clipToText: boolean) => {
    if (!layer) return;
    let classes = getClassesArray(layer);
    const bgDesign = { ...(layer.design?.backgrounds || {}) };

    if (clipToText) {
      bgDesign.backgroundClip = 'text';
      const cls = propertyToClass('backgrounds', 'backgroundClip', 'text');
      if (cls) classes = setBreakpointClass(classes, 'backgroundClip', cls, activeBreakpoint, activeUIState);
      classes = setBreakpointClass(classes, 'color', 'text-transparent', activeBreakpoint, activeUIState);
    } else {
      delete bgDesign.backgroundClip;
      classes = setBreakpointClass(classes, 'backgroundClip', null, activeBreakpoint, activeUIState);
      classes = setBreakpointClass(classes, 'color', null, activeBreakpoint, activeUIState);
    }

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: bgDesign },
      classes: classes.join(' '),
    }));
  }, [layer, onLayerUpdate, activeBreakpoint, activeUIState]);

  /** Handle source type change — single atomic onLayerUpdate to avoid stale-state races */
  const handleSourceTypeChange = useCallback((type: BackgroundImageSourceType) => {
    if (type === 'none') {
      clearBackgroundImage();
      return;
    }
    if (!layer) return;

    // Build the new variable
    let newSrc: typeof bgImageVariable;
    if (type === 'file_manager') {
      newSrc = createAssetVariable('');
    } else if (type === 'custom_url') {
      newSrc = createDynamicTextVariable('');
    } else {
      newSrc = { type: 'field', data: { field_id: null, relationships: [], field_type: null } } as FieldVariable;
    }

    // Ensure size/position/repeat defaults, set up CSS variable class
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    const bgDesign = { ...(layer.design?.backgrounds || {}), isActive: true };
    if (!bgDesign.backgroundSize) bgDesign.backgroundSize = 'cover';
    if (!bgDesign.backgroundPosition) bgDesign.backgroundPosition = 'center';
    if (!bgDesign.backgroundRepeat) bgDesign.backgroundRepeat = 'no-repeat';
    bgDesign.backgroundImage = varName;

    // Rebuild classes for these properties
    let classes = getClassesArray(layer);
    for (const prop of ['backgroundSize', 'backgroundPosition', 'backgroundRepeat'] as const) {
      const cls = propertyToClass('backgrounds', prop, bgDesign[prop]!);
      classes = setBreakpointClass(classes, prop, cls, activeBreakpoint, activeUIState);
    }
    classes = setBreakpointClass(classes, 'backgroundImage', buildBgImgClass(varName), activeBreakpoint, activeUIState);

    // For text layers, auto-enable bg-clip-text so the image shows through the text
    if (isTextLayer(layer)) {
      bgDesign.backgroundClip = 'text';
      const clipCls = propertyToClass('backgrounds', 'backgroundClip', 'text');
      if (clipCls) classes = setBreakpointClass(classes, 'backgroundClip', clipCls, activeBreakpoint, activeUIState);
      classes = setBreakpointClass(classes, 'color', 'text-transparent', activeBreakpoint, activeUIState);
    }

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: bgDesign },
      classes: classes.join(' '),
      variables: { ...layer.variables, backgroundImage: { src: newSrc } },
    }));
  }, [layer, onLayerUpdate, clearBackgroundImage, activeBreakpoint, activeUIState]);

  /** Open the file manager to pick a background image asset */
  const handleOpenFileManager = useCallback(() => {
    openFileManager(
      (asset) => {
        const isImage = asset.mime_type && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES);
        if (!isImage) {
          toast.error('Invalid asset type', {
            description: 'Please select an image file.',
          });
          return false;
        }

        if (!asset.public_url) {
          toast.error('Asset has no URL');
          return false;
        }

        if (!layer) return false;

        // Atomic update: set asset variable + CSS variable class + URL in bgImageVars
        const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
        const cssUrl = `url(${asset.public_url})`;
        const currentBg = layer.design?.backgrounds || {};
        const updatedBg = {
          ...currentBg,
          backgroundImage: varName,
          bgImageVars: { ...currentBg.bgImageVars, [varName]: cssUrl },
          isActive: true,
        };

        let classes = getClassesArray(layer);
        classes = setBreakpointClass(classes, 'backgroundImage', buildBgImgClass(varName), activeBreakpoint, activeUIState);

        onLayerUpdate(layer.id, buildStyledUpdate(layer, {
          design: { ...layer.design, backgrounds: updatedBg },
          classes: classes.join(' '),
          variables: {
            ...layer.variables,
            backgroundImage: { src: createAssetVariable(asset.id) },
          },
        }));
      },
      null,
      [ASSET_CATEGORIES.IMAGES]
    );
  }, [openFileManager, layer, onLayerUpdate, activeBreakpoint, activeUIState]);

  /** Handle CMS field selection — sets variable + CSS variable class */
  const handleFieldSelect = useCallback((
    fieldId: string,
    relationshipPath: string[],
    source?: FieldSourceType,
    layerId?: string,
  ) => {
    if (!layer) return;
    const field = imageFields.find(f => f.id === fieldId);
    const fieldVar: FieldVariable = {
      type: 'field',
      data: {
        field_id: fieldId,
        relationships: relationshipPath,
        field_type: field?.type || null,
        source,
        collection_layer_id: layerId,
      },
    };

    // Set CSS variable class so LayerRenderer knows to resolve via --bg-img var
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    const currentBg = layer.design?.backgrounds || {};
    const updatedBg = {
      ...currentBg,
      backgroundImage: varName,
      isActive: true,
    };

    let classes = getClassesArray(layer);
    classes = setBreakpointClass(classes, 'backgroundImage', buildBgImgClass(varName), activeBreakpoint, activeUIState);

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: updatedBg },
      classes: classes.join(' '),
      variables: {
        ...layer.variables,
        backgroundImage: { src: fieldVar },
      },
    }));
  }, [layer, onLayerUpdate, imageFields, activeBreakpoint, activeUIState]);

  /** Render the CMS field selector dropdown */
  const renderFieldSelector = useCallback(() => (
    <FieldSelectDropdown
      fieldGroups={imageFieldGroups}
      allFields={allFields || {}}
      collections={collections || []}
      value={bgImageVariable?.type === 'field' ? (bgImageVariable as FieldVariable).data.field_id : null}
      onSelect={handleFieldSelect}
      placeholder="Select..."
      allowedFieldTypes={IMAGE_FIELD_TYPES}
    />
  ), [imageFieldGroups, allFields, collections, bgImageVariable, handleFieldSelect]);

  return (
    <div className="py-5">
      <header className="py-4 -mt-4">
        <Label>Backgrounds</Label>
      </header>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['backgroundColor']} variant="muted">Color</DesignPropertyLabel>
          <div className="col-span-2 *:w-full">
            <ColorPropertyField
              value={backgroundColor}
              onChange={(v) => handleBackgroundColorChange(v)}
              onImmediateChange={(v) => handleBackgroundColorChange(v, true)}
              defaultValue="#ffffff"
              layer={layer}
              onLayerUpdate={onLayerUpdate}
              designProperty="backgroundColor"
              fieldGroups={fieldGroups}
              allFields={allFields}
              collections={collections}
            />
          </div>
        </div>

        <BackgroundImageSettings
          backgroundImage={backgroundImage}
          backgroundSize={backgroundSize}
          backgroundPosition={backgroundPosition}
          backgroundRepeat={backgroundRepeat}
          sourceType={sourceType}
          hasCmsFields={hasCmsFields}
          onBackgroundImageChange={handleBackgroundImageChange}
          onBackgroundPropChange={handleBackgroundPropChange}
          onSourceTypeChange={handleSourceTypeChange}
          onOpenFileManager={handleOpenFileManager}
          renderFieldSelector={renderFieldSelector}
        />

        {/*<div className="grid grid-cols-3 items-center">*/}
        {/*  <Label variant="muted">Clip text</Label>*/}
        {/*  <div className="col-span-2">*/}
        {/*    <Tabs*/}
        {/*      value={backgroundClip === 'text' ? 'yes' : 'no'}*/}
        {/*      onValueChange={(v) => handleBackgroundClipToggle(v === 'yes')}*/}
        {/*      className="w-full"*/}
        {/*    >*/}
        {/*      <TabsList className="w-full">*/}
        {/*        <TabsTrigger value="no">No</TabsTrigger>*/}
        {/*        <TabsTrigger value="yes">Yes</TabsTrigger>*/}
        {/*      </TabsList>*/}
        {/*    </Tabs>*/}
        {/*  </div>*/}
        {/*</div>*/}
      </div>
    </div>
  );
});
export default BackgroundsControls;
