'use client';

import React from 'react';
import { DiamondPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { InputGroupInput } from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { CSS_VARIABLE_REFERENCE } from '@/lib/css-variable-utils';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import type { CssVariableType } from '@/types';
import CssVariableReferencePicker from './CssVariableReferencePicker';

type Props = React.ComponentProps<typeof Input> & {
  grouped?: boolean;
  variableTypes?: CssVariableType[];
};

/** Compose the existing inspector input with a typed token picker. */
export default function CssVariableInput({ grouped, variableTypes = ['size', 'percentage'], ...props }: Props) {
  const variables = useCssVariablesStore(s => s.graph.variables);
  const id = CSS_VARIABLE_REFERENCE.exec(String(props.value ?? ''))?.[1];
  const variable = variables.find(v => v.id === id);
  const change = (value: string) => props.onChange?.({ target: { value }, currentTarget: { value } } as React.ChangeEvent<HTMLInputElement>);
  const Control = grouped ? InputGroupInput : Input;
  return (
    <div className="flex items-center gap-0.5 min-w-0 w-full">
      {id ? (
        <Button
          variant="input" size="xs"
          className="flex-1 min-w-0 justify-start truncate [&>svg:first-child]:!size-2.5" title={variable?.name ?? 'Missing variable'}
          disabled={props.disabled} onClick={() => change('')}
        >
          <DiamondPlus className="size-2.5" />
          <span className="truncate">{variable?.name ?? 'Missing variable'}</span>
          <Icon name="x" className="ml-auto shrink-0" />
        </Button>
      ) : <Control {...props} />}
      {!props.disabled && <CssVariableReferencePicker types={variableTypes} onSelect={change} />}
    </div>
  );
}
