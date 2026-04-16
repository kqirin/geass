import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultSetupReadinessModel,
  getSetupReadinessIssueCategory,
  getSetupReadinessStatusLabel,
  normalizeSetupReadinessPayload,
  resolveSetupReadinessSectionState,
} from '../src/lib/setupReadinessViewModel.js';

test('setup-readiness status labels map to dashboard labels', () => {
  assert.equal(getSetupReadinessStatusLabel('ready'), 'Hazir');
  assert.equal(getSetupReadinessStatusLabel('warning'), 'Uyari Var');
  assert.equal(getSetupReadinessStatusLabel('incomplete'), 'Eksik Kurulum');
});

test('setup-readiness issue category labels map to Turkish issue chips', () => {
  assert.equal(
    getSetupReadinessIssueCategory({ targetType: 'channel', reasonCode: 'missing' }),
    'Eksik kanal'
  );
  assert.equal(
    getSetupReadinessIssueCategory({ targetType: 'role', reasonCode: 'missing' }),
    'Eksik rol'
  );
  assert.equal(
    getSetupReadinessIssueCategory({
      targetType: 'config',
      reasonCode: 'tag_role_not_configured',
    }),
    'Ayar bulunamadi'
  );
  assert.equal(
    getSetupReadinessIssueCategory({
      targetType: 'permission',
      reasonCode: 'unverified',
    }),
    'Dogrulama uyarisi'
  );
});

test('setup-readiness payload normalization keeps six cards and safe defaults', () => {
  const normalized = normalizeSetupReadinessPayload({
    contractVersion: 1,
    guildId: 'g-1',
    summary: {
      status: 'ready',
      score: 96,
      totalChecks: 12,
      passedChecks: 11,
      warningChecks: 1,
      failedChecks: 0,
    },
    sections: [
      {
        id: 'static-config',
        title: 'Statik Yapilandirma',
        status: 'ready',
        checks: [{ id: 'a' }],
      },
      {
        id: 'private-room',
        title: 'Ozel Oda Sistemi',
        status: 'warning',
        checks: [{ id: 'b' }],
      },
    ],
    issues: [
      {
        severity: 'warning',
        reasonCode: 'private_vc_hub_channel_missing',
        title: 'Eksik kanal',
        description: 'Hub kanali bulunamadi',
        targetType: 'channel',
        targetKey: 'private_vc_hub_channel',
      },
    ],
  });

  assert.equal(normalized.summary.status, 'ready');
  assert.equal(normalized.summary.score, 96);
  assert.equal(normalized.guildId, 'g-1');
  assert.equal(normalized.sections.length, 6);
  assert.equal(normalized.sections[0].id, 'static-config');
  assert.equal(normalized.sections[1].id, 'private-room');
  assert.equal(normalized.issues.length, 1);
});

test('setup-readiness section state resolves loading, error, and ready safely', () => {
  const base = createDefaultSetupReadinessModel();
  assert.equal(
    resolveSetupReadinessSectionState({
      setupReadiness: null,
      isLoading: true,
      error: null,
    }),
    'loading'
  );
  assert.equal(
    resolveSetupReadinessSectionState({
      setupReadiness: base,
      isLoading: false,
      error: { code: 'internal_error' },
    }),
    'error'
  );
  assert.equal(
    resolveSetupReadinessSectionState({
      setupReadiness: base,
      isLoading: false,
      error: null,
    }),
    'ready'
  );
});
