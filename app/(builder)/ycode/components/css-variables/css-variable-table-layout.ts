/** Fixed width for the variable name column (px). */
export const CSS_VARIABLE_NAME_COL_WIDTH = 220;

/** Fixed width for each mode value column (px). */
export const CSS_VARIABLE_MODE_COL_WIDTH = 220;

/** Fixed width for the row actions column (px). */
export const CSS_VARIABLE_ACTION_COL_WIDTH = 32;

/** Builds a CSS grid template with equal-width name, mode, and action columns. */
export function getCssVariableTableGridColumns(modeCount: number): string {
  const modeCols = Array.from({ length: modeCount }, () => `${CSS_VARIABLE_MODE_COL_WIDTH}px`).join(' ');
  return `${CSS_VARIABLE_NAME_COL_WIDTH}px ${modeCols} ${CSS_VARIABLE_ACTION_COL_WIDTH}px`;
}
