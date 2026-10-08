import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';

import { useTheme } from '../util/ThemeContext';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Doughnut } from 'react-chartjs-2';
import { externalCategoryTooltip, ExternalTooltipCleanupPlugin } from '../util/externalChartTooltip';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  ChartDataLabels,
  ExternalTooltipCleanupPlugin,
);


export default function OverviewPage() {
  const { account } = useAccount();
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();

  const [chartData, setChartData] = useState(null);
  const [categoryChartData, setCategoryChartData] = useState(null);
  const [financialProfile, setFinancialProfile] = useState(null);
  const [allSpending, setAllSpending] = useState([]); // cached, fetched once
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showEditGoalModal, setShowEditGoalModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [goalForm, setGoalForm] = useState({ goalName: '', goalTarget: '', goalCurrent: '' });
  const [monthOffset, setMonthOffset] = useState(0);
  const [categoryTimeRange, setCategoryTimeRange] = useState('ytd');
  const [categoryTotal, setCategoryTotal] = useState(0);

  useEffect(() => {
    if (account?.id) {
      loadAll();
    }
  // loadAll is intentionally tied to account changes, not recreated helper identities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Recompute charts when time range changes — no extra network call
  useEffect(() => {
    if (allSpending.length > 0) {
      computeCategoryChart(allSpending, categoryTimeRange);
    }
  }, [categoryTimeRange, allSpending]);

  const loadAll = async () => {
    if (!account?.id) return;
    const [profile, spending] = await Promise.all([
      api.getFinancialProfile(account.id),
      api.getAllSpending(),
    ]);
    console.log('[overview] spending records loaded:', spending?.length, 'profile:', profile?.monthlyIncome);
    setFinancialProfile(profile);
    setAllSpending(spending);
    computeLast5Months(spending, 0, profile);
    computeCategoryChart(spending, categoryTimeRange);
  };

  const loadFinancialProfile = async () => {
    if (!account?.id) return;
    try {
      const profile = await api.getFinancialProfile(account.id);
      setFinancialProfile(profile);
    } catch (err) {
      console.error('[overview] failed to load financial profile:', err);
    }
  };

  // Pure computation — no network calls
  const computeCategoryChart = (spending, timeRange) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const categoryTotals = {};

    spending.forEach(record => {
      const { year, month } = record;
      let include = false;

      if (timeRange === 'ytd') {
        include = year === currentYear && month <= currentMonth;
      } else if (timeRange === '6months') {
        const key = year * 12 + month;
        const cutoff = currentYear * 12 + currentMonth - 6;
        include = key > cutoff && key <= currentYear * 12 + currentMonth;
      } else if (timeRange === '1year') {
        const key = year * 12 + month;
        const cutoff = currentYear * 12 + currentMonth - 12;
        include = key > cutoff && key <= currentYear * 12 + currentMonth;
      } else {
        include = true; // alltime
      }

      if (!include) return;

      record.expenses?.forEach(expense => {
        const cat = expense.mainCategory ||
          (expense.categories?.length ? expense.categories[0] : 'Uncategorized');
        categoryTotals[cat] = (categoryTotals[cat] || 0) + expense.amount;
      });
    });

    const labels = Object.keys(categoryTotals);
    const data   = Object.values(categoryTotals);
    const colors = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#FF6384','#C9CBCF'];

    setCategoryTotal(data.reduce((s, v) => s + v, 0));
    setCategoryChartData({
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 1 }],
    });
  };

  // Pure computation — no network calls
  const computeLast5Months = (spending, offset = 0, profile = financialProfile) => {
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - 5 + i + offset);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const label = d.toLocaleString('default', { month: 'short' });

      const total = spending
        .filter(r => r.year === y && r.month === m)
        .reduce((sum, r) => sum + (r.expenses || []).reduce((s, e) => s + e.amount, 0), 0);

      const overLimit = total >= (profile?.monthlySpendLimit || Infinity);
      months.push({ month: label, total, overLimit });
    }
    setChartData({
      labels: months.map(d => d.month),
      datasets: [{
        label: 'Monthly Spending',
        data: months.map(d => Math.trunc(d.total)),
        overLimit: months.map(d => d.overLimit),
        backgroundColor: (context) => {
          const { chart, dataIndex } = context;
          const overLimit = months[dataIndex]?.overLimit;
          if (!chart.chartArea) return overLimit ? '#f97373' : '#7c6ee6';
          const gradient = chart.ctx.createLinearGradient(0, chart.chartArea.bottom, 0, chart.chartArea.top);
          if (overLimit) {
            gradient.addColorStop(0, '#ef6a78');
            gradient.addColorStop(1, '#f9a26c');
          } else {
            gradient.addColorStop(0, '#6159cb');
            gradient.addColorStop(.55, '#7c6ee6');
            gradient.addColorStop(1, '#a78bfa');
          }
          return gradient;
        },
        hoverBackgroundColor: (context) => months[context.dataIndex]?.overLimit ? '#f47b72' : '#8b7cf0',
        borderWidth: 0,
        borderRadius: 14,
        borderSkipped: false,
        maxBarThickness: 46,
        categoryPercentage: .72,
        barPercentage: .8,
      }],
    });
  };

  const adjustMonthOffset = (delta) => {
    const newOffset = monthOffset + delta;
    setMonthOffset(newOffset);
    computeLast5Months(allSpending, newOffset);
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 1500,
      easing: 'easeOutQuart'
    },
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: false
      },
      datalabels: {
        display: (context) => Number(context.dataset.data[context.dataIndex]) > 0,
        anchor: 'end',
        align: 'end',
        offset: 2,
        clamp: true,
        color: isDarkMode ? '#e8e7f1' : '#4d4961',
        font: { size: 10, weight: '700' },
        formatter: (value) => new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: financialProfile?.reportingCurrency || 'USD',
          notation: value >= 1000 ? 'compact' : 'standard',
          maximumFractionDigits: 0,
        }).format(value),
      },
      tooltip: {
        displayColors: false,
        backgroundColor: isDarkMode ? 'rgba(24, 23, 36, .96)' : 'rgba(255, 255, 255, .97)',
        titleColor: isDarkMode ? '#f5f3ff' : '#29263b',
        bodyColor: isDarkMode ? '#c9c5dc' : '#625d76',
        borderColor: isDarkMode ? 'rgba(167,139,250,.35)' : 'rgba(99,102,241,.2)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 12,
        titleFont: { size: 12, weight: '700' },
        bodyFont: { size: 12, weight: '600' },
        callbacks: {
          label: (context) => `Spent ${new Intl.NumberFormat('en-US', {
            style: 'currency', currency: financialProfile?.reportingCurrency || 'USD', maximumFractionDigits: 0,
          }).format(context.raw)}`,
        },
      },
    },
    layout: { padding: { top: 24, right: 8, left: 4 } },
    scales: {
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: {
          color: isDarkMode ? 'rgba(255,255,255,.075)' : 'rgba(87,78,120,.09)',
          borderDash: [4, 5],
          drawTicks: false,
        },
        ticks: {
          color: isDarkMode ? '#9792aa' : '#888297',
          padding: 10,
          font: { size: 10, weight: '600' },
          callback: function (value) {
            return new Intl.NumberFormat('en-US', {
              style: 'currency', currency: financialProfile?.reportingCurrency || 'USD', notation: 'compact', maximumFractionDigits: 0,
            }).format(value);
          }
        }
      },
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: {
          color: isDarkMode ? '#bbb7ca' : '#686276',
          padding: 9,
          font: {
            size: 11,
            weight: '700'
          }
        }
      }
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const clickedIndex = elements[0].index;
        const monthName = chartData.labels[clickedIndex];
        const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = shortMonthNames.indexOf(monthName);
        if (monthIndex !== -1) {
          const fullMonthName = fullMonthNames[monthIndex];

          // Calculate the correct year based on the chart data
          const date = new Date();
          date.setMonth(date.getMonth() - 5 + clickedIndex + monthOffset);
          const correctYear = date.getFullYear();

          navigate('/monthly-spending', { state: { year: correctYear, month: fullMonthName } });
        }
      }
    },
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
    }
  };

  if (!account) {
    console.log("Overview page account: ", account);
    return (
      <div className="no-account-message">
        <h2>No Account Selected</h2>
        <p>Please go back and select a profile to continue.</p>
      </div>
    );
  }

  const handleDeleteGoal = async (goalId) => {
    if (api?.deleteGoal && account?.id) {
      await api.deleteGoal(account.id, goalId);
      await loadFinancialProfile();
    }
  };

  const handleAddGoal = async (e) => {
    e.preventDefault();
    if (api?.addGoal && account?.id && goalForm.goalName && goalForm.goalTarget) {
      await api.addGoal(account.id, {
        name: goalForm.goalName,
        targetAmount: parseFloat(goalForm.goalTarget),
        currentAmount: parseFloat(goalForm.goalCurrent) || 0,
        targetDate: '2025-12-31',
        category: 'savings'
      });
      await loadFinancialProfile();
      setGoalForm({ goalName: '', goalTarget: '', goalCurrent: '' });
      setShowGoalModal(false);
    }
  };

  const handleEditGoal = (goal) => {
    setEditingGoal(goal);
    setGoalForm({
      goalName: goal.name,
      goalTarget: goal.targetAmount.toString(),
      goalCurrent: goal.currentAmount.toString()
    });
    setShowEditGoalModal(true);
  };

  const handleUpdateGoal = async (e) => {
    e.preventDefault();
    if (api?.updateGoal && account?.id && editingGoal && goalForm.goalName && goalForm.goalTarget) {
      await api.updateGoal(account.id, editingGoal.id, {
        name: goalForm.goalName,
        targetAmount: parseFloat(goalForm.goalTarget),
        currentAmount: parseFloat(goalForm.goalCurrent) || 0,
        targetDate: editingGoal.targetDate,
        category: editingGoal.category
      });
      await loadFinancialProfile();
      setGoalForm({ goalName: '', goalTarget: '', goalCurrent: '' });
      setShowEditGoalModal(false);
      setEditingGoal(null);
    }
  };

  return (
    <div className="dashboard-page">
    <>
    {/* Hero Greeting Section */}
      <div className="hero-greeting">
        <h1>Welcome, {account.name}</h1>
        <p className="page-subtitle">
          Your financial overview at a glance
        </p>
      </div>

      {/* Settings Button */}
      <div className="settings-dropdown dashboard-settings-dropdown">
        <button
          onClick={() => navigate(('/settings'))}
          className="settings-button"
        >
          ⚙️
        </button>
      </div>

      <div className="two-column-layout">
        {/* Financial Profile Card */}
        <div className="financial-profile-card content-card">
          <div className="section-header">
            <h2 className="card-title">💼 Financial Profile</h2>
          </div>
          {financialProfile ? (
            <div>
              <div className="profile-info-row">
                <div className="info-icon-circle emerald">💵</div>
                <span className="info-label">Monthly Income</span>
                <span className="info-value">${(financialProfile.monthlyIncome || 0).toLocaleString()}</span>
              </div>
              <div className="profile-info-row">
                <div className="info-icon-circle cyan">🏦</div>
                <span className="info-label">After Tax (Monthly)</span>
                <span className="info-value">${((financialProfile?.yearlyIncomeAfterTax || 0) / 12).toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
              </div>
              <div className="profile-info-row">
                <div className="info-icon-circle orange">📊</div>
                <span className="info-label">Yearly Income</span>
                <span className="info-value">${(financialProfile.yearlyIncome || 0).toLocaleString()}</span>
              </div>
              <div className="profile-info-row last">
                <div className="info-icon-circle pink">🎯</div>
                <span className="info-label">Savings Target</span>
                <span className="info-value">${((financialProfile.yearlyIncome || 0) * ((financialProfile.percentToSave || 0) / 100) / 12).toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
              </div>
            </div>
          ) : (
            <p className="content-empty-state">
              Add your financial information in Settings
            </p>
          )}
        </div>

        {/* Monthly Spending Chart Card */}
        <div className="content-card">
          <div className="section-header">
            <h2 className="card-title">📈 Monthly Spend</h2>
            <div className="month-navigation">
              <button onClick={() => adjustMonthOffset(-1)} className="btn-icon month-navigation-button">←</button>
              <button onClick={() => adjustMonthOffset(1)} className="btn-icon month-navigation-button">→</button>
            </div>
          </div>
          {chartData ? (
            <div className="chart-container monthly-spend-chart">
              <Bar data={chartData} options={chartOptions} />
            </div>
          ) : (
            <p className="loading-text">Loading chart...</p>
          )}
        </div>
      </div>

      <div className="category-full-row">
        {/* Donut Chart - Spending by Category */}
        <div className="donut-chart-container spending-category-card content-card">
          <div className="category-summary-toolbar">
            <h2 className="card-title category-card-title">🏷️ Spending by Category</h2>

            <div className="category-summary-actions">
              {financialProfile && categoryTotal > 0 && (
                <div className="metric-chip category-total-chip">
                  <div className="metric-label">Total Spending</div>
                  <div className="metric-value">${(Math.floor(categoryTotal * 100) / 100).toLocaleString()}</div>
                </div>
              )}

              {/* Time Range Buttons */}
              <div className="time-range-buttons">
                {['ytd', '6months', '1year', 'alltime'].map((range) => (
                  <button
                    key={range}
                    onClick={() => setCategoryTimeRange(range)}
                    className={`time-range-button${categoryTimeRange === range ? ' active' : ''}`}
                  >
                    {range === 'ytd' ? 'YTD' :
                      range === '6months' ? '6 Months' :
                        range === '1year' ? '1 Year' :
                          'All Time'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {categoryChartData ? (
            <div className="category-visual-layout">
              <div className="category-donut-chart chart-container">
                <Doughnut data={categoryChartData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '66%',
                  radius: '92%',
                  animation: {
                    duration: 900,
                    easing: 'easeOutQuart'
                  },
                  elements: {
                    arc: {
                      borderWidth: 3,
                      borderColor: 'transparent',
                      borderRadius: 7,
                      spacing: 2,
                      hoverOffset: 8
                    }
                  },
                  plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                      enabled: false,
                      external: externalCategoryTooltip,
                    }
                  }
                }} />
                <div className="donut-center-text">
                  <div className="donut-center-label">Total</div>
                  <div className="donut-center-value">
                    ${categoryTotal.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="category-breakdown">
                <div className="category-breakdown-heading">
                  <span>Category breakdown</span>
                  <small>{categoryChartData.labels.length} categories</small>
                </div>
                <div className="donut-pills-row">
                  {categoryChartData.labels.map((label, i) => {
                    const value = categoryChartData.datasets?.[0]?.data?.[i] || 0;
                    const color = categoryChartData.datasets?.[0]?.backgroundColor?.[i];
                    return (
                      <div className="category-breakdown-item" key={label}>
                        <span className="category-breakdown-label"><i style={{ background: color }} />{label}</span>
                        <strong>${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : <p className="loading-text">Loading category data...</p>}
        </div>
      </div>

      {/* Financial Goals Full Width Card */}
      <div className="content-card full-width-content-card">
        <div className="section-header">
          <h2 className="section-title">🎯 Financial Goals</h2>
          <button onClick={() => setShowGoalModal(true)} className="btn-primary">➕ Add Goal</button>
        </div>

        {/* Default savings goal: monthly targets are frozen server-side. */}
        {(() => {
          const savings = financialProfile?.savingsProgress || { year: new Date().getFullYear(), amountSaved: 0, targetAmount: 0, months: [] };
          const progress = savings.targetAmount > 0 ? (savings.amountSaved / savings.targetAmount) * 100 : 0;
          const monthNames = new Intl.DateTimeFormat(undefined, { month: 'short' });

          return (
            <div className="goal-card yearly-goal-card">
              <div className="goal-header">
                <div><div className="goal-title">💰 Automatic Savings Goal</div><p className="savings-goal-subtitle">Each month’s target is locked using that month’s salary and savings rate.</p></div>
                <span className="savings-tracked-months">{savings.months.length} month{savings.months.length === 1 ? '' : 's'} tracked</span>
              </div>
              <div className="goal-amount">
                ${savings.amountSaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="slash">/</span>
                ${savings.targetAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill emerald"
                  style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
                ></div>
              </div>
              <div className="progress-label">
                <span className="progress-caption">
                  {savings.year} captured-target progress
                </span>
                <span className="progress-percentage">
                  {Math.round(Math.max(progress, 0))}%
                </span>
              </div>
              {savings.months.length ? <div className="savings-month-grid">
                {savings.months.map(month => {
                  const monthlyProgress = month.targetAmount > 0 ? month.amountSaved / month.targetAmount * 100 : 0;
                  return <article className="savings-month-card" key={`${month.year}-${month.month}`}>
                    <div><strong>{monthNames.format(new Date(Date.UTC(month.year, month.month - 1, 1)))}</strong><span>{month.percentToSave}% target</span></div>
                    <div className="savings-month-amount"><strong>${month.amountSaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong><span>of ${month.targetAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                    <div className="savings-month-progress"><i style={{ width: `${Math.min(100, Math.max(0, monthlyProgress))}%` }} /></div>
                  </article>;
                })}
              </div> : <p className="savings-goal-empty">Add income and a savings percentage to begin automatic monthly tracking.</p>}
            </div>
          );
        })()}

        {financialProfile?.goals?.length > 0 ? (
          <div className="goal-list">
            {financialProfile.goals.map(goal => {
              const progress = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
              return (
                <div key={goal.id} className="goal-card">
                  <div className="goal-header">
                    <div className="goal-title">{goal.name}</div>
                    <div className="goal-actions">
                      <button
                        onClick={() => handleEditGoal(goal)}
                        className="goal-icon-btn"
                        title="Edit goal"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(goal.id)}
                        className="goal-icon-btn delete"
                        title="Delete goal"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="goal-amount">
                    ${goal.currentAmount?.toLocaleString()}
                    <span className="slash">/</span>
                    ${goal.targetAmount?.toLocaleString()}
                  </div>
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    ></div>
                  </div>
                  <div className="progress-label">
                    <span className="progress-caption">
                      Target: {goal.targetDate || '2025-12-31'}
                    </span>
                    <span className="progress-percentage">
                      {Math.round(progress)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="content-empty-state">
            No goals set yet. Click "Add Goal" to get started! 🎯
          </p>
        )}
      </div>

      {/* Goal Modal */}
      {showGoalModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button
              onClick={() => setShowGoalModal(false)}
              className="btn-close"
            >
              ×
            </button>

            <h3 className="modal-title">Add New Goal</h3>

            <form onSubmit={handleAddGoal}>
              <div className="form-group">
                <label className="form-label">Goal Name:</label>
                <input
                  type="text"
                  value={goalForm.goalName}
                  onChange={(e) => setGoalForm({ ...goalForm, goalName: e.target.value })}
                  maxLength={100}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Target Amount:</label>
                <input
                  type="number"
                  value={goalForm.goalTarget}
                  onChange={(e) => setGoalForm({ ...goalForm, goalTarget: e.target.value })}
                  min="0"
                  max="1000000000000000"
                  step="0.01"
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Current Amount:</label>
                <input
                  type="number"
                  value={goalForm.goalCurrent}
                  onChange={(e) => setGoalForm({ ...goalForm, goalCurrent: e.target.value })}
                  min="0"
                  max="1000000000000000"
                  step="0.01"
                  className="form-input"
                  placeholder="0"
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Add Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Goal Modal */}
      {showEditGoalModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button
              onClick={() => setShowEditGoalModal(false)}
              className="btn-close"
            >
              ×
            </button>

            <h3 className="modal-title">Edit Goal</h3>

            <form onSubmit={handleUpdateGoal}>
              <div className="form-group">
                <label className="form-label">Goal Name:</label>
                <input
                  type="text"
                  value={goalForm.goalName}
                  onChange={(e) => setGoalForm({ ...goalForm, goalName: e.target.value })}
                  maxLength={100}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Target Amount:</label>
                <input
                  type="number"
                  value={goalForm.goalTarget}
                  onChange={(e) => setGoalForm({ ...goalForm, goalTarget: e.target.value })}
                  min="0"
                  max="1000000000000000"
                  step="0.01"
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Current Amount:</label>
                <input
                  type="number"
                  value={goalForm.goalCurrent}
                  onChange={(e) => setGoalForm({ ...goalForm, goalCurrent: e.target.value })}
                  min="0"
                  max="1000000000000000"
                  step="0.01"
                  className="form-input"
                  required
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Update Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
    </div>
  );
}
