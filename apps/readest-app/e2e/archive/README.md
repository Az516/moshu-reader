# 已替换界面的历史用例

这里保留旧用例原文作为产品演变记录；`.legacy.ts` 不参与当前 Playwright 发现。它们操作已移除的阅读卡片、五步主题研究表单和自定义左侧地图，不能代表当前墨书的回归结果。

| 历史能力/流程 | 当前验证入口 |
|---|---|
| EPUB 导入、正文位置与单双页往返、停留疑问 | `tests/reader-integration.spec.ts` 的真实 EPUB 与阅读器集成测试 |
| 选文打开小墨、锚定笔记、重开后回到原文 | `tests/reader-integration.spec.ts` 的 selection 测试；`src/features/reading-modes/dialogue-card.test.tsx` 等单测验证保存/取消状态 |
| AI 流式显示、停止、重试、引用跳回书籍 | `tests/reader-integration.spec.ts` 的 thematic SSE 测试 |
| 主题书目调整、历史主题与原文来源弹窗 | `tests/thematic-reading.spec.ts`：三个弹窗的键盘焦点圈定与返回、跨主题恢复、刷新后引用保留 |
| 入口响应式、自定义地图开合 | `tests/mode-selector-responsive.spec.ts` 与 `tests/reading-responsive.spec.ts`：当前阅读入口、原生目录、360px/390px/桌面入口不重叠且可点击 |
| 字句跟随开关、纸张和模式保存 | `tests/reading-modes.spec.ts` |
| 五步术语对齐、结构化观点、关系分析、手写综合判断 | 当前产品已移除这些界面；旧数据仍保留，其校验/迁移由 `thematic.test.ts` 覆盖，不把旧界面测试跳过解释成新流程已验证 |
| 阅读记录的版本、备份、恢复、导入导出 | `src/features/active-reading/data.test.ts` 与本地持久化相关单测；没有声称旧卡片的导出按钮仍存在 |

上游 `tests/reading.spec.ts` / `tests/annotation.spec.ts` 保持原样，使用显式 `pnpm test:e2e:web:upstream`。它们要求原版 Readest 的工具栏和弹窗；当前墨书构建不会满足这些前提，因此不纳入本地版发布门禁。查看用例可运行 `pnpm test:e2e:web:upstream --list`；实际执行须连接对应上游构建。

当前本地版完整门禁为 `pnpm test:e2e:web`；直接 `pnpm exec playwright test` 使用相同范围。没有用全局 skip、放宽 expect 或捕获并忽略断言来获得通过。
