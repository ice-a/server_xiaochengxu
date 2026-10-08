'use strict';

// 任务编排：claim job → AI 定级 → verify(官方库) → 写 verdicts
// 兼容两种运行环境：
//   - 常驻容器（云托管 / CloudBase Run）：用 startWorker 的定时器扫描 pending；
//   - 无服务器（Vercel）：无常驻进程，由 getVerdict 调 processJobById 惰性处理。
const { C, _ } = require('./db');
const { callAI } = require('./ai');
const { ruleEngine, matchOfficial } = require('./rules');
const { ANALYZE_SYS } = require('./prompt');
const { AI } = require('./config');

// 任务超过该时长仍处 running 视为超时残留（被 serverless 冷杀/进程崩溃），允许重新认领。
// 既能恢复卡死的 job，又避免并发轮询重复认领同一条（见 processJobById）。
const STALE_MS = 60000;

// 认领一个待处理任务（多实例部署时靠条件更新抢占，避免重复处理）。
// 认领条件：pending，或 running 但已超时（updated_at 早于 now-STALE_MS）。
// 文档库无 SELECT FOR UPDATE，故先取候选，再用「只在该状态时才置 running」的条件更新抢占；
// 抢占成功（updated=1）才处理，否则视为被其他实例认领，返回 null。
async function claimNextJob() {
  const now = Date.now();
  const staleTs = now - STALE_MS;
  const { data } = await C.jobs
    .where(
      _.or([
        { status: 'pending' },
        { status: 'running', updated_at: _.lt(staleTs) },
      ])
    )
    .orderBy('created_at', 'asc')
    .limit(1)
    .get();
  if (!data.length) return null;
  const job = data[0];
  const upd1 = await C.jobs
    .where({ _id: job._id, status: 'pending' })
    .update({ status: 'running', stage: 1, updated_at: now });
  if (upd1.stats.updated !== 1) {
    const upd2 = await C.jobs
      .where({ _id: job._id, status: 'running', updated_at: _.lt(staleTs) })
      .update({ status: 'running', stage: 1, updated_at: now });
    if (upd2.stats.updated !== 1) return null;
  }
  return job;
}

// 写 verdicts（snake_case 字段；JSON 数组/对象直接存文档库，无需序列化）
async function writeVerdict(jobId, fingerprint, v) {
  const ttlDays = v.verdict === 'false' ? 7 : v.verdict === 'true' ? 30 : 1;
  const expiresAt = Date.now() + ttlDays * 86400000;
  const { _id } = await C.verdicts.add({
    fingerprint,
    channel: v.channel,
    claim: v.claim,
    verdict: v.verdict,
    intent: v.intent,
    one_line: v.oneLine,
    reasons: v.reasons || [],
    actions: v.actions || [],
    sources: v.sources || [],
    risk_predicates: v.riskPredicates || [],
    confidence_internal: 'mid',
    model: v.model,
    hit_count: 0,
    expires_at: expiresAt,
    created_at: Date.now(),
  });
  const verdictId = String(_id);
  await C.jobs.doc(jobId).update({
    status: v.degraded ? 'degraded' : 'done',
    verdict_id: verdictId,
    stage: 4,
    updated_at: Date.now(),
  });
  return { ok: true, verdictId, degraded: v.degraded };
}

// 降级写库（status=degraded，标"规则判定，未经AI复核"）
async function degrade(job) {
  const r = ruleEngine(job.raw_text || '');
  return writeVerdict(job._id, job.fingerprint, {
    ...r,
    claim: (job.raw_text || '').slice(0, 20),
    channel: 'text',
    riskPredicates: [],
    model: 'rule-engine',
    degraded: true,
  });
}

// 处理单个 job
async function processJob(job) {
  const text = job.raw_text || '';

  // 合并 prompt：一次调用同时完成判定 + 老年化改写（Vercel 单轮也能产出友好文案）
  let ai = await callAI(ANALYZE_SYS, text);
  if (!ai || !ai.verdict) {
    return degrade(job);
  }

  const sources = matchOfficial(text);
  const matchedOfficial = sources.length > 0;
  // 硬约束：判「假」必须附官方来源，否则降级为「说不准」。
  // 降级时一并把 oneLine 改写为中性表述，避免"结论说不准、标题却写假消息"的自相矛盾。
  if (ai.verdict === 'false' && !matchedOfficial) {
    ai.verdict = 'unverified';
    ai.oneLine = '现在查不清，先别照着做';
  }

  return writeVerdict(job._id, job.fingerprint, {
    claim: ai.claim || text.slice(0, 20),
    verdict: ai.verdict,
    channel: ai.channel || 'text',
    intent: ai.intent || '转述',
    oneLine: ai.oneLine || '现在查不清，先别照着做',
    reasons: ai.reasons || [],
    actions: ai.actions || [],
    sources,
    riskPredicates: ai.riskPredicates || [],
    model: AI.MODEL,
    degraded: false,
  });
}

// 原子认领并处理指定 job（serverless 下由 getVerdict 调用）。
// 认领条件同 claimNextJob：pending，或超时残留的 running。
// 返回 { ok, verdictId, degraded } 或被其他实例认领/非待处理时返回 null（前端继续轮询）。
async function processJobById(id) {
  const now = Date.now();
  const staleTs = now - STALE_MS;
  let job;
  try {
    const { data } = await C.jobs.doc(id).get();
    const j = data[0];
    if (!j) return null;
    const upd = await C.jobs
      .where({ _id: id, status: _.or([{ status: 'pending' }, { status: 'running', updated_at: _.lt(staleTs) }]) })
      .update({ status: 'running', stage: 1, updated_at: now });
    if (upd.stats.updated !== 1) return null; // 被其他实例认领 / 非待处理
    job = j;
  } catch (e) {
    console.error('[worker] processJobById claim err', e && e.message);
    return null;
  }
  if (!job) return null;
  try {
    return await processJob(job);
  } catch (e) {
    console.error('[worker] processJobById err', e && e.message);
    await C.jobs.doc(job._id).update({ status: 'failed', updated_at: Date.now() }).catch(() => {});
    return null;
  }
}

// 单次扫描：认领并尽力处理（最多 5 个，避免单次阻塞过久）
async function scanOnce() {
  let job;
  try {
    job = await claimNextJob();
  } catch (e) {
    console.error('[worker] claim err', e.message);
    return 0;
  }
  if (!job) return 0;
  try {
    await processJob(job);
  } catch (e) {
    console.error('[worker] process err', e.message);
    await C.jobs.doc(job._id).update({ status: 'failed', updated_at: Date.now() }).catch(() => {});
  }
  return 1;
}

// 启动后台扫描定时器（仅常驻容器用；Vercel 下由 index.js 跳过）
function startWorker(intervalMs) {
  if (process.env.DISABLE_WORKER === '1') {
    console.log('[worker] DISABLE_WORKER=1，跳过后台任务处理');
    return;
  }
  const interval = intervalMs || 5000;
  setInterval(async () => {
    try {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const c = await scanOnce();
        if (!c) break;
        n += c;
      }
      if (n) console.log('[worker] processed', n);
    } catch (e) {
      console.error('[worker] loop err', e.message);
    }
  }, interval);
  console.log('[worker] started, interval', interval, 'ms');
}

module.exports = { startWorker, processJob, processJobById, scanOnce };
