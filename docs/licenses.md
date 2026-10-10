# Project Toolkit 依赖与许可证清单

> 生成日期：2026-10-10（阶段 6 交付，T6-06）
> 生成方式：容器内 `pip freeze`（backend）与 node 容器 `npm list --depth=0`（frontend）实测收集；许可证以包元数据/官方仓库为准。

## 一、自研代码

| 部分 | 许可证 | 说明 |
|---|---|---|
| Project Toolkit 全部源码 | 用户自有 | 未采用 GPL/AGPL 代码；OpenProject/Plane/Taiga 仅借鉴交互设计，**零代码复制** |

## 二、后端直接依赖（Python，requirements.txt）

| 包 | 用途 | 许可证 |
|---|---|---|
| fastapi | Web 框架 | MIT |
| uvicorn[standard] | ASGI 服务器 | BSD-3-Clause |
| pydantic / pydantic-settings | 数据校验与配置 | MIT |
| SQLAlchemy | ORM | MIT |
| alembic | 数据库迁移 | MIT |
| psycopg[binary] | PostgreSQL 驱动 | LGPL-3.0（驱动二进制分发） |
| openpyxl | Excel 读写 | MIT |
| python-multipart | 文件上传解析 | Apache-2.0 |
| python-docx | Word 生成 | MIT |
| httpx | AI 服务 HTTP 客户端 | BSD-3-Clause |
| pytest / httpx（dev） | 测试 | MIT / BSD-3-Clause |

> 完整冻结版本清单见交付测试报告附录（`docker compose exec backend pip freeze` 可随时再生）。

## 三、前端直接依赖（Node，package.json）

| 包 | 用途 | 许可证 |
|---|---|---|
| react / react-dom | UI 框架 | MIT |
| antd / @ant-design/icons | 组件库与图标 | MIT |
| echarts | 图表（风险矩阵/燃尽图） | Apache-2.0 |
| frappe-gantt 1.2.2 | 甘特图 | MIT |
| dayjs | 日期处理 | MIT |
| react-router-dom | 路由 | MIT |
| typescript / vite / @vitejs/plugin-react（dev） | 构建链 | Apache-2.0 / MIT |

### 特别说明：frappe-gantt CSS 本地化

`frappe-gantt` 的 npm 包 `exports` 字段限制 CSS 深路径导入，因此其官方样式文件复制为 `frontend/src/assets/frappe-gantt.css`（文件头部保留 MIT 出处注释）。该文件源自 https://github.com/frappe/gantt 1.2.2，未做功能修改。

## 四、基础镜像

| 镜像 | 许可证 |
|---|---|
| python:3.12-slim | PSF License（Python）+ Debian 组件 |
| node:22-alpine（仅构建期） | MIT（Node）+ Alpine |
| nginx:1.27-alpine | BSD-2-Clause（Nginx）+ Alpine |
| postgres:17-alpine | PostgreSQL License + Alpine |

## 五、合规结论

- 全部直接依赖为 MIT / Apache-2.0 / BSD / LGPL-3.0 / PostgreSQL License 等宽松许可证，无 GPL/AGPL 强传染组件进入构建产物。
- GPL/AGPL 项目（OpenProject GPL-3.0、Plane AGPL-3.0、Taiga 前端 AGPL-3.0）仅作设计参考，未复制任何代码、样式或文案，无衍生作品关系（01 规划 2.2 节策略）。
- 分发/自托管义务：保留上述组件的版权与许可声明（随镜像交付的 NOTICE 信息见各包元数据）；LGPL-3.0 的 psycopg 以动态链接的二进制 wheel 使用，满足 LGPL 分发条款。