'use client';

/**
 * CssVariableGroupDialog
 *
 * Shared create/rename dialog for CSS variable groups. The parent picks a
 * mode and supplies the initial name + an async submit handler.
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
import { Spinner } from '@/components/ui/spinner';

interface CssVariableGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rename';
  initialName?: string;
  onSubmit: (name: string) => void | Promise<void>;
}

export default function CssVariableGroupDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  onSubmit,
}: CssVariableGroupDialogProps) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSubmitting(false);
    }
  }, [open, initialName]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'create' ? 'Create group' : 'Rename group';
  const confirmLabel = mode === 'create' ? 'Create' : 'Save';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div>
          <Label className="text-xs text-muted-foreground mb-1">Name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Default group"
            className="h-8"
          />
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
          >
            {submitting && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
