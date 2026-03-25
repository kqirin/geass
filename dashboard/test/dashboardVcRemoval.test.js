import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DASHBOARD_TABS } from '../src/components/Dashboard/shell/dashboardTabConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, '..');

test('dashboard tabs no longer expose the legacy voice-control surface', () => {
  assert.equal(DASHBOARD_TABS.some((tab) => tab.id === 'vc'), false);
});

test('dashboard removes legacy VC components and route wiring', () => {
  const vcComponentPath = path.join(dashboardRoot, 'src', 'components', 'Dashboard', 'VC.jsx');
  const vcDirectoryPath = path.join(dashboardRoot, 'src', 'components', 'Dashboard', 'vc');
  const dashboardPagePath = path.join(dashboardRoot, 'src', 'pages', 'Dashboard.jsx');
  const dashboardPageSource = fs.readFileSync(dashboardPagePath, 'utf8');
  const vcDirectoryEntries = fs.existsSync(vcDirectoryPath) ? fs.readdirSync(vcDirectoryPath) : [];

  assert.equal(fs.existsSync(vcComponentPath), false);
  assert.deepEqual(vcDirectoryEntries, []);
  assert.equal(dashboardPageSource.includes("activeTab === 'vc'"), false);
  assert.equal(dashboardPageSource.includes("components/Dashboard/VC"), false);
});
