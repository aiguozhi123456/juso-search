export interface LayoutRect {
  left: number;
  width: number;
}

export interface HorizontalBoxStyle {
  borderLeft: number;
  borderRight: number;
  paddingLeft: number;
  paddingRight: number;
}

export interface AlignedHostLayout {
  offsetLeft: number;
  width: number;
}

export function calculateAlignedHostLayout(
  parentRect: LayoutRect,
  parentStyle: HorizontalBoxStyle,
  targetRect: LayoutRect,
  targetStyle: HorizontalBoxStyle,
): AlignedHostLayout {
  const parentContentLeft = parentRect.left + parentStyle.borderLeft + parentStyle.paddingLeft;
  const targetContentLeft = targetRect.left + targetStyle.borderLeft + targetStyle.paddingLeft;
  const targetContentWidth =
    targetRect.width - targetStyle.borderLeft - targetStyle.borderRight - targetStyle.paddingLeft - targetStyle.paddingRight;

  return {
    offsetLeft: Math.max(0, targetContentLeft - parentContentLeft),
    width: Math.max(0, targetContentWidth),
  };
}
