// miniprogram/config.js
// 替换为你自己的云开发环境 ID（微信开发者工具 → 云开发控制台 → 环境 ID）
// 也可在云开发控制台「环境设置」里查看
module.exports = {
  // CloudBase 环境 ID（云托管所在环境；wx.cloud.callContainer / wx.cloud.init 需要）。
  CLOUD_ENV: 'cloud1-d2gpgyh80aef3842b',
  // 云托管服务名：该环境内只有一个服务时留空即可；多个服务时填后端服务名（见云托管控制台）。
  CLOUD_SERVICE: '',

  // 开发演示开关：true = 不走云端，用前端本地规则引擎（utils/localEngine.js）直接判定；
  // false = 走云托管后端（/api/*）。上线提审前保持 false。
  FORCE_LOCAL: false,

  // ===== 云托管调用方式 =====
  // 走 CloudBase 云托管后端（server/ 部署到云托管）：AI 的 baseurl/apikey/model 写在云托管
  // 「服务配置 → 环境变量」(AI_BASE_URL / AI_KEY / AI_MODEL)，不进前端代码，也不会下发到客户端。
  // 调用方式：wx.cloud.callContainer（免「request 域名白名单」，需 wx.cloud.init，见 app.js）。
  //   云托管若在该环境内有多个服务，可在 utils/cloud.js 的 callContainer 配置里加 service 名。
  //   （已移除原 wx.request 直连方式，不再需要 API_BASE 公网域名。）
  USE_CLOUD_CONTAINER: true,

  // 业务相关开关（与云托管侧 ENV 保持一致即可，前端仅用于 UI 提示）
  ENABLE_LINK_RESOLVE: true,

  // 虚拟支付开关：true 时打赏走 wx.requestVirtualPayment（需后台开通虚拟支付能力并配置密钥）；
  // false 时为演示模式，打赏直接记录到后端 tips 表，不产生真实扣款。
  // 开启后须在云托管配置 VIRTUAL_PAY_OFFERID / VIRTUAL_PAY_KEY（见 server/.env.example），否则打赏会报「未配置」。
  USE_VIRTUAL_PAY: true,

  // 每日免费次数（仅用于 UI 文案，真实限制由云函数侧 abuse 集合控制）
  FREE_QUOTA: 10,
};
