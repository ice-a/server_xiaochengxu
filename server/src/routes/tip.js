'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { C } = require('../db');

// POST /api/tip  { uid, amount, message? }
// 演示模式（默认）：直接把打赏记录写入 tips 集合，不产生真实扣款。
// 适合 MVP 快速验证交互；后续接微信虚拟支付后改用 /api/tip/sign。
// 说明：云开发数据库集合即用即建，无需建表。
router.post('/', async (req, res) => {
  const uid = (req.body.uid || 'anonymous').toString();
  const amount = Number(req.body.amount);
  const message = (req.body.message || '').toString().slice(0, 200);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.json({ ok: false, code: 4001, msg: '金额不合法' });
  }

  try {
    await C.tips.add({
      uid,
      amount_cents: Math.round(amount * 100),
      message,
      channel: (req.body.channel || 'demo').toString().slice(0, 20),
      created_at: Date.now(),
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[tip] insert failed:', e.message);
    return res.json({ ok: false, code: 5000, msg: '记录失败，请稍后再试' });
  }
});

// POST /api/tip/sign  { uid, amount }
// 微信小程序虚拟支付（币/道具模式）签名接口，供 wx.requestVirtualPayment 使用。
// 前置（平台侧，需开发者自行完成）：
//   1) 微信小程序后台开通「虚拟支付」能力（类目需符合要求），并在微信支付商户平台
//      「虚拟支付」中获取 offerId 与 API 密钥（VIRTUAL_PAY_KEY）；
//   2) 在云托管「服务配置 → 环境变量」填入 VIRTUAL_PAY_OFFERID / VIRTUAL_PAY_KEY 等；
//   3) 前端 config.USE_VIRTUAL_PAY=true 时走该路径。
// 注意：paySign 拼接字段与算法以微信开放文档「小程序虚拟支付」当前版本为准；
//       上线/真机验证前请核对，下方为币/道具模式的标准实现。
router.post('/sign', async (req, res) => {
  const offerId = process.env.VIRTUAL_PAY_OFFERID;
  const apiKey = process.env.VIRTUAL_PAY_KEY; // 虚拟支付 API 密钥（商户平台获取）
  const appId = process.env.VIRTUAL_PAY_APPID || 'wxb171dd3c5f5449ef';
  if (!offerId || !apiKey) {
    return res.json({ ok: false, code: 4010, msg: '虚拟支付未配置（缺少 VIRTUAL_PAY_OFFERID / VIRTUAL_PAY_KEY）' });
  }

  const uid = (req.body.uid || 'anonymous').toString();
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.json({ ok: false, code: 4001, msg: '金额不合法' });
  }

  // 1 元 = VIRTUAL_PAY_COIN_RATIO 个币（默认 1:1）；buyQuantity 必须为正整数。
  const ratio = Number(process.env.VIRTUAL_PAY_COIN_RATIO) || 1;
  const buyQuantity = Math.max(1, Math.round(amount * ratio));

  const orderId = `tip_${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const signType = 'MD5';

  // 币/道具模式 paySign：参与字段按顺序拼接后追加 &key=API密钥，做 MD5 并大写。
  // 若你的虚拟支付产品（如应用内虚拟支付）要求 package/prepayId 等其它字段，请按官方改这里。
  const raw = [
    `appId=${appId}`,
    `buyQuantity=${buyQuantity}`,
    `offerId=${offerId}`,
    `orderId=${orderId}`,
    `nonceStr=${nonceStr}`,
    `timeStamp=${timeStamp}`,
    `signType=${signType}`,
  ].join('&');
  const paySig = crypto.createHash('md5').update(raw + '&key=' + apiKey).digest('hex').toUpperCase();

  return res.json({
    ok: true,
    signData: { offerId, buyQuantity, nonceStr, timeStamp, signType, paySig, orderId },
  });
});

module.exports = router;
