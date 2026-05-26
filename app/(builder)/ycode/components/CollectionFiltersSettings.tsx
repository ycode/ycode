'use client';

/**
 * Collection Filters Settings Component
 *
 * Settings panel for filtering collection items based on field values.
 * Unlike conditional visibility (which hides rendered layers), filters
 * reduce the dataset before items are rendered - filtering at the data level.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import debounce from 'lodash.debounce';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SettingsPanel from './SettingsPanel';
import type {
  Layer,
  CollectionField,
  CollectionFieldType,
  VisibilityCondition,
  VisibilityConditionGroup,
  ConditionalVisibility,
  VisibilityOperator,
} from '@/types';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { collectionsApi } from '@/lib/api';
import {
  getFieldIcon,
  getOperatorsForFieldType,
  operatorRequiresValue,
  operatorRequiresItemSelection,
  operatorRequiresSecondValue,
  findDisplayField,
  getItemDisplayName,
  COMPARE_OPERATORS,
  DATE_PRESET_OPTIONS,
  isDatePreset,
  isDateFieldType,
} from '@/lib/collection-field-utils';
import { getCollectionVariable, isInputInsideFilter, resolveFilterInputId, findLayerById } from '@/lib/layer-utils';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CollectionItemWithValues } from '@/types';

interface CollectionFiltersSettingsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  collectionId: string;
}

/**
 * Reference Items Selector Component
 * Multi-select dropdown for selecting collection items for is_one_of/is_not_one_of operators
 */
function ReferenceItemsSelector({
  collectionId,
  value,
  onChange,
}: {
  collectionId: string;
  value: string; // JSON array of item IDs
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CollectionItemWithValues[]>([]);
  const [loading, setLoading] = useState(false);

  // Get the collection info and fields from the store
  const { collections, fields } = useCollectionsStore();
  const collection = collections.find(c => c.id === collectionId);
  /* eslint-disable-next-line react-hooks/exhaustive-deps -- collectionFields derived from store */
  const collectionFields = fields[collectionId] || [];

  // Find the title/name field for display
  const displayField = useMemo(() => findDisplayField(collectionFields), [collectionFields]);

  // Parse selected IDs from JSON value
  const selectedIds = useMemo(() => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [value]);

  // Get display name for an item
  const getDisplayName = useCallback(
    (item: CollectionItemWithValues) => getItemDisplayName(item, displayField),
    [displayField]
  );

  // Fetch items when dropdown opens
  useEffect(() => {
    if (open && collectionId) {
      const fetchItems = async () => {
        setLoading(true);
        try {
          const response = await collectionsApi.getItems(collectionId, { limit: 100 });
          if (!response.error) {
            setItems(response.data?.items || []);
          }
        } catch (err) {
          console.error('Failed to load items:', err);
        } finally {
          setLoading(false);
        }
      };
      fetchItems();
    }
  }, [open, collectionId]);

  // Toggle item selection
  const handleToggle = (itemId: string) => {
    const newSelectedIds = selectedIds.includes(itemId)
      ? selectedIds.filter(id => id !== itemId)
      : [...selectedIds, itemId];
    onChange(JSON.stringify(newSelectedIds));
  };

  // Get display text for closed state
  const getDisplayText = () => {
    if (selectedIds.length === 0) return 'Select items...';

    // Find display names for selected items
    const selectedNames = selectedIds
      .map(id => {
        const item = items.find(i => i.id === id);
        return item ? getDisplayName(item) : null;
      })
      .filter(Boolean);

    if (selectedNames.length > 0) {
      return selectedNames.length <= 2
        ? selectedNames.join(', ')
        : `${selectedNames.length} items selected`;
    }

    return `${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''} selected`;
  };

  if (!collectionId) {
    return <div className="text-xs text-muted-foreground">No collection linked</div>;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="input"
          size="sm"
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-xs">{getDisplayText()}</span>
          <Icon name="chevronDown" className="size-2.5 opacity-50 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-50 max-h-60 overflow-y-auto" align="start">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-4 text-xs text-muted-foreground">
            No items in this collection
          </div>
        ) : (
          items.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <DropdownMenuCheckboxItem
                key={item.id}
                checked={isSelected}
                onCheckedChange={() => handleToggle(item.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {getDisplayName(item)}
              </DropdownMenuCheckboxItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function CollectionFiltersSettings({
  layer,
  onLayerUpdate,
  collectionId,
}: CollectionFiltersSettingsProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Get fields from the collections store
  const { fields: allFields, loadFields } = useCollectionsStore();
  const fields = allFields[collectionId] || [];

  // Element picker and layer access for filter input linking
  const startElementPicker = useEditorStore((state) => state.startElementPicker);
  const stopElementPicker = useEditorStore((state) => state.stopElementPicker);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const draftsByPageId = usePagesStore((state) => state.draftsByPageId);
  const allLayers = useMemo(() => {
    if (!currentPageId) return [];
    const draft = draftsByPageId[currentPageId];
    return draft ? draft.layers : [];
  }, [currentPageId, draftsByPageId]);

  // Load fields if not already loaded
  useEffect(() => {
    if (collectionId && fields.length === 0) {
      loadFields(collectionId);
    }
  }, [collectionId, fields.length, loadFields]);

  // Get current collection variable
  const collectionVariable = layer ? getCollectionVariable(layer) : null;

  // Initialize groups from layer data (filters are stored in collection.filters)
  const groups: VisibilityConditionGroup[] = useMemo(() => {
    return collectionVariable?.filters?.groups || [];
  }, [collectionVariable?.filters]);

  // Helper to update layer with new filter groups (immediate - for dropdown selections)
  const updateGroups = useCallback((newGroups: VisibilityConditionGroup[]) => {
    if (!layer || !collectionVariable) return;

    const filters: ConditionalVisibility = {
      groups: newGroups,
    };

    onLayerUpdate(layer.id, {
      variables: {
        ...layer.variables,
        collection: {
          ...collectionVariable,
          filters: newGroups.length > 0 ? filters : undefined,
        },
      },
    });
  }, [layer, collectionVariable, onLayerUpdate]);

  // Store the latest updateGroups in a ref to avoid stale closures in debounced function
  const updateGroupsRef = useRef(updateGroups);
  updateGroupsRef.current = updateGroups;

  // Track the current layer ID to detect layer changes
  const currentLayerIdRef = useRef(layer?.id);

  // Create a stable debounced function for text inputs
  const debouncedUpdateGroupsRef = useRef(
    debounce((newGroups: VisibilityConditionGroup[]) => {
      updateGroupsRef.current(newGroups);
    }, 150)
  );

  // Cancel pending debounced calls when layer changes to prevent stale updates
  useEffect(() => {
    if (currentLayerIdRef.current !== layer?.id) {
      debouncedUpdateGroupsRef.current.cancel();
      currentLayerIdRef.current = layer?.id;
    }
  }, [layer?.id]);

  // Cleanup on unmount
  useEffect(() => {
    const debouncedFn = debouncedUpdateGroupsRef.current;
    return () => {
      debouncedFn.cancel();
    };
  }, []);

  // Debounced update for text/number inputs
  const debouncedUpdateGroups = useCallback((newGroups: VisibilityConditionGroup[]) => {
    debouncedUpdateGroupsRef.current(newGroups);
  }, []);

  if (!layer || !collectionVariable) {
    return null;
  }

  // Handle adding a new condition group for a collection field
  const handleAddFieldConditionGroup = (field: CollectionField) => {
    const newCondition: VisibilityCondition = {
      id: `${Date.now()}-1`,
      source: 'collection_field',
      fieldId: field.id,
      fieldType: field.type,
      referenceCollectionId: field.reference_collection_id || undefined,
      operator: getOperatorsForFieldType(field.type)[0].value,
      value: (field.type === 'reference' || field.type === 'multi_reference') ? '[]' : field.type === 'boolean' ? 'true' : '',
    };

    const newGroup: VisibilityConditionGroup = {
      id: Date.now().toString(),
      conditions: [newCondition],
    };

    updateGroups([...groups, newGroup]);
  };

  // Handle adding a condition to an existing group (OR logic)
  const handleAddConditionFromOr = (groupId: string, field: CollectionField) => {
    const newGroups = groups.map(group => {
      if (group.id === groupId) {
        const newCondition: VisibilityCondition = {
          id: `${groupId}-${Date.now()}`,
          source: 'collection_field',
          fieldId: field.id,
          fieldType: field.type,
          referenceCollectionId: field.reference_collection_id || undefined,
          operator: getOperatorsForFieldType(field.type)[0].value,
          value: (field.type === 'reference' || field.type === 'multi_reference') ? '[]' : field.type === 'boolean' ? 'true' : '',
        };
        return {
          ...group,
          conditions: [...group.conditions, newCondition],
        };
      }
      return group;
    });
    updateGroups(newGroups);
  };

  // Handle removing a condition
  const handleRemoveCondition = (groupId: string, conditionId: string) => {
    const newGroups = groups.map(group => {
      if (group.id === groupId) {
        const newConditions = group.conditions.filter(c => c.id !== conditionId);
        if (newConditions.length === 0) {
          return null;
        }
        return {
          ...group,
          conditions: newConditions,
        };
      }
      return group;
    }).filter((group): group is VisibilityConditionGroup => group !== null);
    updateGroups(newGroups);
  };

  const patchCondition = (
    groupId: string,
    conditionId: string,
    patch: Partial<VisibilityCondition>,
    debounced = false,
  ) => {
    const newGroups = groups.map(group => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        conditions: group.conditions.map(c =>
          c.id === conditionId ? { ...c, ...patch } : c
        ),
      };
    });
    if (debounced) {
      debouncedUpdateGroups(newGroups);
    } else {
      updateGroups(newGroups);
    }
  };

  const handleOperatorChange = (groupId: string, conditionId: string, operator: VisibilityOperator) => {
    const needsSecondValue = operatorRequiresSecondValue(operator);
    patchCondition(groupId, conditionId, {
      operator,
      value: operatorRequiresValue(operator) ? groups.find(g => g.id === groupId)?.conditions.find(c => c.id === conditionId)?.value : undefined,
      value2: needsSecondValue ? groups.find(g => g.id === groupId)?.conditions.find(c => c.id === conditionId)?.value2 : undefined,
      inputLayerId2: needsSecondValue ? groups.find(g => g.id === groupId)?.conditions.find(c => c.id === conditionId)?.inputLayerId2 : undefined,
    });
  };

  const handleValueChange = (groupId: string, conditionId: string, value: string) => {
    patchCondition(groupId, conditionId, { value }, true);
  };

  const handleValue2Change = (groupId: string, conditionId: string, value2: string) => {
    patchCondition(groupId, conditionId, { value2 }, true);
  };

  const handleCompareOperatorChange = (groupId: string, conditionId: string, compareOperator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte') => {
    patchCondition(groupId, conditionId, { compareOperator });
  };

  const handleCompareValueChange = (groupId: string, conditionId: string, compareValue: number) => {
    patchCondition(groupId, conditionId, { compareValue }, true);
  };

  // Get field name by ID
  const getFieldName = (fieldId: string): string => {
    const field = fields?.find(f => f.id === fieldId);
    return field?.name || 'Unknown field';
  };

  // Get field type by ID
  const getFieldType = (fieldId: string): CollectionFieldType | undefined => {
    const field = fields?.find(f => f.id === fieldId);
    return field?.type;
  };

  const handlePickInputForCondition = (groupId: string, conditionId: string, origin?: { x: number; y: number }) => {
    startElementPicker(
      (layerId: string) => {
        const resolvedId = resolveFilterInputId(layerId, allLayers);
        patchCondition(groupId, conditionId, { inputLayerId: resolvedId, value: undefined });
        stopElementPicker();
      },
      (layerId: string) => isInputInsideFilter(layerId, allLayers),
      origin
    );
  };

  const handlePickSecondInputForCondition = (groupId: string, conditionId: string, origin?: { x: number; y: number }) => {
    startElementPicker(
      (layerId: string) => {
        const resolvedId = resolveFilterInputId(layerId, allLayers);
        patchCondition(groupId, conditionId, { inputLayerId2: resolvedId, value2: undefined });
        stopElementPicker();
      },
      (layerId: string) => isInputInsideFilter(layerId, allLayers),
      origin
    );
  };

  const handleUnlinkInput = (groupId: string, conditionId: string) => {
    patchCondition(groupId, conditionId, { inputLayerId: undefined });
  };

  const handleUnlinkSecondInput = (groupId: string, conditionId: string) => {
    patchCondition(groupId, conditionId, { inputLayerId2: undefined });
  };

  // Get linked input display name
  const getLinkedInputName = (inputLayerId: string): string => {
    const inputLayer = findLayerById(allLayers, inputLayerId);
    if (!inputLayer) return `Unknown input [${inputLayerId}]`;
    const layerName = inputLayer.customName || inputLayer.name || 'Input';
    return `${layerName} [${inputLayerId}]`;
  };

  // Render the dropdown content for adding conditions
  const renderAddConditionDropdown = (
    onFieldSelect: (field: CollectionField) => void
  ) => (
    <DropdownMenuContent align="end" className="max-h-75! overflow-y-auto">
      {/* Collection Fields Section */}
      {fields && fields.length > 0 && (
        <>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Collection Fields
          </DropdownMenuLabel>
          {fields.map((field) => (
            <DropdownMenuItem
              key={field.id}
              onClick={() => onFieldSelect(field)}
              className="flex items-center gap-2"
            >
              <Icon name={getFieldIcon(field.type)} className="size-3 opacity-60" />
              {field.name}
            </DropdownMenuItem>
          ))}
        </>
      )}

      {/* Empty State */}
      {(!fields || fields.length === 0) && (
        <div className="px-2 py-4 text-xs text-muted-foreground text-center">
          No fields available
        </div>
      )}
    </DropdownMenuContent>
  );

  // Get reference collection ID from condition or look it up from field
  const getReferenceCollectionId = (condition: VisibilityCondition): string | undefined => {
    if (condition.referenceCollectionId) {
      return condition.referenceCollectionId;
    }
    // Fallback: look up from field
    if (condition.fieldId) {
      const field = fields?.find(f => f.id === condition.fieldId);
      return field?.reference_collection_id || undefined;
    }
    return undefined;
  };

  // Render a single condition
  const renderCondition = (condition: VisibilityCondition, group: VisibilityConditionGroup, index: number) => {
    const fieldType = condition.fieldType || getFieldType(condition.fieldId || '');
    const operators = getOperatorsForFieldType(fieldType);
    const icon = getFieldIcon(fieldType);
    const displayName = getFieldName(condition.fieldId || '');
    const referenceCollectionId = getReferenceCollectionId(condition);

    return (
      <React.Fragment key={condition.id}>
        {index > 0 && (
          <li className="flex items-center gap-2 h-6">
            <Label variant="muted" className="text-[10px]">Or</Label>
            <hr className="flex-1" />
          </li>
        )}

        <li className="*:w-full flex flex-col gap-2">
          <header className="flex items-center gap-1.5">
            <div className="size-5 flex items-center justify-center rounded-[6px] bg-secondary/50 hover:bg-secondary">
              <Icon name={icon} className="size-2.5 opacity-60" />
            </div>
            <Label variant="muted" className="truncate">{displayName}</Label>

            <span
              role="button"
              tabIndex={0}
              className="ml-auto -my-1 -mr-0.5 shrink-0 p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
              onClick={() => handleRemoveCondition(group.id, condition.id)}
            >
              <Icon name="x" className="size-2.5" />
            </span>
          </header>

          {/* Operator Select */}
          <Select
            value={condition.operator}
            onValueChange={(value) => handleOperatorChange(group.id, condition.id, value as VisibilityOperator)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {operators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {/* Value Input(s) based on operator */}
          {condition.operator === 'item_count' && (
            <div className="flex gap-2">
              <Select
                value={condition.compareOperator || 'eq'}
                onValueChange={(value) => handleCompareOperatorChange(group.id, condition.id, value as any)}
              >
                <SelectTrigger className="w-1/2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {COMPARE_OPERATORS.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="0"
                value={condition.compareValue ?? ''}
                onChange={(e) => handleCompareValueChange(group.id, condition.id, parseInt(e.target.value) || 0)}
                className="w-1/2"
              />
            </div>
          )}

          {/* Reference/Multi-reference items selector (with element picker support) */}
          {operatorRequiresItemSelection(condition.operator) && referenceCollectionId && (
            <>
              {condition.inputLayerId ? (
                <div className="flex items-center gap-1">
                  <Input value={getLinkedInputName(condition.inputLayerId)} disabled />
                  <div className="shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="secondary" onClick={() => handleUnlinkInput(group.id, condition.id)}>
                          <Icon name="x" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Unlink filter input</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <ReferenceItemsSelector
                      collectionId={referenceCollectionId}
                      value={condition.value || '[]'}
                      onChange={(value) => handleValueChange(group.id, condition.id, value)}
                    />
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        onClick={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          handlePickInputForCondition(group.id, condition.id, {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                          });
                        }}
                      >
                        <Icon name="crosshair" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Link to filter input</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </>
          )}

          {operatorRequiresValue(condition.operator) && condition.operator !== 'item_count' && !operatorRequiresItemSelection(condition.operator) && (
            <>
              {condition.inputLayerId ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={getLinkedInputName(condition.inputLayerId)}
                    disabled
                  />
                  <div className="shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="secondary" onClick={() => handleUnlinkInput(group.id, condition.id)}>
                          <Icon name="x" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Unlink filter input</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    {fieldType === 'boolean' ? (
                      <Select
                        value={condition.value || 'true'}
                        onValueChange={(value) => handleValueChange(group.id, condition.id, value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="true">True</SelectItem>
                            <SelectItem value="false">False</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : isDateFieldType(fieldType) ? (
                      <div className="flex flex-col gap-1.5">
                        <Select
                          value={isDatePreset(condition.value) ? condition.value : (condition.value ? '_custom' : '')}
                          onValueChange={(v) => {
                            if (v === '_custom') {
                              handleValueChange(group.id, condition.id, '');
                            } else {
                              handleValueChange(group.id, condition.id, v);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {DATE_PRESET_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                              <SelectItem value="_custom">Custom date...</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {!isDatePreset(condition.value) && (
                          <Input
                            type="date"
                            value={condition.value || ''}
                            onChange={(e) => handleValueChange(group.id, condition.id, e.target.value)}
                          />
                        )}
                      </div>
                    ) : fieldType === 'number' ? (
                      <Input
                        type="number"
                        placeholder="Enter value..."
                        value={condition.value || ''}
                        onChange={(e) => handleValueChange(group.id, condition.id, e.target.value)}
                      />
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <Select
                          value={condition.value === 'current_user' ? 'current_user' : (condition.value ? '_custom' : '')}
                          onValueChange={(v) => {
                            if (v === 'current_user') {
                              handleValueChange(group.id, condition.id, 'current_user');
                            } else if (v === '_custom') {
                              handleValueChange(group.id, condition.id, '');
                            } else {
                              handleValueChange(group.id, condition.id, '');
                            }
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select source..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="_custom">Static value...</SelectItem>
                              <SelectItem value="current_user">
                                <div className="flex items-center gap-2">
                                  <Icon name="user" className="size-3 text-primary" />
                                  <span>Current logged-in user</span>
                                </div>
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {condition.value !== 'current_user' && (
                          <Input
                            placeholder="Enter value..."
                            value={condition.value || ''}
                            onChange={(e) => handleValueChange(group.id, condition.id, e.target.value)}
                          />
                        )}
                        {condition.value === 'current_user' && (
                          <p className="text-[10px] text-primary font-medium px-1">
                            Matches the ID of the visitor currently logged in.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        onClick={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          handlePickInputForCondition(group.id, condition.id, {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                          });
                        }}
                      >
                        <Icon name="crosshair" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Link to filter input</TooltipContent>
                  </Tooltip>
                </div>
              )}

              {/* Second value for date between */}
              {operatorRequiresSecondValue(condition.operator) && (
                <>
                  <Label variant="muted" className="text-[10px] text-center">and</Label>
                  {condition.inputLayerId2 ? (
                    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
                      <Icon name="filter" className="size-3 text-muted-foreground shrink-0" />
                      <span className="truncate text-foreground">{getLinkedInputName(condition.inputLayerId2)}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handleUnlinkSecondInput(group.id, condition.id)}
                          >
                            <Icon name="unlink" className="size-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Unlink second filter input</TooltipContent>
                      </Tooltip>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="flex-1">
                        <Input
                          type="date"
                          value={condition.value2 || ''}
                          onChange={(e) => handleValue2Change(group.id, condition.id, e.target.value)}
                        />
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              handlePickSecondInputForCondition(group.id, condition.id, {
                                x: rect.left + rect.width / 2,
                                y: rect.top + rect.height / 2,
                              });
                            }}
                          >
                            <Icon name="crosshair" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Link second filter input</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </li>
      </React.Fragment>
    );
  };

  return (
    <SettingsPanel
      title="Filters"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          {renderAddConditionDropdown(handleAddFieldConditionGroup)}
        </DropdownMenu>
      }
    >
      <div className="flex flex-col gap-3">
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No filters set. Click + to add a filter.
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {groupIndex > 0 && (
                <div className="flex items-center gap-2 py-1">
                  <hr className="flex-1" />
                  <Label variant="muted" className="text-[10px]">And</Label>
                  <hr className="flex-1" />
                </div>
              )}
              <div className="flex flex-col bg-muted rounded-lg">
                <ul className="p-2 flex flex-col gap-2">
                  {group.conditions.map((condition, index) =>
                    renderCondition(condition, group, index)
                  )}

                  <li className="flex items-center gap-2 h-6">
                    <Label variant="muted" className="text-[10px]">Or</Label>
                    <hr className="flex-1" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost" size="xs"
                          className="size-5"
                        >
                          <div>
                            <Icon name="plus" className="size-2.5!" />
                          </div>
                        </Button>
                      </DropdownMenuTrigger>
                      {renderAddConditionDropdown(
                        (field) => handleAddConditionFromOr(group.id, field)
                      )}
                    </DropdownMenu>
                  </li>
                </ul>
              </div>
            </React.Fragment>
          ))
        )}
      </div>
    </SettingsPanel>
  );
}
