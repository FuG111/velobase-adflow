# ad-diagnostics

确定性指标计算、AI 报告及建议处理状态。

配置与验证见 [AdFlow 操作说明](../../../docs/zh-CN/product/adflow.md)。

用户数据从 session 派生 owner，服务校验访问权限。模块经 `src/server/adflow` 组合，异步副作用使用领域事件与持久化 outbox。
