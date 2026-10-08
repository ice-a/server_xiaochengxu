# 辨是非 · 云开发数据库（CloudBase Document DB）集合与索引

后端使用 **CloudBase 文档数据库**（NoSQL，免连接串），通过 `@cloudbase/node-sdk` 的
`app.database()` 访问。集合**不会**在首次写入时自动创建，必须先在
**云开发控制台 → 数据管理（数据库）→ 集合 → 新建集合** 手动创建下方全部集合，
否则接口报 `[ResourceNotFound] Db or Table not exist`。
索引在 **集合 → 索引管理** 中创建（提升查询/排序性能、避免全表扫描）。

> created_at / updated_at / expires_at 字段均为 BIGINT（毫秒时间戳，由服务端写入），非日期类型。
> reasons / actions / sources / risk_predicates 为数组/对象，直接存文档库，读取即解析。

## 集合

### jobs（分析任务）
字段：`_id`(自动) `uid` `fingerprint` `input_type` `raw_text` `stage` `status` `verdict_id` `created_at` `updated_at`
status 取值：`pending | running | done | degraded | failed | dead | deleted`
推荐索引：
- 单字段 `fingerprint`（缓存命中查询）
- 复合 `{ status: 1, created_at: 1 }`（worker 认领 + 排序）
- 复合 `{ uid: 1, status: 1, created_at: -1 }`（历史列表 + 排序）

### verdicts（结论）
字段：`_id`(自动) `fingerprint` `channel` `claim` `verdict` `intent` `one_line` `reasons[]` `actions[]` `sources[]` `risk_predicates[]` `confidence_internal` `model` `hit_count` `expires_at` `created_at`
推荐索引：
- 单字段 `fingerprint`（缓存命中查询）
- 单字段 `_id`（按 verdictId 读取，默认主键索引已覆盖）

### abuse（每日限流计数）
字段：`_id`(自动) `id`(=`${uid}_${日期}`) `uid` `day` `count` `updated_at`
推荐索引：
- 单字段 `id`（唯一，限流计数查询/自增）

### users（用户）
字段：`_id`(自动) `openid` `uid` `created_at`

### sources（官方来源库，当前由代码内 OFFICIAL 数组维护，库表可选）
字段：`_id`(自动) `org` `title` `url` `keywords[]`

### feedback（纠错反馈）
字段：`_id`(自动) `uid` `verdict_id` `type` `comment` `created_at`

### tips（打赏 / 虚拟支付记录）
字段：`_id`(自动) `uid` `amount_cents` `message` `channel` `created_at`

## 初始化方式（代码内已封装）
```js
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: process.env.CLOUD_ENV }); // 云托管同环境免密钥
const db = app.database();
const _ = db.command;
```
环境变量：`CLOUD_ENV`（环境 ID）；跨环境/本地调试可补 `TCB_SECRETID` / `TCB_SECRETKEY`。
