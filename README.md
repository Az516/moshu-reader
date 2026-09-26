# 墨书 / Active Reader

本地优先的 AI 阅读器，基于 [Readest](https://github.com/readest/readest) 开发。当前桌面版本 **0.1.10**。

围绕阅读组织三个工作区：快速浏览全书、细读原文与记录思考、跨书主题讨论。书籍、笔记、阅读进度和历史对话保存在本机；调用 AI 时按需发送问题及有限的相关上下文。

## 已实现

- EPUB 阅读、目录、单页／双页、字体调整、朗读与十种阅读背景。
- 选文提问、原文引用回跳、本书笔记与疑问、普通对话历史。
- 主题阅读：左侧历史与搜索，右侧连续对话，支持选书、来源核对、停止、重试和历史恢复。
- 炭灰柠黄亮色、石墨蓝暗色与跟随系统；窄窗口使用历史抽屉。
- 本地安全写入、有效副本恢复、书库备份与合并恢复。

原有官方账号、云同步、订阅、自动更新与遥测在本地版本中关闭。公开资料检索、模型回答和读者主动使用的在线工具仍可能访问网络。

## 界面

以下实际界面使用测试书籍和本机模拟回答，不包含用户的私人对话或笔记。

![主题阅读亮色](docs/moshu/images/light.png)

![主题阅读暗色](docs/moshu/images/dark.png)

## 开发

需要 Node.js、pnpm 11.1.1；桌面构建还需要 Rust 和对应平台工具链。macOS 需要 Xcode Command Line Tools。

```bash
git clone --recurse-submodules https://github.com/Az516/moshu-reader.git
cd moshu-reader
pnpm install --frozen-lockfile
cd apps/readest-app
pnpm setup-vendors
pnpm dev-web
```

默认预览地址为 `http://localhost:3000`。模型连接在“小墨设置”中配置，使用 OpenAI-compatible 接口。桌面 Key 使用系统安全存储，网页 Key 仅保留在当前会话。仓库中的 `.env` 是上游的公开构建配置；个人配置使用被忽略的 `.env.local`，不要提交密钥。

macOS 本地版构建：

```bash
pnpm tauri build --config tauri.active-reader.conf.json --bundles app,dmg
```

使用上述配置以保留应用标识 `local.activereader.desktop`。桌面书库与网页预览书库相互独立；替换应用包不会删除本地数据目录。

## 验证

在 `apps/readest-app` 中运行：

```bash
pnpm lint
pnpm test --run
pnpm test:e2e:web
```

AI 交互测试默认使用本机模拟响应。真实模型测试必须显式开启，详见 [使用与开发说明](README-Active-Reader.md) 和 [测试说明](apps/readest-app/docs/testing.md)。

## 项目资料

- [完整使用说明](README-Active-Reader.md)
- [设计方案、迭代报告与界面参考](docs/moshu/README.md)
- [上游 Readest 说明](README-Upstream.md)

仓库保存源码、测试、应用资源及整理后的设计资料，不包含本机书库、用户对话／笔记、私密配置、安装包、缓存和原始验证日志。

## 来源与许可

项目以 Readest 上游提交 `3e4f8210` 为开发基线，本仓库从墨书 0.1.10 的完整源码快照开始记录，保留上游署名及 [AGPL-3.0 许可](LICENSE)。更早的提交历史见 [Readest 上游仓库](https://github.com/readest/readest)。第三方组件与子模块继续使用各自许可证。
