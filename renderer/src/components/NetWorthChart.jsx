import { useId, useMemo, useState } from 'react';

const WIDTH = 220;
const HEIGHT = 78;
const PAD_X = 6;
const PAD_Y = 10;

function money(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD', maximumFractionDigits: 1 }).format(value);
}

export default function NetWorthChart({ history = [], positive = true }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const gradientId = useId().replace(/:/g, '');
  const color = positive ? '#10b981' : '#ec4899';

  const points = useMemo(() => {
    if (!history.length) return [];
    const values = history.map((item) => item.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      const padding = Math.max(Math.abs(min) * 0.02, 1);
      min -= padding;
      max += padding;
    }
    return history.map((item, index) => ({
      ...item,
      x: history.length === 1 ? WIDTH / 2 : PAD_X + index * ((WIDTH - PAD_X * 2) / (history.length - 1)),
      y: PAD_Y + ((max - item.value) / (max - min)) * (HEIGHT - PAD_Y * 2),
    }));
  }, [history]);

  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = points.length > 1 ? `${line} L ${points.at(-1).x} ${HEIGHT} L ${points[0].x} ${HEIGHT} Z` : '';
  const hovered = hoveredIndex === null ? null : points[hoveredIndex];

  const handleMove = (event) => {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(points[nearest].x - x)) nearest = index;
    });
    setHoveredIndex(nearest);
  };

  return (
    <div className="net-worth-chart" onMouseLeave={() => setHoveredIndex(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Monthly net worth history" onMouseMove={handleMove}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {points.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r="3.5" fill={color} />}
        {hovered && (
          <g className="net-worth-hover">
            <line x1={hovered.x} y1="4" x2={hovered.x} y2={HEIGHT} stroke={color} strokeOpacity=".32" strokeDasharray="3 3" />
            <circle cx={hovered.x} cy={hovered.y} r="5" fill="var(--bg-elevated)" stroke={color} strokeWidth="2.5" />
          </g>
        )}
      </svg>
      {hovered && (
        <div className="net-worth-tooltip" style={{ left: `${(hovered.x / WIDTH) * 100}%` }}>
          <strong>{money(hovered.value)}</strong>
          <span>{hovered.label}{hovered.isFinal ? '' : ' · Live'}</span>
        </div>
      )}
      <div className="net-worth-axis">
        <span>{points[0]?.label || 'Now'}</span>
        <span>{points.length > 1 ? points.at(-1)?.label : 'Tracking started'}</span>
      </div>
    </div>
  );
}
