'use client';

/**
 * CssVariableSetSettingsDialog
 *
 * Dialog that edits a variable set's metadata (name, activation kind).
 * Deletion is handled separately from the sidebar dropdown, so this dialog
 * intentionally has no delete action.
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import type { CssVariableSet, CssVariableSetActivationKind } from '@/types';

interface CssVariableSetSettingsDialogProps {
  set: CssVariableSet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACTIVATION_LABELS: Record<CssVariableSetActivationKind, string> = {
  default: 'Default (single mode)',
  theme: 'Theme (data-theme attribute)',
  breakpoint: 'Breakpoint (@media min-width)',
};

const ACTIVATION_DESCRIPTIONS: Record<CssVariableSetActivationKind, string> = {
  default: 'A single set of values always active.',
  theme: 'Each mode maps to a data-theme value on <html>.',
  breakpoint: 'Each mode applies above a configurable min-width.',
};

export default function CssVariableSetSettingsDialog({
  set,
  open,
  onOpenChange,
}: CssVariableSetSettingsDialogProps) {
  const updateSet = useCssVariablesStore((s) => s.updateSet);

  const [name, setName] = useState(set.name);

  useEffect(() => setName(set.name), [set.name]);

  const commitName = () => {
    if (name.trim() && name !== set.name) {
      void updateSet(set.id, { name: name.trim() });
    } else if (!name.trim()) {
      setName(set.name);
    }
  };

  const handleActivationKindChange = (kind: CssVariableSetActivationKind) => {
    void updateSet(set.id, { activation_kind: kind });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Set settings</DialogTitle>
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

          <div>
            <Label className="text-xs text-muted-foreground mb-1">Activation</Label>
            <Select
              value={set.activation_kind}
              onValueChange={(v) =>
                handleActivationKindChange(v as CssVariableSetActivationKind)
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACTIVATION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {ACTIVATION_DESCRIPTIONS[set.activation_kind]}
            </p>
          </div>
        </div>

        <DialogFooter>
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
  );
}
