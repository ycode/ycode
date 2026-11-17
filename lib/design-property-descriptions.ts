/** One-line explanation of what each design property does, shown in setting tooltips */
const DESIGN_PROPERTY_DESCRIPTIONS: Record<string, string> = {
  // Layout
  display: 'How the element is laid out.',
  flexDirection: 'Lays children out in a row or column.',
  flexWrap: 'Wraps children onto new lines.',
  alignItems: 'Aligns children on the cross axis.',
  justifyContent: 'Distributes children on the main axis.',
  gridTemplateColumns: 'Number and size of grid columns.',
  gridTemplateRows: 'Number and size of grid rows.',
  gap: 'Space between children.',
  columnGap: 'Horizontal space between children.',
  rowGap: 'Vertical space between children.',

  // Flex / grid child
  alignSelf: 'Overrides the parent\'s alignment.',
  flex: 'How the element grows and shrinks.',
  flexGrow: 'Grows to fill the free space.',
  flexShrink: 'Shrinks when space runs out.',
  order: 'Position among its siblings.',
  gridColumnSpan: 'Grid columns the element spans.',
  gridRowSpan: 'Grid rows the element spans.',

  // Sizing
  width: 'Width of the element.',
  minWidth: 'Smallest width it can shrink to.',
  maxWidth: 'Largest width it can grow to.',
  height: 'Height of the element.',
  minHeight: 'Smallest height it can shrink to.',
  maxHeight: 'Largest height it can grow to.',
  overflow: 'Handles content that doesn\'t fit.',
  objectFit: 'How media fills its box.',
  objectPosition: 'Where media sits in its box.',
  aspectRatio: 'Ratio of width to height.',

  // Position
  position: 'How the element is positioned.',
  top: 'Offset from the top edge.',
  right: 'Offset from the right edge.',
  bottom: 'Offset from the bottom edge.',
  left: 'Offset from the left edge.',
  zIndex: 'Stacking order, higher is on top.',

  // Typography
  fontFamily: 'Typeface of the text.',
  fontWeight: 'Thickness of the text.',
  fontSize: 'Size of the text.',
  color: 'Color of the text.',
  placeholderColor: 'Color of input placeholder text.',
  textAlign: 'Horizontal alignment of the text.',
  letterSpacing: 'Space between letters.',
  lineHeight: 'Height of each line of text.',
  textDecoration: 'Line under, over or through text.',
  textDecorationColor: 'Color of the decoration line.',
  textDecorationThickness: 'Thickness of the decoration line.',
  underlineOffset: 'Distance from text to underline.',
  fontStyle: 'Makes the text italic.',
  textTransform: 'Letter case of the text.',
  lineClamp: 'Max lines before text is cut off.',
  textShadow: 'Shadow behind the text.',

  // Backgrounds
  backgroundColor: 'Fill color or gradient.',
  backgroundImage: 'Image behind the element.',
  backgroundSize: 'How the image is scaled.',
  backgroundPosition: 'Where the image is placed.',
  backgroundRepeat: 'Whether the image tiles.',

  // Borders
  borderRadius: 'Roundness of the corners.',
  borderTopLeftRadius: 'Roundness of the top left corner.',
  borderTopRightRadius: 'Roundness of the top right corner.',
  borderBottomRightRadius: 'Roundness of the bottom right corner.',
  borderBottomLeftRadius: 'Roundness of the bottom left corner.',
  borderWidth: 'Thickness of the border.',
  borderTopWidth: 'Thickness of the top border.',
  borderRightWidth: 'Thickness of the right border.',
  borderBottomWidth: 'Thickness of the bottom border.',
  borderLeftWidth: 'Thickness of the left border.',
  borderStyle: 'Solid, dashed or dotted border.',
  borderColor: 'Color of the border.',
  divideX: 'Lines between children in a row.',
  divideY: 'Lines between children in a column.',
  divideStyle: 'Line style of the dividers.',
  divideColor: 'Color of the dividers.',
  outlineWidth: 'Thickness of the outline.',
  outlineColor: 'Color of the outline.',
  outlineOffset: 'Space between outline and edge.',

  // Effects
  opacity: 'Transparency of the element.',
  boxShadow: 'Shadow around the element.',
  blur: 'Blurs the element.',
  backdropBlur: 'Blurs what is behind the element.',
  cursor: 'Pointer shown on hover.',

  // Transforms
  transformOrigin: 'Point it scales and rotates around.',
  scale: 'Resizes without affecting layout.',
  rotate: 'Rotates without affecting layout.',

  // Transitions
  transitionProperty: 'Properties that animate on change.',
  duration: 'How long the transition takes.',
  easing: 'Speed curve of the transition.',
  delay: 'Wait before the transition starts.',
};

/** What a design property does, e.g. 'minWidth' -> 'Smallest width it can shrink to.' */
export function getDesignPropertyDescription(property: string): string | undefined {
  return DESIGN_PROPERTY_DESCRIPTIONS[property];
}
