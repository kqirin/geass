/**
 * Lightweight performance monitor — ENV-gated (PERF_MONITOR=1, default OFF).
 * No PII. Outputs via console.log at INFO level.
 */

const ENABLED = String(process.env.PERF_MONITOR || '') === '1';
const SNAPSHOT_INTERVAL_MS = 60_000;
const LAG_SAMPLE_INTERVAL_MS = 2_000;
const SLOW_QUERY_THRESHOLD_MS = Number(process.env.PERF_SLOW_QUERY_MS) || 100;

const counters = {
    messageCreate: 0,
    commandsExecuted: 0,
    dbQueriesTotal: 0,
    dbQueriesSlow: 0,
};

let lagTimer = null;
let snapshotTimer = null;
let lastLagSampleTs = 0;

function incCounter(name) {
    if (!ENABLED) return;
    if (counters[name] !== undefined) counters[name] += 1;
}

function getCounters() {
    return { ...counters };
}

function getSlowQueryThreshold() {
    return SLOW_QUERY_THRESHOLD_MS;
}

function isEnabled() {
    return ENABLED;
}

function start() {
    if (!ENABLED) return;

    // Event loop lag sampling
    lastLagSampleTs = Date.now();
    lagTimer = setInterval(() => {
        const now = Date.now();
        const drift = now - lastLagSampleTs - LAG_SAMPLE_INTERVAL_MS;
        lastLagSampleTs = now;
        if (drift > 50) {
            console.log(`[PERF] event_loop_lag=${drift}ms`);
        }
    }, LAG_SAMPLE_INTERVAL_MS);
    if (lagTimer.unref) lagTimer.unref();

    // Memory + counters snapshot
    snapshotTimer = setInterval(() => {
        const mem = process.memoryUsage();
        console.log(
            `[PERF] rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB` +
            ` ext=${(mem.external / 1024 / 1024).toFixed(1)}MB` +
            ` msgs=${counters.messageCreate} cmds=${counters.commandsExecuted}` +
            ` dbTotal=${counters.dbQueriesTotal} dbSlow=${counters.dbQueriesSlow}`
        );
    }, SNAPSHOT_INTERVAL_MS);
    if (snapshotTimer.unref) snapshotTimer.unref();

    console.log(`[PERF] monitor started (slowQueryMs=${SLOW_QUERY_THRESHOLD_MS})`);
}

function stop() {
    if (lagTimer) { clearInterval(lagTimer); lagTimer = null; }
    if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
}

module.exports = {
    isEnabled,
    start,
    stop,
    incCounter,
    getCounters,
    getSlowQueryThreshold,
};
