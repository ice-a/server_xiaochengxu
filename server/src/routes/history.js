'use strict';

const express = require('express');
const router = express.Router();
const { C } = require('../db');

// POST /api/history  { uid, action:'list', page, size } 或 { uid, action:'del', ids }
// 云端历史同步：list（分页）/ del（软删除）
// 说明：
//  - 云开发数据库不支持 JOIN，故先取 jobs，再按 verdict_id 逐条拉 verdicts 做映射；
//  - 禁止使用 _.in / _.or 等组合条件与 .where(...).update()（服务端会抛
//    "Cannot read properties of undefined (reading 'updatedAt')"），一律拆成简单查询 + .doc(id).update()。
router.post('/', async (req, res) => {
  try {
    const uid = (req.body.uid || 'anonymous').toString();
    const action = req.body.action;

    if (action === 'list') {
      const page = req.body.page || 0;
      const size = Math.min(req.body.size || 30, 50);
      const { data: jobs } = await C.jobs
        .where({ uid })
        .orderBy('created_at', 'desc')
        .skip(page * size)
        .limit(size)
        .get();
      const list = (jobs || []).filter((j) => j.status === 'done' || j.status === 'degraded');

      const verdictIds = list.map((j) => j.verdict_id).filter(Boolean);
      const verdictMap = {};
      for (const id of verdictIds) {
        try {
          const { data: vs } = await C.verdicts.doc(id).get();
          if (vs && vs[0]) verdictMap[String(id)] = vs[0];
        } catch (e) {
          /* 单条失败忽略 */
        }
      }

      const items = list.map((j) => {
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
      return res.json({ ok: true, items, hasMore: (jobs || []).length === size });
    }

    if (action === 'del') {
      const ids = req.body.ids || [];
      for (const id of ids) {
        try {
          const { data } = await C.jobs.doc(id).get();
          if (data && data[0] && data[0].uid === uid) {
            await C.jobs.doc(id).update({ status: 'deleted' });
          }
        } catch (e) {
          /* 单条失败忽略 */
        }
      }
      return res.json({ ok: true });
    }

    return res.json({ ok: false, code: 4006, msg: '未知 action' });
  } catch (e) {
    console.error('[history] err', e && e.stack ? e.stack : e);
    return res.status(500).json({ ok: false, code: 500, msg: '历史接口异常' });
  }
});

module.exports = router;
