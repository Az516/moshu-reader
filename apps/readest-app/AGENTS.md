## Project Overview

Readest is a cross-platform ebook reader built as a **Next.js 16 + Tauri v2** hybrid app. It's part of a pnpm monorepo at `/apps/readest-app/`. The app runs on web (CloudFlare Workers), desktop (macOS/Windows/Linux via Tauri), and mobile (iOS/Android via Tauri).

## Common Commands

```bash
# Development
pnpm dev-web               # Web-only dev server (no Rust compilation needed)
pnpm tauri dev             # Desktop dev with Tauri (compiles Rust backend); on Linux this is the CEF runtime (needs Rust >= 1.95)

# Building
pnpm build                 # Build Next.js for Tauri
pnpm build-web             # Build Next.js for web deployment

# Testing (see [docs/testing.md](docs/testing.md) for full details)
pnpm test                  # Unit tests (vitest + jsdom)
pnpm test -- src/__tests__/utils/misc.test.ts  # Run a single test file
pnpm test -- --watch       # Watch mode
pnpm test:browser          # Browser tests (Chromium via Playwright)
pnpm tauri:dev:test        # Start Tauri app with webdriver
pnpm test:tauri            # Run Tauri integration tests

# Linting & Formatting
pnpm lint                  # Biome (linter) + tsc (type check)
pnpm format                # Biome formatter (runs from monorepo root)
pnpm format:check          # Check formatting without writing (Biome)

# Rust
pnpm fmt:check             # Check formatting Rust code (src-tauri)
pnpm clippy:check          # Lint Rust code (src-tauri)

# Dictionary tooling
pnpm dictionary:yomitan:convert <input.zip> [output.rdict]  # Build a portable Yomitan dictionary
```

### Source Layout

| Directory         | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `src/app/`        | Next.js App Router pages and API routes                       |
| `src/components/` | React components (reader, settings, library, assistant, etc.) |
| `src/services/`   | Business logic: TTS, translators, OPDS, sync, AI, metadata    |
| `src/store/`      | Zustand state stores                                          |
| `src/hooks/`      | Custom React hooks                                            |
| `src/libs/`       | Document loaders, payment, storage, sync                      |
| `src/plugins/`    | Bundled plugin implementations, including Yomitan             |
| `src/utils/`      | Pure utility functions                                        |
| `src/types/`      | TypeScript type definitions                                   |
| `src/context/`    | React Context providers (Auth, Env, Sync, etc.)               |
| `src/workers/`    | Web Workers for background tasks                              |
| `src-tauri/`      | Rust backend: Tauri plugins, platform-specific code           |

### Path Aliases (tsconfig)

- `@/*` → `./src/*`
- `@/components/ui/*` → `./src/components/primitives/*`

### Rust Backend (`src-tauri/`)

Platform-specific code lives in `src-tauri/src/{macos,windows,android,ios}/`. Custom Tauri plugins are in `src-tauri/plugins/`.

## Git Worktrees

Always use `pnpm worktree:new <branch-name|pr-number>` to create worktrees. Never use `git worktree add` directly — the script handles submodule initialization (simplecc WASM, foliate-js), dependency installation, `.env` copying, vendor assets, and Tauri gen symlinks that are required for lint and tests to pass.

```bash
pnpm worktree:new feat/my-feature   # New branch from origin/main
pnpm worktree:new 3837              # Checkout PR #3837 with push access to fork
```

## Active Reader 本地数据约定

- 本地版用户的笔记、疑问、阅读进度、普通对话和主题历史必须通过 `AppService` 保存在本机；不可接入云端数据库、账号同步或后台上传来持久化这些内容。
- 单书成果位于 `Books/<bookHash>/`；主题历史使用 `AppService` 的 `Data` 基目录下的 `thematic-research.json`（macOS 默认实际路径为 `Readest/thematic-research.json`，没有额外的 `Data/` 层）。普通对话使用 `reading-dialogues.json`，笔记/疑问使用 `reading-method.json`，模式与章节思考使用 `reading-modes.json`。
- 修改这些格式时同步更新验证器、版本化备份清单、恢复合并和回归测试。使用 `localReaderPersistence` 的串行安全替换与有效备份恢复，不直接覆盖 JSON。
- 用户主动使用 AI 时可按当前功能发送限量问题、片段与必要上下文；这不改变本地存储约定。测试默认使用本地模拟模型，不调用真实服务或读取用户密钥。
- 当前产品 Web 回归使用 `pnpm test:e2e:web`；上游 UI 与已移除工作流的历史测试单独保留，不作为墨书当前界面的验收依据。

## Agent Workspace

Project-related agent context lives under `.agents/`, which is a symlink to `.claude/`. Treat `.agents/` as the canonical path when looking for or updating local agent material:

- `.agents/memory/` — persistent project memory and recurring context
- `.agents/plans/` — active or archived implementation plans
- `.agents/rules/` — project rules for test-first work, TypeScript, verification, and related workflows

## Project Rules

Rules are in `.agents/rules/`: test-first, typescript, verification.

### Implementation Scope

For every coding task, write the minimum code that solves the requested problem.

- Do not add features beyond what was asked.
- Do not add abstractions for single-use code.
- Do not add flexibility or configurability unless requested.
- Do not add error handling for impossible scenarios.
- If a solution is much longer than necessary, simplify it before finishing.
- Before shipping, ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### i18n

See [docs/i18n.md](docs/i18n.md) for the key-as-content translation approach, `stubTranslation` usage in non-React modules, and extraction workflow.

### Safe Area Insets

See [docs/safe-area-insets.md](docs/safe-area-insets.md) for rules on handling top/bottom insets for UI elements near screen edges.

### Read Aloud

Four engines sit behind `TTSClient`, including recorded-narration playback from EPUB 3 Media Overlays and device-local audiobook pairings. Gate behaviour on `TTSCapabilities`, never on client identity. See [docs/read-along-narration.md](docs/read-along-narration.md).

### Design System

UI/UX rules — surface tiers, action vocabulary, settings primitives (`BoxedList`, `SettingsRow`, `SettingsSwitchRow`, `SettingsSelect`, `NavigationRow`, `Tips`, etc.), boxed-list anatomy, RTL conventions, e-ink overlay, and anti-patterns — live in [DESIGN.md](DESIGN.md). Codify recurring decisions there so they persist for the team and future contributors. Reach for the primitives in `src/components/settings/primitives/` instead of inlining chassis classes.

### E-ink mode

Every new UI widget must look right under `[data-eink='true']`. E-ink screens have no shadows, no gradients, slow refresh, and need crisp 1px borders for delineation. The conventions live in `src/styles/globals.css` — reuse the existing classes instead of inventing new ones:

- **Surfaces / inputs** — add `eink-bordered`. In eink mode it swaps to `bg-base-100` + 1px `base-content` border. Use it on inputs, custom button backgrounds, ghost-styled cancel buttons, and any container that needs a visible boundary.
- **Primary action buttons** — use `btn-contrast` (theme-neutral solid, already e-ink-correct) for most primary actions; reserve `btn-primary` for true call-to-action buttons. The `[data-eink]` rules render both as `base-content` bg + `base-100` text so the primary action stays distinct from secondary actions.
- **`.modal-box`** picks up no-shadow + 1px border automatically; dialogs that use it don't need additions.
- **Don't rely on color/shadow alone for hierarchy.** Two same-tone buttons differ only by hover on color themes, and hover doesn't exist on e-ink touchscreens. Pair a borderless ghost (cancel) with a solid CTA (submit) so eink can invert one without flattening the difference.

When in doubt, toggle E-ink in Settings → Misc and check. The rules in `globals.css` cover most cases automatically, but composite components (custom buttons, layered cards) often need `eink-bordered` on the right element to stay legible.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
