'use client';

import React, { Fragment, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { colorVariableToCss, splitColorVariableRefs } from '@/lib/color-variable-utils';
import { getComponentVariantLabel } from '@/lib/component-variant-utils';
import { getDesignPropertyDescription } from '@/lib/design-property-descriptions';
import {
  DESIGN_SOURCE_KIND_LABELS,
  getDesignPropertyLabel,
  groupDesignSourceSteps,
  resolveDesignPropertyChain,
  type DesignSourceStep,
} from '@/lib/design-property-source';
import { useDesignPanelSource, type DesignPanelSourceContextValue } from '@/lib/design-property-source-context';
import { cn } from '@/lib/utils';
import type { ColorVariable } from '@/types';

interface DesignPropertyLabelProps extends React.ComponentProps<typeof Label> {
  /** Design properties the setting controls, e.g. ['width', 'minWidth', 'maxWidth'] */
  properties: readonly string[];
}

const PILL_CLASS = 'min-w-0 cursor-pointer rounded-full px-1.5 py-0 text-[10px] font-normal text-foreground disabled:cursor-default';
const STYLE_PILL_CLASS = 'border-blue-400/60 bg-blue-400/10 hover:bg-blue-400/25';
const PARENT_PILL_CLASS = 'border-white/20 bg-secondary hover:bg-white/15';
const VALUE_BLOCK_CLASS = 'flex flex-col gap-1.5 rounded-md border bg-secondary/40 px-2 py-1.5';
const SOURCE_BADGE_CLASS = 'rounded-sm border-transparent bg-secondary px-1 py-0 text-[10px] font-normal text-secondary-foreground';

/**
 * Setting label that shows, on hover, the classes behind the setting's value
 * and the chain of styles, breakpoints and states they come from.
 */
export default function DesignPropertyLabel({ properties, className, children, ...props }: DesignPropertyLabelProps) {
  const context = useDesignPanelSource();

  if (!context) {
    return <Label className={className} {...props}>{children}</Label>;
  }

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Label className={cn('cursor-default transition-colors hover:text-foreground', className)} {...props}>
          {children}
        </Label>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        sideOffset={2}
        className="w-64 rounded-md border bg-background px-3 py-2.5 text-left text-foreground shadow-lg"
        arrowClassName="bg-background fill-background border-r border-b"
      >
        <DesignPropertySourceDetails
          title={children}
          properties={properties}
          context={context}
        />
      </TooltipContent>
    </Tooltip>
  );
}

interface DesignPropertySourceDetailsProps {
  title: React.ReactNode;
  properties: readonly string[];
  context: DesignPanelSourceContextValue;
}

/** Tooltip body; only mounted while the tooltip is open */
function DesignPropertySourceDetails({ title, properties, context }: DesignPropertySourceDetailsProps) {
  const breakpoint = useEditorStore((s) => s.activeBreakpoint);
  const uiState = useEditorStore((s) => s.activeUIState);
  const editingComponentId = useEditorStore((s) => s.editingComponentId);
  const editingVariantId = useEditorStore((s) => s.editingComponentVariantId);
  const editingComponent = useComponentsStore((s) => (
    editingComponentId ? s.getComponentById(editingComponentId) : undefined
  ));
  const colorVariables = useColorVariablesStore((s) => s.colorVariables);
  const colorVariablesById = useMemo(
    () => new Map(colorVariables.map((variable) => [variable.id, variable])),
    [colorVariables],
  );

  const chains = properties
    .map((property) => ({
      property,
      steps: resolveDesignPropertyChain(property, context, breakpoint, uiState),
    }))
    .filter((chain) => chain.steps.length > 0);

  return (
    <div className="flex flex-col gap-2">
      {chains.length === 0 && (
        <div className="flex flex-col gap-2">
          <DesignPropertyHeading title={title} property={properties[0]} />
          <div className={VALUE_BLOCK_CLASS}>
            <p className="text-muted-foreground">Not set, uses the default value.</p>
          </div>
        </div>
      )}

      {chains.length > 0 && (
        <div className="flex flex-col gap-3">
          {chains.map((chain, chainIndex) => (
            <div
              key={chain.property}
              className={cn('flex flex-col gap-2', chainIndex > 0 && 'border-t pt-3')}
            >
              <DesignPropertyHeading
                title={properties.length === 1 ? title : getDesignPropertyLabel(chain.property)}
                property={chain.property}
              />
              <div className={VALUE_BLOCK_CLASS}>
                {groupDesignSourceSteps(chain.steps).map((group, index) => (
                  <DesignSourceGroupRow
                    key={`${group.key}-${index}`}
                    steps={group.steps}
                    winner={chain.steps[chain.steps.length - 1]}
                    colorVariablesById={colorVariablesById}
                    onSelectStyle={context.onSelectStyle}
                    onSelectLayer={context.onSelectLayer}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingComponent && (
        <div className="flex items-center gap-1 text-muted-foreground">
          In
          <Badge className={SOURCE_BADGE_CLASS}>
            {getComponentVariantLabel(editingComponent, editingVariantId)}
          </Badge>
        </div>
      )}
    </div>
  );
}

interface DesignPropertyHeadingProps {
  title: React.ReactNode;
  property: string;
}

/** Property name with a short explanation of what it does */
function DesignPropertyHeading({ title, property }: DesignPropertyHeadingProps) {
  const description = getDesignPropertyDescription(property);

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-medium">{title}</p>
      {description && <p className="text-wrap text-muted-foreground">{description}</p>}
    </div>
  );
}

interface SourcePillProps {
  label: string;
  ariaLabel: string;
  className: string;
  /** Omitted when the source can't be opened */
  onClick?: () => void;
}

/** Clickable source name, e.g. a layer style or parent element */
function SourcePill({ label, ariaLabel, className, onClick }: SourcePillProps) {
  return (
    <Badge asChild className={cn(PILL_CLASS, className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={!onClick}
        onClick={onClick}
      >
        <span className="truncate">{label}</span>
      </button>
    </Badge>
  );
}

interface DesignSourceGroupRowProps {
  /** Consecutive steps from the same source */
  steps: DesignSourceStep[];
  /** The step that renders; every other step is overridden */
  winner: DesignSourceStep;
  colorVariablesById: Map<string, ColorVariable>;
  onSelectStyle?: (styleId: string) => void;
  onSelectLayer?: (layerId: string) => void;
}

/** Source type and name, with the classes it sets on the lines below */
function DesignSourceGroupRow({
  steps,
  winner,
  colorVariablesById,
  onSelectStyle,
  onSelectLayer,
}: DesignSourceGroupRowProps) {
  const [step] = steps;
  const { styleId, layerId } = step;

  return (
    <div className="flex flex-col gap-0.5">
      <div className={cn('flex min-w-0 items-center gap-1', !steps.includes(winner) && 'opacity-50')}>
        <span className="shrink-0 text-muted-foreground">{DESIGN_SOURCE_KIND_LABELS[step.kind]}</span>
        {step.kind === 'layerStyle' && (
          <SourcePill
            label={step.label}
            ariaLabel={`Edit layer style ${step.label}`}
            className={STYLE_PILL_CLASS}
            onClick={styleId && onSelectStyle ? () => onSelectStyle(styleId) : undefined}
          />
        )}
        {step.kind === 'parent' && (
          <SourcePill
            label={step.label}
            ariaLabel={`Select ${step.label}`}
            className={PARENT_PILL_CLASS}
            onClick={layerId && onSelectLayer ? () => onSelectLayer(layerId) : undefined}
          />
        )}
        {step.kind === 'textStyle' && <span className="truncate">{step.label}</span>}
      </div>
      {steps.map((classStep, index) => (
        <div
          key={`${classStep.className}-${index}`}
          className={cn('flex min-w-0 items-start gap-1 pl-1', classStep !== winner && 'opacity-50')}
        >
          <Icon name="arrow-right" className="mt-[3px] size-2.5 shrink-0 text-muted-foreground" />
          <SourceClassName
            className={classStep.className}
            isOverridden={classStep !== winner}
            colorVariablesById={colorVariablesById}
          />
          {classStep.isCustomized && <span className="shrink-0 text-[10px] leading-4 text-yellow-400">Customized</span>}
        </div>
      ))}
    </div>
  );
}

interface SourceClassNameProps {
  className: string;
  isOverridden: boolean;
  colorVariablesById: Map<string, ColorVariable>;
}

/** Class with color variable references shown by name; hover shows the raw class */
function SourceClassName({ className, isOverridden, colorVariablesById }: SourceClassNameProps) {
  return (
    <code title={className} className={cn('min-w-0 font-mono break-all', isOverridden && 'line-through')}>
      {splitColorVariableRefs(className).map((segment, index) => {
        const variable = 'variableId' in segment ? colorVariablesById.get(segment.variableId) : undefined;
        if (!variable) return <Fragment key={index}>{segment.text}</Fragment>;
        return (
          <span key={index} className="mx-0.5 inline-flex items-center gap-1 rounded-sm bg-secondary px-1 align-bottom font-sans">
            <span
              className="size-2 shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: colorVariableToCss(variable.value) }}
            />
            {variable.name}
          </span>
        );
      })}
    </code>
  );
}
