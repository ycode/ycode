export interface TextShadow {
  x: number | string;
  y: number | string;
  blur: number | string;
  color: string;
}

export const DEFAULT_TEXT_SHADOW: TextShadow = {
  x: 0,
  y: 1,
  blur: 2,
  color: 'rgba(0,0,0,0.4)',
};

const NAMED_TEXT_SHADOWS: Record<string, TextShadow> = {
  '2xs': { x: 0, y: 1, blur: 0, color: 'rgba(0,0,0,0.15)' },
  xs: { x: 0, y: 1, blur: 1, color: 'rgba(0,0,0,0.2)' },
  sm: { x: 0, y: 1, blur: 2, color: 'rgba(0,0,0,0.15)' },
  md: { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.15)' },
  lg: { x: 0, y: 4, blur: 8, color: 'rgba(0,0,0,0.15)' },
};

export function formatShadowLength(value: number | string): string {
  return typeof value === 'number' || /^-?\d*\.?\d+$/.test(value) ? `${value}px` : value;
}

export function parseShadowLength(value: string): number | string {
  return /^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value) ? parseFloat(value) : value;
}

export function serializeTextShadow(shadow: TextShadow): string {
  const color = shadow.color.startsWith('color:var(')
    ? shadow.color.replace('color:', '')
    : shadow.color;
  return `${formatShadowLength(shadow.x)}_${formatShadowLength(shadow.y)}_${formatShadowLength(shadow.blur)}_${color}`;
}

export const DEFAULT_TEXT_SHADOW_VALUE = serializeTextShadow(DEFAULT_TEXT_SHADOW);

export function parseTextShadow(value: string): TextShadow | null {
  if (!value || value === 'none') return null;

  if (NAMED_TEXT_SHADOWS[value]) {
    return { ...NAMED_TEXT_SHADOWS[value] };
  }

  const normalized = value.replace(/\s+/g, '_');
  const parts = normalized.split('_');

  if (parts.length < 3) return { ...DEFAULT_TEXT_SHADOW };

  const x = parseShadowLength(parts[0]);
  const y = parseShadowLength(parts[1]);

  const thirdLooksLikeColor = /^(#|rgb|hsl|var|color:)/i.test(parts[2]);
  if (thirdLooksLikeColor && parts.length === 3) {
    return {
      x,
      y,
      blur: 0,
      color: restoreVarColor(parts.slice(2).join('_')),
    };
  }

  const blur = parseShadowLength(parts[2]);
  const color = parts.length > 3
    ? restoreVarColor(parts.slice(3).join('_'))
    : DEFAULT_TEXT_SHADOW.color;

  return { x, y, blur, color };
}

function restoreVarColor(color: string): string {
  if (color.startsWith('var(--')) {
    return `color:${color}`;
  }
  return color;
}

export function convertToRgba(color: string): string {
  if (color.startsWith('rgba')) return color;
  if (color.startsWith('rgb')) {
    return color.replace('rgb(', 'rgba(').replace(')', ',1)');
  }

  let r: number;
  let g: number;
  let b: number;
  let a = 1;

  const hexOpacityMatch = color.match(/^#([0-9a-fA-F]{6})\/(\d+)$/);
  if (hexOpacityMatch) {
    r = parseInt(hexOpacityMatch[1].substring(0, 2), 16);
    g = parseInt(hexOpacityMatch[1].substring(2, 4), 16);
    b = parseInt(hexOpacityMatch[1].substring(4, 6), 16);
    a = parseInt(hexOpacityMatch[2], 10) / 100;
    return `rgba(${r},${g},${b},${a})`;
  }

  const hex = color.replace('#', '');

  if (hex.length === 8) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
    a = parseInt(hex.substring(6, 8), 16) / 255;
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    return 'rgba(0,0,0,1)';
  }

  return `rgba(${r},${g},${b},${a})`;
}

export function swatchColor(color: string): string {
  if (color.startsWith('var(') || color.startsWith('color:var(')) {
    return 'rgba(0,0,0,0.35)';
  }
  return color;
}
