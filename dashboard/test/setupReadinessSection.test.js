import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, '..');

test('dashboard source includes read-only setup readiness section wiring', () => {
  const dashboardPagePath = path.join(dashboardRoot, 'src', 'pages', 'Dashboard.jsx');
  const dashboardPageSource = fs.readFileSync(dashboardPagePath, 'utf8');

  assert.equal(dashboardPageSource.includes("id: 'setup-readiness'"), true);
  assert.equal(
    dashboardPageSource.includes('Bu ekran simdilik sadece kurulum durumunu gosterir'),
    true
  );
  assert.equal(
    dashboardPageSource.includes('GET /api/dashboard/protected/setup-readiness'),
    true
  );
});
