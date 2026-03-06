'use client';

/**
 * Slider Settings Component
 *
 * Settings panel for slider layers, shown when any slider-family layer is selected.
 * Walks up the tree to find the root slider layer and reads/writes settings there.
 */

import React, { useState, useMemo, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SettingsPanel from './SettingsPanel';
import ToggleGroup from './ToggleGroup';

import { findAncestorByName } from '@/lib/layer-utils';
import { isSliderLayerName, DEFAULT_SLIDER_SETTINGS, createSlideLayer } from '@/lib/templates/utilities';
import { EFFECTS_WITH_PER_VIEW } from '@/lib/slider-utils';
import { slidePrev, slideNext } from '@/hooks/use-canvas-slider';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';

import type { Layer, SliderSettings as SliderSettingsType, SwiperAnimationEffect, SliderLoopMode, SliderPaginationType } from '@/types';

interface SliderSettingsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  allLayers: Layer[];
}

const ANIMATION_EFFECTS: { label: string; value: SwiperAnimationEffect }[] = [
  { label: 'Slide', value: 'slide' },
  { label: 'Fade', value: 'fade' },
  { label: 'Cube', value: 'cube' },
  { label: 'Flip', value: 'flip' },
  { label: 'Coverflow', value: 'coverflow' },
  { label: 'Cards', value: 'cards' },
];

const EASING_OPTIONS: { label: string; value: string; icon: 'ease-linear' | 'ease-in' | 'ease-in-out' | 'ease-out' }[] = [
  { label: 'Linear', value: 'ease-linear', icon: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in', icon: 'ease-in' },
  { label: 'Ease in out', value: 'ease-in-out', icon: 'ease-in-out' },
  { label: 'Ease out', value: 'ease-out', icon: 'ease-out' },
];

export default function SliderSettings({ layer, onLayerUpdate, allLayers }: SliderSettingsProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Find the root slider layer: either the current layer or an ancestor
  const sliderLayer = useMemo((): Layer | null => {
    if (!layer) return null;
    if (layer.name === 'slider') return layer;
    if (isSliderLayerName(layer.name)) {
      return findAncestorByName(allLayers, layer.id, 'slider');
    }
    return null;
  }, [layer, allLayers]);

  const sliderLayerId = sliderLayer?.id ?? '';
  const handlePrev = useCallback(() => slidePrev(sliderLayerId), [sliderLayerId]);
  const handleNext = useCallback(() => slideNext(sliderLayerId), [sliderLayerId]);

  const currentPageId = useEditorStore((state) => state.currentPageId);
  const addLayerWithId = usePagesStore((state) => state.addLayerWithId);
  const setSelectedLayerId = useEditorStore((state) => state.setSelectedLayerId);

  const handleAddSlide = useCallback(() => {
    if (!currentPageId || !sliderLayer) return;
    const slidesLayer = sliderLayer.children?.find(c => c.name === 'slides');
    if (!slidesLayer) return;
    const slideNumber = (slidesLayer.children?.length ?? 0) + 1;
    const slide = createSlideLayer(`Slide ${slideNumber}`, '/ycode/layouts/assets/placeholder-2.webp');
    if (slide) {
      addLayerWithId(currentPageId, slidesLayer.id, slide);
      requestAnimationFrame(() => setSelectedLayerId(slide.id));
    }
  }, [currentPageId, sliderLayer, addLayerWithId, setSelectedLayerId]);

  // Guard: only render for slider-family layers
  if (!layer || !sliderLayer) return null;
  if (!isSliderLayerName(layer.name)) return null;

  const settings: SliderSettingsType = {
    ...DEFAULT_SLIDER_SETTINGS,
    ...sliderLayer.settings?.slider,
  };

  const updateSetting = (key: keyof SliderSettingsType, value: SliderSettingsType[keyof SliderSettingsType]) => {
    onLayerUpdate(sliderLayer.id, {
      settings: {
        ...sliderLayer.settings,
        slider: { ...settings, [key]: value },
      },
    });
  };

  const updateSettings = (patch: Partial<SliderSettingsType>) => {
    onLayerUpdate(sliderLayer.id, {
      settings: {
        ...sliderLayer.settings,
        slider: { ...settings, ...patch },
      },
    });
  };

  return (
    <SettingsPanel
      title="Slider"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      action={
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="xs"
            className="size-6 p-0"
            onClick={handleAddSlide}
            aria-label="Add slide"
          >
            <Icon name="plus" className="size-2.5" />
          </Button>
          <Button
            variant="secondary"
            size="xs"
            className="size-6 p-0"
            onClick={handlePrev}
            aria-label="Previous slide"
          >
            <Icon name="slide-button-prev" className="size-2.5" />
          </Button>
          <Button
            variant="secondary"
            size="xs"
            className="size-6 p-0"
            onClick={handleNext}
            aria-label="Next slide"
          >
            <Icon name="slide-button-next" className="size-2.5" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* Animation */}
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Effect</Label>
          <div className="col-span-2">
            <Select
              value={settings.animationEffect}
              onValueChange={(v) => {
                const effect = v as SwiperAnimationEffect;
                if (!EFFECTS_WITH_PER_VIEW.has(effect)) {
                  updateSettings({ animationEffect: effect, groupSlide: 1, slidesPerGroup: 1 });
                } else {
                  updateSetting('animationEffect', effect);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANIMATION_EFFECTS.map((effect) => (
                  <SelectItem key={effect.value} value={effect.value}>
                    {effect.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Slides per view - only for effects that support multiple slides */}
        {EFFECTS_WITH_PER_VIEW.has(settings.animationEffect) && (
          <div className="grid grid-cols-3 items-center">
            <Label variant="muted">Per view</Label>
            <div className="col-span-2 *:w-full">
              <InputGroup>
                <InputGroupInput
                  stepper
                  step="1"
                  min="1"
                  max="10"
                  value={String(settings.groupSlide)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 1 && n <= 10) {
                      const patch: Partial<typeof settings> = { groupSlide: n };
                      if (settings.slidesPerGroup > n) patch.slidesPerGroup = n;
                      updateSettings(patch);
                    }
                  }}
                  onBlur={() => {
                    const n = settings.groupSlide;
                    if (n < 1) updateSettings({ groupSlide: 1, slidesPerGroup: 1 });
                    else if (n > 10) updateSettings({ groupSlide: 10, slidesPerGroup: Math.min(settings.slidesPerGroup, 10) });
                  }}
                />
                <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                  items
                </InputGroupAddon>
              </InputGroup>
            </div>
          </div>
        )}

        {/* Slides per group - only when slidesPerView > 1 */}
        {EFFECTS_WITH_PER_VIEW.has(settings.animationEffect) && settings.groupSlide > 1 && (
          <div className="grid grid-cols-3 items-center">
            <Label variant="muted">Per group</Label>
            <div className="col-span-2 *:w-full">
              <InputGroup>
                <InputGroupInput
                  stepper
                  step="1"
                  min="1"
                  max={settings.groupSlide}
                  value={String(settings.slidesPerGroup)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 1 && n <= settings.groupSlide) {
                      updateSetting('slidesPerGroup', n);
                    }
                  }}
                  onBlur={() => {
                    const n = settings.slidesPerGroup;
                    if (n < 1) updateSetting('slidesPerGroup', 1);
                    else if (n > settings.groupSlide) updateSetting('slidesPerGroup', settings.groupSlide);
                  }}
                />
                <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                  items
                </InputGroupAddon>
              </InputGroup>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Easing</Label>
          <div className="col-span-2">
            <Select
              value={settings.easing}
              onValueChange={(v) => updateSetting('easing', v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EASING_OPTIONS.map((ease) => (
                  <SelectItem key={ease.value} value={ease.value}>
                    <span className="flex items-center gap-2">
                      <Icon name={ease.icon} className="size-3" />
                      {ease.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3">
          <Label variant="muted">Duration</Label>
          <div className="col-span-2 *:w-full">
            <InputGroup>
              <InputGroupInput
                stepper
                step="0.1"
                min="0"
                value={settings.duration}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  updateSetting('duration', val);
                }}
                onBlur={() => {
                  const num = parseFloat(settings.duration);
                  if (!Number.isNaN(num) && num >= 0) {
                    updateSetting('duration', String(num));
                  } else {
                    updateSetting('duration', '0.5');
                  }
                }}
                placeholder="0"
              />
              <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                sec
              </InputGroupAddon>
            </InputGroup>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Autoplay</Label>
          <div className="col-span-2 flex gap-2">
            <div className={settings.autoplay ? 'min-w-0 flex-1' : 'w-full'}>
              <Select
                value={settings.autoplay ? 'every' : 'disabled'}
                onValueChange={(v) => updateSetting('autoplay', v === 'every')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {settings.autoplay ? 'Every' : 'Disabled'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start" className="min-w-37">
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="every">Every X seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settings.autoplay && (
              <InputGroup className="min-w-0 flex-1">
                <InputGroupInput
                  stepper
                  step="0.1"
                  min="0"
                  value={settings.delay}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    updateSetting('delay', val);
                  }}
                  onBlur={() => {
                    const num = parseFloat(settings.delay);
                    if (!Number.isNaN(num) && num >= 0) {
                      updateSetting('delay', String(num));
                    } else {
                      updateSetting('delay', '3');
                    }
                  }}
                  placeholder="0"
                />
                <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                  sec
                </InputGroupAddon>
              </InputGroup>
            )}
          </div>
        </div>

        {/* Loop */}
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Loop</Label>
          <div className="col-span-2 *:w-full">
            <ToggleGroup
              options={[
                { label: 'None', value: 'none' },
                { icon: 'loop-alternate', value: 'loop' },
                { icon: 'loop-repeat', value: 'rewind' },
              ]}
              value={settings.loop}
              onChange={(v) => updateSetting('loop', v as SliderLoopMode)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Pagination</Label>
          <div className="col-span-2">
            <Select
              value={
                !settings.pagination
                  ? 'none'
                  : settings.paginationType === 'fraction'
                    ? 'fraction'
                    : settings.paginationClickable
                      ? 'clickable'
                      : 'passive'
              }
              onValueChange={(v) => {
                if (v === 'none') {
                  updateSettings({ pagination: false });
                } else {
                  updateSettings({
                    pagination: true,
                    paginationType: v === 'fraction' ? 'fraction' : 'bullets',
                    paginationClickable: v === 'clickable',
                  });
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="flex items-center gap-2">
                    <Icon name="none" className="size-3" />
                    Hidden
                  </span>
                </SelectItem>
                <SelectItem value="passive">
                  <span className="flex items-center gap-2">
                    <Icon name="slide-bullets" className="size-3" />
                    Passive bullets
                  </span>
                </SelectItem>
                <SelectItem value="clickable">
                  <span className="flex items-center gap-2">
                    <Icon name="slide-bullets" className="size-3" />
                    Clickable bullets
                  </span>
                </SelectItem>
                <SelectItem value="fraction">
                  <span className="flex items-center gap-2">
                    <Icon name="slide-fraction" className="size-3" />
                    Fraction
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Behavior toggles */}
        <div className="grid grid-cols-3 items-start gap-2">
          <Label variant="muted">Behavior</Label>
          <div className="col-span-2 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="slider-navigation"
                checked={settings.navigation}
                onCheckedChange={(checked) => updateSetting('navigation', checked)}
              />
              <Label
                variant="muted"
                htmlFor="slider-navigation"
                className="cursor-pointer"
              >
                Show navigation
              </Label>
            </div>
            {settings.autoplay && (
              <div className="flex items-center gap-2">
                <Switch
                  id="slider-pause-hover"
                  checked={settings.pauseOnHover}
                  onCheckedChange={(checked) => updateSetting('pauseOnHover', checked)}
                />
                <Label
                  variant="muted"
                  htmlFor="slider-pause-hover"
                  className="cursor-pointer"
                >
                  Pause on hover
                </Label>
              </div>
            )}
            {EFFECTS_WITH_PER_VIEW.has(settings.animationEffect) && settings.groupSlide > 1 && (
              <div className="flex items-center gap-2">
                <Switch
                  id="slider-centered"
                  checked={settings.centered}
                  onCheckedChange={(checked) => updateSetting('centered', checked)}
                />
                <Label
                  variant="muted"
                  htmlFor="slider-centered"
                  className="cursor-pointer"
                >
                  Centered mode
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="slider-touch"
                checked={settings.touchEvents}
                onCheckedChange={(checked) => {
                  updateSettings(
                    checked ? { touchEvents: true } : { touchEvents: false, slideToClicked: false }
                  );
                }}
              />
              <Label
                variant="muted"
                htmlFor="slider-touch"
                className="cursor-pointer"
              >
                Touch events
              </Label>
            </div>
            {settings.touchEvents && (
              <div className="flex items-center gap-2">
                <Switch
                  id="slider-slide-to-clicked"
                  checked={settings.slideToClicked}
                  onCheckedChange={(checked) => updateSetting('slideToClicked', checked)}
                />
                <Label
                  variant="muted"
                  htmlFor="slider-slide-to-clicked"
                  className="cursor-pointer"
                >
                  Slide on touch
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="slider-mousewheel"
                checked={settings.mousewheel}
                onCheckedChange={(checked) => updateSetting('mousewheel', checked)}
              />
              <Label
                variant="muted"
                htmlFor="slider-mousewheel"
                className="cursor-pointer"
              >
                Mousewheel
              </Label>
            </div>
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}
