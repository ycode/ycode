'use client';

/**
 * CssVariableSetEditor
 *
 * Right-pane editor for a single set: shows the mode columns, groups and
 * variable rows. Set-level metadata (name, activation kind, delete) is
 * edited from `CssVariableSetSettingsDialog` triggered in the sidebar.
 */

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import type {
  CssVariable,
  CssVariableGroup,
  CssVariableSet,
  CssVariableSetMode,
  CssVariableType,
} from '@/types';
import { getCssVariableTableGridColumns } from './css-variable-table-layout';
import CssVariableGroupDialog from './CssVariableGroupDialog';
import CssVariableModeEditor from './CssVariableModeEditor';
import CssVariableRow from './CssVariableRow';
import CssVariableSortableList, { CssVariableDragHandle } from './CssVariableSortableList';

interface CssVariableSetEditorProps {
  set: CssVariableSet;
}

const TYPE_LABELS: Record<CssVariableType, string> = {
  color: 'Color',
  size: 'Size',
  percentage: 'Percentage',
  number: 'Number',
  font_family: 'Font family',
};

type GroupDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; group: CssVariableGroup }
  | null;

export default function CssVariableSetEditor({ set }: CssVariableSetEditorProps) {
  const graph = useCssVariablesStore((s) => s.graph);
  const createMode = useCssVariablesStore((s) => s.createMode);
  const createItem = useCssVariablesStore((s) => s.createItem);
  const createGroup = useCssVariablesStore((s) => s.createGroup);
  const updateGroup = useCssVariablesStore((s) => s.updateGroup);
  const deleteGroup = useCssVariablesStore((s) => s.deleteGroup);
  const reorderGroups = useCssVariablesStore((s) => s.reorderGroups);
  const reorderItems = useCssVariablesStore((s) => s.reorderItems);

  const [editingModeId, setEditingModeId] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
  const [deletingGroup, setDeletingGroup] = useState<CssVariableGroup | null>(null);

  const modes = useMemo(
    () =>
      graph.modes
        .filter((m) => m.set_id === set.id)
        .slice()
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order),
    [graph.modes, set.id]
  );

  const groups = useMemo(
    () =>
      graph.groups
        .filter((g) => g.set_id === set.id)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
    [graph.groups, set.id]
  );

  const variablesByGroup = useMemo(() => {
    const map = new Map<string, CssVariable[]>();
    for (const variable of graph.variables) {
      if (variable.set_id !== set.id || !variable.group_id) continue;
      const list = map.get(variable.group_id) ?? [];
      list.push(variable);
      map.set(variable.group_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order);
    }
    return map;
  }, [graph.variables, set.id]);

  const handleAddMode = async () => {
    const created = await createMode({ set_id: set.id, name: 'New mode' });
    if (created) setEditingModeId(created.id);
  };

  const handleAddVariable = async (type: CssVariableType, groupId: string) => {
    await createItem({
      set_id: set.id,
      type,
      name: `New ${TYPE_LABELS[type].toLowerCase()}`,
      group_id: groupId,
    });
  };

  const handleGroupDialogSubmit = async (name: string) => {
    if (!groupDialog) return;
    if (groupDialog.mode === 'create') {
      await createGroup({ set_id: set.id, name });
    } else {
      await updateGroup(groupDialog.group.id, { name });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto">
        <VariableTableHeader
          modes={modes}
          canAddMode={set.activation_kind !== 'default'}
          onEditMode={setEditingModeId}
          onAddMode={handleAddMode}
        />

        <CssVariableSortableList items={groups} onReorder={reorderGroups}>
          {(group) => (
            <GroupSection
              key={group.id}
              group={group}
              variables={variablesByGroup.get(group.id) ?? []}
              modes={modes}
              canDelete={groups.length > 1}
              onAdd={(type) => handleAddVariable(type, group.id)}
              onRename={() => setGroupDialog({ mode: 'rename', group })}
              onDelete={() => setDeletingGroup(group)}
              onAddGroup={() => setGroupDialog({ mode: 'create' })}
              onReorder={reorderItems}
            />
          )}
        </CssVariableSortableList>
      </div>

      {editingModeId &&
        (() => {
          const mode = modes.find((m) => m.id === editingModeId);
          if (!mode) return null;
          return (
            <CssVariableModeEditor
              set={set}
              mode={mode}
              open={true}
              onOpenChange={(o) => {
                if (!o) setEditingModeId(null);
              }}
            />
          );
        })()}

      {groupDialog && (
        <CssVariableGroupDialog
          open
          onOpenChange={(o) => {
            if (!o) setGroupDialog(null);
          }}
          mode={groupDialog.mode}
          initialName={groupDialog.mode === 'rename' ? groupDialog.group.name : ''}
          onSubmit={handleGroupDialogSubmit}
        />
      )}

      {deletingGroup && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeletingGroup(null);
          }}
          title="Delete group"
          description={`Delete the group "${deletingGroup.name}" and move its variables to another group?`}
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={async () => {
            await deleteGroup(deletingGroup.id);
          }}
        />
      )}
    </div>
  );
}

function VariableTableHeader({
  modes,
  canAddMode,
  onEditMode,
  onAddMode,
}: {
  modes: CssVariableSetMode[];
  canAddMode: boolean;
  onEditMode: (id: string) => void;
  onAddMode: () => void;
}) {
  return (
    <div
      className="grid items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/40 w-max min-w-full"
      style={{ gridTemplateColumns: getCssVariableTableGridColumns(modes.length) }}
    >
      <div className="min-w-0 truncate">Variable</div>
      {modes.map((mode) => (
        <div key={mode.id} className="flex items-center gap-1 min-w-0">
          <span className="truncate">{mode.name}</span>
          {mode.is_default && (
            <span className="text-[9px] opacity-70 shrink-0">(Default)</span>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            title="Edit mode"
            onClick={() => onEditMode(mode.id)}
          >
            <Icon name="settings" />
          </Button>
        </div>
      ))}
      <div className="flex justify-end">
        {canAddMode && (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Add mode"
            onClick={onAddMode}
          >
            <Icon name="plus" />
          </Button>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  group,
  variables,
  modes,
  canDelete,
  onAdd,
  onRename,
  onDelete,
  onAddGroup,
  onReorder,
}: {
  group: CssVariableGroup;
  variables: CssVariable[];
  modes: CssVariableSetMode[];
  canDelete: boolean;
  onAdd: (type: CssVariableType) => void;
  onRename: () => void;
  onDelete: () => void;
  onAddGroup: () => void;
  onReorder: (orderedIds: string[]) => Promise<void>;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-muted/20 border-b">
        <CssVariableDragHandle label={`group ${group.name}`} />
        <span className="truncate">{group.name}</span>
        <div className="flex-1" />
        <Button
          size="xs" variant="ghost"
          onClick={onAddGroup}
        >
          <Icon name="plus" />
          Group
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs" variant="ghost"
              title="Group options"
            >
              <Icon name="more" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <Icon name="pencil" />
              Rename
            </DropdownMenuItem>
            {canDelete && (
              <DropdownMenuItem onSelect={onDelete}>
                <Icon name="trash" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {variables.length === 0 ? (
        <div className="px-3 h-13 flex items-center text-xs text-muted-foreground border-b">No variables in this group yet.</div>
      ) : (
        <CssVariableSortableList items={variables} onReorder={onReorder}>
          {(variable) => (
            <CssVariableRow
              key={variable.id} variable={variable}
              modes={modes}
            />
          )}
        </CssVariableSortableList>
      )}
      <div className="px-3 py-2 border-b">
        <AddVariableMenu onAdd={onAdd} />
      </div>
    </div>
  );
}

function AddVariableMenu({ onAdd }: { onAdd: (type: CssVariableType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost">
          <Icon name="plus" />
          Variable
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(TYPE_LABELS) as CssVariableType[]).map((type) => (
          <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
            {TYPE_LABELS[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
