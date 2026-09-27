# 让 Codex / Claude Code 读取墨书笔记

墨书提供本地、只读的 MCP stdio 接口。外部 AI 可以读取书籍目录、全部笔记及每次追加记录、个人感悟、已保存的 AI 分析稿和可用正文。它不启动网络端口，不保存 API Key，也不修改原始笔记。

## 准备

需要 **Node.js 22.18 或更新版本**，以及已执行 `pnpm install --frozen-lockfile` 的项目。服务复用网页端的笔记分组逻辑；原生 TypeScript 类型擦除需要上述 Node 版本。EPUB 解析使用项目已有的 `fflate` 与 `jsdom`，不会执行书中脚本或加载外部资源。

选择一种资料来源：

- 桌面版：指定本地数据目录，目录中应有 `Books/library.json`。也可以指定 `Books` 本身，或包含 `Readest/Books` 的自定义目录。每次调用读取最新文件。
- 网页版：在「本书笔记 → 导出 → JSON」导出统一资料包。使用 `--snapshot` 指定文件；可重复此参数加载多本书。快照包含导出时的记录，后续新增内容需要重新导出。

参数不会自动搜索用户其他目录。未提供资料路径时服务器会退出，不会猜测或打开默认书库。

## Codex 配置

在 Codex 的 MCP 设置中添加 stdio 服务。也可在自己维护的 `config.toml` 中加入以下配置，将两个路径替换为实际的绝对路径：

```toml
[mcp_servers.moshu_notes]
command = "node"
args = ["/absolute/path/readest/apps/readest-app/scripts/notes-mcp/server.mjs", "--library", "/absolute/path/Readest"]
```

如果使用 JSON 快照：

```toml
[mcp_servers.moshu_notes]
command = "node"
args = ["/absolute/path/readest/apps/readest-app/scripts/notes-mcp/server.mjs", "--snapshot", "/absolute/path/book-notes.json"]
```

如果桌面客户端找不到 `node`，把 `command` 替换为 Node 可执行文件的绝对路径。工作目录不影响运行。

## Claude Code 配置

在所选项目的 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "moshu_notes": {
      "command": "node",
      "args": [
        "/absolute/path/readest/apps/readest-app/scripts/notes-mcp/server.mjs",
        "--library",
        "/absolute/path/Readest"
      ]
    }
  }
}
```

网页快照将 `--library` 和目录替换为 `--snapshot` 和 JSON 文件路径。连接范围就是指定的本地书库或快照，不需要向墨书配置外部模型的 API Key；外部客户端使用自己的模型设置。

## 工具与数据范围

| 工具 | 作用 |
| --- | --- |
| `list_books` | 分页列出当前资料范围内的书籍，返回稳定的 `hash` |
| `list_notes` | 按章节与原文位置分页读取笔记组，每组包含原文、所有历次记录及其稳定 ID |
| `read_note_thread` | 根据组 ID 或单条记录 ID 读取完整笔记组 |
| `read_reflections` | 分页读取个人感悟；`kind: "reports"` 切换到 AI 分析稿 |
| `search_notes` | 搜索笔记文本和原文摘录，可限定一本书或搜索全部指定资料 |
| `list_chapters` | 列出可读取的正文单元及其来源范围 |
| `read_chapter` | 分页读取指定章节/节的文字 |

`list_notes` 的 `total` 是原文组数，`entryTotal` 是记录总数。统一记录 ID 与软件内导出完全一致：`native:`、`reading:`、`capture:`、`reconstruction:` 分别表示划线批注、主动笔记、章节随想、章节思考。相同原文定位的多次独立记录保留在同一组内。未保存为笔记的聊天消息不属于笔记接口。

列表默认每页 50 项，最多 100 项；正文默认每页 12000 个 UTF-16 字符单位，最多 50000。**处理全部资料时，必须继续传入 `nextCursor`，直到返回 `null`。** 游标绑定查询范围与内容版本；阅读过程中资料变化会提示从第一页重新开始，避免静默漏读。每次调用独立加载最新文件，跨文件读取不构成数据库事务。

### 正文的实际支持范围

1. **本地 EPUB**：读取 EPUB spine 中每一节的可见纯文本，`source: "epub"`、`completeChapter: true`。一节可能包含多个小标题，不保证与视觉目录的一章一一对应。保留顺序，不提取图片、公式图或音频。
2. **已有本地段落索引**：没有可访问 EPUB 时，可以读取 `thematic-passages.json`，`source: "cached-passages"`、`completeChapter: false`。因为无法与原文件验证版本，不把缓存承诺为最新完整正文。
3. **笔记原文摘录**：没有正文或索引时，返回笔记中保存的原文，`source: "note-excerpts"`、`completeChapter: false`。统一 JSON 快照属于这一范围。

PDF、扫描图片等格式不提供全文解析；仍可读取它们的笔记和保存的摘录。EPUB 单个压缩包限 150 MiB、单个文本文件限 20 MiB、总解压文本限 80 MiB。位于指定目录之外的就地导入原文件不会被读取；可使用已有索引/摘录，或明确指定包含该书文件与 `Readest/Books` 的自定义书库根目录。

接口只接受书籍 ID 和返回的笔记/章节 ID，不接受客户端传入任意文件路径。它只读取书库索引、笔记相关 sidecar 文件和指定范围内的 EPUB；越界路径与符号链接会被拒绝。配置、密钥和 `.env` 不在读取列表中。

## 使用示例

向已连接的客户端提出：

> 请读取墨书里《这本书》的全部笔记和感悟，遍历所有分页。区分我的原话与 AI 分析，找出同一原文下理解的变化，给出引用的记录 ID；没有读取到的正文不要推测。

外部客户端的分析结果暂由用户复制到墨书感悟；MCP 不写回。软件内置的 AI 分析与本接口相互独立，内置功能复用主题阅读的模型配置。

## 本地验证

```sh
pnpm test:notes-mcp
```

测试只创建临时模拟书库，并以真正的 stdio JSON-RPC 连接子进程，验证初始化、工具发现、全量分页、稳定记录 ID、重复阅读追加、实时更新、目录约束、JSON 快照与 EPUB 正文。不会打开真实用户书库或调用远程模型。
