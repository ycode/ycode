'use client';

/**
 * CssVariableRow
 *
 * Renders a single CSS variable with its name and one value cell per mode.
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import type { CssVariable, CssVariableSetMode, CssVariableType } from '@/types';
import { getCssVariableTableGridColumns } from './css-variable-table-layout';
import CssVariableValueCell from './CssVariableValueCell';
import { CssVariableDragHandle } from './CssVariableSortableList';

interface CssVariableRowProps {
  variable: CssVariable;
  modes: CssVariableSetMode[];
}

const TYPE_LABELS: Record<CssVariableType, string> = {
  color: 'Color',
  size: 'Size',
  percentage: 'Percentage',
  number: 'Number',
  font_family: 'Font',
};

const TYPE_ICONS: Record<CssVariableType, React.ComponentProps<typeof Icon>['name']> = {
  color: 'droplet',
  size: 'cube',
  percentage: 'percent',
  number: 'hash',
  font_family: 'type',
};

export default function CssVariableRow({ variable, modes }: CssVariableRowProps) {
  const groups = useCssVariablesStore(s => s.graph.groups).filter(g => g.set_id === variable.set_id);
  const updateItem = useCssVariablesStore((s) => s.updateItem);
  const deleteItem = useCssVariablesStore((s) => s.deleteItem);
  const setValue = useCssVariablesStore((s) => s.setValue);
  const getValue = useCssVariablesStore((s) => s.getValue);

  const [name, setName] = useState(variable.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useEffect(() => setName(variable.name), [variable.name]);

  const commitName = () => {
    if (name.trim() && name !== variable.name) {
      void updateItem(variable.id, { name: name.trim() });
    } else if (!name.trim()) {
      setName(variable.name);
    }
  };

  const handleValueChange = (modeId: string, next: string) => {
    void setValue({ css_variable_id: variable.id, mode_id: modeId, value: next });
  };

  const defaultMode = modes.find((m) => m.is_default) ?? modes[0];
  const defaultModeValue = defaultMode
    ? getValue(variable.id, defaultMode.id)
    : '';

  return (
    <div
      className="grid items-center gap-2 px-3 h-13 hover:bg-muted/30 border-b w-max min-w-full"
      style={{ gridTemplateColumns: getCssVariableTableGridColumns(modes.length) }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <CssVariableDragHandle label={`variable ${variable.name}`} />
        <Icon
          name={TYPE_ICONS[variable.type]}
          className="size-3.5 text-muted-foreground shrink-0"
          aria-label={TYPE_LABELS[variable.type]}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setName(variable.name);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label={`${TYPE_LABELS[variable.type]} variable name`}
        />
      </div>
      {modes.map((mode) => {
        const ownValue = getValue(variable.id, mode.id);
        const isUsingDefault = !mode.is_default && ownValue === '';
        const displayValue = isUsingDefault ? defaultModeValue : ownValue;

        return (
          <div key={mode.id} className="min-w-0">
            <CssVariableValueCell
              type={variable.type}
              value={displayValue}
              isUsingDefault={isUsingDefault}
              excludeVariableId={variable.id}
              onChange={(next) => handleValueChange(mode.id, next)}
            />
          </div>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs" variant="ghost"
            aria-label={`Actions for ${variable.name}`}
          ><Icon name="more" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Move to group</DropdownMenuLabel>
          {groups.map(group => <DropdownMenuItem
            key={group.id} disabled={group.id === variable.group_id}
            onClick={() => { void updateItem(variable.id, { group_id: group.id }); }}
                               >{group.name}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDeleteOpen(true)}>Delete variable</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete variable"
        description={`Delete the variable "${variable.name}"? Any references in layers will break.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          await deleteItem(variable.id);
        }}
      />
    </div>
  );
}
