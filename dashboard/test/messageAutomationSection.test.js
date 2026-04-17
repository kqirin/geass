import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, '..');

test('dashboard source includes message automation section wiring', () => {
  const dashboardPagePath = path.join(dashboardRoot, 'src', 'pages', 'Dashboard.jsx');
  const messageAutomationModelPath = path.join(
    dashboardRoot,
    'src',
    'lib',
    'messageAutomationViewModel.js'
  );
  const dashboardPageSource = fs.readFileSync(dashboardPagePath, 'utf8');
  const messageAutomationModelSource = fs.readFileSync(messageAutomationModelPath, 'utf8');

  assert.equal(dashboardPageSource.includes("id: 'message-automation'"), true);
  assert.equal(dashboardPageSource.includes('Mesaj Otomasyonu'), true);
  assert.equal(dashboardPageSource.includes('MESSAGE_AUTOMATION_MODULES'), true);
  assert.equal(messageAutomationModelSource.includes('Ho\u015f Geldin'), true);
  assert.equal(messageAutomationModelSource.includes('Ho\u015f\u00e7a Kal'), true);
  assert.equal(messageAutomationModelSource.includes('Boost'), true);
  assert.equal(
    dashboardPageSource.includes('GET/PUT /api/dashboard/protected/message-automation'),
    true
  );
});
