'use strict';

const express = require('express');
const router = express.Router();
const { C, _ } = require('../db');

// POST /api/history  { uid, action:'list', page, size } 或 { uid, action:'del', ids }
// 云端历史同步：list（分页）/ del（软删除）
// 说明：云开发数据库不支持 JOIN，故先取 jobs 分页，再按 verdict_id 批量拉 verdicts 做映射。
router.post('/', async (req, res) => {
  const uid = (req.body.uid || 'anonymous').toString();
  const action = req.body.action;

  if (action === 'list') {
    const page = req.body.page || 0;
    const size = Math.min(req.body.size || 30, 50);
    const { data: jobs } = await C.jobs
      .where({ uid, status: _.in(['done', 'degraded']) })
      .orderBy('created_at', 'desc')
      .skip(page * size)
      .limit(size)
      .get();

    const verdictIds = jobs.map((j) => j.verdict_id).filter(Boolean);
    let verdictMap = {};
    if (verdictIds.length) {
      const { data: vs } = await C.verdicts.where({ _id: _.in(verdictIds) }).get();
      verdictMap = Object.fromEntries(vs.map((v) => [String(v._id), v]));
    }

    const items = jobs.map((j) => {
      const v = verdictMap[j.verdict_id] || {};
      return {
        verdictId: j.verdict_id,
        status: j.status,
        createdAt: j.created_at,
        verdict: v.verdict || 'unverified',
        oneLine: v.one_line || '',
        preview: (v.claim || '').slice(0, 40),
      };
    });
    return res.json({ ok: true, items, hasMore: items.length === size });
  }

  if (action === 'del') {
    const ids = req.body.ids || [];
    if (ids.length) {
      await C.jobs
        .where({ uid, verdict_id: _.in(ids) })
        .update({ status: 'deleted' })
        .catch(() => {});
    }
    return res.json({ ok: true });
  }

  return res.json({ ok: false, code: 4006, msg: '未知 action' });
});

module.exports = router;
