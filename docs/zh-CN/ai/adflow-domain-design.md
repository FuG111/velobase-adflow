# AdFlow 领域设计与 MVP 确认稿

状态：用户已确认 MVP 范围，进入实现。入口：`launchpad_source: launchpad_flow`。
已有确认：Google Ads / Meta Ads 授权、AI 诊断、优化建议、行业对比、按绑定广告账户数量收费。
本文中的用户类型、套餐额度和 MVP 边界是建议；价格、目标市场和基准数据授权尚未确定。

## 1. 真正的业务对象与价值

| 对象 | 用户关键动作 | 用户价值 | 直接影响 MVP / 收费的规则 |
| --- | --- | --- | --- |
| 平台授权连接 | 授权、重新授权、撤销 | 安全访问本人有权查看的广告数据 | 登录身份和广告授权分离；一次授权可以发现多个广告账户 |
| 广告账户 | 选择绑定、查看同步状态、解绑 | 明确诊断范围，集中管理多个平台 | 按绑定的实际广告账户计额度，不按 Google / Meta 登录身份计费 |
| 广告系列、广告组、广告及每日指标 | 首次拉取历史、重试同步、选时间范围 | 定位具体低效投放对象 | 唯一键去重；保留币种、时区、归因口径；不混加不同币种 |
| 诊断报告与发现 | 发起诊断、查看证据、比较前期 | 知道哪里浪费预算、异常程度和证据 | 确定性计算指标；AI 解释证据；不把缺失转化数据当作零 |
| 优化建议 | 查看具体行动、标记采纳或忽略 | 将问题转为可执行调整 | 第一版由用户在广告平台执行；不自动修改预算和广告 |
| 行业基准 | 选择行业、查看匹配条件和差距 | 判断相对表现和改进空间 | 必须标记来源、时间、地区、平台、目标、样本信息；不可比时不排名 |
| 账户额度权益 | 订阅、升级、降级、释放绑定名额 | 为实际管理规模付费 | Webhook 生效；并发绑定不能突破额度；支付成功页不能授予权益 |

## 2. 产品概要

```yaml
product:
  name: AdFlow
  one_liner: 对用户授权的 Google Ads 和 Meta Ads 数据进行 AI 诊断并生成可执行优化建议
  target_users: [operator, 中小广告主, 独立投手]
  core_user_stories:
    - 授权并选择广告账户，自动导入最近 30 天投放数据
    - 查看花费、展示、点击、转化及趋势，并定位具体低效广告
    - 阅读附带指标证据的诊断和优化步骤，标记建议处理状态
    - 在有可比来源时查看行业基准差距
    - 根据需要管理的账户数量购买和调整订阅
  business_model: subscription
  ai_capabilities: [analysis, generation]
  target_regions: [TBD，上线前明确市场及结算币种]
  third_party_services: [Google Ads API, Meta Marketing API, Stripe, OpenAI]
```

## 3. 领域与框架复用决策

```yaml
domains:
  user:
    auth_methods: reuse_framework
    roles_permissions: reuse_framework
    profile_fields: not_needed
  billing:
    billing_model: configure
    sku_catalog: configure
    account_entitlements: design_needed
    credit_consumption: not_needed
  operations:
    analytics_events: design_needed
    notifications: design_needed
    lifecycle_touch: not_needed
  integrations:
    auth_provider: reuse_framework
    payment_provider: reuse_framework
    email_provider: reuse_framework
    storage_provider: not_needed
    analytics_provider: reuse_framework
    ai_provider: reuse_framework
    ads_reporting_providers: design_needed
  non_functional:
    security: design_needed
    deployment_mode: configure
    observability: reuse_framework
```

认证复用 NextAuth 和 useLogin；广告数据默认单用户所有，不增加组织、代理商团队或共享角色。
生命周期：注册 → 示例体验 → 订阅 → 绑定账户 → 首次同步 → 首次报告 → 续费 / 降级 / 到期。
平台授权失效进入重新授权状态，不删除历史报告。到期允许查看历史，停止新同步和新诊断。
需要后续确认数据保留政策，第一版至少提供用户主动删除账户数据的能力。

## 4. 计费规则（建议确认）

```yaml
billing:
  model: subscription
  skus:
    - {key: adflow_starter, type: subscription_monthly, price: TBD, account_limit: 1, credits: null, validity: 一个订阅周期}
    - {key: adflow_growth, type: subscription_monthly, price: TBD, account_limit: 5, credits: null, validity: 一个订阅周期}
    - {key: adflow_scale, type: subscription_monthly, price: TBD, account_limit: 20, credits: null, validity: 一个订阅周期}
  credit_rules: []
```

- 价格与平台价格 ID 从框架商品目录读取，不硬编码；未配置价格时不能购买，不能显示虚构售价。
- 免费访问明确标记的隔离示例数据；真实账户绑定需要有效额度。暂不新增免费试用计费周期。
- 同一用户、平台和外部账户 ID 唯一，重新授权不能重复占额；管理账户只用于发现子账户，不重复收费。
- 已绑定但授权过期的账户继续占额；解绑后释放额度并停止同步。历史数据不额外占额。
- 额度校验与绑定写入处于同一串行化事务或等价并发保护中；失败不占额。
- 升级待框架确认新权益后生效。降级到期生效；超额后停止新绑定和同步，提示选择保留账户，不自动删除。
- 重复付款事件不能重复发放权益；诊断重试不能重复创建报告。账户额度是独立产品数据，复用框架支付和权益服务。
- AI 用量按账户、用户设置并发和请求频率上限，避免账户数订阅产生无界 AI 成本；限制值通过配置管理。

## 5. 领域数据模型

全部产品实体使用 `cuid()`、`createdAt`、`updatedAt`。用户数据带 `userId`，服务从 session 派生 owner；不改变框架保留表。

| 实体 | owner / 主要字段 | 关系与索引 | 有限状态 |
| --- | --- | --- | --- |
| AdsConnection | user；platform、externalIdentity、encryptedCredentials、expiresAt、scopes | unique(userId, platform, externalIdentity) | ACTIVE / REAUTH_REQUIRED / REVOKED |
| AdAccount | user；platform、externalId、name、currency、timezone、industry、region | connection；unique(userId, platform, externalId)、index(userId, status) | BOUND / DISCONNECTED |
| AdEntity | user；externalId、level、parentExternalId、name、objective | account；unique(accountId, level, externalId) | ACTIVE / PAUSED / ARCHIVED / UNKNOWN |
| AdDailyMetric | user；date、impressions、clicks、spendMicros、conversions、conversionValue、attributionSpec | account、adEntity；unique(adEntityId, date, attributionSpec)、index(accountId, date) | 不适用 |
| AdSyncRun | user；range、checkpoint、attempts、errorCode、completedAt、dedupeKey | account；unique(dedupeKey)、index(accountId, createdAt) | QUEUED / RUNNING / SUCCEEDED / PARTIAL / FAILED / CANCELLED |
| AdDiagnosis | user；range、dataSnapshotHash、ruleVersion、model、summary、errorCode | account、syncRun；unique(accountId, dataSnapshotHash, ruleVersion)、index(userId, createdAt) | QUEUED / RUNNING / SUCCEEDED / FAILED |
| AdFinding | user；metric、observed、reference、evidence、severity、confidence | diagnosis、adEntity；index(diagnosisId) | INFO / WARNING / CRITICAL（severity） |
| AdRecommendation | user；actionSteps、rationale、expectedDirection | finding；index(userId, status) | OPEN / ACCEPTED / DISMISSED |
| IndustryBenchmark | shared / admin；platform、industry、region、objective、period、currency、metric、value、sourceUrl、sampleSize、licenseNote | index(platform, industry, region, objective, period) | DRAFT / PUBLISHED / RETIRED |
| AdAccountEntitlement | user；sourceSubscriptionId、accountLimit、validUntil、revision | unique(userId)、unique(sourceSubscriptionId) | ACTIVE / EXPIRED / OVER_LIMIT |

转化数允许小数；缺失字段用 null；金额使用精确数值。派生 CTR、CPC、CVR、CPA、ROAS 时处理零分母。
报告保存数据快照和规则版本，避免后续同步修改证据。广告名称等外部文本是不可信输入，不能成为 AI 工具指令。
AI 不接收 OAuth 密钥或个人受众明细，仅使用诊断需要的聚合数据。

## 6. 模块、API 和事件

以四个模块划分，跨模块通过领域事件交接；框架能力通过已有封装使用。
所有列表 cursor 分页，默认 20；所有业务接口 protected，基准管理 admin。

| 模块路径 | Query | Mutation | 职责 |
| --- | --- | --- | --- |
| src/modules/ad-accounts | listConnections、discoverAccounts、listAccounts、listSyncRuns、metrics | beginAuthorization、bindAccount、disconnectAccount、deleteAccountData、requestSync | 授权、绑定、报表 provider 适配、指标持久化和同步 worker |
| src/modules/ad-diagnostics | listReports、getReport、listRecommendations | requestDiagnosis、setRecommendationStatus | 确定性指标与规则、AI 报告、建议及诊断 worker |
| src/modules/ad-benchmarks | compare、list | publish、retire（admin） | 基准来源与匹配、可比性校验 |
| src/modules/ad-entitlements | current | 无公开写接口 | 订阅事件投影到广告账户额度；服务提供额度保留与释放约束 |

OAuth 回调是 Web runtime 外部入口，校验一次性 state、session 绑定、过期时间和 provider 错误；禁用模块返回不可用。
用户 token 服务端加密存储，日志脱敏；撤销和数据删除可取消后续任务。应用代码仅通过 `src/env.js` 读配置。
并发绑定和权益读取由产品权益服务提供原子边界；避免跨模块直接导入业务内部实现，可经框架注册的服务契约使用。

| 事件 | 触发 | 订阅者 |
| --- | --- | --- |
| ads:account-bound | 绑定提交成功 | 同步调度、产品 analytics |
| ads:sync-completed | 完整数据快照落库 | 首次诊断调度、analytics |
| ads:sync-failed | 重试耗尽 | 站内状态、结构化日志 |
| ads:diagnosis-completed | 报告持久化成功 | 站内状态、analytics |
| ads:recommendation-updated | 建议状态变化 | analytics |
| 框架已存在的订阅权益变更事件（实现时核对名称） | 支付 / 续费 / 到期确认 | 广告账户权益投影 |

任务通过 BullMQ + Redis 和 createWorkerInstance。入队与数据库状态采用可恢复调度 / 补偿避免提交后丢任务。
worker 处理分页、退避、限流、授权失效；只在完整快照完成后触发诊断，部分数据显著标识。
手动同步和首次自动同步属于 MVP；定时日更作为后续增强。

## 7. 集成决策与配置优先级

```yaml
integrations:
  oauth_google: enable
  oauth_github: disable
  stripe: enable
  lemonsqueezy: later
  nowpayments: disable
  storage: later
  posthog: enable
  google_ads: enable # 产品报表能力；框架离线转化上传保持独立
  meta_ads: enable
  lark_or_telegram: later
  turnstile: later
  ai_provider: {provider: OpenAI, models: [通过框架配置选择模型]}
```

额外必需服务为 Google Ads API 和 Meta Marketing API。框架的 Google Ads 集成主要处理归因与转化上传，不能直接等同于多租户报表授权。
Google Ads 需要 OAuth 应用和 developer token，详见 [官方接入指南](https://developers.google.com/google-ads/api/docs/get-started/onboarding)。
Meta 读取接口和权限以 [Marketing API Insights 文档](https://developers.facebook.com/docs/marketing-api/insights/) 为实现依据，接入时核实应用审核和权限要求。
行业基准来自运营提供的获许可数据集，第一版不要求额外付费 API。没有真实来源时显示“暂无可比基准”，演示数字只能标记为示例。
不声称能读取未授权竞品的私有花费或转化数据；具体竞品比较待后续明确合法来源。

以下是配置计划，标记“拟新增”的变量尚未写入应用或 .env.example。配置位置：本地 `.env`；部署环境的 Web / Worker secrets。不得提交真实密钥。

| 优先级 | 变量名 | 用途 | 配置位置 |
| --- | --- | --- | --- |
| 必须配置 | DATABASE_URL | PostgreSQL 持久化 | Web / Worker |
| 必须配置 | REDIS_URL 或 REDIS_HOST、REDIS_PORT、REDIS_PASSWORD | 任务与限流 | Web / Worker |
| 必须配置 | AUTH_SECRET | 会话保护 | Web |
| 必须配置 | AUTH_GOOGLE_ID、AUTH_GOOGLE_SECRET | Google 登录 | Web；Google OAuth 控制台配置回调 |
| 必须配置 | ADFLOW_GOOGLE_CLIENT_ID、ADFLOW_GOOGLE_CLIENT_SECRET（拟新增） | 独立广告授权，避免混用框架单账户归因配置 | Web / Worker；Google OAuth 控制台 |
| 必须配置 | ADFLOW_GOOGLE_DEVELOPER_TOKEN（拟新增） | Google Ads 报表访问 | Web / Worker |
| 必须配置 | ADFLOW_META_APP_ID、ADFLOW_META_APP_SECRET（拟新增） | Meta 广告授权 | Web / Worker；Meta 应用后台 |
| 必须配置 | ADFLOW_CREDENTIAL_ENCRYPTION_KEY（拟新增） | 用户广告 token 加密 | Web / Worker secrets |
| 必须配置 | OPENAI_API_KEY | AI 诊断解释和建议生成 | Worker |
| 必须配置 | STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET、NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | 订阅付款与可信权益 | Web；Stripe 配置 webhook |
| 上线前建议配置 | ADFLOW_AI_MODEL（拟新增） | 固定经过验证的分析模型 | Worker |
| 上线前建议配置 | SERVICE_MODE | 明确运行 web,worker，保持独立 Hono API 关闭 | 部署运行配置 |
| 可选增强 | PostHog、Resend 的既有变量（实施时按集成文档列出准确名称） | 使用漏斗、邮件通知 | 对应运行服务 |

广告用户 refresh/access token 通过授权流程获得并加密入库，不要求每位用户填写全局环境变量。
上线前还必须完成 OAuth 回调域名、平台权限、隐私 / 数据删除说明、商品价格和基准数据许可配置；这些不都是 API Key。

## 8. MVP 范围（待确认）

```yaml
mvp_scope:
  product_name: AdFlow
  one_liner: 多平台广告账户只读 AI 诊断与优化工作台
  target_users: [中小广告主, 独立投手]
  core_user_stories: [授权导入, 发现低效广告, 处理优化建议, 对比行业基准, 按账户数订阅]
  must_have_features:
    - 产品首页与中英文文案，主 CTA 进入实际诊断工作台
    - Google Ads 与 Meta Ads 授权、账户选择、解绑和重新授权
    - 最近 30 天历史同步，广告层级指标与手动重试
    - 花费、CTR、CPC、CVR、CPA、ROAS 及前期趋势，保留数据口径
    - 附证据的异常和低效诊断，AI 生成具体优化步骤
    - 建议采纳 / 忽略，报告历史
    - 有来源的匹配行业基准；不匹配或无数据时明确缺失
    - 按 1 / 5 / 20 个账户分级月订阅，使用框架商品和支付服务
    - 权限隔离、额度并发保护、任务状态和明确错误提示
    - 与真实数据隔离并显著标识的示例体验
  nice_to_have_features: [每日自动同步, 邮件周报, 报告导出]
  explicitly_out_of_scope:
    - 自动更改投放、预算、出价或创意
    - 未授权竞品私有数据和没有来源的行业排名
    - 代理商团队、组织权限和客户共享
    - 年付、优惠券定制、多币种结算和免费试用机制
    - 自建支付、认证、邮件、队列或对象存储底层
  business_model: subscription
  required_integrations: [NextAuth, Stripe, PostgreSQL, Redis/BullMQ, OpenAI, Google Ads API, Meta Marketing API]
  first_demo_path: 首页 → 示例工作台 → 定位低效广告 → 查看证据和建议；真实路径为登录 → 订阅 → 授权绑定 → 同步 → 报告
  acceptance_criteria:
    - 配置齐全时，两平台各至少一个真实授权账户能完成同步并生成可追溯报告
    - 授权取消、过期、限流、部分同步和无数据有明确状态与恢复入口
    - 指标零分母、缺失转化、混币种和不同归因口径不生成误导性结果
    - 用户无法访问其他用户的账户、同步、报告和建议
    - 并发绑定不能超额，重复 webhook 和任务重试不重复授予权益或写入数据
    - AI 输出经过结构校验；失败不伪装成成功报告
    - 基准显示来源和适用条件，无可比数据时不生成虚构对比
    - 核心路径支持窄屏及 loading / empty / error / unauthorized 状态
```

## 9. 测试与交付计划

```yaml
tests:
  - {module: ad-accounts, service_unit: required, router_integration: required, worker: required, e2e: required}
  - {module: ad-diagnostics, service_unit: required, router_integration: required, worker: required, e2e: required}
  - {module: ad-benchmarks, service_unit: required, router_integration: required, worker: none, e2e: optional}
  - {module: ad-entitlements, service_unit: required, router_integration: required, worker: optional, e2e: required}
```

重点覆盖 OAuth state 重放 / 越权、指标计算、基准可比性、token 撤销、重复分页、队列重试、AI 无效响应、订阅到期与并发额度。
自动测试 mock 外部 provider；数据库集成测试使用测试数据库。端到端保留示例诊断、受控账户诊断与测试模式订阅少量关键路径。
真实平台验收需已获批应用、用户授权与配置好的账户，不以 mock 测试通过替代真实验证。
实现后执行 completion-checklist：lint、typecheck、build、相关测试、migration、配置与安全审查；报告所有未运行项。
完成后按用户授权 git add、commit、push origin main，检查 Actions 的触发与结果。

## 10. 当前确认项与检查记录

- 建议采用上述只读 MVP、1 / 5 / 20 账户月订阅和有来源基准范围；用户可一次性确认或修改。
- 价格、结算币种及首发市场可以在商品配置阶段补齐，不伪造真实价格或开启未配置支付。
- 已读取中英文设计规则、新模块、测试、支付、广告、API 和完成检查文档。
- 当前仅新增设计文档，没有产品代码、数据库或环境变量变更；尚未 commit / push / 部署。
- 用户确认 scope 后再进入产品代码，实现前继续读取对应 auth、database、queue、security、analytics 和部署文档。

## 已确认后的实现记录

MVP 已获用户确认。最终模块、数据持久化取舍、实际环境变量及验证方式见 [AdFlow 上线说明](../product/adflow.md)。以该文档的实际配置清单为准；上文拟议实体不等同于最终 Prisma 表。
