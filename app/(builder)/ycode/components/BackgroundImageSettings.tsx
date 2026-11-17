'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import DesignPropertyLabel from './DesignPropertyLabel';
import { DEFAULT_ASSETS } from '@/lib/asset-utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Background image source types */
export type BackgroundImageSourceType = 'none' | 'file_manager' | 'custom_url' | 'cms';

interface BackgroundImageSettingsProps {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  sourceType: BackgroundImageSourceType;
  hasCmsFields: boolean;
  onBackgroundImageChange: (value: string, immediate?: boolean) => void;
  /** Generic handler for size, position, repeat changes */
  onBackgroundPropChange: (property: string, value: string) => void;
  onSourceTypeChange: (type: BackgroundImageSourceType) => void;
  onOpenFileManager: () => void;
  /** Render the CMS field selector dropdown */
  renderFieldSelector: () => React.ReactNode;
}

/** Extracts a plain URL from a css url() value */
function extractImageUrl(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('url(')) {
    return raw.slice(4, -1).replace(/['"]/g, '');
  }
  return raw;
}

/** Background image source, preview, and size/position/repeat controls */
export default function BackgroundImageSettings({
  backgroundImage,
  backgroundSize,
  backgroundPosition,
  backgroundRepeat,
  sourceType,
  hasCmsFields,
  onBackgroundImageChange,
  onBackgroundPropChange,
  onSourceTypeChange,
  onOpenFileManager,
  renderFieldSelector,
}: BackgroundImageSettingsProps) {
  const bgImageUrl = useMemo(() => extractImageUrl(backgroundImage), [backgroundImage]);
  const displayUrl = bgImageUrl || (sourceType === 'file_manager' ? DEFAULT_ASSETS.IMAGE : '');

  // Local state for custom URL input — syncs from prop, debounces updates to parent
  const [localUrl, setLocalUrl] = useState(bgImageUrl);
  useEffect(() => { setLocalUrl(bgImageUrl); }, [bgImageUrl]);

  const handleUrlInput = useCallback((value: string) => {
    setLocalUrl(value);
    onBackgroundImageChange(value.trim());
  }, [onBackgroundImageChange]);

  const isActive = sourceType !== 'none';

  const handleAdd = useCallback(() => {
    onSourceTypeChange('file_manager');
  }, [onSourceTypeChange]);

  return (
    <div className="grid grid-cols-3 items-start">
      <DesignPropertyLabel
        properties={['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']}
        variant="muted" className="py-2"
      >
        Image
      </DesignPropertyLabel>
      <div className="col-span-2 *:w-full">
        <Popover>
          <PopoverTrigger asChild>
            {isActive ? (
              <Button
                variant="input"
                size="sm"
                className="justify-start"
              >
                <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 outline-offset-[-1px]">
                  <div className="absolute inset-0 opacity-5 bg-checkerboard z-10" />
                  {displayUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={displayUrl}
                      className="absolute inset-0 w-full h-full object-cover z-20"
                      alt=""
                    />
                  )}
                </div>
                <span className="truncate">
                  {sourceType === 'file_manager' && (bgImageUrl ? 'Image' : 'File manager')}
                  {sourceType === 'custom_url' && (localUrl || 'Custom URL')}
                  {sourceType === 'cms' && 'CMS field'}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="ml-auto -mr-0.5 p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSourceTypeChange('none');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onSourceTypeChange('none');
                    }
                  }}
                >
                  <Icon name="x" className="size-2.5" />
                </span>
              </Button>
            ) : (
              <Button
                variant="input"
                size="sm"
                className="justify-start"
                onClick={handleAdd}
              >
                <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 outline-offset-[-1px]">
                  <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
                </div>
                <span className="dark:opacity-50">Add...</span>
              </Button>
            )}
          </PopoverTrigger>

          {isActive && (
            <PopoverContent className="w-64 my-0.5 flex flex-col gap-2" align="end">
              <div className="grid grid-cols-3 items-center">
                <Label variant="muted">Source</Label>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={sourceType}
                    onValueChange={(value) => onSourceTypeChange(value as BackgroundImageSourceType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="file_manager"><Icon name="folder" className="size-3" /> File manager</SelectItem>
                      <SelectItem value="custom_url"><Icon name="link" className="size-3" /> Custom URL</SelectItem>
                      <SelectItem value="cms" disabled={!hasCmsFields}><Icon name="database" className="size-3" /> CMS field</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {sourceType === 'file_manager' && (
                <div className="grid grid-cols-3 items-start">
                  <Label variant="muted" className="pt-2">File</Label>
                  <div className="col-span-2">
                    <div
                      className="relative group bg-secondary/30 hover:bg-secondary/60 rounded-md w-full aspect-3/2 overflow-hidden cursor-pointer"
                      onClick={onOpenFileManager}
                    >
                      <div className="absolute inset-0 opacity-5 bg-checkerboard" />
                      {displayUrl && (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={displayUrl}
                            className="relative w-full h-full object-contain z-10"
                            alt="Background image preview"
                          />
                        </>
                      )}
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center px-2 py-1 opacity-0 group-hover:opacity-100 z-20">
                        <Button variant="overlay" size="sm">{bgImageUrl ? 'Change file' : 'Choose file'}</Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {sourceType === 'custom_url' && (
                <div className="grid grid-cols-3 items-start">
                  <Label variant="muted" className="pt-2">URL</Label>
                  <div className="col-span-2">
                    <Input
                      type="text"
                      value={localUrl}
                      onChange={(e) => handleUrlInput(e.target.value)}
                      placeholder="https://example.com/image.jpg"
                    />
                  </div>
                </div>
              )}

              {sourceType === 'cms' && (
                <div className="grid grid-cols-3 items-center">
                  <Label variant="muted">Field</Label>
                  <div className="col-span-2 w-full">
                    {renderFieldSelector()}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3">
                <DesignPropertyLabel properties={['backgroundSize']} variant="muted">Size</DesignPropertyLabel>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={backgroundSize || 'cover'}
                    onValueChange={(v) => onBackgroundPropChange('backgroundSize', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="cover">Cover</SelectItem>
                        <SelectItem value="contain">Contain</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3">
                <DesignPropertyLabel properties={['backgroundPosition']} variant="muted">Position</DesignPropertyLabel>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={backgroundPosition || 'center'}
                    onValueChange={(v) => onBackgroundPropChange('backgroundPosition', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="left-top">Top / Left</SelectItem>
                        <SelectItem value="top">Top / Center</SelectItem>
                        <SelectItem value="right-top">Top / Right</SelectItem>
                        <SelectItem value="left">Center / Left</SelectItem>
                        <SelectItem value="center">Center / Center</SelectItem>
                        <SelectItem value="right">Center / Right</SelectItem>
                        <SelectItem value="left-bottom">Bottom / Left</SelectItem>
                        <SelectItem value="bottom">Bottom / Center</SelectItem>
                        <SelectItem value="right-bottom">Bottom / Right</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3">
                <DesignPropertyLabel properties={['backgroundRepeat']} variant="muted">Repeat</DesignPropertyLabel>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={backgroundRepeat || 'no-repeat'}
                    onValueChange={(v) => onBackgroundPropChange('backgroundRepeat', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="no-repeat">No repeat</SelectItem>
                        <SelectItem value="repeat">Repeat</SelectItem>
                        <SelectItem value="repeat-x">Repeat X</SelectItem>
                        <SelectItem value="repeat-y">Repeat Y</SelectItem>
                        <SelectItem value="repeat-round">Repeat round</SelectItem>
                        <SelectItem value="repeat-space">Repeat space</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverContent>
          )}
        </Popover>
      </div>
    </div>
  );
}
