'use client';

/**
 * Rename Component Dialog
 *
 * Single-input name dialog for renaming a component. Title, placeholder and
 * confirm label are configurable so it also serves component folders.
 */

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface RenameComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (componentName: string) => void;
  currentName?: string;
  title?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export default function RenameComponentDialog({
  open,
  onOpenChange,
  onConfirm,
  currentName,
  title = 'Rename component',
  placeholder = 'Name',
  confirmLabel = 'Rename',
}: RenameComponentDialogProps) {
  const [componentName, setComponentName] = useState(currentName || '');

  // Sync the input with the component being renamed each time the dialog opens
  useEffect(() => {
    if (open) setComponentName(currentName || '');
  }, [open, currentName]);

  const handleConfirm = () => {
    if (!componentName.trim()) return;

    // Persist optimistically and close immediately — the store updates the
    // name in place and rolls back if the request fails.
    onConfirm(componentName.trim());
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && componentName.trim()) {
      handleConfirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="320px"
        className="gap-0"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4.5">
          <div className="flex flex-col gap-2">
            <Input
              id="component-name"
              placeholder={placeholder}
              value={componentName}
              onChange={(e) => setComponentName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              autoFocus
            />
          </div>

          <DialogFooter className="grid grid-cols-2 mt-1">
            <Button
              variant="secondary"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!componentName.trim()}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
