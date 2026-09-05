# AdFlow：配置、验证与上线

入口为 `launchpad_flow`，MVP 范围已由用户确认。领域设计见 [设计记录](../ai/adflow-domain-design.md)。

## 已实现的闭环

- `/`：AdFlow 产品首页。`/adflow/demo`：隔离的合成示例，可查看指标、预设建议及采纳状态。
- `/adflow`：登录后授权 Google Ads / Meta Ads、发现并绑定广告账户、同步、查看指标和 AI 报告、管理建议与套餐。
- 从账户时区的昨日向前读取 60 天，展示最近 30 天并对比前 30 天。超过 100,000 行时明确失败，避免不完整报告。
- Google 管理账户展开为实际投放账户。Meta 第一版使用网站购买事件 `offsite_conversion.fb_pixel_purchase`、7 天点击归因和转化时间；界面保留该口径，不能当作所有转化事件总和。
- 缺失转化保留 null；金额和比例由代码计算。AI 解释花费最高 50 个广告的证据，最多生成 12 条建议，不能自动修改广告。
- 行业基准必须匹配平台、行业、地区、目标、币种和归因口径，且来源周期不超过一年；无匹配来源时显示空状态。
- 1 / 5 / 20 个账户的月订阅复用框架商品、Stripe、履约和订阅周期。账户数与 Google/Meta 登录身份数无关。
- 升级使用框架结账路径；同币种月订阅的降级使用 Stripe Schedule，下期付款与本地续费周期确认后更新套餐。超额停止同步/新诊断，由用户解绑保留账户。
- 解绑保留历史，撤销访问清除本地令牌，删除账户数据级联删除快照、报告和建议。

## 模块及实现决策

- `src/modules/ad-accounts`：账户、OAuth、provider 适配、UI、同步 outbox。
- `src/modules/ad-diagnostics`：确定性指标、规则、报告与建议。
- `src/modules/ad-benchmarks`：可比基准、管理员发布/停用 API。
- `src/modules/ad-entitlements`：从框架已履约订阅读取额度、未来套餐变更。
- `src/server/adflow`：API/worker/AI 组合层。跨模块副作用使用领域事件，DB outbox 补偿遗漏。
- 与初始设计相比，广告实体及每日指标保存在不可变的完整同步 JSON 快照内，而非多张可变指标表，便于报告追溯。已校验行 schema 和重复键；仅产品表加入迁移。
- 没有另建支付权益账本。额度直接从已履约订阅及有效周期计算，免除重复权益发放问题。新增 `AdsPlanChange` 保存未来降级状态。
- 修复了框架低层 `membership.createSubscription/createSubscriptionCycle` 的权限：仅管理员；状态查询固定使用当前用户。

## 必须配置

配置位置统一为本地 `.env` 或 Velobase Cloud 对应服务的环境变量 / Secret。定义在 `src/env.js`，模板在 `.env.example`。不要将实际密钥提交到 Git，也不要在聊天中粘贴密钥。

| 变量名 | 用途 | 配置位置 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL | Web、Worker |
| `REDIS_URL`，或 `REDIS_HOST` / `REDIS_PORT` / `REDIS_USER` / `REDIS_PASSWORD` | 队列、OAuth state、限流 | Web、Worker |
| `AUTH_SECRET` | 登录会话 | Web |
| `APP_URL`、`AUTH_URL` | 公网 HTTPS 地址和登录回调 | Web、Worker |
| `AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET` | Google 登录应用 | Web；Google Cloud OAuth 后台 |
| `ADFLOW_GOOGLE_CLIENT_ID`、`ADFLOW_GOOGLE_CLIENT_SECRET` | 广告账户 OAuth 应用 | Web、Worker；Google Cloud OAuth 后台 |
| `ADFLOW_GOOGLE_DEVELOPER_TOKEN` | Google Ads API 开发者访问 | Web、Worker；Google Ads API Center |
| `ADFLOW_META_APP_ID`、`ADFLOW_META_APP_SECRET` | Meta Marketing API 应用 | Web、Worker；Meta 应用后台 |
| `ADFLOW_META_API_VERSION` | 应用支持的 Marketing API 版本，例如后台明确列出的版本号 | Web、Worker；部署时按 Meta 后台填写 |
| `ADFLOW_CREDENTIAL_ENCRYPTION_KEY` | 用户授权令牌的 AES-256-GCM 加密密钥，64 个十六进制字符 | Web、Worker Secret；两服务使用同一个值 |
| `OPENAI_API_KEY` | AI 诊断 | Web 用于就绪判断，Worker 用于调用 |
| `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 订阅结账、Webhook 验签 | Web；Stripe 后台配置 Webhook |
| `STRIPE_SECRET_KEY` | 未来降级的付款与套餐对账 | Worker |
| `VELOBASE_API_KEY` | 既有 GitHub Actions 的 Cloud 部署授权 | GitHub repository Actions Secret；不要写进产品配置文件 |

Google 登录应用可以与广告 OAuth 应用使用同一 Cloud 项目，但登录授权与广告授权逻辑独立；不要把多租户广告授权令牌填入框架单账户归因变量 `GOOGLE_ADS_REFRESH_TOKEN`。

OAuth 回调必须精确配置：

- 登录：`https://你的域名/api/auth/callback/google`
- Google Ads：`https://你的域名/api/adflow/oauth/google`
- Meta Ads：`https://你的域名/api/adflow/oauth/meta`

Google 需要 `openid` 与 `https://www.googleapis.com/auth/adwords` scope；Google 的 scope 本身不是只读 scope，本应用只调用读取接口。需要 developer token 的正式账户访问级别和 OAuth 发布/审核。参见 [Google 接入](https://developers.google.com/google-ads/api/docs/get-started/onboarding)。
Meta 需要支持广告报表的应用、`ads_read` 权限及适用的应用审核/业务验证；版本和访问要求以 [Marketing API](https://developers.facebook.com/docs/marketing-api/get-started/authorization/) 后台与官方文档为准。

## 上线前建议配置

| 变量名 | 用途 | 配置位置 |
| --- | --- | --- |
| `ADFLOW_MODE=auto` 或 `on` | 启用产品 API/worker；`off` 禁用 | Web、Worker |
| `ADFLOW_GOOGLE_API_VERSION` | Google Ads REST 版本，当前默认 v25 | Web、Worker；按官方版本周期维护 |
| `ADFLOW_AI_MODEL` | 经验证的结构化输出模型，默认 gpt-4.1-mini | Worker |
| `ADFLOW_MAX_DAILY_REPORTS` | 每账户滚动 24 小时新报告上限，默认 5 | Web、Worker |
| `SERVICE_MODE` | 拆分部署分别 web / worker；本地 combined 为 web,worker | 部署运行配置 |
| `NEXT_PUBLIC_APP_NAME=AdFlow` | 框架登录和账单品牌 | Web 构建环境 |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | 支持与隐私联系邮箱 | Web 构建环境 |

运营方需在上线前补全名称、联系信息、数据保留/备份策略和适用的商业条款。产品已替换模板的视频生成隐私/条款页面为实际广告数据处理说明。广告名称和聚合指标会发送给配置的 OpenAI 服务，授权页面有提示。

## 可选增强

| 变量名 | 用途 | 配置位置 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | 可选的 OpenAI 兼容服务地址 | Worker；更换处理商时同步隐私说明 |
| `NEXT_PUBLIC_POSTHOG_KEY`、`NEXT_PUBLIC_POSTHOG_HOST`、`POSTHOG_API_KEY` | 功能使用事件分析 | Web / Worker |
| `RESEND_API_KEY`、`EMAIL_FROM` | 框架邮件登录或支持邮件 | Web / Worker |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` | 框架登录反滥用 | Web |

邮件周报、每日自动同步、团队共享、广告自动调整和额外竞品数据服务不在本期范围。

## 配置套餐

先用框架运行环境执行：

```bash
pnpm exec tsx scripts/seed-adflow.ts
```

此命令幂等创建 `adflow-starter`、`adflow-growth`、`adflow-scale` 三个**不可购买**的商品草稿及月订阅计划。不会覆盖已配置的价格或可用状态，也不会自动给用户授予额度。

在现有管理员商品配置中设置真实月费（USD 最小货币单位）、状态 ACTIVE 和 isAvailable。保留商品 metadata：`{"adflow":true,"accountLimit":1}`（其他档为 5 / 20）。价格未配置前页面展示“价格待配置”。不要把未定价格替换为虚构的正式售价。

Stripe 使用框架生成的结账和 Webhook。打开 Stripe Customer Portal 的取消续费、账单和付款方式管理；产品内负责套餐降级计划，避免在 Portal 另行改套餐而不同步产品计划。

框架默认 USD 商品，首版不添加多币种价格。以后添加多币种时，产品价格展示和降级也需要按结账币种一起扩展。

## 发布行业基准

通过管理员 tRPC `adflow.publishBenchmark` 提交经过许可的数据：platform、industry、region、objective、currency、attribution、metric、value、sourceUrl、licenseNote、sampleSize、periodStart、periodEnd、published。
也可以在运营服务器执行 `pnpm exec tsx scripts/import-adflow-benchmarks.ts <licensed-benchmarks.json>` 导入相同结构的 JSON 数组；同一来源、周期和口径重复导入会更新，不会重复插入。

使用 `adflow.retireBenchmark` 停用来源过期的数据。不得用模拟值冒充行业水平。MVP 不内置未经授权的竞品数据集。

## 本地验证

普通单元测试不连接广告/支付/AI 服务：

```bash
node --env-file=.env --import tsx --test src/modules/ad-accounts/server/crypto.test.ts src/modules/ad-accounts/server/providers.test.ts src/modules/ad-diagnostics/server/service.test.ts
```

集成测试连接独立 PostgreSQL/Redis，并在测试后清理所建数据；广告、AI 和 Stripe 调用全部模拟。仅在独立测试库执行：

```bash
ADFLOW_TEST_DATABASE=1 NODE_ENV=test node --env-file=.env --experimental-test-module-mocks --import tsx --test src/modules/ad-accounts/server/router.integration.test.ts
```

集成测试采用仓库已有的 Node module mocking 模式，需要支持 `--experimental-test-module-mocks` 的 Node 版本（本次使用 Node 25）；生产仍按框架 Node 20+ 构建。

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm check:env
pnpm test:env
pnpm db:migrate
```

Worker 的 outbox 每 15 秒扫描，自动补发已提交未入队的同步/诊断任务。最大重试 3 次，后台仅记录安全错误码。真实用户凭证不写入 Job payload。

## 真实服务验收

完成配置后，用 Google 和 Meta 各一个有权访问的测试广告账户完成授权 → 绑定 → 同步 → 报告 → 建议状态；检查平台拒绝/取消授权、过期和零数据。
Stripe 使用测试模式完成购买、升级、到期降级、重复 Webhook、取消续费和到期额度检查。模拟测试不能替代真实 API 和应用审核验收。

GitHub Actions 由 `git push origin main` 触发。当前 `.github/workflows/deploy-velobase.yml` 部署 Web + Worker；Web 在启动时执行迁移。缺少 Cloud GitHub Secret、运行环境变量或平台审核不能靠提交代码补齐。
