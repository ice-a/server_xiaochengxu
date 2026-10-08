'use strict';

// 云开发数据库（CloudBase Document DB，NoSQL）——免连接串：
//   - 云托管（同环境）内通常无需密钥，tcb.init({ env }) 即用；
//   - 跨环境 / 本地调试，可填 secretId + secretKey（读环境变量）。
// 文档库集合即用即建，无需建表 SQL。
const cloudbase = require('@cloudbase/node-sdk');

const env = process.env.CLOUD_ENV || process.env.TCB_ENV;
if (!env) {
  console.error('[db] 未设置 CLOUD_ENV（CloudBase 环境 ID）；云开发数据库无法初始化。');
}

function initOpts() {
  const opts = { env };
  const secretId =
    process.env.TCB_SECRETID || process.env.TENCENTCLOUD_SECRETID || process.env.SECRET_ID;
  const secretKey =
    process.env.TCB_SECRETKEY || process.env.TENCENTCLOUD_SECRETKEY || process.env.SECRET_KEY;
  if (secretId && secretKey) {
    opts.secretId = secretId;
    opts.secretKey = secretKey;
  }
  return opts;
}

const tcb = cloudbase.init(initOpts());
const db = tcb.database();
const _ = db.command;

// 便捷：集合对象
const C = {
  jobs: db.collection('jobs'),
  verdicts: db.collection('verdicts'),
  abuse: db.collection('abuse'),
  users: db.collection('users'),
  sources: db.collection('sources'),
  feedback: db.collection('feedback'),
  tips: db.collection('tips'),
};

module.exports = { db, _, C, tcb };
