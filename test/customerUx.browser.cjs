// Run with npm run test:ux after `npx playwright install chromium`.
// Uses the real API and encrypted fixtures in test/setup.js's private database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(process.env.BUDGET_DB_PATH?.includes('budget-app-test-'), 'Browser tests must use the private test database');
process.env.CUSTOMER_DATA_MASTER_KEY = crypto.randomBytes(32).toString('hex');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const { chromium } = require('playwright');
const express = require('express');
const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');
const app = require('../server/index');
const { db, sqlite } = require('../server/db');
const schema = require('../server/db/schema');
const { protectExpenseRecord, revealExpenseRecord, protectFinancialAccountData } = require('../server/lib/customerDataFields');
const { encryptAccessUrl } = require('../server/lib/simplefinCrypto');
const { createNotification } = require('../server/lib/notifications');
const { JWT_SECRET } = require('../server/middleware/auth');

const now = new Date();
const stamp = now.toISOString();
const accountId = `ux-review-${crypto.randomUUID()}`;
db.insert(schema.accounts).values({ id: accountId, name: 'Alex Morgan' }).run();
const user = db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'test-only', accountId, role: 'user', isActive: true, emailVerifiedAt: stamp, createdAt: stamp }).returning().get();
const categories = ['Food', 'Drinks', 'Travel', 'Work reimbursable', 'Seattle weekend', 'Shopping', 'Home & household', 'Groceries', 'Subscriptions'];
categories.forEach((name, i) => db.insert(schema.categories).values({ userId: accountId, name, color: ['#7658dc', '#1a9a9b', '#d88e30', '#c96391'][i % 4] }).run());
db.insert(schema.creditCards).values([{ id: 'ux-card', userId: accountId, name: 'Chase Sapphire Preferred', data: protectFinancialAccountData(sqlite, accountId, 'credit_card', JSON.stringify({ nickname: 'Everyday spending', institution: 'Chase' })) }, { id: 'ux-apple', userId: accountId, name: 'Apple Card (Updated Monthly)', data: protectFinancialAccountData(sqlite, accountId, 'credit_card', JSON.stringify({ institution: 'Goldman Sachs' })) }]).run();
db.insert(schema.bankAccounts).values({ id: 'ux-bank', userId: accountId, name: 'Emergency savings', data: protectFinancialAccountData(sqlite, accountId, 'bank', JSON.stringify({ bankName: 'Emergency savings', balance: 12000 })) }).run();
db.insert(schema.financialProfiles).values({ userId: accountId, monthlyIncome: 6200, yearlyIncome: 96000, yearlyIncomeAfterTax: 74400, monthlySpendLimit: 3600, percentToSave: 20, monthlySavingTarget: 1240, reportingCurrency: 'USD' }).run();
const fixtures = [
  ['Amazon Marketplace · Household supplies', 87.19, ['Shopping', 'Home & household', 'Work reimbursable']],
  ['The Pink Door Restaurant & Bar', 128.42, ['Food', 'Drinks', 'Travel', 'Work reimbursable', 'Seattle weekend']],
  ['Whole Foods Market', 142.68, ['Groceries']],
  ['Alaska Airlines · Seattle to San Francisco', 324.8, ['Travel', 'Work reimbursable', 'Seattle weekend']],
  ['Dinner with friends', 38.5, ['Food', 'Drinks']],
  ['Spotify', 11.99, ['Subscriptions']],
  ['Store refund', -25, ['Refunds']],
];
for (let offset = 0; offset < 6; offset++) {
  const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const spendingId = `ux-month-${offset}`;
  db.insert(schema.monthlySpending).values({ id: spendingId, userId: accountId, cardId: 'ux-card', year: date.getFullYear(), month: date.getMonth() + 1 }).run();
  fixtures.forEach(([description, amount, tags], index) => db.insert(schema.expenses).values(protectExpenseRecord(sqlite, accountId, { id: `ux-expense-${offset}-${index}`, spendingId, description, amount, category: tags[0], date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(Math.max(1, Math.min(now.getDate(), 25) - index)).padStart(2, '0')}`, data: JSON.stringify({ categories: tags, mainCategory: tags[0], reportingCurrency: 'USD', notes: index === 0 ? 'Check the refund before returning the item.' : '', source: index === 3 ? 'simplefin' : 'manual', pending: index === 3 }) })).run());
}
db.insert(schema.detectedSubscriptions).values({ id: 'ux-subscription', userId: accountId, description: 'Spotify', averageAmount: 11.99, totalPaid: 71.94, occurrences: 6, consecutiveMonths: 6, isActive: true, firstDetected: '2026-01-01', lastPayment: stamp.slice(0, 10) }).run();
db.insert(schema.simplefinConnections).values({ id: 'ux-connection', userId: accountId, ...encryptAccessUrl('https://test.invalid/simplefin', accountId), status: 'reconnect_required', createdAt: stamp, lastSyncSucceededAt: stamp, lastError: 'Authentication required' }).run();
db.insert(schema.simplefinAccounts).values({ id: 'ux-remote-account', connectionId: 'ux-connection', remoteAccountId: 'test-account', remoteName: 'Apple Card', institutionName: 'Goldman Sachs', currency: 'USD', balance: '-520.21', firstSeenAt: stamp, lastSeenAt: stamp, balanceDate: stamp }).run();
db.insert(schema.financialAccountLinks).values({ id: 'ux-link', userId: accountId, simplefinAccountId: 'ux-remote-account', localAccountType: 'credit_card', localAccountId: 'ux-apple', status: 'linked', transactionSyncEnabled: false, createdAt: stamp, linkedAt: stamp }).run();
const dueAt = new Date(Date.now() + 3 * 86400000).toISOString();
sqlite.prepare('INSERT INTO purchase_reminders(expense_id,account_id,due_at) VALUES(?,?,?)').run('ux-expense-0-0', accountId, dueAt);
createNotification(accountId, { title: 'Purchase reminder', message: 'Check this purchase.', metadata: { expenseId: 'ux-expense-0-0', purchaseDescription: fixtures[0][0] } });
app.use(express.static(path.resolve(__dirname, '../dist')));
app.get('/{*path}', (_, res) => res.sendFile(path.resolve(__dirname, '../dist/index.html')));

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = process.env.UX_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'simplerfinance-ux-implemented-'));
  fs.mkdirSync(output, { recursive: true });
  let browser;
  const errors = [];
  let currentPage;
  const widths = process.env.UX_WIDTHS ? process.env.UX_WIDTHS.split(',').map(Number) : [360, 390, 430, 768, 1440];
  const routes = [['overview', '/overview'], ['spending', '/monthly-spending'], ['accounts', '/accounts_overview'], ['analytics', '/category-browser'], ['subscriptions', '/detected-subscriptions'], ['settings', '/settings'], ['activity', '/activity'], ['connections', '/settings?panel=simplefin'], ['more', '/more'], ['all-subscriptions', '/detected-subscriptions?view=list'], ['appearance', '/settings?panel=appearance'], ['upcoming', '/settings?panel=upcoming']];
  const token = jwt.sign({ userId: user.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '15m' });
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 769, hasTouch: width < 769 });
      await context.addCookies([{ name: 'token', value: token, url: base }]);
      const page = await context.newPage();
      currentPage = page;
      page.on('pageerror', error => errors.push(error.message));
      for (const [name, route] of routes) {
        await page.goto(base + route);
        await page.locator('.ux-app-header').waitFor();
        await page.locator('.main-content > .page-container, .main-content > .dashboard-page').waitFor();
        await page.waitForTimeout(500);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} overflows at ${width}px`);
        if (name === 'spending') {
          await page.locator('.monthly-account-row').first().click();
          await page.locator('.ux-purchase-row').first().waitFor();
          await page.waitForTimeout(350);
          assert.equal(await page.locator('.monthly-spending-page .category-breakdown').count(), 0);
          assert.equal(await page.locator('.ux-spending-pie canvas').count(), 1);
          assert.ok(await page.locator('.ux-purchase-row img.ux-vendor-icon').count() > 0, 'Vendor icons must be retained');
          if ([390, 1440].includes(width)) await page.screenshot({ path: path.join(output, `spending-summary-${width}.png`), animations: 'disabled' });
          assert.equal(await page.getByText('Refunds reduce the total.', { exact: false }).count(), 0);
          if (width > 768) {
            assert.equal(await page.locator('.ux-purchase-row').first().locator('.ux-expanded-tags .ux-chip').count(), 3, 'Desktop expands every purchase category');
            assert.equal(await page.locator('.ux-purchase-row').first().locator('button.ux-tag-summary').count(), 0, 'Desktop category labels are display-only');
            const chart = await page.locator('.ux-spending-pie').boundingBox();
            const metrics = await page.locator('.ux-month-metrics').boundingBox();
            assert.ok(chart.x < metrics.x, 'The desktop pie chart sits beside the spending figures on the left');
          }
          await page.locator('.ux-purchase-row').last().evaluate(el => scrollTo({ top: el.getBoundingClientRect().top + scrollY - 130, behavior: 'instant' }));
          await page.locator('.ux-row-menu-trigger').last().click();
          await page.locator('.ux-purchase-menu').waitFor();
          assert.ok(await page.locator('.ux-purchase-menu').evaluate(el => {
            const rect = el.getBoundingClientRect();
            return el.parentElement === document.body && el.contains(document.elementFromPoint(rect.left + 20, rect.bottom - 20));
          }), 'The last purchase menu paints above subsequent account cards');
          if ([390, 1440].includes(width)) await page.screenshot({ path: path.join(output, `spending-menu-${width}.png`), animations: 'disabled' });
          await page.locator('.ux-purchase-menu').getByRole('button', { name: 'Edit categories', exact: true }).click();
          await page.getByRole('dialog', { name: 'Categories & tags' }).waitFor();
          await page.keyboard.press('Escape');
          await page.locator('.ux-sheet-overlay').waitFor({ state: 'detached' });
          await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        }
        if (name === 'settings') {
          const gap = await page.evaluate(() => document.querySelector('.settings-session-card').getBoundingClientRect().top - document.querySelector('.settings-workspace').getBoundingClientRect().bottom);
          assert.ok(gap >= 20, 'Sign out is separated from account and security settings');
        }
        if (name === 'analytics') await page.getByRole('img', { name: 'Overall spending pie chart by category' }).waitFor();
        if (name === 'subscriptions') assert.ok(await page.locator('.subscription-calendar-grid').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'The entire calendar must fit without horizontal scrolling');
        if (name === 'subscriptions' && width === 390) {
          await page.locator('.subscription-calendar-agenda').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, 'agenda-390.png'), animations: 'disabled' });
          await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        }
        if ([390, 1440].includes(width)) {
          await page.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: 'disabled' });
          if (name === 'analytics') await page.locator('.analytics-category-card').screenshot({ path: path.join(output, `analytics-pie-${width}.png`), animations: 'disabled' });
        }
      }
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: 'token', value: token, url: base }]);
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/monthly-spending');
    await page.locator('.monthly-account-row').first().click();
    await page.getByRole('button', { name: `Edit categories for ${fixtures[0][0]}` }).click();
    await page.getByRole('checkbox', { name: 'Travel', exact: true }).check();
    await page.locator('.ux-category-option').filter({ hasText: 'Travel' }).getByRole('button', { name: 'Set primary' }).click();
    await page.getByRole('button', { name: 'Done · 4 selected' }).click();
    await page.getByLabel('Purchase note', { exact: true }).fill('Encrypted UX test note: follow up on the refund.');
    await page.getByRole('button', { name: 'Close purchase details' }).click();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await page.evaluate(() => history.back());
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert.ok(page.url().includes('purchase=ux-expense-0-0'), 'Browser back must preserve unsaved edits when canceled');
    assert.equal(await page.getByLabel('Purchase note', { exact: true }).inputValue(), 'Encrypted UX test note: follow up on the refund.');
    await page.screenshot({ path: path.join(output, 'purchase-390.png') });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.locator('.ux-sheet-overlay').waitFor({ state: 'detached' });
    const stored = db.select().from(schema.expenses).where(eq(schema.expenses.id, 'ux-expense-0-0')).get();
    assert.ok(!stored.encryptedPayload.includes('Encrypted UX test note'));
    const revealed = revealExpenseRecord(sqlite, stored);
    assert.equal(JSON.parse(revealed.data).notes, 'Encrypted UX test note: follow up on the refund.');
    assert.equal(JSON.parse(revealed.data).mainCategory, 'Travel');

    await page.goto(base + '/activity');
    await page.getByRole('button', { name: 'Open purchase', exact: true }).click();
    await page.getByRole('button', { name: 'Close purchase details' }).click();
    assert.equal(await page.locator('.ux-notice').count(), 1, 'Opening must not acknowledge the notification');
    await page.getByRole('button', { name: 'Upcoming events', exact: true }).click();
    await page.getByRole('button', { name: `Cancel reminder for ${fixtures[0][0]}` }).click();
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM purchase_reminders WHERE expense_id=?').get('ux-expense-0-0').count, 0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: `Cancel reminder for ${fixtures[0][0]}` }).waitFor();
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM purchase_reminders WHERE expense_id=?').get('ux-expense-0-0').count, 1);
    assert.equal(JSON.parse(revealExpenseRecord(sqlite, db.select().from(schema.expenses).where(eq(schema.expenses.id, 'ux-expense-0-0')).get()).data).notes, 'Encrypted UX test note: follow up on the refund.');

    await page.goto(base + '/category-browser?section=browser');
    await page.getByRole('button', { name: /Filters/ }).click();
    await page.getByLabel('Add a category to the filter').selectOption({ label: 'Food' });
    await page.getByLabel('Add a category to the filter').selectOption({ label: 'Drinks' });
    const inputs = page.locator('.ux-sheet input[type="date"]');
    await inputs.nth(0).fill(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    await inputs.nth(1).fill(stamp.slice(0, 10));
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.ux-explorer-mobile-list .ux-purchase-row').count(), 2, 'Overlapping Food/Drinks purchases must appear once');
    await page.screenshot({ path: path.join(output, 'explorer-390.png') });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('img', { name: 'Overall spending pie chart by category' }).waitFor();
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await page.locator('.ux-explorer-mobile-list .ux-purchase-row').first().waitFor();
    assert.equal(await page.locator('.ux-explorer-mobile-list .ux-purchase-row').count(), 2, 'Tabs must retain filters');

    await page.goto(base + '/accounts_overview');
    await page.getByRole('button', { name: /Emergency savings/ }).click();
    await page.getByRole('checkbox', { name: 'Include in tracked net worth' }).click();
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Include in tracked net worth"]').checked);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('.ux-sheet-overlay').waitFor({ state: 'detached' });
    await page.goto(base + '/overview');
    await page.locator('.ux-tracked-total').waitFor();
    await page.getByRole('button', { name: 'Hide balances' }).click();
    assert.equal(await page.locator('.ux-hero-amount').innerText(), '••••••');

    await page.evaluate(id => localStorage.setItem(`budget:appearance:${id}`, JSON.stringify({ isDarkMode: true, colorTheme: 'violet' })), accountId);
    await page.goto(base + '/monthly-spending');
    await page.waitForFunction(() => document.documentElement.dataset.themeMode === 'dark');
    await page.locator('.monthly-account-row').first().click();
    await page.locator('.ux-purchase-row').first().waitFor();
    await page.screenshot({ path: path.join(output, 'spending-dark-390.png'), animations: 'disabled' });
    await page.getByRole('button', { name: `View purchase details for ${fixtures[0][0]}` }).click();
    await page.getByLabel('Purchase note', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'purchase-dark-390.png'), animations: 'disabled' });
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('.ux-sheet').evaluate(el => el.contains(document.activeElement)), 'Keyboard focus stays inside the sheet');
    await page.keyboard.press('Escape');
    await page.locator('.ux-sheet-overlay').waitFor({ state: 'detached' });
    await context.close();
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(`UX browser checks passed: ${widths.length * routes.length} route/viewport combinations, dark mode, vendor icons, both pie charts, purchase/tag saves, encrypted notes, unsaved browser-back protection, notification navigation, cancellation/undo, category deduplication, tracked net worth, privacy, and keyboard focus. Screenshots: ${output}`);
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) { await currentPage.screenshot({ path: path.join(output, 'failure.png') }); console.error('Browser failure:', currentPage.url(), await currentPage.locator('body').innerText(), errors, 'Screenshots:', output); }
    throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
