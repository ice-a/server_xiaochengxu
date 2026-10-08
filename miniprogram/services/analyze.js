// miniprogram/services/analyze.js
const { callFunction } = require('../utils/cloud');
const { analyze: localAnalyze, SOURCES } = require('../utils/localEngine');
const { CLOUD_ENV, FORCE_LOCAL } = require('../config');

const LOCAL_VERDICTS_KEY = 'localVerdicts'; // verdictId -> verdict 全量，供 history/result 回看

// 是否启用真实云函数：FORCE_LOCAL 为 false 且已配置环境 ID 时才走云
function useCloud() {
  return !FORCE_LOCAL && CLOUD_ENV && CLOUD_ENV !== 'your-cloud-env-id';
}

// 简易内容指纹（保证本地 verdictId 稳定，便于历史去重）
function fingerprint(text) {
  let h = 0;
  const s = (text || '').trim();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// 本地 verdict 库（storage）
function saveLocalVerdict(verdictId, verdict) {
  const store = wx.getStorageSync(LOCAL_VERDICTS_KEY) || {};
  store[verdictId] = verdict;
  // 最多保留 100 条，避免无限膨胀
  const keys = Object.keys(store);
  if (keys.length > 100) {
    delete store[keys[0]];
  }
  wx.setStorageSync(LOCAL_VERDICTS_KEY, store);
}

function getLocalVerdict(verdictId) {
  const store = wx.getStorageSync(LOCAL_VERDICTS_KEY) || {};
  return store[verdictId] || null;
}

// 把云函数返回统一成 { cached, verdictId, jobId?, verdict? }
function normalizeCloud(res) {
  if (!res) return { cached: false };
  if (res.cached) {
    return { cached: true, verdictId: res.verdictId, verdict: res.verdict || null };
  }
  if (res.jobId) {
    return { cached: false, jobId: res.jobId };
  }
  // 云函数若直接回 verdict（同步模式）也兼容
  if (res.verdictId) {
    return { cached: false, verdictId: res.verdictId, verdict: res.verdict || null };
  }
  return { cached: false };
}

// 提交一条待判定内容。
// 返回：
//   云缓存命中  -> { cached:true, verdictId, verdict? }
//   云未命中    -> { cached:false, jobId }
//   云不可用    -> { local:true, cached:false, verdictId, verdict, degraded:true }（降级本地规则引擎）
async function submit(text) {
  const clean = (text || '').trim();
  if (clean.length < 5) {
    throw { ok: false, code: 4000, msg: '内容太短，说不清楚，多复制点文字吧' };
  }

  if (useCloud()) {
    try {
      const res = await callFunction('analyze', { text: clean });
      return normalizeCloud(res);
    } catch (e) {
      // 云调用失败，降级到本地规则引擎（架构方案 L2）
      console.warn('[analyze] 云函数调用失败，降级本地规则引擎：', e && e.msg);
    }
  }

  // 本地规则引擎（开发演示 / 降级）
  const verdict = localAnalyze(clean);
  const verdictId = `local_${fingerprint(clean)}`;
  saveLocalVerdict(verdictId, verdict);
  return { local: true, cached: false, verdictId, verdict, degraded: true };
}

// 按 verdictId 拉取完整结论：本地库优先，否则走云
async function getVerdict(verdictId) {
  const local = getLocalVerdict(verdictId);
  if (local) return { verdict: local, fromLocal: true };
  if (useCloud()) {
    const res = await callFunction('getVerdict', { verdictId });
    return { verdict: res.verdict };
  }
  return { verdict: null };
}

// 提交纠错反馈（云不可用时仅本地提示）
async function submitFeedback(verdictId, type, comment) {
  if (useCloud()) {
    return callFunction('feedback', { verdictId, type, comment });
  }
  return { ok: true, local: true };
}

module.exports = { submit, getVerdict, submitFeedback, saveLocalVerdict, getLocalVerdict, SOURCES };
