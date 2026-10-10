# 阶段 4 验收报告 · AI 助手（T4-14）

> 验收日期：2026-10-10（会话 5）
> 验收方式：WSL2 实际部署 + pytest（本地 mock OpenAI 服务，仅测试装置）+ 界面核对
> 对照：planning/08-acceptance-tests.md 的 A4 清单

## 1. A4 清单逐项结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A4-1 | 配置模型后真实调用 | ⏳ **待用户配置模型后执行**（D-03） | 适配层/重试/错误路径已用 mock 服务全测；真实调用需用户提供 base_url/model/api_key（见第 7 节配置指引） |
| A4-2 | WBS 初稿生成 | ✅（管线级验证） | mock 返回任务树 → 建议 pending → 差异预览 3 项；真实生成待 A4-1 |
| A4-3 | 未配置降级 | ✅ | 未配置时非 AI 全可用；wbs-draft 返回 422 `model_not_configured`（pytest） |
| A4-4 | 校验拦截 | ✅ | 非法日期/非 JSON/坏引用均不入库（pytest 三例） |
| A4-5 | 建议隔离 | ✅ | pending 不写业务表；接受后写入；拒绝零写入（pytest） |
| A4-6 | 高影响确认 | ✅ | `bulk_reschedule` 类建议必须 confirm=true（pytest `high_impact_confirm_required`） |
| A4-7 | 周报真实 | ✅ | 周报注入三要素头部（统计截止日期/数据来源/生成时间），缺失标注由提示词约束 |
| A4-8 | 密钥不可见 | ✅ | `model.default` 读接口脱敏 `sk-****6789`（pytest `test_ai_status_masked`） |
| A4-9 | 错误与重试 | ✅ | timeout/5xx/非 JSON 均映射可理解错误；瞬态自动重试 1 次（pytest） |

## 2. 功能实现清单

- **适配层**：OpenAI 兼容 `/chat/completions`，配置（base_url/model/api_key/timeout）存 `app_settings.model.default`，密钥仅服务端；错误分类 timeout/api_error/format_error；瞬态自动重试 1 次；连接测试端点 `/api/ai/test`（不持久化）。
- **校验管道**：markdown 围栏 JSON 提取 → 结构校验 → 字段/日期/父引用业务校验；失败短路由为 format_error/validation，零落库。
- **建议中心（BR-05）**：`ai_action_proposals` 三态（pending/accepted/rejected）+ diff_preview（新增/修改/删除）；接受后服务层事务写入业务表并审计；高影响动作二次确认。
- **六项能力**：WBS 初稿（→建议）；工期/依赖检查；风险建议；周报（三要素头部）；项目问答（上下文装配）；全部记录 context_digest（发送范围）与调用审计。
- **配置页**：Base URL/模型/密钥（脱敏不回显）/超时/保存/连接测试；AI 工作台含能力按钮 + 问答 + 建议中心。

## 3. 测试记录

- pytest：**60 passed**（阶段 4 新增 8 例 AI 用例：降级/脱敏/WBS 流/拒绝/校验/坏 JSON/超时/高影响）
- 迁移链 `0001→0007 (head)`
- 界面：AI 工作台（能力按钮 + BR-05 + 建议中心空态）、设置页 AI 配置表单（未配置状态）

## 4. 缺陷修复记录（均有回归）

| # | 缺陷 | 修复 |
|---|---|---|
| D17 | `AiStatusRead` 不存在导入 | 移除 |
| D18 | 测试路径缺 `/ai` 前缀 | 测试对齐 `/api/ai/projects/...` |
| D19 | PowerShell 替换破坏 UTF-8 测试文件 | 重写文件 + 后续禁用 GBK 读写 |
| D20 | `context.build_context_digest` 未定义 | 改用 `parser.build_context_digest` |
| D21 | `ModelCallError` 缺 message 属性 | 补 `self.message` |
| D22 | wbs-draft 端点未声明 201 | `status_code=201` |
| D23 | 解析丢弃 parent_wbs → 子树变根任务 | 规范化保留 parent_wbs + 解析期父引用校验 |

## 5. 已知问题

1. **A4-1 真实模型调用未执行**：未提供模型服务配置（D-03）。代码与测试已完备，配置后即可验证；**绝不使用假数据冒充 AI 结果（S-5）**。
2. 对话消息接口仅支持单轮问答（会话记录保留）；多轮上下文暂未携带历史（后续可增强）。
3. 发送范围（数据最小化）以能力级白名单实现并在 context_digest 记录，暂未提供每能力级开关 UI。

## 6. 范围核对

阶段 4 提示词六项功能全部落地；实现要求 11 条全落实（结构化解析/校验/暂存差异/确认/高影响/不推测/信息不足/错误重试/密钥/数据最小化/审计/可编辑）；验收 9 条中 8 条通过、1 条（A4-1）待用户配置。

## 7. 用户配置指引（供真实调用）

在「系统设置 → AI 模型配置」填写：
- API Base URL：兼容 OpenAI 的地址，如 `https://api.deepseek.com/v1` / `https://api.openai.com/v1`
- 模型名称：如 `deepseek-chat` / `gpt-4o-mini`
- API 密钥：`sk-...`（仅存服务端，保存后不回显）
- 点「连接测试」验证 → 「保存配置」→ AI 工作台即可使用全部能力

## 8. 下一步（阶段 5 · 燃尽图与交付资料）

T5-01~T5-09：进度快照采集（BR-03 真实历史）、ECharts 燃尽图、交付清单模板/台账/附件/Excel、Word 报告（python-docx）、AI 交付清单检查（AI-5）。