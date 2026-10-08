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

// 还原错误对象：优先 stack，没有则 JSON 化（SDK 有时抛普通对象而非 Error）
function errObj(e) {
  return (e && e.stack) || (typeof e === 'object' ? JSON.stringify(e) : e);
}

// 按状态认领一个候选 job：先简单查询，再用 .doc(_id).update 抢占。
// 重要：CloudBase 文档库对已认领用 .doc(_id).update()（标准 API）；
// 不要用 .where({_id}).update() 或 _.or / _.lt 组合条件——实测服务端会抛
// "Cannot read properties of undefined (reading 'updatedAt')"。
async function claimWhere(status) {
  const now = Date.now();
  let data;
  try {
    const res = await C.jobs.where({ status }).limit(1).get();
    data = res.data;
  } catch (e) {
    console.error('[claim] GET err', errObj(e));
    return null;
  }
  if (!data || !data.length) return null;
  const job = data[0];
  try {
    const upd = await C.jobs.doc(job._id).update({ status: 'running', stage: 1, updated_at: now });
    if (!upd || !upd.stats || upd.stats.updated !== 1) return null;
    return job;
  } catch (e) {
    console.error('[claim] UPDATE err', errObj(e));
    return null;
  }
}

// 认领一个待处理任务：先抢 pending，再抢 running（单实例下 running 残留极少）。
async function claimNextJob() {
  let job = await claimWhere('pending');
  if (!job) job = await claimWhere('running');
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
// 用 .doc(id).update() 抢占（单实例下无需按状态条件校验）。
async function processJobById(id) {
  const now = Date.now();
  let job;
  try {
    const { data } = await C.jobs.doc(id).get();
    const j = data[0];
    if (!j) return null;
    const upd = await C.jobs.doc(id).update({ status: 'running', stage: 1, updated_at: now });
    if (!upd || !upd.stats || upd.stats.updated !== 1) return null; // 认领失败
    job = j;
  } catch (e) {
    console.error('[worker] processJobById claim err', errObj(e));
    return null;
  }
  if (!job) return null;
  try {
    return await processJob(job);
  } catch (e) {
    console.error('[worker] processJobById err', errObj(e));
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
    console.error('[worker] claim err', (e && e.stack) || e);
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
