import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../util/AccountContext';
import { api } from '../util/api';
import SplitPurchaseFields from '../components/SplitPurchaseFields';
import { Download } from 'lucide-react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);


export default function CategoryBrowserPage() {
    const { account } = useAccount();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedStart = searchParams.get('start');
    const requestedEnd = searchParams.get('end');
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
    const inputDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const initialEnd = validDate(requestedEnd) ? requestedEnd : inputDate(new Date());
    const initialStartDate = new Date();
    initialStartDate.setMonth(initialStartDate.getMonth() - 3, 1);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(() => searchParams.get('category') || '');
    const [timeRange, setTimeRange] = useState(() => validDate(requestedStart) && validDate(requestedEnd) ? 'custom' : '3months');
    const [customStartDate, setCustomStartDate] = useState(() => validDate(requestedStart) ? requestedStart : inputDate(initialStartDate));
    const [customEndDate, setCustomEndDate] = useState(initialEnd);
    const [expenses, setExpenses] = useState([]);
    const [totalAmount, setTotalAmount] = useState(0);
    const [creditCards, setCreditCards] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
    const [splitPeople, setSplitPeople] = useState([]);
    const [splitDraft, setSplitDraft] = useState(null);
    const [splitError, setSplitError] = useState('');
    const [savingSplit, setSavingSplit] = useState(false);
    const [removingExpenseId, setRemovingExpenseId] = useState(null);
    const [actionError, setActionError] = useState('');
    const [analyticsSpending, setAnalyticsSpending] = useState([]);
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [analyticsRange, setAnalyticsRange] = useState('12months');
    const [reportingCurrency, setReportingCurrency] = useState('USD');
    const [generatingReport, setGeneratingReport] = useState(false);
    const categoryBrowserRef = useRef(null);
    const browserRequested = searchParams.get('section') === 'browser';

    useEffect(() => {
        if (account?.id) {
            loadCategories();
            loadCreditCards();
            api.getSplitPeople().then(setSplitPeople).catch(() => {});
            api.getFinancialProfile().then(profile => setReportingCurrency(profile?.reportingCurrency || 'USD')).catch(() => {});
            loadAnalytics();
        }
    // These loaders intentionally rerun only when the authenticated account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account]);

    useEffect(() => {
        if (selectedCategory && account?.id) {
            loadCategoryExpenses();
        }
    // loadCategoryExpenses reads the current filter state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCategory, timeRange, customStartDate, customEndDate, account]);

    useEffect(() => {
        const next = {};
        if (selectedCategory) next.category = selectedCategory;
        if (customStartDate) next.start = customStartDate;
        if (customEndDate) next.end = customEndDate;
        if (browserRequested) next.section = 'browser';
        setSearchParams(next, { replace: true });
    }, [selectedCategory, customStartDate, customEndDate, browserRequested, setSearchParams]);

    useEffect(() => {
        if (!browserRequested || analyticsLoading) return;
        categoryBrowserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [browserRequested, analyticsLoading]);

    const loadCategories = async () => {
        if (api) {
            const cats = await api.getCategories();
            setCategories(cats);
        }
    };

    const loadCreditCards = async () => {
        if (api && account?.id) {
            const [cards, banks] = await Promise.all([api.getCreditCards(account.id), api.getBankAccounts(account.id)]);
            setCreditCards([
                ...(cards || []),
                ...(banks || []).map(bank => ({ ...bank, name: bank.bankName || bank.name, institution: bank.institution || bank.simplefin?.institutionName || '' })),
            ]);
        }
    };

    const loadAnalytics = async () => {
        setAnalyticsLoading(true);
        try { setAnalyticsSpending(await api.getAllSpending()); }
        catch (error) { setActionError(error.message || 'Unable to load spending analytics.'); }
        finally { setAnalyticsLoading(false); }
    };

    const selectTimeRange = value => {
        setTimeRange(value);
        if (value === 'custom') return;
        const now = new Date();
        const start = value === '1year'
            ? new Date(now.getFullYear() - 1, now.getMonth(), 1)
            : new Date(now.getFullYear(), now.getMonth() - (value === '6months' ? 6 : 3), 1);
        setCustomStartDate(inputDate(start));
        setCustomEndDate(inputDate(now));
    };

    const loadCategoryExpenses = async () => {
        if (!api || !account?.id || !selectedCategory) return;

        setLoading(true);
        if (!validDate(customStartDate) || !validDate(customEndDate) || customEndDate < customStartDate) {
            setExpenses([]); setTotalAmount(0); setLoading(false); return;
        }
        const categoryExpenses = [];
        let total = 0;

        // Get all months in the date range
        const currentDate = new Date(`${customStartDate.slice(0, 7)}-01T12:00:00Z`);
        const endMonth = new Date(`${customEndDate.slice(0, 7)}-01T12:00:00Z`);
        while (currentDate <= endMonth) {
            const year = currentDate.getUTCFullYear();
            const month = currentDate.getUTCMonth() + 1;

            try {
                const monthlyData = await api.getMonthlySpending(account.id, year, month);

                monthlyData.forEach(cardData => {
                    const card = creditCards.find(c => c.id.toString() === cardData.cardId.toString());
                    const cardName = card ? `${card.institution} ${card.name}` : `Card ${cardData.cardId}`;

                    cardData.expenses?.forEach(expense => {
                        // Check both old format (categories array) and new format (mainCategory)
                        const expenseDate = String(expense.date || '').slice(0, 10);
                        const inExactRange = expenseDate >= customStartDate && expenseDate <= customEndDate;
                        const matchesCategory = inExactRange && (
                            (expense.categories && expense.categories.includes(selectedCategory)) ||
                            expense.mainCategory === selectedCategory
                        );

                        if (matchesCategory) {
                            categoryExpenses.push({
                                ...expense,
                                cardName,
                                cardId: cardData.cardId,
                                year,
                                month
                            });
                            total += expense.amount;
                        }
                    });
                });
            } catch (error) {
                console.error(`Error loading data for ${year}-${month}:`, error);
            }

            currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
        }

        // Sort by date (newest first)
        categoryExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));

        setExpenses(categoryExpenses);
        setTotalAmount(total);
        setLoading(false);
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString();
    };

    const getCategoryColor = (categoryName) => {
        const category = categories.find(cat =>
            (typeof cat === 'string' ? cat : cat.name) === categoryName
        );
        return category && typeof category === 'object' ? category.color : '#007bff';
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortedExpenses = () => {
        const sortedExpenses = [...expenses];

        sortedExpenses.sort((a, b) => {
            let aValue, bValue;

            switch (sortConfig.key) {
                case 'date':
                    aValue = new Date(a.date);
                    bValue = new Date(b.date);
                    break;
                case 'description':
                    aValue = a.description.toLowerCase();
                    bValue = b.description.toLowerCase();
                    break;
                case 'card':
                    aValue = a.cardName.toLowerCase();
                    bValue = b.cardName.toLowerCase();
                    break;
                case 'amount':
                    aValue = a.amount;
                    bValue = b.amount;
                    break;
                default:
                    return 0;
            }

            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });

        return sortedExpenses;
    };

    const getSortIcon = (columnKey) => {
        if (sortConfig.key !== columnKey) {
            return '↕️'; // Both arrows when not sorted
        }
        return sortConfig.direction === 'asc' ? '↑' : '↓';
    };

    const removeSelectedCategory = async expense => {
        if (removingExpenseId) return;
        setRemovingExpenseId(expense.id);
        setActionError('');
        const remaining = (expense.categories || []).filter(category => category !== selectedCategory);
        try {
            await api.updateExpense(account.id, expense.year, expense.month, expense.cardId, expense.id, {
                categories: remaining,
                mainCategory: remaining[0] || '',
                category: remaining[0] || 'Uncategorized',
            });
            setExpenses(current => current.filter(item => item.id !== expense.id));
            setTotalAmount(current => current - expense.amount);
            loadAnalytics();
        } catch (error) {
            setActionError(error.message || 'Unable to remove this category from the purchase.');
        } finally {
            setRemovingExpenseId(null);
        }
    };

    const openSplitPurchase = expense => {
        setSplitError('');
        setSplitDraft({
            expense,
            mode: expense.split?.mode || 'percent',
            allocations: expense.split?.allocations?.map(allocation => ({ ...allocation })) || [],
        });
    };

    const saveSplitPurchase = async event => {
        event.preventDefault();
        if (!splitDraft || savingSplit) return;
        setSavingSplit(true);
        setSplitError('');
        try {
            const updated = await api.updateExpenseSplit(splitDraft.expense.id, splitDraft.mode, splitDraft.allocations);
            setExpenses(current => current.map(expense => expense.id === updated.id
                ? { ...expense, ...updated, cardName: expense.cardName, cardId: expense.cardId, year: expense.year, month: expense.month }
                : expense));
            setTotalAmount(current => current - splitDraft.expense.amount + updated.amount);
            setSplitDraft(null);
            loadAnalytics();
        } catch (error) {
            setSplitError(error.message || 'Unable to save this split.');
        } finally {
            setSavingSplit(false);
        }
    };

    const splitPerson = personId => splitPeople.find(person => person.id === personId);
    const splitAssigned = splitDraft?.allocations.reduce((sum, allocation) => sum + (Number(allocation.value) || 0), 0) || 0;
    const splitMaximum = splitDraft?.mode === 'percent' ? 100 : Math.abs(Number(splitDraft?.expense.originalAmount ?? splitDraft?.expense.amount) || 0);
    const money = (amount, currency = reportingCurrency) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || reportingCurrency }).format(Number(amount) || 0);
    const wholeMoney = (amount, currency = reportingCurrency) => new Intl.NumberFormat(undefined, {
        style: 'currency', currency: currency || reportingCurrency, maximumFractionDigits: 0,
    }).format(Number(amount) || 0);

    const splitTotals = useMemo(() => {
        const totals = new Map();
        let splitPurchaseCount = 0;
        for (const expense of expenses) {
            const allocations = Array.isArray(expense.split?.allocations) ? expense.split.allocations : [];
            if (!allocations.length) continue;
            splitPurchaseCount += 1;
            const originalAmount = Math.abs(Number(expense.originalAmount ?? expense.amount) || 0);
            for (const allocation of allocations) {
                const personId = String(allocation.personId || '');
                if (!personId) continue;
                const value = Math.max(0, Number(allocation.value) || 0);
                const owed = expense.split.mode === 'percent' ? originalAmount * value / 100 : value;
                totals.set(personId, (totals.get(personId) || 0) + Math.round(owed * 100) / 100);
            }
        }
        return {
            people: [...totals.entries()].map(([personId, amount]) => ({
                personId,
                name: splitPeople.find(person => String(person.id) === personId)?.name || 'Unknown person',
                amount,
            })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
            splitPurchaseCount,
        };
    }, [expenses, splitPeople]);

    const downloadCategoryReport = async () => {
        if (!expenses.length || generatingReport) return;
        setGeneratingReport(true);
        setActionError('');
        try {
            const [{ jsPDF }, { default: autoTable }] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable'),
            ]);
            const doc = new jsPDF({ unit: 'pt', format: 'letter' });
            const pageWidth = doc.internal.pageSize.getWidth();
            const reportMoney = value => `${reportingCurrency} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
            const reportDate = value => new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            const splitDetails = expense => (expense.split?.allocations || []).map(allocation => {
                const person = splitPeople.find(candidate => String(candidate.id) === String(allocation.personId));
                const original = Math.abs(Number(expense.originalAmount ?? expense.amount) || 0);
                const share = expense.split.mode === 'percent' ? original * (Number(allocation.value) || 0) / 100 : Number(allocation.value) || 0;
                return `${person?.name || 'Unknown person'}: ${reportMoney(share)}`;
            }).join('\n') || 'Not split';

            doc.setProperties({
                title: `${selectedCategory} spending report`,
                subject: `Purchases and splits from ${customStartDate} through ${customEndDate}`,
                creator: 'Simpler Finance',
            });
            doc.setFillColor(78, 61, 168);
            doc.rect(0, 0, pageWidth, 108, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(21);
            doc.text('Category spending report', 42, 43);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.text(`${selectedCategory}  |  ${reportDate(customStartDate)} - ${reportDate(customEndDate)}`, 42, 66);
            doc.setFontSize(8);
            doc.setTextColor(224, 219, 255);
            doc.text('Generated from your filtered Analytics purchases', 42, 86);

            const originalTotal = expenses.reduce((sum, expense) => sum + (Number(expense.originalAmount ?? expense.amount) || 0), 0);
            const othersTotal = splitTotals.people.reduce((sum, person) => sum + person.amount, 0);
            const metrics = [
                ['PURCHASES', String(expenses.length)],
                ['ORIGINAL TOTAL', reportMoney(originalTotal)],
                ['YOUR SHARE', reportMoney(totalAmount)],
                ['OTHERS SHOULD PAY', reportMoney(othersTotal)],
            ];
            metrics.forEach(([label, value], index) => {
                const left = 42 + index * 128;
                doc.setFillColor(247, 247, 252);
                doc.roundedRect(left, 126, 116, 49, 6, 6, 'F');
                doc.setTextColor(119, 124, 143);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.text(label, left + 9, 143);
                doc.setTextColor(31, 35, 48);
                doc.setFontSize(10);
                doc.text(String(value), left + 9, 161, { maxWidth: 98 });
            });

            let tableStart = 198;
            if (splitTotals.people.length) {
                doc.setTextColor(31, 35, 48);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.text('Split totals', 42, tableStart);
                autoTable(doc, {
                    startY: tableStart + 10,
                    margin: { left: 42, right: 42 },
                    head: [['Person', 'Split purchases', 'Total they should pay']],
                    body: splitTotals.people.map(person => [
                        person.name,
                        String(expenses.filter(expense => expense.split?.allocations?.some(allocation => String(allocation.personId) === person.personId)).length),
                        reportMoney(person.amount),
                    ]),
                    theme: 'grid',
                    headStyles: { fillColor: [92, 75, 190], textColor: 255, fontSize: 8 },
                    bodyStyles: { textColor: [47, 51, 65], fontSize: 8, cellPadding: 6 },
                    alternateRowStyles: { fillColor: [248, 248, 252] },
                    columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
                });
                tableStart = doc.lastAutoTable.finalY + 28;
            }

            doc.setTextColor(31, 35, 48);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.text('Purchases', 42, tableStart);
            autoTable(doc, {
                startY: tableStart + 10,
                margin: { left: 30, right: 30, bottom: 34 },
                head: [['Date', 'Purchase', 'Account', 'Other tags', 'Split details', 'Original', 'Your share']],
                body: getSortedExpenses().map(expense => [
                    reportDate(expense.date),
                    expense.description,
                    expense.cardName,
                    (expense.categories || []).filter(category => category !== selectedCategory).join(', ') || 'None',
                    splitDetails(expense),
                    reportMoney(expense.originalAmount ?? expense.amount),
                    reportMoney(expense.amount),
                ]),
                theme: 'striped',
                headStyles: { fillColor: [50, 52, 68], textColor: 255, fontSize: 7, cellPadding: 5 },
                bodyStyles: { textColor: [47, 51, 65], fontSize: 7, cellPadding: 5, overflow: 'linebreak' },
                alternateRowStyles: { fillColor: [247, 247, 251] },
                columnStyles: {
                    0: { cellWidth: 54 }, 1: { cellWidth: 92 }, 2: { cellWidth: 70 },
                    3: { cellWidth: 62 }, 4: { cellWidth: 88 }, 5: { cellWidth: 58, halign: 'right' },
                    6: { cellWidth: 58, halign: 'right', fontStyle: 'bold' },
                },
            });

            const pageCount = doc.getNumberOfPages();
            for (let page = 1; page <= pageCount; page += 1) {
                doc.setPage(page);
                doc.setDrawColor(222, 224, 232);
                doc.line(30, 758, pageWidth - 30, 758);
                doc.setTextColor(130, 134, 150);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.text(`Private financial report  |  Page ${page} of ${pageCount}`, 30, 773);
                doc.text(new Date().toLocaleString(), pageWidth - 30, 773, { align: 'right' });
            }

            const safeCategory = selectedCategory.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
            doc.save(`${safeCategory}-${customStartDate}-to-${customEndDate}.pdf`);
        } catch (error) {
            setActionError(error.message || 'Unable to create the PDF report.');
        } finally {
            setGeneratingReport(false);
        }
    };

    const analytics = useMemo(() => {
        const now = new Date();
        const rangeMonths = analyticsRange === 'all' ? null : Number.parseInt(analyticsRange, 10);
        const start = rangeMonths ? new Date(now.getFullYear(), now.getMonth() - rangeMonths + 1, 1) : null;
        const accountNames = new Map(creditCards.map(card => [String(card.id), [card.name, card.institution].filter(Boolean).join(' — ') || 'Account']));
        const all = analyticsSpending.flatMap(record => (record.expenses || []).map(expense => ({
            ...expense,
            year: record.year,
            month: record.month,
            cardId: record.cardId,
            analyticsDate: new Date(`${String(expense.date || `${record.year}-${String(record.month).padStart(2, '0')}-01`).slice(0, 10)}T12:00:00`),
        }))).filter(expense => !Number.isNaN(expense.analyticsDate.getTime()) && (!start || expense.analyticsDate >= start) && String(expense.date || '').slice(0, 10) <= inputDate(now));

        const sum = values => values.reduce((total, value) => total + Number(value || 0), 0);
        const categoryTotals = new Map();
        const merchantTotals = new Map();
        const accountTotals = new Map();
        const weekdayTotals = new Map(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => [day, 0]));
        const monthlyTotals = new Map();
        for (const expense of all) {
            const amount = Number(expense.amount) || 0;
            const category = expense.mainCategory || expense.category || 'Uncategorized';
            const merchant = expense.description || 'Unknown merchant';
            const accountName = accountNames.get(String(expense.cardId)) || 'Unknown account';
            const monthKey = `${expense.analyticsDate.getFullYear()}-${String(expense.analyticsDate.getMonth() + 1).padStart(2, '0')}`;
            categoryTotals.set(category, (categoryTotals.get(category) || 0) + amount);
            merchantTotals.set(merchant, (merchantTotals.get(merchant) || 0) + amount);
            accountTotals.set(accountName, (accountTotals.get(accountName) || 0) + amount);
            const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][expense.analyticsDate.getDay()];
            weekdayTotals.set(weekday, (weekdayTotals.get(weekday) || 0) + amount);
            monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) || 0) + amount);
        }
        let monthKeys;
        if (rangeMonths) {
            monthKeys = Array.from({ length: rangeMonths }, (_, index) => {
                const date = new Date(now.getFullYear(), now.getMonth() - rangeMonths + index + 1, 1);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            });
        } else monthKeys = [...monthlyTotals.keys()].sort();
        const monthValues = monthKeys.map(key => monthlyTotals.get(key) || 0);
        const sortedCategories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
        const sortedMerchants = [...merchantTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        const sortedAccounts = [...accountTotals.entries()].sort((a, b) => b[1] - a[1]);
        const largest = [...all].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
        const total = sum(all.map(expense => expense.amount));
        const activeMonths = Math.max(1, monthValues.filter((_, index) => monthKeys[index] <= `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).length);
        const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
        const currentSpend = monthlyTotals.get(currentKey) || 0;
        const previousSpend = monthlyTotals.get(previousKey) || 0;
        return { all, total, average: total / activeMonths, currentSpend, monthChange: previousSpend ? ((currentSpend - previousSpend) / Math.abs(previousSpend)) * 100 : null, largest, sortedCategories, sortedMerchants, sortedAccounts, weekdayTotals, monthKeys, monthValues };
    }, [analyticsSpending, analyticsRange, creditCards]);

    const chartBase = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => money(context.raw) } } },
        scales: {
            x: { grid: { display: false }, ticks: { color: '#8791a7', maxRotation: 0, autoSkip: true } },
            y: { beginAtZero: true, grid: { color: 'rgba(127,127,127,.12)' }, ticks: { color: '#8791a7', callback: value => money(value).replace(/\.00$/, '') } },
        },
    };
    const wholeNumberChartBase = {
        ...chartBase,
        plugins: { ...chartBase.plugins, tooltip: { callbacks: { label: context => wholeMoney(context.raw) } } },
        scales: {
            ...chartBase.scales,
            y: { ...chartBase.scales.y, ticks: { ...chartBase.scales.y.ticks, precision: 0, callback: value => wholeMoney(value) } },
        },
    };
    const analyticsColors = analytics.sortedCategories.map(([name], index) => getCategoryColor(name) || ['#7658dc','#22a6b3','#f0932b','#eb4d4b'][index % 4]);

    if (!account) {
        return (
            <div className="no-account-message">
                <h2>No Account Selected</h2>
                <p>Please go back and select a profile to continue.</p>
            </div>
        );
    }

    return (
        <div className="page-container category-browser-page">
            <header className="analytics-page-header">
                <div><span className="page-eyebrow">Spending intelligence</span><h1 className="page-title">Analytics</h1><p>Understand where, when, and how your spending changes over time.</p></div>
                <label>Analysis period<select value={analyticsRange} onChange={event => setAnalyticsRange(event.target.value)}><option value="3months">Last 3 months</option><option value="6months">Last 6 months</option><option value="12months">Last 12 months</option><option value="all">All history</option></select></label>
            </header>

            {analyticsLoading ? <div className="content-card analytics-loading">Building your spending analysis…</div> : <>
                <section className="analytics-metric-grid" aria-label="Spending highlights">
                    <article><span>Period spending</span><strong>{money(analytics.total)}</strong><small>{analytics.all.length} transaction{analytics.all.length === 1 ? '' : 's'}</small></article>
                    <article><span>Monthly average</span><strong>{money(analytics.average)}</strong><small>Across the selected period</small></article>
                    <article><span>This month</span><strong>{money(analytics.currentSpend)}</strong><small className={analytics.monthChange > 0 ? 'analytics-up' : 'analytics-down'}>{analytics.monthChange == null ? 'No prior-month comparison' : `${Math.abs(analytics.monthChange).toFixed(1)}% ${analytics.monthChange > 0 ? 'more' : 'less'} than last month`}</small></article>
                    <article><span>Largest purchase</span><strong>{analytics.largest ? money(analytics.largest.amount, analytics.largest.reportingCurrency) : '—'}</strong><small>{analytics.largest?.description || 'No purchases in this period'}</small></article>
                </section>

                <section className="analytics-dashboard-grid">
                    <article className="content-card analytics-chart-card analytics-trend-card">
                        <header><div><span>Momentum</span><h2>Spending over time</h2></div><strong>{analytics.monthKeys.length} months</strong></header>
                        <div className="analytics-chart analytics-line-chart"><Line data={{ labels: analytics.monthKeys.map(key => new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })), datasets: [{ data: analytics.monthValues, borderColor: '#7658dc', backgroundColor: 'rgba(118,88,220,.14)', fill: true, tension: .35, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: '#7658dc' }] }} options={wholeNumberChartBase} /></div>
                    </article>

                    <article className="content-card analytics-chart-card analytics-category-card">
                        <header><div><span>Allocation</span><h2>Category mix</h2></div><strong>{analytics.sortedCategories.length} categories</strong></header>
                        <div className="analytics-category-layout">
                            <div className="analytics-donut"><Doughnut data={{ labels: analytics.sortedCategories.map(([name]) => name), datasets: [{ data: analytics.sortedCategories.map(([, value]) => Math.max(0, value)), backgroundColor: analyticsColors, borderWidth: 0, hoverOffset: 5 }] }} options={{ responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${wholeMoney(context.raw)}` } } } }} /></div>
                            <div className="analytics-category-list">{analytics.sortedCategories.slice(0, 7).map(([name, value], index) => <div key={name}><i style={{ '--analytics-color': analyticsColors[index] }} /><span>{name}</span><strong>{wholeMoney(value)}</strong><small>{analytics.total ? `${Math.round(Math.max(0, value / analytics.total * 100))}%` : '0%'}</small></div>)}</div>
                        </div>
                    </article>

                    <article className="content-card analytics-chart-card">
                        <header><div><span>Timing</span><h2>Spending by weekday</h2></div></header>
                        <div className="analytics-chart"><Bar data={{ labels: [...analytics.weekdayTotals.keys()], datasets: [{ data: [...analytics.weekdayTotals.values()], backgroundColor: 'rgba(34,166,179,.72)', borderRadius: 7, borderSkipped: false }] }} options={wholeNumberChartBase} /></div>
                    </article>

                    <article className="content-card analytics-chart-card">
                        <header><div><span>Concentration</span><h2>Top merchants</h2></div></header>
                        <div className="analytics-chart"><Bar data={{ labels: analytics.sortedMerchants.map(([name]) => name.length > 24 ? `${name.slice(0, 23)}…` : name), datasets: [{ data: analytics.sortedMerchants.map(([, value]) => value), backgroundColor: 'rgba(240,147,43,.76)', borderRadius: 7, borderSkipped: false }] }} options={{ ...chartBase, indexAxis: 'y', scales: { x: chartBase.scales.y, y: { grid: { display: false }, ticks: { color: '#8791a7' } } } }} /></div>
                    </article>

                    <article className="content-card analytics-chart-card analytics-account-card">
                        <header><div><span>Funding source</span><h2>Spending by account</h2></div></header>
                        <div className="analytics-account-list">{analytics.sortedAccounts.map(([name, value], index) => <div key={name}><span><i>{index + 1}</i><b>{name}</b></span><strong>{money(value)}</strong><div><i style={{ '--account-share': `${analytics.total ? Math.max(0, value / analytics.total * 100) : 0}%` }} /></div></div>)}{!analytics.sortedAccounts.length && <p>No spending in this period.</p>}</div>
                    </article>

                    <article className="content-card analytics-insights-card">
                        <header><div><span>Quick read</span><h2>Habits at a glance</h2></div></header>
                        <ul>
                            <li><span>Top category</span><strong>{analytics.sortedCategories[0]?.[0] || 'No data'}</strong><small>{analytics.sortedCategories[0] ? money(analytics.sortedCategories[0][1]) : '—'}</small></li>
                            <li><span>Most-used merchant</span><strong>{analytics.sortedMerchants[0]?.[0] || 'No data'}</strong><small>{analytics.sortedMerchants[0] ? money(analytics.sortedMerchants[0][1]) : '—'}</small></li>
                            <li><span>Highest-spend weekday</span><strong>{[...analytics.weekdayTotals.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] || 'No data'}</strong><small>Based on transaction dates</small></li>
                        </ul>
                    </article>
                </section>
            </>}

            <div className="analytics-browser-heading" ref={categoryBrowserRef}><div><span className="page-eyebrow">Transaction explorer</span><h2>Category browser</h2><p>Inspect individual purchases, adjust category membership, and manage splits.</p></div></div>

            {/* Controls */}
            <div className="content-card">
                <div className="category-browser-controls">
                    {/* Category Selection */}
                    <div className="form-group">
                        <label className="form-label">Category:</label>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="form-input category-browser-select"
                        >
                            <option value="">Select a category</option>
                            {categories.map((category, index) => {
                                const categoryName = typeof category === 'string' ? category : category.name;
                                return (
                                    <option key={index} value={categoryName}>
                                        {categoryName}
                                    </option>
                                );
                            })}
                        </select>
                    </div>

                    {/* Time Range Selection */}
                    <div className="form-group">
                        <label className="form-label">Time Range:</label>
                        <select
                            value={timeRange}
                            onChange={(e) => selectTimeRange(e.target.value)}
                            className="form-input"
                        >
                            <option value="3months">Last 3 Months</option>
                            <option value="6months">Last 6 Months</option>
                            <option value="1year">Last 1 Year</option>
                            <option value="custom">Custom Range</option>
                        </select>
                    </div>

                    {/* Exact date range */}
                            <div className="form-group category-date-control">
                                <label className="form-label">Start Date:</label>
                                <div className="category-date-input-frame">
                                    <input
                                        type="date"
                                        required
                                        value={customStartDate}
                                        max={customEndDate || undefined}
                                        onChange={(e) => { setTimeRange('custom'); setCustomStartDate(e.target.value); }}
                                        className="category-date-input"
                                    />
                                </div>
                            </div>
                            <div className="form-group category-date-control">
                                <label className="form-label">End Date:</label>
                                <div className="category-date-input-frame">
                                    <input
                                        type="date"
                                        required
                                        value={customEndDate}
                                        min={customStartDate || undefined}
                                        onChange={(e) => { setTimeRange('custom'); setCustomEndDate(e.target.value); }}
                                        className="category-date-input"
                                    />
                                </div>
                            </div>
                </div>
            </div>

            {/* Results */}
            {selectedCategory && (
                <div className="content-card">
                    <div className="category-browser-summary">
                        <h2 style={{ '--category-color': getCategoryColor(selectedCategory) }}>
                            <span
                                className="category-browser-dot"
                            ></span>
                            {selectedCategory}
                        </h2>
                        <div className="category-browser-summary-actions">
                            <div className="category-browser-total">
                                Total: ${totalAmount.toFixed(2)}
                            </div>
                            <button type="button" className="category-report-download" disabled={loading || !expenses.length || generatingReport} onClick={downloadCategoryReport}>
                                <Download size={15} aria-hidden="true" />
                                {generatingReport ? 'Creating PDF…' : 'Download report'}
                            </button>
                        </div>
                    </div>
                    {actionError && <p className="category-rule-error" role="alert">{actionError}</p>}

                    {loading ? (
                        <p>Loading expenses...</p>
                    ) : expenses.length === 0 ? (
                        <p>No expenses found for this category in the selected time range.</p>
                    ) : (
                        <div>
                            <p className="category-browser-count">
                                Found {expenses.length} expense{expenses.length !== 1 ? 's' : ''} in this category
                            </p>

                            <section className="category-split-totals" aria-labelledby="category-split-totals-title">
                                <div className="category-split-totals-heading">
                                    <div>
                                        <span>Shared expenses</span>
                                        <h3 id="category-split-totals-title">Split totals</h3>
                                    </div>
                                    <small>{splitTotals.splitPurchaseCount} split purchase{splitTotals.splitPurchaseCount !== 1 ? 's' : ''}</small>
                                </div>
                                {splitTotals.people.length ? <div className="category-split-total-list">
                                    {splitTotals.people.map(person => <div key={person.personId}>
                                        <span className="category-split-person-avatar" aria-hidden="true">{person.name.charAt(0).toLocaleUpperCase()}</span>
                                        <span><strong>{person.name}</strong><small>Should pay</small></span>
                                        <b>{money(person.amount)}</b>
                                    </div>)}
                                </div> : <p className="category-split-totals-empty">None of these purchases are currently split with anyone.</p>}
                            </section>

                            {/* Expenses Table */}
                            <div className="data-table-wrap">
                                <table className="data-table category-browser-table">
                                    <thead>
                                        <tr>
                                            <th
                                                className="sortable"
                                                onClick={() => handleSort('date')}
                                            >
                                                Date {getSortIcon('date')}
                                            </th>
                                            <th
                                                className="sortable"
                                                onClick={() => handleSort('description')}
                                            >
                                                Description {getSortIcon('description')}
                                            </th>
                                            <th
                                                className="sortable"
                                                onClick={() => handleSort('card')}
                                            >
                                                Card {getSortIcon('card')}
                                            </th>
                                            <th>
                                                Subcategories
                                            </th>
                                            <th>Split with</th>
                                            <th
                                                className="sortable numeric no-divider"
                                                onClick={() => handleSort('amount')}
                                            >
                                                Amount {getSortIcon('amount')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {getSortedExpenses().map((expense) => (
                                            <tr
                                                key={expense.id}
                                            >
                                                <td data-label="Date">
                                                    {formatDate(expense.date)}
                                                </td>
                                                <td data-label="Description">
                                                    <div className="category-purchase-name">
                                                        <span>{expense.description}</span>
                                                        <button type="button" className="category-purchase-remove" disabled={removingExpenseId === expense.id} onClick={() => removeSelectedCategory(expense)} aria-label={`Remove ${selectedCategory} from ${expense.description}`} title={`Remove ${selectedCategory} from this purchase`}>
                                                            {removingExpenseId === expense.id ? '…' : '×'}
                                                        </button>
                                                    </div>
                                                </td>
                                                <td data-label="Account">
                                                    {expense.cardName}
                                                </td>
                                                <td data-label="Tags">
                                                    {expense.categories && expense.categories.length > 0 ? (
                                                        <div className="category-tag-list">
                                                            {expense.categories
                                                                .filter(cat => cat !== selectedCategory) // Don't show the main selected category
                                                                .map((category, catIndex) => (
                                                                    <span
                                                                        key={catIndex}
                                                                        className="category-browser-tag"
                                                                        style={{ '--category-color': getCategoryColor(category) }}
                                                                    >
                                                                        {category}
                                                                    </span>
                                                                ))}
                                                        </div>
                                                    ) : (
                                                        <span className="category-none">
                                                            None
                                                        </span>
                                                    )}
                                                </td>
                                                <td data-label="Split with">
                                                    <div className="category-split-cell">
                                                        {expense.split?.allocations?.length ? <div className="category-split-people">
                                                            {expense.split.allocations.map(allocation => {
                                                                const person = splitPerson(allocation.personId);
                                                                return <span key={allocation.personId}>{person?.name || 'Unknown person'} · {expense.split.mode === 'percent' ? `${allocation.value}%` : money(allocation.value, expense.reportingCurrency)}</span>;
                                                            })}
                                                        </div> : <span className="category-none">Not split</span>}
                                                        <button type="button" className="category-split-button" onClick={() => openSplitPurchase(expense)}>{expense.split?.allocations?.length ? 'Edit split' : 'Split'}</button>
                                                    </div>
                                                </td>
                                                <td data-label="Amount" className="numeric strong no-divider">
                                                    ${expense.amount.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {splitDraft && createPortal(<div className="modal-overlay" onMouseDown={() => setSplitDraft(null)}>
                <form className="modal-content split-purchase-modal" onSubmit={saveSplitPurchase} onMouseDown={event => event.stopPropagation()}>
                    <button type="button" className="btn-close" onClick={() => setSplitDraft(null)}>×</button>
                    <h3 className="modal-title">Split purchase</h3>
                    <p>{splitDraft.expense.description} · Original {money(splitDraft.expense.originalAmount ?? splitDraft.expense.amount, splitDraft.expense.reportingCurrency)}</p>
                    {splitError && <p className="category-rule-error" role="alert">{splitError}</p>}
                    <SplitPurchaseFields people={splitPeople} draft={splitDraft} setDraft={setSplitDraft} maximum={splitMaximum} assigned={splitAssigned} saving={savingSplit} formatMoney={money} />
                </form>
            </div>, document.body)}
        </div>
    );
}
