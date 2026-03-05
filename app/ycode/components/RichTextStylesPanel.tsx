'use client';

import React, { forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { getTextStyleLabel } from '@/lib/text-format-utils';
import type { Layer } from '@/types';

interface RichTextStylesPanelProps {
  layer: Layer | null;
  activeStyleKey?: string | null;
  onStyleSelect: (key: string) => void;
}

const TEXT_STYLE_ROWS: { key: string; badge: string }[] = [
  { key: 'paragraph', badge: 'P' },
  { key: 'h1', badge: 'H1' },
  { key: 'h2', badge: 'H2' },
  { key: 'h3', badge: 'H3' },
  { key: 'h4', badge: 'H4' },
  { key: 'h5', badge: 'H5' },
  { key: 'h6', badge: 'H6' },
  { key: 'link', badge: 'A' },
  { key: 'code', badge: 'C' },
  { key: 'bulletList', badge: '•' },
  { key: 'orderedList', badge: '1.' },
];

const RichTextStylesPanel = forwardRef<HTMLDivElement, RichTextStylesPanelProps>(
  function RichTextStylesPanel({ layer, activeStyleKey, onStyleSelect }, ref) {
    if (!layer || layer.name !== 'richText') return null;

    const textStyles = layer.textStyles;

    return (
      <div className="pt-5" ref={ref}>
        <header className="w-full py-5 -mt-5 flex items-center justify-between">
          <Label>Text</Label>
        </header>

        <div className="flex flex-col gap-0.5 pb-5">
          {TEXT_STYLE_ROWS.map(({ key, badge }) => {
            const style = textStyles?.[key];
            const label = getTextStyleLabel(key, style);
            const isActive = activeStyleKey === key;

            return (
              <Button
                key={key}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start gap-2.5 px-2 h-8 font-normal"
                onClick={() => onStyleSelect(key)}
              >
                <span
                  className={cn(
                    'inline-flex items-center justify-center size-5 rounded text-[10px] font-semibold shrink-0',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {badge}
                </span>
                <span className="truncate text-xs">{label}</span>
                <Icon name="chevronRight" className="size-3 ml-auto opacity-40" />
              </Button>
            );
          })}
        </div>
      </div>
    );
  }
);

export default RichTextStylesPanel;
