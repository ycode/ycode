'use client';

/**
 * CssVariableModeEditor
 *
 * Dialog that edits a single mode's metadata (name, data-theme or min-width)
 * and exposes a Delete action for non-default modes. Triggered by clicking
 * the settings icon next to a mode column header.
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import type { CssVariableSet, CssVariableSetMode } from '@/types';

interface CssVariableModeEditorProps {
  set: CssVariableSet;
  mode: CssVariableSetMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CssVariableModeEditor({
  set,
  mode,
  open,
  onOpenChange,
}: CssVariableModeEditorProps) {
  const updateMode = useCssVariablesStore((s) => s.updateMode);
  const deleteMode = useCssVariablesStore((s) => s.deleteMode);

  const [name, setName] = useState(mode.name);
  const [dataTheme, setDataTheme] = useState(mode.data_theme ?? '');
  const [minWidth, setMinWidth] = useState(mode.min_width?.toString() ?? '');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => setName(mode.name), [mode.name]);
  useEffect(() => setDataTheme(mode.data_theme ?? ''), [mode.data_theme]);
  useEffect(() => setMinWidth(mode.min_width?.toString() ?? ''), [mode.min_width]);

  const commitName = () => {
    if (name.trim() && name !== mode.name) {
      void updateMode(mode.id, { name: name.trim() });
    } else if (!name.trim()) {
      setName(mode.name);
    }
  };

  const commitDataTheme = () => {
    const trimmed = dataTheme.trim();
    void updateMode(mode.id, { data_theme: trimmed === '' ? null : trimmed });
  };

  const commitMinWidth = () => {
    const trimmed = minWidth.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && !Number.isFinite(parsed)) {
      setMinWidth(mode.min_width?.toString() ?? '');
      return;
    }
    void updateMode(mode.id, { min_width: parsed });
  };

  const handleDelete = async () => {
    await deleteMode(mode.id);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit mode</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                className="h-8"
              />
            </div>

            {set.activation_kind === 'theme' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1">data-theme</Label>
                <Input
                  value={dataTheme}
                  onChange={(e) => setDataTheme(e.target.value)}
                  onBlur={commitDataTheme}
                  placeholder={mode.is_default ? 'Default (no attribute)' : 'dark'}
                  className="h-8"
                  disabled={mode.is_default}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  The mode applies when {`<html data-theme="..."/>`} matches this value.
                </p>
              </div>
            )}

            {set.activation_kind === 'breakpoint' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1">min-width (px)</Label>
                <Input
                  value={minWidth}
                  onChange={(e) => setMinWidth(e.target.value)}
                  onBlur={commitMinWidth}
                  placeholder={mode.is_default ? 'Default (no media query)' : '768'}
                  className="h-8"
                  disabled={mode.is_default}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Wrapped in {`@media (min-width: ...px)`}.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            {!mode.is_default ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                <Icon name="trash" />
                Delete mode
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete mode"
        description={`Delete the mode "${mode.name}"? Values for this mode will be lost.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
