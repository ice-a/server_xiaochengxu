'use strict';

// 运行配置：全部来自环境变量，不写死任何密钥。
module.exports = {
  // 每日免费分析次数（与前端 config.FREE_QUOTA 保持一致）
  FREE_QUOTA: parseInt(process.env.FREE_QUOTA, 10) || 10,

  // worker 扫描 pending 任务的间隔（毫秒）
  WORKER_INTERVAL: parseInt(process.env.WORKER_INTERVAL, 10) || 5000,

  // CloudBase AI 网关（OpenAI 兼容）。
  // 凭证必须走云托管「服务配置 → 环境变量」，切勿提交到代码库。
  //   AI_BASE_URL = https://<你的云环境ID>.api.tcloudbasegateway.com/v1/ai/cloudbase
  //   AI_KEY      = CloudBase AI 网关 API Key（service_role JWT）
  //   AI_MODEL    = hy3
  // 仅 AI_BASE_URL 给了默认值（一个 URL，不含密钥），方便同源环境开箱即用；AI_KEY 留空则自动走本地规则引擎降级。
  AI: {
    BASE_URL:
      process.env.AI_BASE_URL ||
      'https://cloud1-d2gpgyh80aef3842b.api.tcloudbasegateway.com/v1/ai/cloudbase',
    KEY: process.env.AI_KEY || '',
    MODEL: process.env.AI_MODEL || 'hy3',
  },
};
