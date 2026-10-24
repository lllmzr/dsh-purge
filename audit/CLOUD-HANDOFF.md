# 云端检查交接材料

> 当前工作已进入自维护 1.1.72。复核当前版本请运行 `npm run check` 和 `npm test`；下文 `run-audit.mjs` 仅适用于历史 1.1.71 固定提交，不能在新版上当成通过条件。

云端可补跑可移植测试，不会自动继承本地未提交文件。这里没有自动创建或发送到另一个会话。

## 代码与命令

1. 获取原始 1.1.71 提交：`5e757260a0be055892b48ec520d451cc82e1c191`。镜像 `https://github.com/lllmzr/dsh-purge` 保留了它。
2. 将本地新增的 `audit/`、`DEVLOG.md` 随代码一起提供给云端；只有上游仓库链接时，云端看不到这些新增材料。
3. 使用 Node 24 运行：

```sh
node --version
node audit/run-audit.mjs
```

脚本仅需 Node 内置模块，不需要为本轮审查安装 peerDependencies。它不会调用插件 apply、宿主重启、自更新、环境铺设或任何网络目标。

输出 `audit/results.json`。Windows 基线结果是 14 个检查点得到预期证据，包含 9 个缺陷和 1 个维护风险。**退出 0 是复现成功，不是产品安全或兼容性通过。** 云端如果出现 inconclusive，先判断平台差异或测试假设，不要直接判为产品修复。

## 可直接复制的任务说明

> 对 dsh-purge 原始提交 5e757260a0be055892b48ec520d451cc82e1c191 做隔离检查，为自维护版 1.1.72 准备修复。先阅读 audit/REVIEW-1.1.71.md、audit/PLAN-1.1.72.md 与 DEVLOG.md，使用 Node 24 运行 audit/run-audit.mjs，复核每项证据。先报告云端与 Windows 结果差异；如实施修复，为每项缺陷补断言正确行为的回归测试。保留原作者署名。不要运行 redteam-setup.sh、下载或执行演练载荷、进行公网扫描、自动更新到原作者 master，或把云端通过说成 Windows Electron 兼容性通过。Windows 真实宿主已经只读核对为 0.2.1-rc.3，尚未做真实 Apply/Restore。

本地宿主元数据脚本 `audit/read-host-metadata.mjs` 需要本机 ASAR 文件，仅在有对应文件的环境运行；云端没有该文件时按未测试记录。
