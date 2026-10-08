'use strict';

const express = require('express');
const cors = require('cors');
const { startWorker } = require('./worker');
const { WORKER_INTERVAL } = require('./config');
const analyze = require('./routes/analyze');
const getVerdict = require('./routes/getVerdict');
const feedback = require('./routes/feedback');
const history = require('./routes/history');
const tip = require('./routes/tip');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 请求超时兜底：Express 4 不会自动结束挂起的 async 处理器，这里主动 504，
// 避免云托管网关长时间无响应（errCode 102002 请求超时）。
const REQ_TIMEOUT_MS = 8000;
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ ok: false, code: 504, msg: '处理超时' });
  }, REQ_TIMEOUT_MS);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// 健康检查（云托管探测 / 负载均衡 / Vercel 健康检查用）
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// API 路由（与小程序 callFunction(name) 一一对应：/api/<name>）
app.use('/api/analyze', analyze);
app.use('/api/getVerdict', getVerdict);
app.use('/api/feedback', feedback);
app.use('/api/history', history);
app.use('/api/tip', tip);

// 404
app.use((req, res) => res.status(404).json({ ok: false, code: 404, msg: 'not found' }));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[express] error', err);
  res.status(500).json({ ok: false, code: 500, msg: '服务器开小差了' });
});

// 常驻容器（云托管 / CloudBase Run）：启动后台扫描定时器；
// Vercel(serverless) 无常驻进程，由 getVerdict 惰性处理任务，故跳过。
if (process.env.VERCEL !== '1') {
  startWorker(WORKER_INTERVAL);
}

// 仅在直接运行（node src/index.js）时监听端口；被 Vercel 的 api/index.js 引入时不监听。
if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 80;
  app.listen(PORT, () => {
    console.log('[server] listening on', PORT);
  });

  // 启动自检：确认能连上云开发数据库，否则打明显日志便于排查（连不上会导致 /api/* 全部超时）。
  (async () => {
    try {
      const { db } = require('./db');
      await db.collection('jobs').limit(1).get();
      console.log('[db] 连接正常');
    } catch (e) {
      console.error('[db] 启动自检失败（数据库可能连不上，请检查 CLOUD_ENV / 云托管内网访问）：', e && e.message);
    }
  })();
}

module.exports = app;
