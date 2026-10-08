// miniprogram/utils/cloud.js
// 统一的后端调用封装，Promise 化 + 标准错误结构。
// 后端部署在腾讯云托管（CloudBase Run）的 Express 服务，路由为 /api/<name>。
// 调用方式（见 config.js）：统一走 wx.cloud.callContainer（免域名白名单，需 wx.cloud.init）。
// 自动注入匿名 uid（后端用它代替 OPENID 做限流 / 历史隔离）。
const { CLOUD_ENV, CLOUD_SERVICE, USE_CLOUD_CONTAINER } = require('../config');

function callFunction(name, data = {}) {
  const uid = wx.getStorageSync('uid') || '';
  const body = Object.assign({ uid }, data);

  return new Promise((resolve, reject) => {
    const onSuccess = (res) => {
      // callContainer 返回 res.data；wx.request 返回 r.data；云函数旧结构为 res.result
      const result = (res && res.data) || (res && res.result) || {};
      if (result.ok === false) {
        reject(result); // { ok:false, code, msg, ... }
      } else {
        resolve(result);
      }
    };
    const onFail = (err) => {
      reject({ ok: false, code: -1, msg: '网络开了小差，请稍后再试', detail: err });
    };

    if (USE_CLOUD_CONTAINER && wx.cloud && wx.cloud.callContainer) {
      const containerConfig = { env: CLOUD_ENV };
      if (CLOUD_SERVICE) containerConfig.service = CLOUD_SERVICE; // 多服务环境需指定后端服务名
      wx.cloud.callContainer({
        config: containerConfig,
        path: `/api/${name}`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: body,
        success: onSuccess,
        fail: onFail,
      });
    } else {
      reject({ ok: false, code: -2, msg: '当前未启用 callContainer 调用方式，请确认 USE_CLOUD_CONTAINER 与 wx.cloud 可用' });
    }
  });
}

module.exports = { callFunction };
