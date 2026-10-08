'use strict';

const express = require('express');
const router = express.Router();
const { C } = require('../db');
const { publicVerdict } = require('../format');
const { processJobById } = require('../worker');

// 按 verdictId 返回公开结论
async function getVerdictById(id) {
  const { data } = await C.verdicts.doc(id).get();
  const v = data[0];
  if (!v) return null;
  return { verdictId: String(v._id), verdict: publicVerdict(v) };
}

// POST /api/getVerdict  { jobId } 或 { verdictId }
// jobId 模式：serverless 下会在此惰性处理 pending 任务，再返回结论。
router.post('/', async (req, res) => {
  // 轮询模式：按 jobId 返回任务进度 / 结论
  if (req.body.jobId) {
    const { data: rows } = await C.jobs.doc(req.body.jobId).get();
    const job = rows[0];
    if (!job) return res.json({ ok: false, code: 404, msg: '任务不存在' });

    if (job.status === 'pending' || job.status === 'running') {
      // 惰性处理（原子认领；若被其他实例认领或本次超时未成，返回 null，前端继续轮询）
      const r = await processJobById(req.body.jobId);
      if (r && r.verdictId) {
        const found = await getVerdictById(r.verdictId);
        if (found) {
          return res.json({ ok: true, verdictId: found.verdictId, verdict: found.verdict, degraded: r.degraded });
        }
      }
      // 还没好（处理中 / 超时未成），前端继续轮询
      return res.json({ ok: true, pending: true, stage: job.stage || 0, status: job.status });
    }

    if (job.status === 'failed') return res.json({ ok: false, code: 410, msg: '分析失败，请重试' });
    if (!job.verdict_id) return res.json({ ok: false, code: 404, msg: '结论缺失' });
    const found = await getVerdictById(job.verdict_id);
    if (!found) return res.json({ ok: false, code: 404, msg: '记录不存在或已过期' });
    return res.json({ ok: true, verdictId: found.verdictId, verdict: found.verdict, degraded: job.status === 'degraded' });
  }

  // 直接按 verdictId
  const verdictId = req.body.verdictId;
  if (!verdictId) return res.json({ ok: false, code: 4004, msg: '缺少 verdictId' });
  const found = await getVerdictById(verdictId);
  if (!found) return res.json({ ok: false, code: 404, msg: '记录不存在或已过期' });
  return res.json({ ok: true, verdictId: found.verdictId, verdict: found.verdict });
});

module.exports = router;
