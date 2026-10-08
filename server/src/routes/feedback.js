'use strict';

const express = require('express');
const router = express.Router();
const { C } = require('../db');

// POST /api/feedback  { uid, verdictId, type, comment }
// 纠错反馈入口，进人工复核队列
router.post('/', async (req, res) => {
  const uid = (req.body.uid || 'anonymous').toString();
  const { verdictId, type, comment } = req.body;
  if (!verdictId || !type) {
    return res.json({ ok: false, code: 4005, msg: '参数不全' });
  }
  await C.feedback.add({
    uid,
    verdict_id: String(verdictId),
    type,
    comment: comment || '',
    created_at: Date.now(),
  });
  return res.json({ ok: true });
});

module.exports = router;
