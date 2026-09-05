# ad-accounts

OAuth 授权、广告账户绑定、同步数据及工作台 UI。

配置与验证见 [AdFlow 操作说明](../../../docs/zh-CN/product/adflow.md)。

用户数据从 session 派生 owner，服务校验访问权限。模块经 `src/server/adflow` 组合，异步副作用使用领域事件与持久化 outbox。
