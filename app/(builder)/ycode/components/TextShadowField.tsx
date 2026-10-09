'use client';

import { memo, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import CssVariableInput from './css-variables/CssVariableInput';
import { Slider } from '@/components/ui/slider';
import Icon from '@/components/ui/icon';
import { InputGroup } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  convertToRgba,
  parseShadowLength,
  parseTextShadow,
  serializeTextShadow,
  swatchColor,
  type TextShadow,
} from '@/lib/text-shadow-utils';
import ColorPicker from './ColorPicker';

interface TextShadowFieldProps {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}

const TextShadowField = memo(function TextShadowField({
  value,
  onChange,
  onRemove,
}: TextShadowFieldProps) {
  const shadow = parseTextShadow(value);

  const updateShadow = useCallback((next: TextShadow) => {
    onChange(serializeTextShadow(next));
  }, [onChange]);

  const handleColorChange = useCallback((color: string) => {
    if (!shadow) return;
    if (color.startsWith('color:var(')) {
      updateShadow({ ...shadow, color });
      return;
    }
    updateShadow({ ...shadow, color: convertToRgba(color) });
  }, [shadow, updateShadow]);

  const handleXChange = useCallback((x: number | string) => {
    if (!shadow) return;
    updateShadow({ ...shadow, x });
  }, [shadow, updateShadow]);

  const handleYChange = useCallback((y: number | string) => {
    if (!shadow) return;
    updateShadow({ ...shadow, y });
  }, [shadow, updateShadow]);

  const handleBlurChange = useCallback((blur: number | string) => {
    if (!shadow) return;
    updateShadow({ ...shadow, blur });
  }, [shadow, updateShadow]);

  if (!shadow) return null;

  return (
    <div className="grid grid-cols-3 items-start">
      <Label variant="muted" className="h-8">Shadow</Label>
      <div className="col-span-2 flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <InputGroup className="flex-1 cursor-pointer">
              <div className="w-full flex items-center gap-2 px-2.5">
                <div
                  className="size-4 rounded shrink-0 outline outline-current/10 -outline-offset-1"
                  style={{ backgroundColor: swatchColor(shadow.color) }}
                />
                <Label variant="muted">
                  {shadow.x}px {shadow.y}px {shadow.blur}px
                </Label>
              </div>
            </InputGroup>
          </PopoverTrigger>
          <PopoverContent className="w-56 my-0.5 flex flex-col gap-2" align="end">
            <div className="grid grid-cols-3">
              <Label variant="muted">Color</Label>
              <div className="col-span-2 *:w-full">
                <ColorPicker
                  value={shadow.color}
                  onChange={handleColorChange}
                  solidOnly
                />
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">X</Label>
              <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                <CssVariableInput
                  variableTypes={['size']}
                  stepper
                  min={-20}
                  max={20}
                  step={1}
                  value={shadow.x}
                  onChange={(e) => handleXChange(parseShadowLength(e.target.value))}
                />
                <Slider
                  className="flex-1"
                  value={[Number(shadow.x) || 0]}
                  onValueChange={(values) => handleXChange(values[0])}
                  min={-20}
                  max={20}
                  step={1}
                />
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Y</Label>
              <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                <CssVariableInput
                  variableTypes={['size']}
                  stepper
                  min={-20}
                  max={20}
                  step={1}
                  value={shadow.y}
                  onChange={(e) => handleYChange(parseShadowLength(e.target.value))}
                />
                <Slider
                  className="flex-1"
                  value={[Number(shadow.y) || 0]}
                  onValueChange={(values) => handleYChange(values[0])}
                  min={-20}
                  max={20}
                  step={1}
                />
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Blur</Label>
              <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                <CssVariableInput
                  variableTypes={['size']}
                  stepper
                  min={0}
                  max={30}
                  step={1}
                  value={shadow.blur}
                  onChange={(e) => handleBlurChange(parseShadowLength(e.target.value))}
                />
                <Slider
                  className="flex-1"
                  value={[Number(shadow.blur) || 0]}
                  onValueChange={(values) => handleBlurChange(values[0])}
                  min={0}
                  max={30}
                  step={1}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label="Remove text shadow"
          className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          onClick={onRemove}
        >
          <Icon name="x" className="size-2.5" />
        </button>
      </div>
    </div>
  );
});

export default TextShadowField;
