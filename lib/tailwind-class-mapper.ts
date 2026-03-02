/**
 * Tailwind Class Mapper
 *
 * Bidirectional conversion between design object properties and Tailwind CSS classes
 * with intelligent conflict resolution
 */

import type { Layer, UIState, Breakpoint } from '@/types';
import { cn } from '@/lib/utils';
import { getBreakpointPrefix } from './breakpoint-utils';

/**
 * Build a CSS custom property name for background image per breakpoint/state.
 * Omits suffixes for defaults: desktop→no bp suffix, neutral→no state suffix.
 *
 * Examples:
 *  ('desktop','neutral') → '--bg-img'
 *  ('mobile','neutral')  → '--bg-img-mobile'
 *  ('desktop','hover')   → '--bg-img-hover'
 *  ('tablet','focus')    → '--bg-img-tablet-focus'
 */
export function buildBgImgVarName(breakpoint: Breakpoint, uiState: UIState): string {
  const parts = ['--bg-img'];
  if (breakpoint !== 'desktop') parts.push(breakpoint);
  if (uiState !== 'neutral') parts.push(uiState);
  return parts.join('-');
}

/**
 * Combine background image URL and gradient into a single CSS `background-image` value.
 * Returns comma-separated layers when both exist (image renders on top of gradient).
 */
export function combineBgValues(imageUrl?: string, gradient?: string): string {
  return [imageUrl, gradient].filter(Boolean).join(', ');
}

/**
 * Merge bgImageVars and bgGradientVars into a single record of combined CSS variable values.
 * Used by both client LayerRenderer and SSR page-fetcher.
 */
export function mergeStaticBgVars(
  imgVars?: Record<string, string>,
  gradVars?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const allKeys = new Set([
    ...Object.keys(imgVars || {}),
    ...Object.keys(gradVars || {}),
  ]);
  for (const key of allKeys) {
    const combined = combineBgValues(imgVars?.[key], gradVars?.[key]);
    if (combined) result[key] = combined;
  }
  return result;
}

// Regex to detect background-image CSS variable classes — built via new RegExp
// to prevent Tailwind's source scanner from extracting phantom class candidates
const _bgVarPat = '--bg-img(?:-[\\w]+)*';
const BG_IMG_VAR_RE = new RegExp(
  '^(?:bg-\\[image:var\\(' + _bgVarPat + '\\)\\]|bg-\\(' + _bgVarPat + '\\))$'
);

/** Prefix used for background-image CSS variable classes */
const BG_IMG_CLASS_PREFIX = 'bg-' + '[image:var(';

/** Build the Tailwind class for a background-image CSS variable */
export function buildBgImgClass(varName: string): string {
  return BG_IMG_CLASS_PREFIX + varName + ')]';
}

/** Extract the CSS variable name from a background-image CSS variable class */
export function extractBgImgVarName(cls: string): string | null {
  if (cls.startsWith(BG_IMG_CLASS_PREFIX)) return cls.slice(BG_IMG_CLASS_PREFIX.length, -2);
  if (cls.startsWith('bg-(' + '--bg-img')) return cls.slice(3, -1);
  return null;
}

/**
 * Helper: Check if a value looks like a color (hex, rgb, rgba, hsl, hsla, or color name)
 * Used to distinguish between text-[color] and text-[size] arbitrary values
 */
function isColorValue(value: string): boolean {
  // Check for hex colors (with or without #)
  // Supports: #RGB, RGB, #RRGGBB, RRGGBB, #RRGGBBAA, RRGGBBAA
  if (/^#?[0-9A-Fa-f]{3}$/.test(value)) return true; // #RGB or RGB
  if (/^#?[0-9A-Fa-f]{6}$/.test(value)) return true; // #RRGGBB or RRGGBB
  if (/^#?[0-9A-Fa-f]{8}$/.test(value)) return true; // #RRGGBBAA or RRGGBBAA

  // Check for rgb/rgba functions
  // Supports: rgb(r,g,b), rgba(r,g,b,a), with or without spaces
  if (/^rgba?\s*\(/i.test(value)) return true;

  // Check for hsl/hsla functions
  // Supports: hsl(h,s,l), hsla(h,s,l,a), with or without spaces
  if (/^hsla?\s*\(/i.test(value)) return true;

  // Check for CSS color keywords (common ones)
  const colorKeywords = [
    'transparent', 'currentcolor', 'inherit',
    'black', 'white', 'red', 'green', 'blue',
    'yellow', 'purple', 'pink', 'gray', 'grey', 'orange', 'cyan', 'magenta',
    'indigo', 'violet', 'brown', 'lime', 'teal', 'navy', 'maroon', 'olive'
  ];
  if (colorKeywords.includes(value.toLowerCase())) return true;

  // If it has a size unit, it's definitely NOT a color
  // Units: px, rem, em, %, vh, vw, vmin, vmax, ch, ex, cm, mm, in, pt, pc
  if (/^-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc)$/i.test(value)) {
    return false;
  }

  // If it's just a number (with optional decimal), it's a size, not a color
  // Examples: 10, 1.5, 100, 0.5
  if (/^-?\d*\.?\d+$/.test(value)) {
    return false;
  }

  // Default: if we can't determine, assume it's NOT a color (safer default)
  return false;
}

/**
 * Helper: Format measurement value for Tailwind class generation
 * Handles plain numbers by adding 'px', preserves explicit units
 *
 * @param value - The measurement value (e.g., "100", "100px", "10rem")
 * @param prefix - The Tailwind prefix (e.g., "w", "m", "text")
 * @param allowedNamedValues - Optional array of named values (e.g., ["auto", "full"])
 * @returns Formatted Tailwind class
 *
 * @example
 * formatMeasurementClass("100", "w") // "w-[100px]"
 * formatMeasurementClass("100px", "m") // "m-[100px]"
 * formatMeasurementClass("10rem", "text") // "text-[10rem]"
 * formatMeasurementClass("auto", "w", ["auto"]) // "w-auto"
 */
function formatMeasurementClass(
  value: string,
  prefix: string,
  allowedNamedValues: string[] = []
): string {
  // Check for named values first (e.g., "auto", "full")
  if (allowedNamedValues.includes(value)) {
    return `${prefix}-${value}`;
  }

  // Check if value already ends with px - don't add it again
  if (value.endsWith('px')) {
    return `${prefix}-[${value}]`;
  }

  // Check if value is just a number (e.g., "100" without any unit)
  const isPlainNumber = /^-?\d*\.?\d+$/.test(value);
  if (isPlainNumber) {
    // Add px to plain numbers
    return `${prefix}-[${value}px]`;
  }

  // For values with other units (rem, em, %, etc.) or negative prefix, wrap in arbitrary value
  if (value.match(/^-/)) {
    return `${prefix}-[${value}]`;
  }

  // For values starting with a digit but not caught above
  if (value.match(/^\d/)) {
    return `${prefix}-[${value}]`;
  }

  // Otherwise use as named class (e.g., "large", "small")
  return `${prefix}-${value}`;
}

/**
 * Map of Tailwind class prefixes to their property names
 * Used for conflict detection and removal
 */
const CLASS_PROPERTY_MAP: Record<string, RegExp> = {
  // Display & Layout
  display: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/,
  flexDirection: /^flex-(row|row-reverse|col|col-reverse)$/,
  flexWrap: /^flex-(wrap|wrap-reverse|nowrap)$/,
  justifyContent: /^justify-(start|end|center|between|around|evenly|stretch)$/,
  alignItems: /^items-(start|end|center|baseline|stretch)$/,
  alignContent: /^content-(start|end|center|between|around|evenly|stretch)$/,
  gap: /^gap-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  columnGap: /^gap-x-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  rowGap: /^gap-y-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  gridTemplateColumns: /^grid-cols-(\[.+\]|\d+|none|subgrid)$/,
  gridTemplateRows: /^grid-rows-(\[.+\]|\d+|none|subgrid)$/,

  // Spacing
  padding: /^p-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  paddingTop: /^pt-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  paddingRight: /^pr-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  paddingBottom: /^pb-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  paddingLeft: /^pl-(\[.+\]|\d+|px|0\.5|1\.5|2\.5|3\.5)$/,
  margin: /^m-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  marginTop: /^mt-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  marginRight: /^mr-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  marginBottom: /^mb-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  marginLeft: /^ml-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,

  // Sizing
  width: /^w-(\[.+\]|\d+\/\d+|\d+|px|auto|full|screen|min|max|fit)$/,
  height: /^h-(\[.+\]|\d+\/\d+|\d+|px|auto|full|screen|min|max|fit)$/,
  minWidth: /^min-w-(\[.+\]|\d+|px|full|min|max|fit)$/,
  minHeight: /^min-h-(\[.+\]|\d+|px|full|screen|min|max|fit)$/,
  maxWidth: /^max-w-(\[.+\]|none|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full|min|max|fit|prose|screen-sm|screen-md|screen-lg|screen-xl|screen-2xl)$/,
  maxHeight: /^max-h-(\[.+\]|\d+|px|full|screen|min|max|fit)$/,
  overflow: /^overflow-(visible|hidden|clip|scroll|auto|x-visible|x-hidden|x-clip|x-scroll|x-auto|y-visible|y-hidden|y-clip|y-scroll|y-auto)$/,
  aspectRatio: /^aspect-(\[.+\]|auto|square|video)$/,
  objectFit: /^object-(contain|cover|fill|none|scale-down)$/,
  gridColumnSpan: /^col-span-(1|2|3|4|5|6|7|8|9|10|11|12|auto|full)$/,
  gridRowSpan: /^row-span-(1|2|3|4|5|6|7|8|9|10|11|12|auto|full)$/,

  // Typography
  fontFamily: /^font-(sans|serif|mono|\[.+\])$/,
  // Updated to match partial arbitrary values like text-n, text-no, text-non (not just complete text-[10rem])
  // Excludes text-align values (left, center, right, justify, start, end)
  fontSize: /^text-(?!(?:left|center|right|justify|start|end)(?:\s|$)).+$/,
  fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[.+\])$/,
  lineHeight: /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/,
  letterSpacing: /^tracking-(tighter|tight|normal|wide|wider|widest|\[.+\]|.+)$/,
  textAlign: /^text-(left|center|right|justify|start|end)$/,
  textTransform: /^(uppercase|lowercase|capitalize|normal-case)$/,
  textDecoration: /^(underline|overline|line-through|no-underline)$/,
  textDecorationColor: /^decoration-\[.+\](\/\d+)?$/,
  textDecorationThickness: /^decoration-(\d+|auto|from-font|\[(?!#|rgb|hsl).+\])$/,
  underlineOffset: /^underline-offset-.+$/,
  // Updated to match partial arbitrary values like text-r, text-re, text-red (not just complete text-[#FF0000])
  // Excludes fontSize named values and text-align values
  // Includes opacity modifier: text-[#cc8d8d]/59
  color: /^text-(?!(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|left|center|right|justify|start|end)(?:\s|$)).+(\/\d+)?$/,
  placeholderColor: /^placeholder:text-.+(\/\d+)?$/,

  // Backgrounds
  backgroundColor: /^bg-(?!(?:auto|cover|contain|bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top|repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space|none|gradient-to-t|gradient-to-tr|gradient-to-r|gradient-to-br|gradient-to-b|gradient-to-bl|gradient-to-l|gradient-to-tl)$)((\w+)(-\d+)?|\[.+\](?:\/\d+)?)$/,
  backgroundSize: /^bg-(auto|cover|contain|\[.+\])$/,
  backgroundPosition: /^bg-(bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top|\[.+\])$/,
  backgroundRepeat: /^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/,
  backgroundImage: /^bg-(none|gradient-to-t|gradient-to-tr|gradient-to-r|gradient-to-br|gradient-to-b|gradient-to-bl|gradient-to-l|gradient-to-tl|\[.+\])$/,
  backgroundClip: /^bg-clip-(text|border|padding|content)$/,

  // Borders
  borderWidth: /^border(-\d+|-\[(?!#|rgb).+\])?$/,
  borderTopWidth: /^border-t(-\d+|-\[(?!#|rgb).+\])?$/,
  borderRightWidth: /^border-r(-\d+|-\[(?!#|rgb).+\])?$/,
  borderBottomWidth: /^border-b(-\d+|-\[(?!#|rgb).+\])?$/,
  borderLeftWidth: /^border-l(-\d+|-\[(?!#|rgb).+\])?$/,
  borderStyle: /^border-(solid|dashed|dotted|double|hidden|none)$/,
  borderColor: /^border-(?!(?:solid|dashed|dotted|double|hidden|none)$)(?!t-|r-|b-|l-|x-|y-)((\w+)(-\d+)?|\[(?:#|rgb).+\])(\/\d+)?$/,
  borderRadius: /^rounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[.+\])?$/,
  borderTopLeftRadius: /^rounded-tl(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[.+\])?$/,
  borderTopRightRadius: /^rounded-tr(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[.+\])?$/,
  borderBottomRightRadius: /^rounded-br(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[.+\])?$/,
  borderBottomLeftRadius: /^rounded-bl(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[.+\])?$/,

  // Dividers
  divideX: /^divide-x(-\d+|-\[(?!#|rgb).+\])?$/,
  divideY: /^divide-y(-\d+|-\[(?!#|rgb).+\])?$/,
  divideStyle: /^divide-(solid|dashed|dotted|double|none)$/,
  divideColor: /^divide-((\w+)(-\d+)?|\[(?:#|rgb).+\])(\/\d+)?$/,

  // Effects
  opacity: /^opacity-(\d+|\[.+\])$/,
  boxShadow: /^shadow(-none|-sm|-md|-lg|-xl|-2xl|-inner|-\[.+\])?$/,
  blur: /^blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-\[.+\])?$/,
  backdropBlur: /^backdrop-blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-\[.+\])?$/,

  // Positioning
  position: /^(static|fixed|absolute|relative|sticky)$/,
  top: /^top-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  right: /^right-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  bottom: /^bottom-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  left: /^left-(\[.+\]|\d+|px|auto|0\.5|1\.5|2\.5|3\.5)$/,
  zIndex: /^z-(\[.+\]|\d+|auto)$/,
};

/**
 * Get the conflicting class pattern for a given property
 */
export function getConflictingClassPattern(property: string): RegExp | null {
  return CLASS_PROPERTY_MAP[property] || null;
}

/**
 * Helper: Extract arbitrary value from Tailwind class
 */
function extractArbitraryValue(className: string): string | null {
  const match = className.match(/\[([^\]]+)\]/);
  return match ? match[1] : null;
}

/**
 * Helper: Extract arbitrary value with opacity modifier
 * Handles both "text-[#cc8d8d]" and "text-[#cc8d8d]/59"
 */
function extractArbitraryValueWithOpacity(className: string): string | null {
  const match = className.match(/\[([^\]]+)\](?:\/(\d+))?/);
  if (!match) return null;

  const value = match[1];
  const opacity = match[2];

  // If opacity exists, append it with /
  return opacity ? `${value}/${opacity}` : value;
}

/**
 * Remove conflicting classes based on property name
 * Smart handling for text-[...] to distinguish between fontSize and color
 * Smart handling for bg-[...] to distinguish between backgroundColor and backgroundImage
 */
export function removeConflictingClasses(
  classes: string[],
  property: string
): string[] {
  const pattern = getConflictingClassPattern(property);
  if (!pattern) return classes;

  return classes.filter(cls => {
    // Strip breakpoint and state prefixes for helper class detection
    const baseClass = cls.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

    // Special handling for text color property
    // Remove gradient-related classes (bg-[gradient], bg-clip-text, text-transparent)
    if (property === 'color') {
      // Remove bg-[gradient] used for text gradient
      if (baseClass.startsWith('bg-[')) {
        const value = extractArbitraryValue(baseClass);
        if (value && value.includes('gradient(')) {
          return false; // Remove gradient background (it's a text gradient)
        }
      }
      // Remove bg-clip-text (used for text gradients)
      if (baseClass === 'bg-clip-text') {
        return false;
      }
      // Remove text-transparent (used for text gradients)
      if (baseClass === 'text-transparent') {
        return false;
      }
    }

    // Check if this class matches the pattern (use baseClass)
    if (!pattern.test(baseClass)) return true; // Keep it if it doesn't match

    // Special handling for text-[...] arbitrary values
    // Need to distinguish between fontSize (text-[10rem]) and color (text-[#0000FF])
    if (baseClass.startsWith('text-[')) {
      const value = extractArbitraryValue(baseClass);
      if (value) {
        const isColor = isColorValue(value);

        // If we're removing fontSize conflicts, keep color classes
        if (property === 'fontSize' && isColor) {
          return true; // Keep this class, it's a color not a size
        }

        // If we're removing color conflicts, keep size classes
        if (property === 'color' && !isColor) {
          return true; // Keep this class, it's a size not a color
        }
      }
    }

    // Background-image CSS variable classes are always backgroundImage
    if (BG_IMG_VAR_RE.test(baseClass)) {
      if (property === 'backgroundColor') return true;
      if (property === 'backgroundImage') return false;
      return true;
    }

    // Special handling for bg-[...] arbitrary values
    // Need to distinguish between backgroundColor (bg-[#0000FF]) and backgroundImage (bg-[url(...)])
    if (baseClass.startsWith('bg-[')) {
      const value = extractArbitraryValue(baseClass);
      if (value) {
        const isImage = isImageValue(value);

        // If we're removing backgroundColor conflicts, keep image classes
        if (property === 'backgroundColor' && isImage) {
          return true; // Keep this class, it's an image not a color
        }

        // If we're removing backgroundImage conflicts, keep color classes
        if (property === 'backgroundImage' && !isImage) {
          return true; // Keep this class, it's a color not an image
        }
      }
    }

    // For all other cases, remove the conflicting class
    return false;
  });
}

/**
 * Check if a class is a standard Tailwind color class (e.g., text-blue-500, bg-red-500)
 */
function isStandardColorClass(className: string): boolean {
  // Strip prefixes
  const baseClass = className.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

  // Common Tailwind color patterns
  const colorPattern = /^(text|bg|border|ring|outline|decoration|shadow|from|via|to|caret|accent|divide|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/;

  return colorPattern.test(baseClass);
}

/**
 * Check if a class is an arbitrary value for a color property
 */
function isArbitraryColorClass(className: string, property: string): boolean {
  // Strip prefixes
  const baseClass = className.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

  // Check based on property
  if (property === 'color' && baseClass.startsWith('text-[')) {
    const value = extractArbitraryValue(baseClass);
    return value ? isColorValue(value) : false;
  }

  if (property === 'backgroundColor' && baseClass.startsWith('bg-[')) {
    const value = extractArbitraryValue(baseClass);
    return value ? isColorValue(value) : false;
  }

  if (property === 'borderColor' && baseClass.startsWith('border-[')) {
    const value = extractArbitraryValue(baseClass);
    return value ? isColorValue(value) : false;
  }

  return false;
}

/**
 * Replace a conflicting class with a new one
 * Note: Does NOT use cn() here because our property-aware conflict detection
 * is more precise than tailwind-merge for arbitrary values
 */
export function replaceConflictingClasses(
  existingClasses: string[],
  property: string,
  newClass: string | null
): string[] {
  const filtered = removeConflictingClasses(existingClasses, property);

  if (newClass) {
    return [...filtered, newClass];
  }

  return filtered;
}

/**
 * Convert a design property value to a Tailwind class
 */
export function propertyToClass(
  category: keyof NonNullable<Layer['design']>,
  property: string,
  value: string
): string | null {
  if (!value) return null;

  // Layout conversions
  if (category === 'layout') {
    switch (property) {
      case 'display':
        return value; // Already a valid class: 'flex', 'grid', 'block', etc.
      case 'flexDirection':
        if (value === 'row') return 'flex-row';
        if (value === 'column') return 'flex-col';
        if (value === 'row-reverse') return 'flex-row-reverse';
        if (value === 'column-reverse') return 'flex-col-reverse';
        return `flex-${value}`;
      case 'flexWrap':
        if (value === 'wrap') return 'flex-wrap';
        if (value === 'nowrap') return 'flex-nowrap';
        if (value === 'wrap-reverse') return 'flex-wrap-reverse';
        return null;
      case 'justifyContent':
        return `justify-${value}`;
      case 'alignItems':
        return `items-${value}`;
      case 'alignContent':
        return `content-${value}`;
      case 'gap':
        return formatMeasurementClass(value, 'gap');
      case 'columnGap':
        return formatMeasurementClass(value, 'gap-x');
      case 'rowGap':
        return formatMeasurementClass(value, 'gap-y');
      case 'gridTemplateColumns':
        // Replace spaces with underscores for Tailwind arbitrary value syntax
        return `grid-cols-[${value.replace(/\s+/g, '_')}]`;
      case 'gridTemplateRows':
        // Replace spaces with underscores for Tailwind arbitrary value syntax
        return `grid-rows-[${value.replace(/\s+/g, '_')}]`;
    }
  }

  // Typography conversions
  if (category === 'typography') {
    switch (property) {
      case 'fontSize':
        return formatMeasurementClass(value, 'text');
      case 'fontWeight':
        // Always use arbitrary values for numeric weights
        return value.match(/^\d/) ? `font-[${value}]` : `font-${value}`;
      case 'fontFamily':
        // Built-in fonts: sans, serif, mono → font-sans, font-serif, font-mono
        if (['sans', 'serif', 'mono'].includes(value)) return `font-${value}`;
        // Google/custom fonts: replace spaces with underscores for Tailwind arbitrary values
        return `font-[${value.replace(/\s+/g, '_')}]`;
      case 'lineHeight':
        return value.match(/^\d/) ? `leading-[${value}]` : `leading-${value}`;
      case 'letterSpacing':
        // Check if value starts with digit/minus and doesn't already have a unit
        if (value.match(/^-?\d/)) {
          // Check if value already has a unit (ends with letters or %)
          const hasUnit = /[a-z%]$/i.test(value);
          return hasUnit ? `tracking-[${value}]` : `tracking-[${value}em]`;
        }
        return `tracking-${value}`;
      case 'textAlign':
        return `text-${value}`;
      case 'textTransform':
        if (value === 'none') return 'normal-case';
        return value; // uppercase, lowercase, capitalize
      case 'textDecoration':
        if (value === 'none') return 'no-underline';
        return value; // underline, line-through, overline
      case 'textDecorationColor': {
        if (value.match(/^#|^rgb|^hsl/)) {
          const parts = value.split('/');
          if (parts.length === 2) {
            return `decoration-[${parts[0]}]/${parts[1]}`;
          }
          return `decoration-[${value}]`;
        }
        return `decoration-${value}`;
      }
      case 'textDecorationThickness':
        return formatMeasurementClass(value, 'decoration');
      case 'underlineOffset':
        return formatMeasurementClass(value, 'underline-offset');
      case 'color':
        // Check if value is a gradient (linear-gradient or radial-gradient)
        if (value.includes('gradient(')) {
          // For gradients on text, we need bg-[gradient] + bg-clip-text + text-transparent
          // Note: This returns space-separated classes that will be split by the caller
          return `bg-[${value}] bg-clip-text text-transparent`;
        }
        if (value.match(/^#|^rgb/)) {
          // Handle opacity: split "#cc8d8d/59" into "text-[#cc8d8d]/59"
          const parts = value.split('/');
          if (parts.length === 2) {
            return `text-[${parts[0]}]/${parts[1]}`;
          }
          return `text-[${value}]`;
        }
        return `text-${value}`;
      case 'placeholderColor':
        if (value.match(/^#|^rgb/)) {
          const parts = value.split('/');
          if (parts.length === 2) {
            return `placeholder:text-[${parts[0]}]/${parts[1]}`;
          }
          return `placeholder:text-[${value}]`;
        }
        return `placeholder:text-${value}`;
    }
  }

  // Spacing conversions
  if (category === 'spacing') {
    const prefixMap: Record<string, string> = {
      padding: 'p',
      paddingTop: 'pt',
      paddingRight: 'pr',
      paddingBottom: 'pb',
      paddingLeft: 'pl',
      margin: 'm',
      marginTop: 'mt',
      marginRight: 'mr',
      marginBottom: 'mb',
      marginLeft: 'ml',
    };

    const prefix = prefixMap[property];
    if (prefix) {
      // Margin can be auto
      if (property.startsWith('margin')) {
        return formatMeasurementClass(value, prefix, ['auto']);
      }
      return formatMeasurementClass(value, prefix);
    }
  }

  // Sizing conversions
  if (category === 'sizing') {
    const prefixMap: Record<string, string> = {
      width: 'w',
      height: 'h',
      minWidth: 'min-w',
      minHeight: 'min-h',
      maxWidth: 'max-w',
      maxHeight: 'max-h',
    };

    const prefix = prefixMap[property];
    if (prefix) {
      // Special case: 100% → full
      if (value === '100%') return `${prefix}-full`;

      // Use abstracted helper with allowed named values
      return formatMeasurementClass(value, prefix, ['auto', 'full', 'screen', 'min', 'max', 'fit']);
    }

    // Overflow
    if (property === 'overflow') {
      return `overflow-${value}`; // overflow-visible, overflow-hidden, overflow-scroll, overflow-auto
    }

    // Aspect Ratio
    if (property === 'aspectRatio') {
      // Always stored in bracket format: [16/9], [1/1], etc.
      return `aspect-${value}`;
    }

    // Object Fit
    if (property === 'objectFit') {
      return `object-${value}`;
    }

    // Grid Column Span
    if (property === 'gridColumnSpan') {
      return value === 'full' ? 'col-span-full' : `col-span-${value}`;
    }

    // Grid Row Span
    if (property === 'gridRowSpan') {
      return value === 'full' ? 'row-span-full' : `row-span-${value}`;
    }
  }

  // Borders conversions
  if (category === 'borders') {
    switch (property) {
      case 'borderWidth':
        if (value === '1px') return 'border';
        return formatMeasurementClass(value, 'border');
      case 'borderTopWidth':
        if (value === '1px') return 'border-t';
        return formatMeasurementClass(value, 'border-t');
      case 'borderRightWidth':
        if (value === '1px') return 'border-r';
        return formatMeasurementClass(value, 'border-r');
      case 'borderBottomWidth':
        if (value === '1px') return 'border-b';
        return formatMeasurementClass(value, 'border-b');
      case 'borderLeftWidth':
        if (value === '1px') return 'border-l';
        return formatMeasurementClass(value, 'border-l');
      case 'borderStyle':
        return `border-${value}`;
      case 'borderColor':
        if (value.match(/^#|^rgb/)) {
          // Handle opacity: split "#cc8d8d/59" into "border-[#cc8d8d]/59"
          const parts = value.split('/');
          if (parts.length === 2) {
            return `border-[${parts[0]}]/${parts[1]}`;
          }
          return `border-[${value}]`;
        }
        return `border-${value}`;
      case 'borderRadius':
        return formatMeasurementClass(value, 'rounded');
      case 'borderTopLeftRadius':
        return formatMeasurementClass(value, 'rounded-tl');
      case 'borderTopRightRadius':
        return formatMeasurementClass(value, 'rounded-tr');
      case 'borderBottomRightRadius':
        return formatMeasurementClass(value, 'rounded-br');
      case 'borderBottomLeftRadius':
        return formatMeasurementClass(value, 'rounded-bl');
      case 'divideX':
        if (value === '1px') return 'divide-x';
        return formatMeasurementClass(value, 'divide-x');
      case 'divideY':
        if (value === '1px') return 'divide-y';
        return formatMeasurementClass(value, 'divide-y');
      case 'divideStyle':
        return `divide-${value}`;
      case 'divideColor':
        if (value.match(/^#|^rgb/)) {
          // Handle opacity: split "#cc8d8d/59" into "divide-[#cc8d8d]/59"
          const parts = value.split('/');
          if (parts.length === 2) {
            return `divide-[${parts[0]}]/${parts[1]}`;
          }
          return `divide-[${value}]`;
        }
        return `divide-${value}`;
    }
  }

  // Backgrounds conversions
  if (category === 'backgrounds') {
    switch (property) {
      case 'backgroundColor':
        // Gradients and hex/rgb colors need brackets for arbitrary values
        if (value.match(/^#|^rgb|gradient\(/)) {
          // Handle opacity: split "#cc8d8d/59" into "bg-[#cc8d8d]/59"
          const parts = value.split('/');
          if (parts.length === 2 && !value.includes('gradient(')) {
            return `bg-[${parts[0]}]/${parts[1]}`;
          }
          return `bg-[${value}]`;
        }
        return `bg-${value}`;
      case 'backgroundImage':
        if (value.startsWith('--bg-img')) return buildBgImgClass(value);
        if (value.startsWith('url(')) return `bg-[${value}]`;
        return `bg-${value}`;
      case 'backgroundSize':
        return `bg-${value}`;
      case 'backgroundPosition':
        return `bg-${value}`;
      case 'backgroundRepeat':
        if (value === 'no-repeat') return 'bg-no-repeat';
        return `bg-${value}`;
      case 'backgroundClip':
        return `bg-clip-${value}`;
    }
  }

  // Effects conversions
  if (category === 'effects') {
    switch (property) {
      case 'opacity': {
        // Convert 0-100 to 0-100 or decimal to percentage
        const opacityValue = value.includes('.')
          ? Math.round(parseFloat(value) * 100).toString()
          : value;
        return `opacity-[${opacityValue}%]`;
      }
      case 'boxShadow':
        if (value === 'none') return 'shadow-none';
        if (['sm', 'md', 'lg', 'xl', '2xl', 'inner'].includes(value)) {
          return `shadow-${value}`;
        }
        return `shadow-[${value}]`;
      case 'blur':
        if (value === 'none') return 'blur-none';
        if (['sm', 'md', 'lg', 'xl', '2xl', '3xl'].includes(value)) {
          return `blur-${value}`;
        }
        return `blur-[${value}]`;
      case 'backdropBlur':
        if (value === 'none') return 'backdrop-blur-none';
        if (['sm', 'md', 'lg', 'xl', '2xl', '3xl'].includes(value)) {
          return `backdrop-blur-${value}`;
        }
        return `backdrop-blur-[${value}]`;
    }
  }

  // Positioning conversions
  if (category === 'positioning') {
    switch (property) {
      case 'position':
        return value; // static, relative, absolute, fixed, sticky
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
        return formatMeasurementClass(value, property, ['auto']);
      case 'zIndex':
        if (value === 'auto') return 'z-auto';
        return value.match(/^\d/) ? `z-[${value}]` : `z-${value}`;
    }
  }

  return null;
}

/**
 * Convert design object to Tailwind classes array
 */
export function designToClasses(design?: Layer['design']): string[] {
  if (!design) return [];

  const classes: string[] = [];

  // Process each category
  Object.entries(design).forEach(([category, properties]) => {
    if (!properties || typeof properties !== 'object') return;

    Object.entries(properties).forEach(([property, value]) => {
      if (property === 'isActive' || !value) return;

      const cls = propertyToClass(
        category as keyof NonNullable<Layer['design']>,
        property,
        value as string
      );

      if (cls) {
        // Handle multiple space-separated classes (e.g., for text gradients)
        const clsList = cls.split(' ').filter(Boolean);
        classes.push(...clsList);
      }
    });
  });

  return classes;
}

/**
 * Convert design object to merged Tailwind class string
 * Uses cn() to ensure proper conflict resolution
 */
export function designToClassString(design?: Layer['design']): string {
  return cn(designToClasses(design));
}

/**
 * Detect which design properties a class affects
 * Returns an array of property names that should have conflicts removed
 * Smart handling for text-[...] to distinguish between fontSize and color
 * Smart handling for bg-[...] to distinguish between backgroundColor and backgroundImage
 */
export function getAffectedProperties(className: string): string[] {
  const properties: string[] = [];

  // Strip breakpoint and state prefixes for helper class detection
  const baseClass = className.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

  // bg-clip-* classes affect backgroundClip; bg-clip-text also participates in text gradients
  if (baseClass.startsWith('bg-clip-')) {
    properties.push('backgroundClip');
    if (baseClass === 'bg-clip-text') properties.push('color');
    return properties;
  }
  if (baseClass === 'text-transparent') {
    properties.push('color');
    return properties;
  }

  // Special handling for standard Tailwind color classes (e.g., text-blue-500, text-red-500)
  // These should ONLY affect color, not fontSize
  if (isStandardColorClass(baseClass)) {
    if (baseClass.startsWith('text-')) {
      properties.push('color');
      return properties;
    }
    if (baseClass.startsWith('bg-')) {
      properties.push('backgroundColor');
      return properties;
    }
    if (baseClass.startsWith('border-')) {
      properties.push('borderColor');
      return properties;
    }
  }

  // Special handling for text-[...] arbitrary values
  // Must distinguish between fontSize and color
  if (baseClass.startsWith('text-[')) {
    const value = extractArbitraryValue(baseClass);
    if (value) {
      const isColor = isColorValue(value);

      if (isColor) {
        // This is a color class, only affects color property
        properties.push('color');
        return properties;
      } else {
        // This is a fontSize class, only affects fontSize property
        properties.push('fontSize');
        return properties;
      }
    }
  }

  // Background-image CSS variable classes are always backgroundImage
  if (BG_IMG_VAR_RE.test(baseClass)) {
    properties.push('backgroundImage');
    return properties;
  }

  // Special handling for bg-[...] arbitrary values
  // Must distinguish between backgroundColor, backgroundImage, and text gradient
  if (baseClass.startsWith('bg-[')) {
    const value = extractArbitraryValue(baseClass);
    if (value) {
      const isImage = isImageValue(value);
      const isGradient = value.includes('gradient(');

      // Gradients in bg-[...] can be used for text color (with bg-clip-text)
      // or for background color. We'll treat them as backgroundColor by default
      // The context (presence of bg-clip-text) will determine actual usage
      if (isGradient) {
        // This could be text gradient or background gradient
        // For conflict resolution, we'll mark it as backgroundColor
        // The removeConflictingClasses function will handle text gradient case specially
        properties.push('backgroundColor');
        return properties;
      }

      if (isImage) {
        // This is an image class, only affects backgroundImage property
        properties.push('backgroundImage');
        return properties;
      } else {
        // This is a color class, only affects backgroundColor property
        properties.push('backgroundColor');
        return properties;
      }
    }
  }

  // For all other classes, check each property pattern
  for (const [property, pattern] of Object.entries(CLASS_PROPERTY_MAP)) {
    if (pattern.test(className)) {
      properties.push(property);
    }
  }

  return properties;
}

/**
 * Remove all classes that conflict with the new class being added
 */
export function removeConflictsForClass(
  existingClasses: string[],
  newClass: string
): string[] {
  const affectedProperties = getAffectedProperties(newClass);

  // Start with existing classes
  let result = existingClasses;

  // Remove conflicts for each affected property
  affectedProperties.forEach(property => {
    result = removeConflictingClasses(result, property);
  });

  // Additional check: if newClass is a standard color class (e.g., text-blue-500),
  // also remove arbitrary color values (e.g., text-[#000000])
  if (isStandardColorClass(newClass)) {
    affectedProperties.forEach(property => {
      result = result.filter(cls => !isArbitraryColorClass(cls, property));
    });
  }

  return result;
}

/**
 * Helper: Merge two design objects
 */
export function mergeDesign(existing: Layer['design'] | undefined, parsed: Layer['design'] | undefined): Layer['design'] {
  if (!parsed) return existing || {};

  const result: Layer['design'] = {
    layout: { ...(existing?.layout || {}), ...(parsed.layout || {}) },
    typography: { ...(existing?.typography || {}), ...(parsed.typography || {}) },
    spacing: { ...(existing?.spacing || {}), ...(parsed.spacing || {}) },
    sizing: { ...(existing?.sizing || {}), ...(parsed.sizing || {}) },
    borders: { ...(existing?.borders || {}), ...(parsed.borders || {}) },
    backgrounds: { ...(existing?.backgrounds || {}), ...(parsed.backgrounds || {}) },
    effects: { ...(existing?.effects || {}), ...(parsed.effects || {}) },
    positioning: { ...(existing?.positioning || {}), ...(parsed.positioning || {}) },
  };
  return result;
}

/**
 * Parse Tailwind classes back to design object
 * Comprehensive parser for all design properties
 */
export function classesToDesign(classes: string | string[]): Layer['design'] {
  const classList = Array.isArray(classes) ? classes : classes.split(' ').filter(Boolean);

  const design: Layer['design'] = {
    layout: {},
    typography: {},
    spacing: {},
    sizing: {},
    borders: {},
    backgrounds: {},
    effects: {},
    positioning: {},
  };

  // Check if this is a text gradient (bg-[gradient] + bg-clip-text)
  const hasBgClipText = classList.includes('bg-clip-text');
  const hasTextTransparent = classList.includes('text-transparent');
  const gradientBgClass = classList.find(cls =>
    cls.startsWith('bg-[') && extractArbitraryValue(cls)?.includes('gradient(')
  );

  // If we have all the gradient text indicators, extract the gradient and store as text color
  if (hasBgClipText && hasTextTransparent && gradientBgClass) {
    const gradientValue = extractArbitraryValue(gradientBgClass);
    if (gradientValue) {
      design.typography!.color = gradientValue;
    }
  }

  classList.forEach(cls => {
    // CRITICAL FIX: Skip state-specific classes (they should not be in design object)
    // The design object should only contain base/neutral values
    // State-specific values are handled by getInheritedValue based on activeUIState
    if (cls.match(/^(hover|focus|active|disabled|visited):/)) {
      return; // Skip this class
    }

    // Also skip breakpoint+state combinations
    if (cls.match(/^(max-lg|max-md|lg|md):(hover|focus|active|disabled|visited):/)) {
      return; // Skip this class
    }

    // Strip breakpoint prefix (but keep base classes)
    // "max-md:m-[10px]" should still be parsed into design object
    // But "max-md:hover:m-[10px]" should have been skipped above
    cls = cls.replace(/^(max-lg|max-md|lg|md):/, '');

    // ===== LAYOUT =====
    // Display
    if (cls === 'block') design.layout!.display = 'block';
    if (cls === 'inline-block') design.layout!.display = 'inline-block';
    if (cls === 'inline') design.layout!.display = 'inline';
    if (cls === 'flex') design.layout!.display = 'flex';
    if (cls === 'inline-flex') design.layout!.display = 'inline-flex';
    if (cls === 'grid') design.layout!.display = 'grid';
    if (cls === 'inline-grid') design.layout!.display = 'inline-grid';
    if (cls === 'hidden') design.layout!.display = 'hidden';

    // Flex Direction
    if (cls === 'flex-row') design.layout!.flexDirection = 'row';
    if (cls === 'flex-row-reverse') design.layout!.flexDirection = 'row-reverse';
    if (cls === 'flex-col') design.layout!.flexDirection = 'column';
    if (cls === 'flex-col-reverse') design.layout!.flexDirection = 'column-reverse';

    // Justify Content
    if (cls.startsWith('justify-')) {
      const value = cls.replace('justify-', '');
      if (['start', 'end', 'center', 'between', 'around', 'evenly', 'stretch'].includes(value)) {
        design.layout!.justifyContent = value;
      }
    }

    // Align Items
    if (cls.startsWith('items-')) {
      const value = cls.replace('items-', '');
      if (['start', 'end', 'center', 'baseline', 'stretch'].includes(value)) {
        design.layout!.alignItems = value;
      }
    }

    // Gap
    if (cls.startsWith('gap-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.layout!.gap = value;
    }

    // Grid
    if (cls.startsWith('grid-cols-[')) {
      const value = extractArbitraryValue(cls);
      // Convert underscores back to spaces (Tailwind arbitrary value syntax)
      if (value) design.layout!.gridTemplateColumns = value.replace(/_/g, ' ');
    }
    if (cls.startsWith('grid-rows-[')) {
      const value = extractArbitraryValue(cls);
      // Convert underscores back to spaces (Tailwind arbitrary value syntax)
      if (value) design.layout!.gridTemplateRows = value.replace(/_/g, ' ');
    }

    // ===== TYPOGRAPHY =====
    // Color - Check FIRST before fontSize to avoid confusion
    if (cls.startsWith('text-[')) {
      const value = extractArbitraryValueWithOpacity(cls);
      if (value && isColorValue(value.split('/')[0])) {
        design.typography!.color = value;
        return; // Skip further checks for this class
      }
    }

    // Font Size - Only if not a color
    if (cls.startsWith('text-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.typography!.fontSize = value;
    }

    // Font Weight (arbitrary values)
    if (cls.startsWith('font-[') && !cls.includes('sans') && !cls.includes('serif') && !cls.includes('mono')) {
      const value = extractArbitraryValue(cls);
      if (value) design.typography!.fontWeight = value;
    }
    // Font Weight (named values)
    if (cls === 'font-thin') design.typography!.fontWeight = '100';
    if (cls === 'font-extralight') design.typography!.fontWeight = '200';
    if (cls === 'font-light') design.typography!.fontWeight = '300';
    if (cls === 'font-normal') design.typography!.fontWeight = '400';
    if (cls === 'font-medium') design.typography!.fontWeight = '500';
    if (cls === 'font-semibold') design.typography!.fontWeight = '600';
    if (cls === 'font-bold') design.typography!.fontWeight = '700';
    if (cls === 'font-extrabold') design.typography!.fontWeight = '800';
    if (cls === 'font-black') design.typography!.fontWeight = '900';

    // Font Family (arbitrary values - Google/custom fonts with underscores as space replacements)
    if (cls.startsWith('font-[') && !cls.match(/^font-\[\d/)) {
      const value = extractArbitraryValue(cls);
      if (value) {
        // Convert underscores back to spaces for font family names
        design.typography!.fontFamily = value.replace(/_/g, ' ');
      }
    }
    // Font Family (named values)
    if (cls === 'font-sans') design.typography!.fontFamily = 'sans';
    if (cls === 'font-serif') design.typography!.fontFamily = 'serif';
    if (cls === 'font-mono') design.typography!.fontFamily = 'mono';

    // Text Align
    if (cls === 'text-left') design.typography!.textAlign = 'left';
    if (cls === 'text-center') design.typography!.textAlign = 'center';
    if (cls === 'text-right') design.typography!.textAlign = 'right';
    if (cls === 'text-justify') design.typography!.textAlign = 'justify';

    // Text Transform
    if (cls === 'uppercase') design.typography!.textTransform = 'uppercase';
    if (cls === 'lowercase') design.typography!.textTransform = 'lowercase';
    if (cls === 'capitalize') design.typography!.textTransform = 'capitalize';
    if (cls === 'normal-case') design.typography!.textTransform = 'none';

    // Text Decoration
    if (cls === 'underline') design.typography!.textDecoration = 'underline';
    if (cls === 'line-through') design.typography!.textDecoration = 'line-through';
    if (cls === 'no-underline') design.typography!.textDecoration = 'none';

    // Text Decoration Color (decoration-[#color] or decoration-[rgb(...)])
    if (cls.startsWith('decoration-[')) {
      const value = extractArbitraryValueWithOpacity(cls);
      if (value && isColorValue(value.split('/')[0])) {
        design.typography!.textDecorationColor = value;
      }
    }

    // Text Decoration Thickness (decoration-[size] where value is not a color)
    if (cls.startsWith('decoration-[')) {
      const value = extractArbitraryValue(cls);
      if (value && !isColorValue(value)) {
        design.typography!.textDecorationThickness = value;
      }
    }

    // Underline Offset
    if (cls.startsWith('underline-offset-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.typography!.underlineOffset = value;
    }

    // Line Height
    if (cls.startsWith('leading-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.typography!.lineHeight = value;
    }

    // Letter Spacing
    if (cls.startsWith('tracking-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.typography!.letterSpacing = value;
    }

    // Placeholder Color
    if (cls.startsWith('placeholder:text-[')) {
      const value = extractArbitraryValueWithOpacity(cls);
      if (value) design.typography!.placeholderColor = value;
    }

    // ===== SPACING =====
    // Padding
    if (cls.startsWith('p-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.padding = value;
    } else if (cls.startsWith('pt-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.paddingTop = value;
    } else if (cls.startsWith('pr-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.paddingRight = value;
    } else if (cls.startsWith('pb-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.paddingBottom = value;
    } else if (cls.startsWith('pl-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.paddingLeft = value;
    }

    // Margin
    if (cls.startsWith('m-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.margin = value;
    } else if (cls.startsWith('mt-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.marginTop = value;
    } else if (cls.startsWith('mr-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.marginRight = value;
    } else if (cls.startsWith('mb-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.marginBottom = value;
    } else if (cls.startsWith('ml-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.spacing!.marginLeft = value;
    }

    // ===== SIZING =====
    // Width
    if (cls.startsWith('w-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.sizing!.width = value;
    }

    // Height
    if (cls.startsWith('h-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.sizing!.height = value;
    }

    // Min Width
    if (cls.startsWith('min-w-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.sizing!.minWidth = value;
    }

    // Min Height
    if (cls.startsWith('min-h-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.sizing!.minHeight = value;
    }

    // Max Width
    if (cls.startsWith('max-w-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.sizing!.maxWidth = value;
    }

    // Max Height
    if (cls.startsWith('max-h-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.sizing!.maxHeight = value;
    }

    // Aspect Ratio
    if (cls.startsWith('aspect-')) {
      // Arbitrary values: aspect-[16/9]
      if (cls.startsWith('aspect-[')) {
        const value = extractArbitraryValue(cls);
        if (value) design.sizing!.aspectRatio = `[${value}]`;
      }
      // Named values: convert to bracket format for consistency
      else if (cls === 'aspect-square') {
        design.sizing!.aspectRatio = '[1/1]';
      } else if (cls === 'aspect-video') {
        design.sizing!.aspectRatio = '[16/9]';
      } else if (cls === 'aspect-auto') {
        design.sizing!.aspectRatio = null;
      }
    }

    // Object Fit
    if (cls.startsWith('object-')) {
      const match = cls.match(/^object-(contain|cover|fill|none|scale-down)$/);
      if (match) {
        design.sizing!.objectFit = match[1];
      }
    }

    // Grid Column Span
    if (cls.startsWith('col-span-')) {
      const match = cls.match(/^col-span-(1|2|3|4|5|6|7|8|9|10|11|12|auto|full)$/);
      if (match) {
        design.sizing!.gridColumnSpan = match[1];
      }
    }

    // Grid Row Span
    if (cls.startsWith('row-span-')) {
      const match = cls.match(/^row-span-(1|2|3|4|5|6|7|8|9|10|11|12|auto|full)$/);
      if (match) {
        design.sizing!.gridRowSpan = match[1];
      }
    }

    // ===== BORDERS =====
    // Border Radius (all)
    if (cls.startsWith('rounded-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.borderRadius = value;
    }
    // Border Radius (individual corners)
    else if (cls.startsWith('rounded-tl-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.borderTopLeftRadius = value;
    } else if (cls.startsWith('rounded-tr-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.borderTopRightRadius = value;
    } else if (cls.startsWith('rounded-br-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.borderBottomRightRadius = value;
    } else if (cls.startsWith('rounded-bl-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.borderBottomLeftRadius = value;
    }

    // Border Width (all)
    if (cls.startsWith('border-[') && !cls.includes('#') && !cls.includes('rgb')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.borderWidth = value;
    }

    // Border Style
    if (cls === 'border-solid') design.borders!.borderStyle = 'solid';
    if (cls === 'border-dashed') design.borders!.borderStyle = 'dashed';
    if (cls === 'border-dotted') design.borders!.borderStyle = 'dotted';
    if (cls === 'border-double') design.borders!.borderStyle = 'double';
    if (cls === 'border-none') design.borders!.borderStyle = 'none';

    // Border Color
    if (cls.startsWith('border-[#') || cls.startsWith('border-[rgb')) {
      const value = extractArbitraryValueWithOpacity(cls);
      if (value) design.borders!.borderColor = value;
    }

    // Divide X (horizontal dividers)
    if (cls.startsWith('divide-x-[') && !cls.includes('#') && !cls.includes('rgb')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.divideX = value;
    } else if (cls === 'divide-x') {
      design.borders!.divideX = '1px';
    }

    // Divide Y (vertical dividers)
    if (cls.startsWith('divide-y-[') && !cls.includes('#') && !cls.includes('rgb')) {
      const value = extractArbitraryValue(cls);
      if (value) design.borders!.divideY = value;
    } else if (cls === 'divide-y') {
      design.borders!.divideY = '1px';
    }

    // Divide Style
    if (cls === 'divide-solid') design.borders!.divideStyle = 'solid';
    if (cls === 'divide-dashed') design.borders!.divideStyle = 'dashed';
    if (cls === 'divide-dotted') design.borders!.divideStyle = 'dotted';
    if (cls === 'divide-double') design.borders!.divideStyle = 'double';
    if (cls === 'divide-none') design.borders!.divideStyle = 'none';

    // Divide Color
    if (cls.startsWith('divide-[#') || cls.startsWith('divide-[rgb')) {
      const value = extractArbitraryValueWithOpacity(cls);
      if (value) design.borders!.divideColor = value;
    }

    // ===== BACKGROUNDS =====
    // Background Color
    if (cls.startsWith('bg-[#') || cls.startsWith('bg-[rgb')) {
      const value = extractArbitraryValueWithOpacity(cls);
      if (value) design.backgrounds!.backgroundColor = value;
    }
    // Background Gradient (but skip if it's a text gradient)
    if (cls.startsWith('bg-[') && !hasBgClipText) {
      const value = extractArbitraryValue(cls);
      if (value && value.includes('gradient(')) {
        design.backgrounds!.backgroundColor = value;
      }
    }
    // Background Image via CSS variable class
    if (BG_IMG_VAR_RE.test(cls)) {
      const varName = extractBgImgVarName(cls);
      if (varName) design.backgrounds!.backgroundImage = varName;
    }
    // Background Clip (skip when it's part of a text gradient — that's managed by typography.color)
    if (cls.startsWith('bg-clip-') && !(hasBgClipText && hasTextTransparent && gradientBgClass)) {
      const value = cls.replace('bg-clip-', '');
      design.backgrounds!.backgroundClip = value;
    }

    // ===== EFFECTS =====
    // Opacity
    if (cls.startsWith('opacity-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.effects!.opacity = value;
    }

    // Box Shadow
    if (cls.startsWith('shadow-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.effects!.boxShadow = value;
    }

    // Blur
    if (cls.startsWith('blur-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.effects!.blur = value;
    } else if (cls === 'blur-none') {
      design.effects!.blur = 'none';
    } else if (cls.match(/^blur-(sm|md|lg|xl|2xl|3xl)$/)) {
      const match = cls.match(/^blur-(.+)$/);
      if (match) design.effects!.blur = match[1];
    }

    // Backdrop Blur
    if (cls.startsWith('backdrop-blur-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.effects!.backdropBlur = value;
    } else if (cls === 'backdrop-blur-none') {
      design.effects!.backdropBlur = 'none';
    } else if (cls.match(/^backdrop-blur-(sm|md|lg|xl|2xl|3xl)$/)) {
      const match = cls.match(/^backdrop-blur-(.+)$/);
      if (match) design.effects!.backdropBlur = match[1];
    }

    // ===== POSITIONING =====
    // Position
    if (cls === 'static') design.positioning!.position = 'static';
    if (cls === 'relative') design.positioning!.position = 'relative';
    if (cls === 'absolute') design.positioning!.position = 'absolute';
    if (cls === 'fixed') design.positioning!.position = 'fixed';
    if (cls === 'sticky') design.positioning!.position = 'sticky';

    // Top/Right/Bottom/Left
    if (cls.startsWith('top-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.positioning!.top = value;
    }
    if (cls.startsWith('right-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.positioning!.right = value;
    }
    if (cls.startsWith('bottom-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.positioning!.bottom = value;
    }
    if (cls.startsWith('left-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.positioning!.left = value;
    }

    // Z-Index
    if (cls.startsWith('z-[')) {
      const value = extractArbitraryValue(cls);
      if (value) design.positioning!.zIndex = value;
    }
  });

  return design;
}

/**
 * UI State Configuration (for hover, focus, active, etc.)
 */
export const UI_STATE_CONFIG = {
  neutral: { prefix: '' },
  hover: { prefix: 'hover:' },
  focus: { prefix: 'focus:' },
  active: { prefix: 'active:' },
  disabled: { prefix: 'disabled:' },
  current: { prefix: 'visited:' }, // Tailwind uses 'visited' for current/visited state
} as const;

/**
 * Get UI state prefix for Tailwind classes
 */
export function getUIStatePrefix(state: UIState): string {
  return UI_STATE_CONFIG[state].prefix;
}

/**
 * Parse a full class name to extract breakpoint, UI state, and base class
 * Tailwind order: responsive prefix first, then state modifier
 * e.g., "max-md:hover:text-red-500" -> { breakpoint: 'mobile', uiState: 'hover', baseClass: 'text-red-500' }
 */
export function parseFullClass(className: string): {
  breakpoint: Breakpoint;
  uiState: UIState;
  baseClass: string;
} {
  let remaining = className;
  let breakpoint: Breakpoint = 'desktop';
  let uiState: UIState = 'neutral';

  // Check for responsive prefix first (Tailwind order: responsive then state)
  if (remaining.startsWith('max-md:')) {
    breakpoint = 'mobile';
    remaining = remaining.slice(7);
  } else if (remaining.startsWith('max-lg:')) {
    breakpoint = 'tablet';
    remaining = remaining.slice(7);
  } else if (remaining.startsWith('lg:')) {
    breakpoint = 'desktop';
    remaining = remaining.slice(3);
  } else if (remaining.startsWith('md:')) {
    breakpoint = 'tablet';
    remaining = remaining.slice(3);
  }

  // Check for state prefix
  if (remaining.startsWith('hover:')) {
    uiState = 'hover';
    remaining = remaining.slice(6);
  } else if (remaining.startsWith('focus:')) {
    uiState = 'focus';
    remaining = remaining.slice(6);
  } else if (remaining.startsWith('active:')) {
    uiState = 'active';
    remaining = remaining.slice(7);
  } else if (remaining.startsWith('disabled:')) {
    uiState = 'disabled';
    remaining = remaining.slice(9);
  } else if (remaining.startsWith('visited:')) {
    uiState = 'current';
    remaining = remaining.slice(8);
  }

  return { breakpoint, uiState, baseClass: remaining };
}

/**
 * Parse breakpoint from class name (Desktop-First)
 * "max-lg:w-[100px]" → { breakpoint: 'tablet', baseClass: 'w-[100px]' }
 * "max-md:w-[100px]" → { breakpoint: 'mobile', baseClass: 'w-[100px]' }
 * "w-[100px]" → { breakpoint: 'desktop', baseClass: 'w-[100px]' }
 */
export function parseBreakpointClass(className: string): {
  breakpoint: Breakpoint;
  baseClass: string;
} {
  if (className.startsWith('max-md:')) {
    return { breakpoint: 'mobile', baseClass: className.slice(7) };
  }
  if (className.startsWith('max-lg:')) {
    return { breakpoint: 'tablet', baseClass: className.slice(7) };
  }
  // Support legacy mobile-first classes for backward compatibility
  if (className.startsWith('lg:')) {
    return { breakpoint: 'desktop', baseClass: className.slice(3) };
  }
  if (className.startsWith('md:')) {
    return { breakpoint: 'tablet', baseClass: className.slice(3) };
  }
  return { breakpoint: 'desktop', baseClass: className };
}

/**
 * Add breakpoint prefix to a class (Desktop-First)
 * ('desktop', 'w-[100px]') → 'w-[100px]' (no prefix)
 * ('tablet', 'w-[100px]') → 'max-lg:w-[100px]'
 * ('mobile', 'w-[100px]') → 'max-md:w-[100px]'
 */
export function addBreakpointPrefix(breakpoint: Breakpoint, className: string): string {
  const prefix = getBreakpointPrefix(breakpoint);
  return prefix ? `${prefix}${className}` : className;
}

/**
 * Get all classes for a specific breakpoint from a classes array (Desktop-First)
 * Returns base classes without the breakpoint prefix
 */
export function getBreakpointClasses(classes: string[], breakpoint: Breakpoint): string[] {
  const prefix = getBreakpointPrefix(breakpoint);

  return classes
    .filter(cls => {
      if (prefix) {
        // For tablet (max-lg:) or mobile (max-md:), match their specific prefix
        return cls.startsWith(prefix);
      } else {
        // For desktop (no prefix), return classes without max-lg: or max-md: prefix
        // Also exclude legacy mobile-first prefixes (md:, lg:)
        return !cls.startsWith('max-lg:') && !cls.startsWith('max-md:') &&
               !cls.startsWith('md:') && !cls.startsWith('lg:');
      }
    })
    .map(cls => (prefix ? cls.slice(prefix.length) : cls));
}

/**
 * Helper: Check if a value is likely a background image (URL or gradient)
 */
function isImageValue(value: string): boolean {
  // Check for URLs
  if (value.startsWith('url(') || value.includes('http://') || value.includes('https://') || value.includes('data:')) {
    return true;
  }

  // Check for gradients
  if (value.includes('gradient(') || value.includes('linear-gradient') || value.includes('radial-gradient') || value.includes('conic-gradient')) {
    return true;
  }

  // If it's a color, it's not an image
  if (isColorValue(value)) {
    return false;
  }

  // Default: if we can't determine, treat as color (safer default for bg-[...])
  return false;
}

/**
 * Helper: Check if a class should be included when looking for a specific property
 * Smart filtering for text-[...] to distinguish between fontSize and color
 * Smart filtering for bg-[...] to distinguish between backgroundColor and backgroundImage
 */
function shouldIncludeClassForProperty(className: string, property: string, pattern: RegExp): boolean {
  // Strip breakpoint and state prefixes for helper class detection
  const baseClass = className.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

  // Special handling for text color property
  // Include gradient-related classes (bg-[gradient], text-transparent) but NOT bg-clip-text
  // bg-clip-text is a helper/modifier, not an actual color value
  if (property === 'color') {
    // Include bg-[gradient] for text gradient
    if (baseClass.startsWith('bg-[')) {
      const value = extractArbitraryValue(baseClass);
      if (value && value.includes('gradient(')) {
        return true; // This is a text gradient
      }
    }
    // Exclude bg-clip-text — it's managed by the backgrounds "Clip text" toggle
    if (baseClass === 'bg-clip-text') {
      return false;
    }
    // Include text-transparent (part of text gradient)
    if (baseClass === 'text-transparent') {
      return true;
    }
  }

  // Special handling for fontSize property
  // NEVER remove text-transparent or bg-clip-text (they're part of text gradient, not a font size)
  if (property === 'fontSize') {
    if (baseClass === 'text-transparent' || baseClass === 'bg-clip-text') {
      return false; // Don't consider this a fontSize conflict, keep it
    }
    // Also keep gradient backgrounds when changing fontSize
    if (baseClass.startsWith('bg-[')) {
      const value = extractArbitraryValue(baseClass);
      if (value && value.includes('gradient(')) {
        return false; // Keep text gradient background
      }
    }
  }

  // First check if pattern matches (use baseClass)
  if (!pattern.test(baseClass)) return false;

  // Smart filtering for font-[...] arbitrary values (fontWeight vs fontFamily)
  // font-[700] is a weight (starts with digit), font-[Inter] is a family
  if (baseClass.startsWith('font-[')) {
    const value = extractArbitraryValue(baseClass);
    if (value) {
      const isNumeric = /^\d/.test(value);
      if (property === 'fontWeight' && !isNumeric) return false;
      if (property === 'fontFamily' && isNumeric) return false;
    }
  }

  // Special handling for text-[...] arbitrary values (fontSize vs color)
  if (baseClass.startsWith('text-[')) {
    const value = extractArbitraryValue(baseClass);
    if (value) {
      const isColor = isColorValue(value);

      // If looking for fontSize, exclude color values
      if (property === 'fontSize' && isColor) {
        return false;
      }

      // If looking for color, exclude size values
      if (property === 'color' && !isColor) {
        return false;
      }
    }
  }

  // Background-image CSS variable classes are always backgroundImage
  if (BG_IMG_VAR_RE.test(baseClass)) {
    if (property === 'backgroundImage') return true;
    return false;
  }

  // Special handling for bg-[...] arbitrary values (backgroundColor vs backgroundImage)
  if (baseClass.startsWith('bg-[')) {
    const value = extractArbitraryValue(baseClass);
    if (value) {
      const isImage = isImageValue(value);
      const isGradient = value.includes('gradient(') || value.includes('linear-gradient') || value.includes('radial-gradient') || value.includes('conic-gradient');

      // When looking for text color, gradients in bg-[...] are text gradients
      if (property === 'color' && isGradient) {
        return true; // Include gradient for text color
      }

      // Gradients should be treated as backgroundColor, not backgroundImage
      // If looking for backgroundColor, exclude only URL-based images (keep gradients)
      // But exclude gradients that are being used as text gradients (handled above)
      if (property === 'backgroundColor') {
        // Exclude URL images, but include gradients and colors
        if (isImage && !isGradient) {
          return false;
        }
        return true; // Include gradients and colors for backgroundColor
      }

      // If looking for backgroundImage, exclude color values and gradients
      if (property === 'backgroundImage') {
        // Only include URL-based images, not gradients or colors
        if (isGradient || !isImage) {
          return false;
        }
        return true;
      }

      // CRITICAL: Preserve backgroundImage when updating other background properties
      // backgroundSize, backgroundPosition, backgroundRepeat should NOT remove backgroundImage
      if (property === 'backgroundSize' || property === 'backgroundPosition' || property === 'backgroundRepeat') {
        if (isImage) {
          return false; // Don't remove image classes when updating size/position/repeat
        }
      }
    }
  }

  return true;
}

/**
 * Get inherited value for a property across breakpoints
 * Desktop-first cascade: desktop → tablet → mobile
 */
export function getInheritedValue(
  classes: string[],
  property: string,
  currentBreakpoint: Breakpoint,
  currentUIState: UIState = 'neutral'
): { value: string | null; source: Breakpoint | null } {
  const pattern = getConflictingClassPattern(property);
  if (!pattern) return { value: null, source: null };

  // Define inheritance chain based on current breakpoint (desktop-first)
  const inheritanceChain: Breakpoint[] =
    currentBreakpoint === 'mobile' ? ['desktop', 'tablet', 'mobile'] :
      currentBreakpoint === 'tablet' ? ['desktop', 'tablet'] :
        ['desktop'];

  // Check each breakpoint in order (desktop → tablet → mobile)
  let lastValue: string | null = null;
  let lastSource: Breakpoint | null = null;

  for (const breakpoint of inheritanceChain) {
    const bpPrefix = getBreakpointPrefix(breakpoint);
    const statePrefix = getUIStatePrefix(currentUIState);

    // If we're in a specific state (not neutral), check for state-specific class at this breakpoint
    if (currentUIState !== 'neutral') {
      const fullPrefix = bpPrefix + statePrefix;
      const stateClass = classes.find(cls => {
        const withPrefix = bpPrefix ? cls.startsWith(fullPrefix) : cls.startsWith(statePrefix);
        if (!withPrefix) return false;
        const baseClass = cls.slice(fullPrefix.length);
        // Smart filtering for text-[...] classes
        return shouldIncludeClassForProperty(baseClass, property, pattern);
      });

      if (stateClass) {
        lastValue = stateClass.slice(fullPrefix.length);
        lastSource = breakpoint;
        // Don't break - keep checking for more specific breakpoints
      }
    }

    // Check for neutral state class at this breakpoint (always check this)
    const neutralClass = classes.find(cls => {
      if (bpPrefix) {
        if (!cls.startsWith(bpPrefix)) return false;
        const afterBp = cls.slice(bpPrefix.length);
        // Must not have a state prefix
        if (afterBp.match(/^(hover|focus|active|disabled|visited):/)) return false;
        // Smart filtering for text-[...] classes
        return shouldIncludeClassForProperty(afterBp, property, pattern);
      } else {
        // Desktop: no breakpoint prefix, no state prefix
        if (cls.match(/^(max-lg|max-md|hover|focus|active|disabled|visited):/)) return false;
        // Smart filtering for text-[...] classes
        return shouldIncludeClassForProperty(cls, property, pattern);
      }
    });

    if (neutralClass) {
      const baseClass = bpPrefix ? neutralClass.slice(bpPrefix.length) : neutralClass;

      // CRITICAL FIX: If we're in neutral state, ONLY use neutral classes
      // If we're in a specific state, only use neutral as fallback if no state-specific value found
      if (currentUIState === 'neutral') {
        // In neutral: always update with neutral value (override any state values that shouldn't be here)
        lastValue = baseClass;
        lastSource = breakpoint;
      } else {
        // In specific state: only use neutral as fallback if no state-specific value exists yet
        if (!lastValue) {
          lastValue = baseClass;
          lastSource = breakpoint;
        }
      }
    }
  }

  return { value: lastValue, source: lastSource };
}

/**
 * Remove conflicting classes for a specific breakpoint
 * Uses smart filtering for text-[...] to distinguish between fontSize and color
 */
export function removeConflictingClassesForBreakpoint(
  classes: string[],
  property: string,
  breakpoint: Breakpoint
): string[] {
  const pattern = getConflictingClassPattern(property);
  if (!pattern) return classes;

  const prefix = getBreakpointPrefix(breakpoint);

  return classes.filter(cls => {
    const parsed = parseBreakpointClass(cls);

    // Only remove if:
    // 1. It's from the same breakpoint
    // 2. It matches the property pattern AND passes smart filtering
    if (parsed.breakpoint === breakpoint) {
      // Use smart filtering to distinguish text-[size] from text-[color]
      return !shouldIncludeClassForProperty(parsed.baseClass, property, pattern);
    }

    return true; // Keep classes from other breakpoints
  });
}

/**
 * Add or update a class for a specific breakpoint
 * Handles conflict resolution automatically with smart filtering
 */
export function setBreakpointClass(
  classes: string[],
  property: string,
  newClass: string | null,
  breakpoint: Breakpoint,
  uiState: UIState = 'neutral'
): string[] {
  const pattern = getConflictingClassPattern(property);
  if (!pattern) return classes;

  const bpPrefix = getBreakpointPrefix(breakpoint);
  const statePrefix = getUIStatePrefix(uiState);
  const fullPrefix = bpPrefix + statePrefix;

  // Remove existing class for this property + breakpoint + state
  // Use smart filtering to preserve text-[color] when adding text-[size] and vice versa
  let newClasses = classes.filter(cls => {
    const parsed = parseFullClass(cls);
    if (parsed.breakpoint !== breakpoint || parsed.uiState !== uiState) return true;
    // Use smart filtering instead of plain pattern test
    return !shouldIncludeClassForProperty(parsed.baseClass, property, pattern);
  });

  // When setting a solid color (not gradient, not transparent), also remove bg-clip-text
  if (property === 'color' && newClass) {
    const baseNew = newClass.split(' ')[0];
    const isGradient = newClass.includes('bg-clip-text');
    const isTransparent = baseNew === 'text-transparent';
    if (!isGradient && !isTransparent) {
      newClasses = newClasses.filter(cls => {
        const parsed = parseFullClass(cls);
        if (parsed.breakpoint !== breakpoint || parsed.uiState !== uiState) return true;
        return parsed.baseClass !== 'bg-clip-text';
      });
    }
  }

  // Add new class if value is provided
  if (newClass) {
    // Handle multiple space-separated classes (e.g., for text gradients)
    // Each class needs to get the prefix individually
    const classesToAdd = newClass.split(' ').filter(Boolean);
    classesToAdd.forEach(cls => {
      newClasses.push(fullPrefix + cls);
    });
  }

  return newClasses;
}

/**
 * Get classes from layer style that correspond to properties explicitly removed on the layer
 * Returns the style classes that should be shown as line-through
 */
export function getRemovedPropertyClasses(
  layerDesign: Layer['design'] | undefined,
  styleDesign: Layer['design'] | undefined,
  styleClasses: string[]
): string[] {
  if (!styleDesign || !styleClasses.length) return [];

  const removedClasses: string[] = [];
  const layerDesignObj = layerDesign || {};

  // Check each category in style design
  const categories = [
    'layout', 'typography', 'spacing', 'sizing',
    'borders', 'backgrounds', 'effects', 'positioning'
  ] as const;

  for (const category of categories) {
    const styleCategory = styleDesign[category];
    const layerCategory = layerDesignObj[category];

    if (!styleCategory) continue;

    // Check each property in the style category
    for (const [property, styleValue] of Object.entries(styleCategory)) {
      // Skip if style property is empty/null
      if (styleValue === null || styleValue === undefined || styleValue === '') continue;

      // Check if layer has explicitly removed this property
      // A property is considered removed if:
      // 1. Style has the property with a value
      // 2. Layer either:
      //    a) Doesn't have this category at all (inheriting everything from style)
      //    b) Has the category but the property is missing (removed)
      //    c) Has the property set to null or empty string (explicitly cleared)

      // If layer doesn't have this category, it's inheriting from style (not removed)
      if (!layerCategory) continue;

      const layerValue = layerCategory[property as keyof typeof layerCategory];
      const hasProperty = property in layerCategory;

      // Property is removed if it's either:
      // 1. Present with null/empty value (explicit removal)
      // 2. NOT present in layer category while other properties are (selective removal)
      const isExplicitlyRemoved = hasProperty ? (
        layerValue === null ||
        (typeof layerValue === 'string' && layerValue === '')
      ) : (
        // Property not present in layer, but layer has the category with other properties
        // This means this specific property was removed
        Object.keys(layerCategory).length > 0
      );

      if (isExplicitlyRemoved) {
        // Find which style classes correspond to this property
        const propertyPattern = getConflictingClassPattern(property);
        if (propertyPattern) {
          // Find all style classes that match this property pattern
          for (const styleClass of styleClasses) {
            // Strip prefixes for pattern matching
            const baseClass = styleClass.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

            // Special handling for text-[...] classes
            if (baseClass.startsWith('text-[')) {
              const value = baseClass.match(/\[([^\]]+)\]/)?.[1];
              if (value) {
                const isColor = /^#?[0-9A-Fa-f]{3,8}$/.test(value) ||
                               /^rgba?\s*\(/i.test(value) ||
                               /^hsla?\s*\(/i.test(value);

                // Match text color with color property
                if (property === 'color' && isColor && !removedClasses.includes(styleClass)) {
                  removedClasses.push(styleClass);
                }
                // Match text size with fontSize property
                else if (property === 'fontSize' && !isColor && !removedClasses.includes(styleClass)) {
                  removedClasses.push(styleClass);
                }
              }
            }
            // Standard pattern matching
            else if (propertyPattern.test(baseClass) && !removedClasses.includes(styleClass)) {
              removedClasses.push(styleClass);
            }
          }
        }
      }
    }
  }

  return removedClasses;
}
