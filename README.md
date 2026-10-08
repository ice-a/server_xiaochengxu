# 辨是非 · 微信小程序

帮长辈识别谣言、骗局的小工具：把收到的话粘贴进来，马上告诉你真的假的、为什么、该怎么办。

- **前端**：微信小程序（`miniprogram/`），原生开发，通过 `wx.cloud.callContainer` 调用后端。
- **后端**：Express 服务（`server/`），部署到 **腾讯云 CloudBase 云托管**，AI 模型凭证全部写在云托管环境变量里，不下发前端。

> 架构为「小程序 + 云托管」单一路径：AI 的 `baseurl / apikey / model` 只存在于云托管的环境变量中，前端代码不含任何密钥。

---

## 一、前置准备

1. 注册并开通 **腾讯云 CloudBase（云开发）**，新建一个环境，记下 **环境 ID**。
2. 在该环境内开通 **云托管（CloudBase Run）**；后端用环境内的 **云开发数据库（文档型，NoSQL）**，免连接串，即用即建，无需单独买 MySQL。
3. 准备一个可用的大模型凭证：
   - CloudBase AI 网关：`AI_BASE_URL=https://<环境ID>.api.tcloudbasegateway.com/v1/ai/cloudbase`，`AI_MODEL=hy3`，`AI_KEY` 为网关的 service_role Key；
   - 或任意 OpenAI 兼容服务：`AI_BASE_URL=https://api.openai.com/v1`，`AI_MODEL=gpt-3.5-turbo`，`AI_KEY=sk-...`。
4. 微信公众平台注册小程序，拿到 **AppID**（填入 `project.config.json` 的 `appid`）。

---

## 二、后端配置（环境变量）

把以下变量填到 **云托管控制台 → 服务 → 服务配置 → 环境变量**（切勿提交真实密钥到代码库）：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `AI_BASE_URL` | 模型接口地址（OpenAI 兼容） | `https://<环境ID>.api.tcloudbasegateway.com/v1/ai/cloudbase` |
| `AI_KEY` | 模型 API Key | `sk-...` / 网关 Key |
| `AI_MODEL` | 模型名 | `hy3` / `gpt-3.5-turbo` / `deepseek-chat` |
| `CLOUD_ENV` | CloudBase 环境 ID（云开发数据库用它初始化，免连接串） | `dev-d4g97a4h5772bec4a` |
| `TCB_SECRETID` / `TCB_SECRETKEY` | 跨环境/本地调试才需要；云托管同环境内通常免填 | `AKID...` / `...` |
| `FREE_QUOTA` | 每日免费分析次数（可选） | `10` |
| `WORKER_INTERVAL` | worker 扫描间隔 ms（可选） | `5000` |

后端代码读取位置：`server/src/config.js`（`AI_*`）、`server/src/db.js`（`CLOUD_ENV` / `TCB_SECRET*`）。
完整示例见 `server/.env.example`。

### 集合与索引（无需建表）

后端用 **云开发数据库**（NoSQL）：集合即建即用。首次运行会按代码自动创建 `jobs` / `verdicts` / `abuse` / `users` / `sources` / `feedback` / `tips` 等集合；
为查询/排序性能，请在 **云开发控制台 → 数据库 → 集合 → 索引管理** 按 `cloudbase/collections.md` 建立推荐索引。

---

## 三、前端配置

编辑 `miniprogram/config.js`：

```js
CLOUD_ENV: '<你的云开发环境 ID>',     // 必填
CLOUD_SERVICE: '',                    // 该环境只有一个云托管服务时留空；多个服务时填后端服务名
USE_CLOUD_CONTAINER: true,            // true = 走 wx.cloud.callContainer（免 request 域名白名单）
FORCE_LOCAL: false,                   // 生产保持 false，走云端
```

其余 `API_BASE / ENABLE_LINK_RESOLVE / USE_VIRTUAL_PAY / FREE_QUOTA` 按需要微调即可。

---

## 四、如何上传 / 部署

### 1）部署后端到云托管

云托管基于容器，使用 `server/Dockerfile`（已就绪，监听云托管注入的 `PORT`，提供 `/healthz` 与 `/api/*`）。

- **方式 A（代码仓库）**：把 `server/` 目录作为「构建目录」关联 GitHub / 代码托管，在云托管控制台新建服务、选择该目录构建并部署。
- **方式 B（本地镜像）**：
  ```bash
  cd server
  docker build -t bianfeishi-server .
  # 推送到云托管关联的镜像仓库后，在控制台用该镜像创建/更新服务
  ```
- 部署完成后，在控制台「服务配置 → 环境变量」填入第二节的变量，并确认服务健康（`/healthz` 返回 `{ok:true}`）。
- **建索引（重要）**：云开发数据库对带 `orderBy` 的查询（历史列表、worker 认领排队）要求字段已建索引，否则会报错。请到
  **云开发控制台 → 数据库 → 各集合 → 索引管理**，按 `cloudbase/collections.md` 建立推荐索引（如 `jobs` 的 `{status,created_at}`、`{uid,status,created_at}`，`verdicts`/`abuse` 的 `fingerprint`/`id` 单字段索引）。集合会在首次请求时自动创建。

> 云开发数据库即环境内的文档库，免连接串、即用即建，无需像 MySQL 那样单独买实例或填 `DATABASE_URL`。

### 2）上传小程序前端

1. 用 **微信开发者工具** 导入本项目根目录（`project.config.json` 的 `miniprogramRoot` 指向 `miniprogram/`）。
2. 确认 `project.config.json` 的 `appid` 与你的小程序一致。
3. 工具会自动 `wx.cloud.init`（`miniprogram/app.js`）连到 `CLOUD_ENV`。
4. 点工具栏 **「上传」** 把代码上传为开发版；在微信公众平台提交审核、发布。
5. 体验 / 真机调试时，若用 `USE_CLOUD_CONTAINER=false` 的 `wx.request` 直连，需把后端域名加入
   **小程序后台 → 开发 → 开发设置 → 服务器域名 → request 合法域名**；用 `callContainer`（默认）则无需配置域名白名单。

---

## 五、目录结构

```
miniprogram/   微信小程序前端
  config.js    前端运行配置（环境 ID、调用方式）
  services/    业务服务（analyze 等，统一经 utils/cloud.js 调后端）
  pages/       页面（查一查 / 结果 / 历史 / 我的）
  components/  组件（verdict-card 结论卡片、tip-sheet 打赏）
server/        Express 后端（云托管）
  src/         路由、AI 调用、worker、DB
  Dockerfile   云托管镜像
  .env.example 环境变量示例
cloudbase/     集合与索引说明（collections.md）
```

## 六、常见问题

- **结论一直转圈 / 拿不到结果**：后端 `AI_*` 或 `CLOUD_ENV` 没配对；先看云托管服务日志，确认 `/healthz` 正常、worker 能跑通 `analyze`。文档库查询若报索引相关错误，按 `cloudbase/collections.md` 建索引。
- **前端报网络错误**：确认 `CLOUD_ENV` 正确、`USE_CLOUD_CONTAINER=true`（callContainer 免白名单），或已配置 request 合法域名。
- **密钥安全**：AI Key 只在云托管环境变量里，前端代码与小程序包均不含密钥；不要在前端写死 Key。
