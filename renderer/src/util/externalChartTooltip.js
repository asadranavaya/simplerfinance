const tooltipElements = new WeakMap();

function tooltipElement(chart) {
  let element = tooltipElements.get(chart);
  if (element) return element;
  element = document.createElement('div');
  element.className = 'chart-external-tooltip';
  element.setAttribute('role', 'tooltip');
  document.body.appendChild(element);
  tooltipElements.set(chart, element);
  return element;
}

export function externalCategoryTooltip({ chart, tooltip }) {
  const element = tooltipElement(chart);
  if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    element.classList.remove('visible');
    return;
  }

  const point = tooltip.dataPoints[0];
  const value = Number(point.raw) || 0;
  const total = point.dataset.data.reduce((sum, item) => sum + (Number(item) || 0), 0);
  const percentage = total > 0 ? (value / total) * 100 : 0;
  element.textContent = `${point.label}: ${value.toLocaleString(undefined, { style: 'currency', currency: 'USD' })} (${percentage.toFixed(1)}%)`;
  element.classList.add('visible');

  const canvasRect = chart.canvas.getBoundingClientRect();
  const tooltipRect = element.getBoundingClientRect();
  const gap = 14;
  const viewportPadding = 10;
  const anchorX = canvasRect.left + tooltip.caretX;
  const anchorY = canvasRect.top + tooltip.caretY;
  const left = Math.min(
    window.innerWidth - tooltipRect.width - viewportPadding,
    Math.max(viewportPadding, anchorX - tooltipRect.width / 2),
  );
  const preferredTop = anchorY - tooltipRect.height - gap;
  const top = preferredTop >= viewportPadding
    ? preferredTop
    : Math.min(window.innerHeight - tooltipRect.height - viewportPadding, anchorY + gap);
  element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

export const ExternalTooltipCleanupPlugin = {
  id: 'external-category-tooltip-cleanup',
  afterDestroy(chart) {
    tooltipElements.get(chart)?.remove();
    tooltipElements.delete(chart);
  },
};
