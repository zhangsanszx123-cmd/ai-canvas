# 项目协作约定

## 项目背景

本项目是基于 Next.js + Supabase 的项目，使用 TypeScript、React、Tailwind CSS 和 Next.js App Router。当前已增加基于 `pg` 的 PostgreSQL 服务端连接模块，通过 `.env` 中的 `DATABASE_URL` 连接数据库；现有 Supabase 代码用于认证。

最新已确认方向：多用户自主注册的画布生图产品，账号与业务数据均存 PostgreSQL，使用 Better Auth，并接入现有 S3 兼容存储。当前页面和 API 已替换 Supabase Auth，遗留模板代码不参与实际认证流程。以 `/docs/prd.md` 和 `/docs/technical-design.md` 的最新决策为准。

后续开发优先遵循当前项目已有的技术栈、目录结构和代码风格。修改前先阅读相关代码，复用现有模块，避免无必要地引入新框架或调整目录结构。

## 项目文档目录约定

相关项目文档统一放在项目根目录的 `/docs/` 下。本文中的 `/docs/` 等路径均相对于项目根目录。

- `/docs/prd.md`：项目需求文档、功能规格、已确认的产品决策。
- `/docs/images/`：截图、界面参考图、流程图等图片资料。
- `/docs/api/`：API 文档、接口约定、第三方服务对接说明。

新增或更新文档时优先合并现有内容，保留仍然有效的信息，避免重复和相互矛盾的记录。

## 需求沉淀规则

当与用户讨论功能实现、产品需求、业务规则或交互细节时，及时将已经明确的需求整理并写入 `/docs/prd.md`。

- 仅将已经确认的信息记录为正式需求或产品决策，不得把未经确认的猜测当作最终需求。
- 需求不完整或存在歧义时，可记录为“待确认问题”或“开放问题”，与已确认需求分开。
- 区分用户确认的需求和当前实现状态，不得仅因代码已实现就视为用户已确认。
- 已确认需求发生变更时，同步更新相关条目和受影响的文档。
- 记录配置方式和环境变量名称即可，不得把环境变量的敏感值写入文档。

## 安全和配置约定

- 不得将 Supabase service role key、数据库密码、访问令牌、完整数据库连接字符串等敏感信息写入前端代码、项目文档、日志或提交到仓库。
- 前端只能使用 `NEXT_PUBLIC_` 开头的公开环境变量；该前缀代表会暴露给浏览器，敏感信息禁止使用此类变量名。
- `DATABASE_URL` 仅用于服务端。数据库访问复用 `/lib/db.ts`，不得在客户端组件中导入数据库模块或直接连接数据库。
- `.env` 和本地私密配置保持不受版本控制；环境变量示例仅包含占位符。
- 涉及用户数据访问时，优先考虑 Supabase RLS 策略和最小权限原则。
- 直接 SQL 查询不得默认视为受 RLS 保护；需确认连接角色、表策略及用户上下文，并在服务端落实认证和授权。
- SQL 查询使用参数绑定，不拼接未经校验的用户输入。
- 自建 PostgreSQL 认证方案下，逐次验证会话和资源所有权；RLS 用户上下文需要自行设计，不假定可直接使用 Supabase `auth.uid()`。

## 编辑与验证

更新本文件时保留原有有效内容，按需合并，不做无意义覆盖。

尊重工作区中已有的用户修改。代码变更后执行与变更范围匹配的检查；数据库连接可用 `pnpm db:check` 验证，连接检查不得修改业务数据。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
