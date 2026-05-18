'use client';

/**
 * Input Settings Component
 *
 * Settings panel for form input elements (input, textarea, select)
 * Allows configuring type, placeholder, value, and behavior attributes
 */

import React, { useState, useCallback, useMemo } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SettingsPanel from './SettingsPanel';
import { findAncestor } from '@/lib/layer-utils';
import type { Layer } from '@/types';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { USERS_COLLECTION_ID } from '@/lib/auth-constants';

interface InputSettingsProps {
  layer: Layer | null;
  allLayers?: Layer[];
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

// Input type options
const INPUT_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email address' },
  { value: 'tel', label: 'Phone number' },
  { value: 'url', label: 'URL' },
  { value: 'date', label: 'Date' },
  { value: 'datetime-local', label: 'Date and time' },
  { value: 'range', label: 'Range' },
];

export default function InputSettings({ layer, allLayers, onLayerUpdate }: InputSettingsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const { fields } = useCollectionsStore();

  // Check if this is a form input element
  const isInputLayer = layer?.name === 'input';
  const isTextareaLayer = layer?.name === 'textarea';
  const isSelectLayer = layer?.name === 'select';
  const isFormInputElement = isInputLayer || isTextareaLayer || isSelectLayer;

  // Check if this is a checkbox or radio input
  const isCheckboxInput = isInputLayer && layer?.attributes?.type === 'checkbox';
  const isRadioInput = isInputLayer && layer?.attributes?.type === 'radio';

  // Lock name/type for the password input on the 401 page: when this input
  // sits inside a password-protected form AND has structural restrictions,
  // the verify endpoint relies on type=password / name=password.
  const isLockedPasswordInput = useMemo(() => {
    if (!layer || !isInputLayer || !allLayers) return false;
    if (layer.restrictions?.copy !== false || layer.restrictions?.delete !== false) return false;
    const parentForm = findAncestor(
      allLayers,
      layer.id,
      (candidate) => candidate.name === 'form'
        && candidate.settings?.form?.form_type === 'password_protected'
    );
    return !!parentForm;
  }, [layer, isInputLayer, allLayers]);

  // Get current attribute values
  const attributes = layer?.attributes || {};
  const inputType = attributes.type || 'text';
  const placeholder = attributes.placeholder || '';
  const value = attributes.value || '';
  const name = attributes.name || '';
  const isRequired = attributes.required === true || attributes.required === 'true';
  const isAutofocus = attributes.autoFocus === true || attributes.autoFocus === 'true';
  const cmsFieldId = attributes.cms_field_id || '';

  // Get User collection fields for mapping
  const userFields = fields[USERS_COLLECTION_ID] || [];
  // Exclude system fields, hidden fields
  const mappableFields = userFields.filter(f => 
    !['email', 'password', 'supabase_user_id', 'role'].includes(f.key || '') && 
    !f.hidden
  );

  const handleAttributeChange = useCallback(
    (key: string, newValue: any) => {
      if (!layer) return;

      // Handle boolean attributes (required, autoFocus)
      if (key === 'required' || key === 'autoFocus') {
        const newAttributes = { ...layer.attributes };
        if (newValue) {
          newAttributes[key] = true;
        } else {
          delete newAttributes[key];
        }
        onLayerUpdate(layer.id, { attributes: newAttributes });
        return;
      }

      // Handle empty string values - remove the attribute
      if (newValue === '') {
        const newAttributes = { ...layer.attributes };
        delete newAttributes[key];
        onLayerUpdate(layer.id, { attributes: newAttributes });
        return;
      }

      onLayerUpdate(layer.id, {
        attributes: {
          ...layer.attributes,
          [key]: newValue,
        },
      });
    },
    [layer, onLayerUpdate]
  );

  // Only show for form input elements
  if (!layer || !isFormInputElement) {
    return null;
  }

  const renderCmsMapping = () => {
    if (mappableFields.length === 0) return null;
    
    return (
      <div className="grid grid-cols-3 pt-2 border-t border-dashed mt-2">
        <Label variant="muted">CMS Field</Label>
        <div className="col-span-2 *:w-full">
          <Select
            value={cmsFieldId || 'none'}
            onValueChange={(val) => handleAttributeChange('cms_field_id', val === 'none' ? '' : val)}
          >
            <SelectTrigger className="h-8 text-xs bg-primary/5 border-primary/20">
              <SelectValue placeholder="Map to User field..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not mapped</SelectItem>
              {mappableFields.map((field) => (
                <SelectItem key={field.id} value={field.id}>
                  {field.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1 px-1">
            Used to save this input to the User&apos;s profile.
          </p>
        </div>
      </div>
    );
  };

  return (
    <SettingsPanel
      title="Settings"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <div className="flex flex-col gap-3">
        {/* Radio specific settings */}
        {isRadioInput ? (
          <>
            <div className="grid grid-cols-3">
              <Label variant="muted">Group</Label>
              <div className="col-span-2 *:w-full">
                <Input
                  value={name}
                  onChange={(e) => handleAttributeChange('name', e.target.value)}
                  placeholder="e.g., plan"
                />
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Value</Label>
              <div className="col-span-2 *:w-full">
                <Input
                  value={value}
                  onChange={(e) => handleAttributeChange('value', e.target.value)}
                  placeholder="e.g., premium"
                />
              </div>
            </div>

            {renderCmsMapping()}

            <div className="grid grid-cols-3 items-start">
              <Label variant="muted" className="pt-0.5">Behavior</Label>
              <div className="col-span-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="required"
                    checked={isRequired}
                    onCheckedChange={(checked) => handleAttributeChange('required', checked)}
                  />
                  <Label
                    htmlFor="required"
                    className="text-xs font-normal cursor-pointer text-muted-foreground"
                  >
                    Required
                  </Label>
                </div>
              </div>
            </div>
          </>
        ) : isCheckboxInput ? (
          <>
            <div className="grid grid-cols-3">
              <Label variant="muted">Name</Label>
              <div className="col-span-2 *:w-full">
                <Input
                  value={name}
                  onChange={(e) => handleAttributeChange('name', e.target.value)}
                  placeholder="e.g., agree_terms"
                />
              </div>
            </div>

            {renderCmsMapping()}

            <div className="grid grid-cols-3 items-start">
              <Label variant="muted" className="pt-0.5">Behavior</Label>
              <div className="col-span-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="required"
                    checked={isRequired}
                    onCheckedChange={(checked) => handleAttributeChange('required', checked)}
                  />
                  <Label
                    htmlFor="required"
                    className="text-xs font-normal cursor-pointer text-muted-foreground"
                  >
                    Required
                  </Label>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3">
              <Label variant="muted">Name</Label>
              <div className="col-span-2 *:w-full">
                <Input
                  value={name}
                  onChange={(e) => handleAttributeChange('name', e.target.value)}
                  placeholder="Field"
                  disabled={isLockedPasswordInput}
                />
              </div>
            </div>

            {isInputLayer && (
              <div className="grid grid-cols-3">
                <Label variant="muted">Type</Label>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={inputType}
                    onValueChange={(val) => handleAttributeChange('type', val)}
                    disabled={isLockedPasswordInput}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {INPUT_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {isLockedPasswordInput && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Name and type are locked because this input gates a password-protected page.
                Restyle it freely.
              </p>
            )}

            {/* Placeholder - for input and textarea (select placeholder is in SelectOptionsSettings) */}
            {(isInputLayer || isTextareaLayer) && (
              <div className="grid grid-cols-3">
                <Label variant="muted">Placeholder</Label>
                <div className="col-span-2 *:w-full">
                  <Input
                    value={placeholder}
                    onChange={(e) => handleAttributeChange('placeholder', e.target.value)}
                    placeholder="Placeholder text"
                  />
                </div>
              </div>
            )}

            {(isInputLayer || isTextareaLayer) && (
              <div className="grid grid-cols-3">
                <Label variant="muted">Value</Label>
                <div className="col-span-2 *:w-full">
                  <Input
                    value={value}
                    onChange={(e) => handleAttributeChange('value', e.target.value)}
                    placeholder="Input value"
                  />
                </div>
              </div>
            )}

            {renderCmsMapping()}

            <div className="grid grid-cols-3 items-start">
              <Label variant="muted" className="pt-0.5">Behavior</Label>
              <div className="col-span-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="required"
                    checked={isRequired}
                    onCheckedChange={(checked) => handleAttributeChange('required', checked)}
                  />
                  <Label
                    htmlFor="required"
                    className="text-xs font-normal cursor-pointer text-muted-foreground"
                  >
                    Required
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="autofocus"
                    checked={isAutofocus}
                    onCheckedChange={(checked) => handleAttributeChange('autoFocus', checked)}
                  />
                  <Label
                    htmlFor="autofocus"
                    className="text-xs font-normal cursor-pointer text-muted-foreground"
                  >
                    Autofocus
                  </Label>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsPanel>
  );
}
