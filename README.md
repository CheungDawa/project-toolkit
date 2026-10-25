<div align="center">

# Project Toolkit

**现代化个人项目经理与交付效能协同工作台**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18.3-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1.svg?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

中文 PC Web · 本地/私有化部署 · 单容器编排 · 零外部重型依赖

</div>

---

## 📖 项目简介

**Project Toolkit** 是专为项目经理、交付工程师和技术主管打造的**自托管项目协同与交付效能工作台**。

不同于传统的庞大笨重系统或只注重敏捷故事的轻量看板，Project Toolkit 聚焦于**完整交付闭环**：以数据库作为项目业务实体的唯一真实数据源（Single Source of Truth），将 WBS 任务树、现代甘特图、干系人策略矩阵、风险与问题闭环、交付物台账、周期报告、项目复盘以及多端分享导出整合为一体。

---

## 🌟 核心功能亮点

### 1. 🌳 WBS 工作分解结构与任务管理
- **多级父子任务树**：支持多层级层级分解，任务编码（如 `1.1.2`）自动依据层级拓扑重算；
- **智能工时加权**：支持基于子任务工时加权自动计算父级汇总进度，或由叶子任务直接驱动；
- **任务依赖与防环校验**：严格的前置任务依赖关系管理，防循环依赖检测；
- **跨项目模板深拷贝**：支持从历史同构项目中一键全量克隆 WBS 任务树结构，避免新项目逐条手工搭建。

### 2. 📅 现代高对比度甘特图（Gantt Chart）
- **胶囊化现代设计**：借鉴 Monday.com / Linear 现代设计语言，采用 1.5px 明确描边与高对比度状态配色，彻底告别传统甘特图任务条与浅色行背景混色看不清的痛点；
- **精准时间轴定位**：首帧渲染自动平滑居中至「今日」（位于视口约 1/3 最佳视野，兼顾近期上下文与未来排期）；
- **「🎯 定位到今日」一键回归**：支持跨月/跨年浏览后一键平滑定位至当前日期；
- **今日参考线与醒目标记**：贯穿式红色指示线搭配顶部胶囊气泡，醒目直观；
- **多尺度与双向联动**：日 / 周 / 月三尺度视图，自由拖拽改期与调整进度，松手后乐观提交并与 WBS 双向同步。

### 3. 👥 干系人管理与四象限矩阵
- **权力 / 关注度二维评估**：自动归类至四大管理象限（重点管理、随时告知、令其满意、监督观察）；
- **参与度感知徽章（C/D）**：清晰标记不知晓、抵制、中立、支持、领导等状态及当前与期望落差；
- **沟通策略与频次台账**：登记沟通频率、主要联络渠道及干系人诉求。

### 4. ⚠️ 风险与问题全流程闭环
- **风险概率 × 影响热力评分**：红黄绿三色定级（高/中/低），支持风险评估历史溯源；
- **风险一键转任务 / 问题**：当风险发生或需要前置防范时，可一键衍生对应处理任务或记录问题；
- **问题严格闭环机制**：关闭问题时必填解决结果与说明，彻底防止“假关闭”，全流程可追溯。

### 5. 🔄 项目复盘与行动项联动（Retrospectives）
- **结构化复盘沉淀**：覆盖目标回顾、结果对比、经验亮点、教训不足四个核心维度；
- **行动项（Action Items）一键转化**：复盘识别的改进措施可直接一键转为后续任务、新增风险或遗留问题；
- **实时联动感知**：行动项直接展示关联实体的实时流转状态与完成进度徽章，杜绝“复盘完就搁置”。

### 6. 📤 数据导出与分享导出双轨制
- **数据导出（面向数据再加工）**：CSV / Excel / JSON 统一后端接口，支持各模块底层数据全量导出；
- **分享导出（面向团队汇报与客户呈现）**：
  - 📄 **单页不分页长图 PDF（直接下载）**：基于 ISO 32000 标准纯前端组装的自适应长页 PDF，彻底解决传统浏览器物理 A4 打印将表格从中间截断腰斩的顽疾；
  - 🖼️ **2x Retina 高清长图（PNG）**：直接生成高清无损长图，方便一键贴进微信群、钉钉或邮件直接传阅；
  - 🖨️ **分页 PDF（新窗口打印）**：保留针对物理 A4 打印机输出的纯净无壳打印；
  - 🌐 **离线单文件 HTML**：内联样式、零外部网络依赖的自包含离线报告文件，双击即可离线查看。

### 7. 📊 项目驾驶舱、看板与报告中心
- **多维效能视图**：项目驾驶舱（KPI / 阶段占比 / 关键动态）、任务状态流转看板（Kanban）、计划基线对比（Baseline）；
- **交付物台账与燃尽图**：交付物状态与版本管理、历史快照真实燃尽图（工时与任务数双口径）；
- **周期报告引擎**：一键生成项目日报、周报与月报。

---

## 🛠️ 技术架构

```
┌────────────────────────────────────────────────────────┐
│               Project Toolkit Client (Web)             │
│   React 18 + TypeScript + Ant Design 5 + Vite + ECharts│
└───────────────────────────┬────────────────────────────┘
                            │  HTTP / REST API (port: 8180)
┌───────────────────────────▼────────────────────────────┐
│                    Nginx Reverse Proxy                 │
└─────────────┬────────────────────────────┬─────────────┘
              │  /api                      │  /
┌─────────────▼──────────────┐ ┌───────────▼─────────────┐
│    FastAPI Backend App     │ │    Static Web Assets    │
│  SQLAlchemy 2.0 + Alembic  │ └─────────────────────────┘
└─────────────┬──────────────┘
              │  TCP (port: 5432, internal only)
┌─────────────▼──────────────┐
│       PostgreSQL 17        │
│    (Named Volume: pgdata)  │
└────────────────────────────┘
```

- **后端**：FastAPI (Python 3.12) + SQLAlchemy 2.0 (ORM) + Alembic (数据库版本迁移) + PostgreSQL 17
- **前端**：React 18 + TypeScript + Ant Design 5 + Vite + ECharts + frappe-gantt + html-to-image
- **部署**：Docker + Docker Compose 多阶段构建与编排

---

## 🚀 快速启动

### 方式一：Docker Compose 一键启动（推荐）

1. **克隆代码到本地**：
   ```bash
   git clone https://github.com/CheungDawa/project-toolkit.git
   cd project-toolkit
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   # 按需修改 .env 中的 POSTGRES_PASSWORD 或端口号（默认 8180）
   ```

3. **启动容器服务**：
   ```bash
   docker compose up -d --build
   ```

4. **访问系统**：
   - Web 界面：[http://localhost:8180](http://localhost:8180)
   - 健康检查：`http://localhost:8180/api/health`（返回 `{"status":"ok","db":"ok"}`）

---

### 方式二：本地开发调试

#### 后端开发环境（Python 3.12+）：
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# 运行数据库迁移并启动调试服务
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

#### 前端开发环境（Node.js 20+）：
```bash
cd frontend
npm install
npm run dev
# 前端 Vite 调试地址：http://localhost:5173
```

---

## 📁 目录组织

```
project-toolkit/
├── backend/               # 后端应用目录
│   ├── alembic/           # 数据库版本迁移链 (0001~0010)
│   ├── app/
│   │   ├── api/           # RESTful 接口路由
│   │   ├── core/          # 基础配置与数据库引擎
│   │   ├── models/        # SQLAlchemy 实体模型
│   │   ├── schemas/       # Pydantic 校验模型
│   │   └── services/      # 业务逻辑与报告服务
│   └── tests/             # 后端单元与集成测试
├── frontend/              # 前端单页面应用
│   ├── src/
│   │   ├── api/           # 请求封装层
│   │   ├── assets/        # 样式与静态资源（含甘特图增强样式）
│   │   ├── components/    # 公共组件（ExportMenu, GanttView 等）
│   │   ├── pages/         # 业务模块页面（WBS, 甘特, 复盘, 报告等）
│   │   └── utils/         # 报告生成 (HTML/PDF/PNG)、下载工具
├── docker/                # Docker 镜像构建配置 (Dockerfile, entrypoint)
├── docs/                  # 详细技术文档（部署、备份、合规、手册）
├── planning/              # 需求规格说明与架构设计文档
├── scripts/               # 数据库备份、恢复与批量导入脚本
├── docker-compose.yml     # 容器编排定义
├── .env.example           # 环境变量示例
└── LICENSE                # MIT 开源许可证
```

---

## 🔒 安全与部署建议

- **网络边界防护**：本系统默认按个人项目经理本地或局域网私有化部署设计，`docker-compose.yml` 中默认将端口绑定于 `127.0.0.1`，数据库端口不对外暴露；
- **公网访问规范**：切勿在无安全防护的前提下将 `8180` 端口直接映射至公网；若需远程访问，推荐使用 **SSH 隧道** 或 **企业内部 VPN / ZeroTrust 网关** 穿透访问。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。您可以免费用于个人使用、企业内部部署、商业定制或二次分发开发。
