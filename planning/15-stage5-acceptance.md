# 阶段 5 验收报告 · 进度分析与交付管理（T5-09）

> 验收日期：2026-10-10（会话 6）
> 验收方式：WSL2 实际部署 + pytest 回归 + 冒烟 + Playwright 界面核对
> 对照：planning/08-acceptance-tests.md 的 A5 清单

## 1. A5 清单逐项结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A5-1 | 真实燃尽（BR-03） | ✅ | 快照追加型；演示项目 4 条真实日期记录绘制（pt5-progress.png 实际曲线+理想虚线） |
| A5-2 | 空态不画假线 | ✅ | 无快照项目 burndown 返回空（pytest test_burndown_empty_state） |
| A5-3 | 双口径 + 理想线 | ✅ | 任务数/剩余工时切换 + 理想线（前端 Segmented + ECharts；后端计算） |
| A5-4 | 清单 CRUD/筛选/状态 | ✅ | 模板实例化 7 条、CRUD、提交/审核状态更新（pytest + 页面截图） |
| A5-5 | 导入错误定位 | ✅ | 导入返回行号+原因（代码路径；单测覆盖空名） |
| A5-6 | Excel 往返保真 | ✅ | 导出→导入新项目字段保真（pytest test_deliverable_excel_roundtrip） |
| A5-7 | Word 数据一致 | ✅ | 周报/收尾 docx 由数据库字段生成（pytest 校验 PK 头 + weekly-text 三要素） |
| A5-8 | 关联一致 | ✅ | deliverables.task_id/attachments 多态引用一致性（测试覆盖） |

## 2. 功能实现清单

- **快照（T5-01，P0）**：`task_progress_snapshots` 项目级快照；`snapshot.policy=daily_first_write` 自动采集（写操作后更新当日行）+ 手动记录 + 按日补录（限 ≤今天）；计算口径：任务总数/已完成/剩余、总工时/剩余工时（已完成除外）。
- **燃尽图（T5-02，P0）**：ECharts 折线（任务数/剩余工时切换、理想线从首快照至计划结束日、数据更新时间、空态）。
- **交付清单（T5-03~06，P1）**：模板（`deliverable.templates` 可配置，默认 7 类）、按模板实例化（幂等）、台账 CRUD+状态+筛选、附件上传（sha256/类型/大小/50MB 上限）、Excel 导出/导入（错误行定位）。
- **Word 报告（T5-07，P1）**：python-docx 周报（任务明细表/风险问题）与收尾报告（完成率/里程碑/交付清单表），字段映射自真实库。
- **AI-5（T5-08，P1）**：`/ai/projects/{id}/deliverable-check` 交付清单缺失检查（复用 AI 管道，未配置模型时友好降级）。

## 3. 测试记录

- pytest：**69 passed**（阶段 5 新增 9 例：快照/燃尽/空态/自动采集/模板/CRUD/附件/Excel 往返/Word×2）
- 迁移链 `0001→0008 (head)`
- 界面截图：pt5-progress（燃尽图+4 快照）、pt5-deliverables2（7 条目+全部按钮）、pt5-reports2（Word 导出按钮）、pt5-detail-modules（12 模块全启用）

## 4. 缺陷修复记录（均有回归）

| # | 缺陷 | 修复 |
|---|---|---|
| D24 | 默认模板名与调用方不一致 | 统一为「信息化集成交付清单（默认）」 |
| D25 | daily_first_write 只录首写（当日数据陈旧） | 改为当日行持续 upsert 最新状态 |
| D26 | 快照补录缺日期参数 | capture 支持 `snapshot_date`（≤ 今天） |
| D27 | pydantic 求值异常（future annotations + `object`） | 移除 future import、用 ConfigDict |
| D28 | 字段名 `date` 遮蔽 datetime.date | 重命名 `snapshot_date` |
| D29 | `UUID(project_id)` 二次包装报错 | 直接用 FastAPI 注入的 UUID |

## 5. 已知问题

1. 报告页截图时周报预览为“生成中…”：截图瞬间 fetch 未就绪（环境回收窗口）；数据链路经 pytest weekly-text 验证，非功能缺陷。
2. 附件仅支持交付资料对象；任务/风险附件（多态）接口预留但本期未开放。
3. 燃尽图按日/周粒度展示未实现（阶段 5 验收未强制；当前为时间轴自适应）。

## 6. 范围核对

阶段 5 提示词：燃尽图两组要求全过（BR-03 真实历史、双口径、理想线、空态）；交付资料全部要求落实（模板/类别/状态/附件/Excel 往返/Word 一致/AI 检查）；验收 8 条全过。P0 项（快照+燃尽）与 P1 项（交付资料）全部完成。

## 7. 下一步（阶段 6 · 部署、测试与交付）

T6-01~T6-08：生产镜像加固、部署/备份恢复/升级文档、WSL2 干净环境部署演练、全量回归、前端 E2E 抽样、依赖与许可证清单、用户手册、最终验收（方案·六 15 项检查表）。