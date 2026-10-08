import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Activity, RefreshCcw } from 'lucide-react';
import { api } from '../util/api';
import { useTheme } from '../util/ThemeContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const METHOD_COLORS = { GET: '#22a06b', POST: '#6d5de7', PATCH: '#e08a1e', PUT: '#1683c4', DELETE: '#dc3545' };
const FALLBACK_COLORS = ['#9c5de7', '#00a6a6', '#d4559d', '#758195'];
const PERCENTILES = [
  ['p50', 'P50', 'Typical request latency'],
  ['p90', 'P90', 'Nine in ten requests complete below this value'],
  ['p99', 'P99', 'Tail latency for the slowest one percent'],
];

function timeLabel(value, rangeHours) {
  const date = new Date(value);
  return date.toLocaleString(undefined, rangeHours === 24 ? { hour: 'numeric' } : { weekday: 'short', hour: 'numeric' });
}

export default function LatencyTelemetryDashboard() {
  const { isDarkMode } = useTheme();
  const [rangeHours, setRangeHours] = useState(24);
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLatency = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setTelemetry(await api.getServiceLatency(rangeHours));
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load latency telemetry.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [rangeHours]);

  useEffect(() => {
    loadLatency();
    const interval = window.setInterval(() => loadLatency(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadLatency]);

  const charts = useMemo(() => PERCENTILES.map(([key, title, description]) => ({
    key, title, description,
    data: {
      labels: (telemetry?.points || []).map(point => timeLabel(point.bucketStart, rangeHours)),
      datasets: (telemetry?.methods || []).map((method, index) => ({
        label: method,
        data: telemetry.points.map(point => point.methods[method]?.[key] ?? null),
        borderColor: METHOD_COLORS[method] || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        backgroundColor: METHOD_COLORS[method] || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.28,
        spanGaps: true,
      })),
    },
  })), [rangeHours, telemetry]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 250 },
    plugins: {
      datalabels: { display: false },
      legend: { position: 'bottom', labels: { color: isDarkMode ? '#aab2c0' : '#64748b', usePointStyle: true, boxWidth: 7, padding: 14 } },
      tooltip: { callbacks: { label: context => `${context.dataset.label}: ${Number(context.parsed.y).toLocaleString(undefined, { maximumFractionDigits: 2 })} ms` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: isDarkMode ? '#7f8998' : '#94a3b8', maxTicksLimit: rangeHours === 24 ? 8 : 7, maxRotation: 0 } },
      y: { beginAtZero: true, grid: { color: isDarkMode ? 'rgba(148,163,184,.09)' : 'rgba(148,163,184,.14)' }, ticks: { color: isDarkMode ? '#7f8998' : '#94a3b8', callback: value => `${value} ms` } },
    },
  };

  return (
    <section className="admin-latency-dashboard">
      <header className="admin-latency-header">
        <div className="admin-security-title"><span><Activity size={21} /></span><div><h2>Request latency</h2><p>Exact hourly percentiles split by HTTP method. Automatically refreshed every minute.</p></div></div>
        <div className="admin-latency-controls">
          <div role="group" aria-label="Latency time range">
            <button type="button" className={rangeHours === 24 ? 'active' : ''} onClick={() => setRangeHours(24)}>24 hours</button>
            <button type="button" className={rangeHours === 168 ? 'active' : ''} onClick={() => setRangeHours(168)}>7 days</button>
          </div>
          <button type="button" className="admin-latency-refresh" onClick={() => loadLatency()} disabled={loading} aria-label="Refresh latency charts"><RefreshCcw size={15} /></button>
        </div>
      </header>
      {error && <div className="admin-error admin-latency-error" role="alert">{error}</div>}
      <div className="admin-latency-summary"><strong>{telemetry?.sampleCount || 0}</strong> requests across <strong>{telemetry?.methods?.length || 0}</strong> methods</div>
      {loading && !telemetry ? <div className="admin-latency-empty">Loading latency percentiles…</div> : telemetry?.sampleCount ? <div className="admin-latency-grid">
        {charts.map(chart => <article key={chart.key}>
          <div><strong>{chart.title}</strong><span>{chart.description}</span></div>
          <div className="admin-latency-chart"><Line data={chart.data} options={chartOptions} /></div>
        </article>)}
      </div> : <div className="admin-latency-empty">No request samples are available in this time range yet.</div>}
    </section>
  );
}
