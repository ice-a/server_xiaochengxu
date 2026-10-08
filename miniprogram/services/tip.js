// miniprogram/services/tip.js
// 打赏（虚拟支付）封装：演示模式（默认）+ 微信虚拟支付两条路径。
const { callFunction } = require('../utils/cloud');
const { USE_VIRTUAL_PAY } = require('../config');

// 提交一笔打赏。
// 返回：{ ok, paid, recorded }
//   - 演示模式：直接 POST /api/tip 记录，paid=false, recorded=true（无真实扣款）
//   - 虚拟支付：调用 wx.requestVirtualPayment，paid=true
async function recordTip(amount, message) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw { ok: false, code: 4001, msg: '金额不合法' };
  }

  const canVirtualPay = USE_VIRTUAL_PAY && typeof wx.requestVirtualPayment === 'function';
  if (canVirtualPay) {
    // 真实虚拟支付：后端签名 -> 前端拉起支付
    const sign = await callFunction('tip/sign', { amount: amt });
    if (!sign || !sign.ok) {
      throw { ok: false, code: 4010, msg: (sign && sign.msg) || '虚拟支付未配置' };
    }
    return await new Promise((resolve, reject) => {
      wx.requestVirtualPayment({
        ...(sign.signData || {}),
        success: async () => {
          // 支付成功：把打赏落地到 tips 集合（channel=virtualpay）
          try {
            await callFunction('tip', {
              amount: amt,
              message: (message || '').toString().slice(0, 200),
              channel: 'virtualpay',
            });
          } catch (e) {
            // 记录失败不影响支付结果，仅打日志
            console.error('[tip] record after pay failed', e);
          }
          resolve({ ok: true, paid: true, recorded: true });
        },
        fail: (e) => reject({ ok: false, code: 4012, msg: '支付已取消或失败', raw: e }),
      });
    });
  }

  // 演示模式：记录即可
  const res = await callFunction('tip', { amount: amt, message: (message || '').toString().slice(0, 200) });
  return { ok: !!res.ok, paid: false, recorded: !!res.ok };
}

module.exports = { recordTip };
