# dsh-purge 1.1.73（lllmzr 自维护版）

基于 [YuJunZhiXue/dsh-purge 1.1.71](https://github.com/YuJunZhiXue/dsh-purge/tree/5e757260a0be055892b48ec520d451cc82e1c191) 的独立维护版本。原作者 YuJunZhiXue，原版权 Copyright (c) 2026 小杨；保留 MIT 许可证及第三方声明。当前仓库不再是零改动镜像。

这是作用于本机 DeepSeek Harness 的第三方插件，提供提示词、规则、补丁和演练台。应用补丁会改变宿主的权限与运行策略；测试通过不等于没有所有风险。

## 本版修复

- 修复 0.2.1 发送消息时报 `unknown prompt variable "{{cwd}}"`：插件生成的 persona 后缀直接读取当前会话目录并按字面文本处理，保留宿主必需的运行时上下文。
- 统一 HTTP 来源与 JSON 请求校验，规则写操作只接受 POST。
- 卸载识别真实的嵌套 profile 结构；停用/卸载时清理本插件占用的默认预设。
- 修复文件句柄路由、并发原子写与重复 Apply 破坏备份的问题。
- 更新使用完整安装树的暂存、切换和回滚；修复本地归档识别，校验 ZIP 路径、符号链接、大小和 CRC。
- 更新源属于 `lllmzr/dsh-purge`。源码安装不会被插件强制 reset 或覆盖。
- 对接 0.2.1 工具 schema；旧 `toolFilter` 的限制保留在源模板，并迁移为独立叶子预设与单调 `tools.guard`，执行子代理仍不能继续委派。
- 演练目标限本机回环和 RFC1918 私网，检查域名全部解析结果与后续工具参数。应用层检查不能替代系统网络隔离。

## 运行与验证范围

- Node.js **>=22.13.0**；本轮验证使用 Node **24.13.1**。
- 目标宿主：官方 Windows 桌面 **0.2.1-rc.3**。
- 已验证：回归测试、官方宿主副本补丁语法/幂等/逐文件还原、官方运行时配置组合与本地接口。
- 未宣称验证：所有模型的输出效果、所有宿主版本、macOS/Linux 桌面或公网演练。
- 原始 1.1.71 检查记录见 [审查报告](audit/REVIEW-1.1.71.md)，当前变更见 [更新记录](release-notes.md) 和 [开发日志](DEVLOG.md)。

## 推荐安装：独立源码 + 单个 profile 本地引用

把此仓库放在长期保留的独立目录。以下命令先预览，确认路径后增加 `--apply`：

```powershell
node scripts/manage-install.mjs --home "$env:USERPROFILE/.dsh" --profile desktop
node scripts/manage-install.mjs --home "$env:USERPROFILE/.dsh" --profile desktop --apply
```

脚本只修改指定 profile：增加 `link:` 依赖、bundle 和本体 insert，并建立指向源码的 Junction。原 package/patch 保存在 `$DSH_HOME/dsh-purge/install-backups/`。不运行铺环境脚本，不自动 Apply，也不启动或重启宿主。官方 Web 要独立使用 `--profile web`。

源码目录就是唯一管理位置，修改会通过链接被宿主读取；更新后完整退出并重新打开应用。源码安装的覆盖式自动更新关闭，需要用 Git 管理；升级前提交本地修改。应用宿主补丁前保留完整原版归档并核对宿主版本。

不要直接照历史 README 或其他镜像的 npm 安装命令操作。此包名不承诺在 npm registry 发布。

## 检查命令

```sh
npm run check
npm test
```

只使用 Node 内置模块即可跑回归，不需要运行安装脚本或提供模型密钥。`scripts/verify-host.mjs`、`verify-runtime.mjs`、`smoke-patched.mjs` 需要工作目录中的官方宿主测试副本；副本和本机测试输出不上传 Git。

`node scripts/verify-prompt.mjs --base <@deepseek-ai的绝对路径>` 使用真实宿主渲染器复现旧错误，并验证 24 组场景、48 次渲染，不发送模型请求。

## 数据与限制

提示词、规则、SQLite 数据等运行数据属于 `$DSH_HOME`，源码目录只管理插件。自动更新和启动自动应用默认关闭。演练技能是文档资源，不代表对应工具已安装；本版安装不会替你下载或执行这些工具。

本项目不是 DeepSeek 官方产品。继续保留原作者署名、MIT LICENSE、NOTICE 和随包第三方声明。历史镜像来源见 [MIRROR-NOTICE.md](MIRROR-NOTICE.md)。
