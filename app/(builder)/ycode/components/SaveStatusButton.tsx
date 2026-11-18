'use client';

import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type SaveStatus = 'saving' | 'unsaved' | 'saved';

interface SaveStatusButtonProps {
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  /** Saves pending changes; omitted when saving is automatic (e.g. component editing) */
  onSave?: () => void;
}

/** Resolve the save status shown in the header from the editor save state. */
function getSaveStatus(isSaving: boolean, hasUnsavedChanges: boolean): SaveStatus {
  if (isSaving) return 'saving';
  if (hasUnsavedChanges) return 'unsaved';
  return 'saved';
}

/** Tooltip text describing the current save status. */
function getSaveStatusLabel(status: SaveStatus): string {
  if (status === 'saving') return 'Saving changes…';
  if (status === 'unsaved') return 'There are unsaved changes';
  return 'All changes are saved';
}

/** Icon-only save status indicator; clickable only when there are changes to save. */
export default function SaveStatusButton({
  isSaving,
  hasUnsavedChanges,
  onSave,
}: SaveStatusButtonProps) {
  const status = getSaveStatus(isSaving, hasUnsavedChanges);
  const canSave = status === 'unsaved' && !!onSave;
  const label = getSaveStatusLabel(status);

  return (
    <Tooltip>
      {/* Disabled buttons don't emit pointer events, so the wrapper triggers the tooltip */}
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={canSave ? undefined : 0}>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canSave}
            aria-label={label}
            onClick={onSave}
            className="[&>svg]:size-4! disabled:opacity-100 disabled:cursor-default"
          >
            {status === 'saving' && <Spinner aria-hidden />}
            {status === 'unsaved' && <Icon name="circle-dot" className="text-muted-foreground" />}
            {status === 'saved' && <Icon name="check-circle" />}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
