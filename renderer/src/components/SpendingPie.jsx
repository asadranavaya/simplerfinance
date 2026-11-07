import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { purchaseMoney } from '../util/formatting';

ChartJS.register(ArcElement, Tooltip, Legend);
export default function SpendingPie({ labels, values, colors, total, currency = 'USD', title = 'Spending by category', onSelect }) {
  const visible = labels.map((label, index) => ({ label, value: values[index], color: colors?.[index] })).filter(item => item.value > 0);
  return <div className="ux-spending-pie">
    <h3>{title}</h3>
    {visible.length ? <div className="ux-pie-chart"><Doughnut role="img" aria-label={`${title}: ${visible.map(item => `${item.label} ${purchaseMoney(item.value, currency)}`).join(', ')}`} data={{ labels: visible.map(item => item.label), datasets: [{ data: visible.map(item => item.value), backgroundColor: visible.map((item, index) => item.color || ['#7959d8', '#1c9a9c', '#d88f30', '#cf6492', '#4e78c8'][index % 5]), borderWidth: 3, borderColor: 'transparent', borderRadius: 5, spacing: 2 }] }} options={{ responsive: true, maintainAspectRatio: false, cutout: '70%', animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350 }, plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${purchaseMoney(context.raw, currency)}` } } }, onClick: (_, elements) => { if (elements[0] && onSelect) onSelect(visible[elements[0].index].label); } }} /><div className="ux-pie-center"><span>Total</span><strong>{purchaseMoney(total, currency)}</strong></div></div> : <p className="ux-helper">No positive category spending in this period.</p>}
  </div>;
}
