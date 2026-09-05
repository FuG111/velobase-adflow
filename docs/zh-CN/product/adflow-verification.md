# AdFlow MVP 验证记录

入口：`launchpad_flow`；范围以用户确认的领域设计和 [产品运行说明](./adflow.md) 为准。

## 已完成

- 依赖按锁文件安装；Prisma Client 生成，两个新增 migration 在独立 PostgreSQL 上通过 `migrate deploy` 应用。
- Lint、TypeScript 和 Next.js 生产构建通过。Lint 仅保留框架原有邮件模板 `no-head-element` 警告。
- 10 个产品单元测试通过：凭证加密、平台分页与错误脱敏、归因口径、加权指标和缺失值。
- 14 个集成测试项通过（含父测试）：真实 PostgreSQL / Redis 持久化，模拟 Google、Meta、OpenAI、Stripe；覆盖越权、并发额度、OAuth 一次性状态、同步与报告幂等、撤销、失败重试和付费周期降级。
- 环境变量检查及 13 个环境相关测试通过；新增文件格式检查、`git diff --check` 通过。
- 浏览器检查桌面和 390px 窄屏演示、建议状态操作、行业基准空状态、未登录账户入口和登录弹窗。
- 演示数据有明确标识；没有虚构付费价格、真实行业基准或竞品私有表现。

## 尚需真实配置后验收

本机没有产品的 Google / Meta 应用凭证、OpenAI Key 或 Stripe 测试商户配置。因此未执行真实广告账户 OAuth、平台历史数据请求、付费 AI 调用、真实 Stripe 结账/Webhook。平台应用审核也需要账户所有者操作。

配置清单已在 [产品运行说明](./adflow.md) 按“必须配置 / 上线前建议配置 / 可选增强”列出；密钥只填写到运行环境或 GitHub Secret，不放入仓库或聊天。套餐草稿必须设置真实价格并启用；行业基准需导入有许可、来源与口径的数据。

GitHub Actions 的实际运行结果以推送对应 commit 的工作流为准；工作流接受部署请求不等于已经完成真实服务验收。

## Worker 容器补充验证（2026-09-06）

部署复核发现 Dockerfile.worker 未复制业务模块及 env-normalization.js。已补齐镜像文件，重新构建并在本地 Node 20 容器中连接独立测试 PostgreSQL / Redis 启动：AdFlow Worker 和调度器加载成功，outbox dispatch 任务执行成功，内部 `/health` 返回 HTTP 200。此次仅调整镜像复制清单，验证采用实际容器构建与启动；未重复运行应用 Lint、TypeScript 或 Next.js 构建。云端新版本的健康状态仍需通过 Velobase 控制台确认。
