import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, '..');

test('dashboard source includes real read-only log-system section states', () => {
  const dashboardPagePath = path.join(dashboardRoot, 'src', 'pages', 'Dashboard.jsx');
  const dashboardPageSource = fs.readFileSync(dashboardPagePath, 'utf8');

  assert.equal(dashboardPageSource.includes("id: 'log-system'"), true);
  assert.equal(dashboardPageSource.includes('Moderasyon Logları'), true);
  assert.equal(dashboardPageSource.includes('Komut Logları'), true);
  assert.equal(dashboardPageSource.includes('Sistem Olayları'), true);

  assert.equal(dashboardPageSource.includes('Log kayıtları yükleniyor'), true);
  assert.equal(dashboardPageSource.includes('Log kayıtları okunamadı'), true);
  assert.equal(dashboardPageSource.includes('Kaynak aktif değil'), true);
  assert.equal(
    dashboardPageSource.includes('Bu sunucuda henüz kayıt bulunmuyor.'),
    true
  );

  assert.equal(
    dashboardPageSource.includes('/api/dashboard/protected/logs/moderation'),
    true
  );
  assert.equal(
    dashboardPageSource.includes('/api/dashboard/protected/logs/commands'),
    true
  );
  assert.equal(
    dashboardPageSource.includes('/api/dashboard/protected/logs/system'),
    true
  );
});
