'use client';

import React, { memo, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import DesignPropertyLabel from './DesignPropertyLabel';
import IconTabs, { type IconOption } from './IconTabs';
import SettingsPanel from './SettingsPanel';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useParentLayout } from '@/hooks/use-parent-layout';
import { useEditorStore } from '@/stores/useEditorStore';
import type { Layer } from '@/types';

const noop = () => {};

interface FlexChildControlsProps {
  layer: Layer | null;
  parentLayer?: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

/**
 * Optional sizing override; added via "+" and removed with "x". Without it the
 * browser default (`0 1 auto`) applies, so no "auto" preset is needed.
 */
type Sizing = 'shrink' | 'grow' | 'fixed';
/** Optional order override; added via "+" and removed with "x" */
type OrderMode = 'first' | 'last' | 'custom';

const SIZING_OPTIONS: IconOption<Sizing>[] = [
  { value: 'shrink', icon: 'minSize', label: 'Shrink if needed' },
  { value: 'grow', icon: 'maxSize', label: 'Grow equally' },
  { value: 'fixed', icon: 'flex-fixed', label: "Don't shrink or grow" },
];

/** Preset → `flex` shorthand (initial = 0 1 auto, 1 = 1 1 0%, none = 0 0 auto) */
const SIZING_FLEX_VALUE: Record<Sizing, string> = {
  shrink: 'initial',
  grow: '1',
  fixed: 'none',
};

/**
 * Per-child override of the parent's Align. Always visible: with no override the
 * parent's value is shown selected, and re-selecting it clears the override.
 */
type AlignSelf = 'start' | 'center' | 'end' | 'stretch';

const ALIGN_SELF_OPTIONS: IconOption<AlignSelf>[] = [
  { value: 'start', icon: 'alignStart', label: 'Start' },
  { value: 'center', icon: 'alignCenter', label: 'Center' },
  { value: 'end', icon: 'alignEnd', label: 'End' },
  { value: 'stretch', icon: 'alignStretch', label: 'Stretch' },
];

const ORDER_OPTIONS: IconOption<OrderMode>[] = [
  { value: 'first', label: 'First' },
  { value: 'last', label: 'Last' },
  { value: 'custom', icon: 'more', label: 'Custom' },
];

/** Optional setting row with an "x" that removes it (same look as Sizing's Aspect ratio) */
function RemovableRow({ label, properties, onRemove, children }: {
  label: string;
  /** Design properties the row controls, for the label's source tooltip */
  properties: string[];
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3">
      <DesignPropertyLabel properties={properties} variant="muted">{label}</DesignPropertyLabel>
      <div className="col-span-2 flex items-center gap-2">
        <div className="flex-1">{children}</div>
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          onClick={onRemove}
        >
          <Icon name="x" className="size-2.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Map the layer's `flex` shorthand to a preset. `flex-auto` and individual
 * grow/shrink classes (from imports or the AI) have no preset, so no tab is selected.
 */
function resolveSizing(flex: string): Sizing | '' {
  if (flex === 'initial') return 'shrink';
  if (flex === '1') return 'grow';
  if (flex === 'none') return 'fixed';
  return '';
}

/** `self-auto`/`self-baseline` have no tab, so they select nothing rather than a wrong option */
function resolveAlignSelf(alignSelf: string): AlignSelf | '' {
  return ALIGN_SELF_OPTIONS.some((option) => option.value === alignSelf) ? (alignSelf as AlignSelf) : '';
}

/** Empty when no order is set (row hidden); `order-none` selects nothing */
function resolveOrderMode(order: string, forceCustom: boolean): OrderMode | '' {
  if (order === 'first' || order === 'last') return order;
  if (/^\d+$/.test(order) || forceCustom) return 'custom';
  return '';
}

/**
 * "Flex child" section: how this layer behaves inside its flex parent. Align is always
 * shown (inheriting from the parent unless overridden); Sizing and Order are opt-in via "+".
 * Renders nothing when the parent is not a flex container.
 */
const FlexChildControls = memo(function FlexChildControls({ layer, parentLayer = null, onLayerUpdate }: FlexChildControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const { updateDesignProperties, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });
  const { isFlex, isColumnAxis, alignItems } = useParentLayout(parentLayer);

  const flex = getDesignProperty('layout', 'flex') || '';
  const flexGrowRaw = getDesignProperty('layout', 'flexGrow') || '';
  const flexShrinkRaw = getDesignProperty('layout', 'flexShrink') || '';
  const alignSelfRaw = getDesignProperty('layout', 'alignSelf') || '';
  const order = getDesignProperty('layout', 'order') || '';

  // Rows added from "+" appear empty until the user picks a value, so track
  // "added" separately from "has a value"
  const [isSizingAdded, setIsSizingAdded] = useState(false);
  const [isOrderAdded, setIsOrderAdded] = useState(false);
  // Custom order can be chosen before a number is typed
  const [isCustomOrder, setIsCustomOrder] = useState(false);
  const [orderInput, setOrderInput] = useState(/^\d+$/.test(order) ? order : '');

  useEffect(() => {
    setIsSizingAdded(false);
    setIsOrderAdded(false);
    setIsCustomOrder(false);
  }, [layer?.id]);

  useEffect(() => {
    setOrderInput(/^\d+$/.test(order) ? order : '');
  }, [order]);

  if (!layer || !isFlex) return null;

  const sizing = resolveSizing(flex);
  const orderMode = resolveOrderMode(order, isCustomOrder);

  const hasSizing = Boolean(flex || flexGrowRaw || flexShrinkRaw) || isSizingAdded;

  // No override → show what the child actually gets from the parent (`baseline` has no tab)
  const inheritedAlign = resolveAlignSelf(alignItems);
  const ownAlign = resolveAlignSelf(alignSelfRaw);
  const alignSelf = ownAlign || inheritedAlign;
  const alignOptions: IconOption<AlignSelf>[] = ALIGN_SELF_OPTIONS.map((option) => (
    option.value === inheritedAlign && !ownAlign
      ? { ...option, label: `${option.label} (from parent)` }
      : option
  ));

  // Picking the parent's value again drops the override so the child follows the parent
  const handleAlignSelfChange = (value: AlignSelf) => {
    updateDesignProperties([{
      category: 'layout',
      property: 'alignSelf',
      value: value === inheritedAlign ? null : value,
    }]);
  };

  // A preset replaces any individual grow/shrink classes so the two never conflict
  const handleSizingChange = (next: Sizing) => {
    updateDesignProperties([
      { category: 'layout', property: 'flex', value: SIZING_FLEX_VALUE[next] },
      { category: 'layout', property: 'flexGrow', value: null },
      { category: 'layout', property: 'flexShrink', value: null },
    ]);
  };

  const handleRemoveSizing = () => {
    setIsSizingAdded(false);
    updateDesignProperties([
      { category: 'layout', property: 'flex', value: null },
      { category: 'layout', property: 'flexGrow', value: null },
      { category: 'layout', property: 'flexShrink', value: null },
    ]);
  };

  const hasOrder = Boolean(order) || isOrderAdded || isCustomOrder;
  const canAdd = !hasSizing || !hasOrder;

  const addButton = (
    <Button
      variant="ghost" size="xs"
      aria-label="Add flex child option"
      disabled={!canAdd}
    >
      <Icon name="plus" />
    </Button>
  );

  const handleOrderModeChange = (next: OrderMode) => {
    if (next === 'custom') {
      setIsCustomOrder(true);
      if (!/^\d+$/.test(order)) {
        updateDesignProperties([{ category: 'layout', property: 'order', value: null }]);
      }
      return;
    }

    setIsCustomOrder(false);
    updateDesignProperties([{ category: 'layout', property: 'order', value: next }]);
  };

  const handleRemoveOrder = () => {
    setIsOrderAdded(false);
    setIsCustomOrder(false);
    updateDesignProperties([{ category: 'layout', property: 'order', value: null }]);
  };

  const handleOrderInputChange = (value: string) => {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setOrderInput(value);
    debouncedUpdateDesignProperty('layout', 'order', value || null);
  };

  return (
    <SettingsPanel
      title="Flex child"
      isOpen
      onToggle={noop}
      action={
        // Everything added: plain disabled button so no empty menu can open
        canAdd ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>{addButton}</DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setIsSizingAdded(true)}
                disabled={hasSizing}
              >
                Sizing
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsOrderAdded(true)}
                disabled={hasOrder}
              >
                Order
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : addButton
      }
    >
      <div className="grid grid-cols-3">
        <DesignPropertyLabel properties={['alignSelf']} variant="muted">Align</DesignPropertyLabel>
        <div className="col-span-2">
          <IconTabs
            value={alignSelf}
            options={alignOptions}
            onChange={handleAlignSelfChange}
            iconClassName={isColumnAxis ? '-rotate-90' : undefined}
          />
        </div>
      </div>

      {hasSizing && (
        <RemovableRow
          label="Sizing" properties={['flex', 'flexGrow', 'flexShrink']}
          onRemove={handleRemoveSizing}
        >
          <IconTabs
            value={sizing}
            options={SIZING_OPTIONS}
            onChange={handleSizingChange}
          />
        </RemovableRow>
      )}

      {hasOrder && (
        <RemovableRow
          label="Order" properties={['order']}
          onRemove={handleRemoveOrder}
        >
          <IconTabs
            value={orderMode}
            options={ORDER_OPTIONS}
            onChange={handleOrderModeChange}
          />
        </RemovableRow>
      )}

      {orderMode === 'custom' && (
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['order']} variant="muted">Position</DesignPropertyLabel>
          <div className="col-span-2">
            <InputGroup>
              <InputGroupInput
                stepper
                min="0"
                step="1"
                placeholder="0"
                value={orderInput}
                onChange={(e) => handleOrderInputChange(e.target.value)}
              />
            </InputGroup>
          </div>
        </div>
      )}
    </SettingsPanel>
  );
});

export default FlexChildControls;
