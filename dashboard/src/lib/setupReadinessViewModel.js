export const SETUP_READINESS_STATUS = Object.freeze({
  READY: 'ready',
  WARNING: 'warning',
  INCOMPLETE: 'incomplete',
});

export const DEFAULT_SETUP_READINESS_SECTION_DEFINITIONS = Object.freeze([
  { id: 'static-config', title: 'Statik Yapilandirma' },
  { id: 'private-room', title: 'Ozel Oda Sistemi' },
  { id: 'startup-voice', title: 'Baslangic Ses Kanali' },
  { id: 'moderation-roles', title: 'Moderasyon Rolleri' },
  { id: 'tag-role', title: 'Tag Rol Sistemi' },
  { id: 'command-policy', title: 'Komut Politikalari' },
]);

function toKnownStatus(rawStatus = '') {
  const normalizedStatus = String(rawStatus || '').trim().toLowerCase();
  if (
    normalizedStatus === SETUP_READINESS_STATUS.READY ||
    normalizedStatus === SETUP_READINESS_STATUS.WARNING ||
    normalizedStatus === SETUP_READINESS_STATUS.INCOMPLETE
  ) {
    return normalizedStatus;
  }
  return SETUP_READINESS_STATUS.WARNING;
}

function toSafeArray(rawValue) {
  return Array.isArray(rawValue) ? rawValue : [];
}

function toSafeScore(rawValue) {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function toSafeCount(rawValue) {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.floor(numericValue));
}

export function createDefaultSetupReadinessModel() {
  const sections = DEFAULT_SETUP_READINESS_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.title,
    status: SETUP_READINESS_STATUS.WARNING,
    checks: [],
  }));
  return {
    contractVersion: 1,
    guildId: null,
    summary: {
      status: SETUP_READINESS_STATUS.WARNING,
      score: 0,
      totalChecks: 0,
      passedChecks: 0,
      warningChecks: 0,
      failedChecks: 0,
    },
    sections,
    issues: [],
  };
}

export function normalizeSetupReadinessPayload(rawPayload = null) {
  const base = createDefaultSetupReadinessModel();
  const payload =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? rawPayload
      : {};

  const rawSummary =
    payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
      ? payload.summary
      : {};
  const normalizedSummary = {
    status: toKnownStatus(rawSummary.status),
    score: toSafeScore(rawSummary.score),
    totalChecks: toSafeCount(rawSummary.totalChecks),
    passedChecks: toSafeCount(rawSummary.passedChecks),
    warningChecks: toSafeCount(rawSummary.warningChecks),
    failedChecks: toSafeCount(rawSummary.failedChecks),
  };

  const incomingSections = new Map();
  for (const rawSection of toSafeArray(payload.sections)) {
    if (!rawSection || typeof rawSection !== 'object') continue;
    const id = String(rawSection.id || '').trim();
    if (!id) continue;
    incomingSections.set(id, {
      id,
      title: String(rawSection.title || '').trim() || id,
      status: toKnownStatus(rawSection.status),
      checks: toSafeArray(rawSection.checks),
    });
  }

  const normalizedSections = DEFAULT_SETUP_READINESS_SECTION_DEFINITIONS.map((definition) => {
    const incoming = incomingSections.get(definition.id);
    if (incoming) return incoming;
    return {
      id: definition.id,
      title: definition.title,
      status: SETUP_READINESS_STATUS.WARNING,
      checks: [],
    };
  });

  const normalizedIssues = toSafeArray(payload.issues)
    .filter((issue) => issue && typeof issue === 'object')
    .map((issue) => ({
      severity:
        issue.severity === 'error' || issue.severity === 'warning' || issue.severity === 'info'
          ? issue.severity
          : 'warning',
      reasonCode: String(issue.reasonCode || '').trim() || null,
      title: String(issue.title || '').trim() || 'Kurulum uyarisi',
      description:
        String(issue.description || '').trim() ||
        'Kurulum durumunda bir uyari bulundu.',
      targetType: String(issue.targetType || '').trim() || 'config',
      targetKey: String(issue.targetKey || '').trim() || null,
    }));

  return {
    ...base,
    contractVersion: Number(payload.contractVersion || base.contractVersion),
    guildId: String(payload.guildId || '').trim() || null,
    summary: normalizedSummary,
    sections: normalizedSections,
    issues: normalizedIssues,
  };
}

export function getSetupReadinessStatusLabel(status = '') {
  const normalizedStatus = toKnownStatus(status);
  if (normalizedStatus === SETUP_READINESS_STATUS.READY) return 'Hazir';
  if (normalizedStatus === SETUP_READINESS_STATUS.INCOMPLETE) return 'Eksik Kurulum';
  return 'Uyari Var';
}

export function getSetupReadinessIssueCategory(issue = {}) {
  const targetType = String(issue?.targetType || '').trim().toLowerCase();
  const reasonCode = String(issue?.reasonCode || '').trim().toLowerCase();
  if (targetType === 'role') return 'Eksik rol';
  if (targetType === 'channel' || targetType === 'category') return 'Eksik kanal';
  if (reasonCode.includes('missing') || reasonCode.includes('not_configured')) {
    return 'Ayar bulunamadi';
  }
  return 'Dogrulama uyarisi';
}

export function resolveSetupReadinessSectionState({
  setupReadiness = null,
  isLoading = false,
  error = null,
} = {}) {
  if (isLoading && !setupReadiness) return 'loading';
  if (error) return 'error';
  if (!setupReadiness) return 'loading';
  return 'ready';
}
