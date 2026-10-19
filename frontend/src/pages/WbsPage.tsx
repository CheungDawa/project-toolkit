import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  ExportOutlined,
  ImportOutlined,
  LinkOutlined,
  PlusOutlined,
  UpOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { TableProps } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import { useParams } from 'react-router-dom'

import type { DependencyItem, ImportIssue, TaskImportResult, TaskItem, TaskPayload } from '../api/stage2'
import {
  cloneTasksFromProject,
  copyTask,
  createDependency,
  createTask,
  deleteDependency,
  deleteTask,
  exportTasksUrl,
  importTasks,
  listTasks,
  reorderTask,
  updateTask,
} from '../api/stage2'
import type { Project } from '../api/projects'
import { listProjects } from '../api/projects'
import TaskFormModal from '../components/TaskFormModal'

/** 导入模板下载地址（后端端点 GET /api/projects/{id}/tasks/import-template） */
const importTemplateUrl = (projectId: string) => `/api/projects/${projectId}/tasks/import-template`

/** 批量修改可选的任务状态 */
const TASK_STATUS_OPTIONS = ['未开始', '进行中', '已完成', '已暂停', '已取消']

interface TaskNode extends TaskItem {
  children?: TaskNode[]
}

interface BatchFieldFlags {
  status: boolean
  owner: boolean
  plan_start: boolean
  plan_end: boolean
  progress: boolean
}

interface BatchFieldValues {
  status?: string
  owner?: string
  plan_start?: string
  plan_end?: string
  progress?: number
}

/** 导入结果弹窗里的问题列表：最多展示 20 条，超出可滚动 */
function ImportIssueList({
  title,
  issues,
  color,
}: {
  title: string
  issues: ImportIssue[]
  color: string
}) {
  if (issues.length === 0) return null
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text strong style={{ color }}>
        {title}
      </Typography.Text>
      <ul style={{ maxHeight: 200, overflow: 'auto', paddingLeft: 18, marginTop: 4, marginBottom: 0 }}>
        {issues.slice(0, 20).map((issue, index) => (
          <li key={index}>
            第 {issue.row} 行：{issue.message}
          </li>
        ))}
      </ul>
      {issues.length > 20 ? (
        <Typography.Text type="secondary">（共 {issues.length} 条，仅显示前 20 条）</Typography.Text>
      ) : null}
    </div>
  )
}

/** 构建 parent_id -> 直接子任务 的索引 */
function buildChildrenMap(items: TaskItem[]): Map<string | null, TaskItem[]> {
  const map = new Map<string | null, TaskItem[]>()
  for (const item of items) {
    const list = map.get(item.parent_id) ?? []
    list.push(item)
    map.set(item.parent_id, list)
  }
  return map
}

/** 汇总某父任务全部后代（含所有层级）的计划区间：最小 plan_start ~ 最大 plan_end */
function descendantRange(
  parentId: string,
  childrenMap: Map<string | null, TaskItem[]>,
): { start: string | null; end: string | null } {
  let start: string | null = null
  let end: string | null = null
  const stack: TaskItem[] = [...(childrenMap.get(parentId) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop() as TaskItem
    if (node.plan_start && (!start || node.plan_start < start)) start = node.plan_start
    if (node.plan_end && (!end || node.plan_end > end)) end = node.plan_end
    const kids = childrenMap.get(node.id)
    if (kids) stack.push(...kids)
  }
  return { start, end }
}

function buildTree(items: TaskItem[]): TaskNode[] {
  const byParent = new Map<string | null, TaskNode[]>()
  for (const item of items) {
    const node: TaskNode = { ...item }
    const key = item.parent_id
    byParent.set(key, [...(byParent.get(key) ?? []), node])
  }
  const attach = (parent: string | null): TaskNode[] => {
    const list = (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    for (const node of list) {
      const kids = attach(node.id)
      if (kids.length) node.children = kids
    }
    return list
  }
  return attach(null)
}

export default function WbsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [deps, setDeps] = useState<DependencyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<TaskItem | null>(null)
  const [editingParent, setEditingParent] = useState<TaskItem | null>(null)
  const [depModalOpen, setDepModalOpen] = useState(false)
  const [depPred, setDepPred] = useState<string | undefined>()
  const [depSucc, setDepSucc] = useState<string | undefined>()

  // 批量修改相关状态
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchUse, setBatchUse] = useState<BatchFieldFlags>({
    status: false,
    owner: false,
    plan_start: false,
    plan_end: false,
    progress: false,
  })
  const [batchValue, setBatchValue] = useState<BatchFieldValues>({})

  // 从其他项目复制 WBS 相关状态
  const [projects, setProjects] = useState<Project[]>([])
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneSourceId, setCloneSourceId] = useState<string | undefined>()
  const [cloneWithDates, setCloneWithDates] = useState(false)
  const [cloneSaving, setCloneSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await listTasks(projectId)
      setTasks(data.items)
      setDeps(data.dependencies)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载任务失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false
      if (!kw) return true
      return (
        t.name.toLowerCase().includes(kw) ||
        t.wbs_code.includes(kw) ||
        (t.owner ?? '').toLowerCase().includes(kw)
      )
    })
  }, [tasks, keyword, statusFilter])

  const tree = useMemo(() => buildTree(filtered), [filtered])

  /** 父任务 id -> 由子任务汇总出的「建议区间」（只统计有子任务的任务） */
  const summaryRange = useMemo(() => {
    const childrenMap = buildChildrenMap(tasks)
    const map = new Map<string, { start: string; end: string }>()
    for (const task of tasks) {
      const kids = childrenMap.get(task.id)
      if (!kids || kids.length === 0) continue
      const range = descendantRange(task.id, childrenMap)
      if (range.start && range.end) map.set(task.id, { start: range.start, end: range.end })
    }
    return map
  }, [tasks])

  const handleBatchSubmit = async () => {
    const ids = selectedKeys.map((key) => String(key))
    const payload: Partial<TaskPayload> = {}
    if (batchUse.status && batchValue.status) payload.status = batchValue.status
    if (batchUse.owner) payload.owner = batchValue.owner ?? null
    if (batchUse.plan_start) payload.plan_start = batchValue.plan_start ?? null
    if (batchUse.plan_end) payload.plan_end = batchValue.plan_end ?? null
    if (batchUse.progress && typeof batchValue.progress === 'number') payload.progress = batchValue.progress

    if (ids.length === 0) {
      message.warning('请先在表格中勾选要修改的任务')
      return
    }
    if (Object.keys(payload).length === 0) {
      message.warning('请至少勾选一个要修改的字段')
      return
    }

    setBatchSaving(true)
    let success = 0
    let failed = 0
    // 串行提交，避免一次性并发写爆后端；任一条失败不影响其余
    for (const id of ids) {
      try {
        await updateTask(id, payload)
        success += 1
      } catch {
        failed += 1
      }
    }
    setBatchSaving(false)
    setBatchOpen(false)
    if (failed === 0) {
      message.success(`批量修改完成：成功 ${success} 条`)
    } else {
      message.warning(`批量修改完成：成功 ${success} 条，失败 ${failed} 条（后端校验未通过的任务已跳过）`)
    }
    await fetchData()
  }

  const handleRecalcParentDates = async () => {
    const targets = tasks
      .map((task) => ({ task, range: summaryRange.get(task.id) }))
      .filter((item): item is { task: TaskItem; range: { start: string; end: string } } => Boolean(item.range))
      .filter((item) => item.task.plan_start !== item.range.start || item.task.plan_end !== item.range.end)

    if (targets.length === 0) {
      message.info('所有父任务的计划起止已与子任务区间一致，无需重算')
      return
    }

    let success = 0
    let failed = 0
    for (const item of targets) {
      try {
        await updateTask(item.task.id, { plan_start: item.range.start, plan_end: item.range.end })
        success += 1
      } catch {
        failed += 1
      }
    }
    if (failed === 0) {
      message.success(`已按子任务重算 ${success} 个父任务的计划起止`)
    } else {
      message.warning(`重算完成：成功 ${success} 个，失败 ${failed} 个`)
    }
    await fetchData()
  }

  const confirmRecalc = () => {
    const count = tasks.filter((task) => {
      const range = summaryRange.get(task.id)
      return range && (task.plan_start !== range.start || task.plan_end !== range.end)
    }).length
    if (count === 0) {
      message.info('所有父任务的计划起止已与子任务区间一致，无需重算')
      return
    }
    Modal.confirm({
      title: '按子任务重算父任务日期',
      content: `将对 ${count} 个父任务按「子任务最小开始日 ~ 最大结束日」更新计划起止，是否继续？`,
      okText: '确认重算',
      cancelText: '取消',
      onOk: () => void handleRecalcParentDates(),
    })
  }

  const handleSubmit = async (payload: TaskPayload) => {
    if (!projectId) return
    try {
      if (editing) {
        await updateTask(editing.id, payload)
        message.success('任务已更新')
      } else {
        await createTask(projectId, payload)
        message.success('任务已创建')
      }
      setModalOpen(false)
      setEditing(null)
      setEditingParent(null)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (task: TaskItem) => {
    try {
      await deleteTask(task.id)
      message.success(`任务 ${task.wbs_code} 已删除（含子任务）`)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleCopy = async (task: TaskItem) => {
    try {
      await copyTask(task.id)
      message.success('已复制任务及其子任务')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '复制失败')
    }
  }

  const handleMove = async (task: TaskItem, direction: -1 | 1) => {
    if (!projectId) return
    const siblings = tasks
      .filter((t) => t.parent_id === task.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)
    const index = siblings.findIndex((t) => t.id === task.id)
    const target = index + direction
    if (target < 0 || target >= siblings.length) return
    try {
      await reorderTask(projectId, { task_id: task.id, new_parent_id: task.parent_id, new_index: target })
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '排序失败')
    }
  }

  const handleAddDep = async () => {
    if (!projectId || !depPred || !depSucc) return
    try {
      await createDependency(projectId, { predecessor_id: depPred, successor_id: depSucc })
      message.success('依赖已添加')
      setDepPred(undefined)
      setDepSucc(undefined)
      setDepModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '添加依赖失败')
    }
  }

  const handleRemoveDep = async (dep: DependencyItem) => {
    try {
      await deleteDependency(dep.id)
      message.success('依赖已移除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '移除失败')
    }
  }

  const handleImport = async (file: File) => {
    if (!projectId) return false
    try {
      // 兜底永远不能省：灰度/滚动发布时前端可能先于后端部署，
      // 旧构建返回的响应体里没有 warnings/errors 字段，直接 .length 会崩。
      const result: TaskImportResult = await importTasks(projectId, file)
      const errors = result.errors ?? []
      const warnings = result.warnings ?? []

      if (errors.length > 0) {
        Modal.warning({
          title: `导入完成：成功 ${result.created} 条，失败 ${errors.length} 条`,
          content: (
            <div>
              <ImportIssueList title="失败明细" issues={errors} color="#cf1322" />
              {/* 不致命但用户必须知道：父编码找不到按顶级导入、字段超长已截断等 */}
              <ImportIssueList title={`另有 ${warnings.length} 条提示`} issues={warnings} color="#d46b08" />
            </div>
          ),
        })
      } else if (warnings.length > 0) {
        // 全部导入成功但有提示：不能用 success toast，否则用户会以为导入完美，实际树可能挂错位置
        Modal.warning({
          title: `导入成功 ${result.created} 条，但有 ${warnings.length} 条需要注意`,
          content: (
            <div>
              <Typography.Text type="secondary">
                以下行已导入，但处理方式与文件里写的不完全一致，请核对：
              </Typography.Text>
              <ImportIssueList title="提示明细" issues={warnings} color="#d46b08" />
            </div>
          ),
        })
      } else {
        message.success(`导入成功：${result.created} 条`)
      }
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败')
    }
    return false
  }

  /** 打开「从其他项目复制」弹窗并按需拉取项目列表（排除当前项目自身） */
  const openCloneModal = async () => {
    setCloneOpen(true)
    try {
      const data = await listProjects({ archived: 'exclude', size: 100 })
      setProjects(data.items)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载项目列表失败')
    }
  }

  const handleCloneSubmit = async () => {
    if (!projectId) return
    if (!cloneSourceId) {
      message.warning('请先选择要复制的源项目')
      return
    }
    setCloneSaving(true)
    try {
      const result = await cloneTasksFromProject(projectId, cloneSourceId, cloneWithDates)
      message.success(`已复制 ${result.created} 条任务`)
      setCloneOpen(false)
      setCloneSourceId(undefined)
      setCloneWithDates(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCloneSaving(false)
    }
  }

  const columns: TableProps<TaskNode>['columns'] = [
    {
      title: 'WBS',
      dataIndex: 'wbs_code',
      width: 90,
      // 编码如 1.2 / 2.1.12 在窄列里会在小数点后折行（显示成 "1." + "2" 两行），必须禁止换行
      render: (v: string) => (
        <Typography.Text code style={{ whiteSpace: 'nowrap' }}>
          {v}
        </Typography.Text>
      ),
    },
    { title: '任务名称', dataIndex: 'name', width: 220 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={v === '已完成' ? 'green' : v === '进行中' ? 'blue' : 'default'}>{v}</Tag>,
    },
    { title: '负责人', dataIndex: 'owner', width: 100, render: (v: string | null) => v ?? '-' },
    {
      title: '计划起止',
      key: 'plan',
      width: 220,
      render: (_: unknown, r) => {
        const current = r.plan_start && r.plan_end ? `${r.plan_start} ~ ${r.plan_end}` : '-'
        const suggested = summaryRange.get(r.id)
        if (!suggested) return current
        const suggestedText = `${suggested.start} ~ ${suggested.end}`
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            {current}
            <br />
            {/* 父任务：给出由子任务汇总出的建议区间，作为灰色提示 */}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              建议 {suggestedText}
            </Typography.Text>
          </span>
        )
      },
    },
    { title: '工期(天)', dataIndex: 'duration_days', width: 90, render: (v: number | null) => v ?? '-' },
    { title: '工时', dataIndex: 'work_hours', width: 80, render: (v: number | null) => v ?? '-' },
    {
      title: '进度',
      key: 'progress',
      width: 110,
      render: (_: unknown, r) => (
        <span>
          {r.children && r.children.length > 0 ? <Tag color="purple">汇总</Tag> : null}
          {r.effective_progress ?? r.progress}%
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_: unknown, r) => (
        <Space size="small" wrap>
          <Button
            size="small"
            type="link"
            onClick={() => { setEditingParent(r); setEditing(null); setModalOpen(true) }}
          >
            子任务
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => { setEditing(r); setModalOpen(true) }}
          >
            编辑
          </Button>
          <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => void handleCopy(r)} />
          <Button size="small" type="link" icon={<UpOutlined />} onClick={() => void handleMove(r, -1)} />
          <Button size="small" type="link" icon={<DownOutlined />} onClick={() => void handleMove(r, 1)} />
          <Popconfirm
            title={`删除任务 ${r.wbs_code}？`}
            description="将连同其全部子任务一起删除（软删除）"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDelete(r)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card
        title="WBS 任务分解"
        extra={
          <Space wrap>
            <Input.Search
              placeholder="搜索名称/编码/负责人"
              allowClear
              style={{ width: 200 }}
              onSearch={setKeyword}
            />
            <Select
              placeholder="状态筛选"
              allowClear
              style={{ width: 120 }}
              options={['未开始', '进行中', '已完成', '已暂停', '已取消'].map((v) => ({ value: v, label: v }))}
              onChange={setStatusFilter}
            />
            <Button
              icon={<PlusOutlined />}
              type="primary"
              onClick={() => { setEditing(null); setEditingParent(null); setModalOpen(true) }}
            >
              新建顶级任务
            </Button>
            <Button icon={<LinkOutlined />} onClick={() => setDepModalOpen(true)}>
              依赖
            </Button>
            <Button icon={<ExportOutlined />} onClick={() => window.open(exportTasksUrl(projectId!))}>
              导出
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => window.open(importTemplateUrl(projectId!))}>
              下载模板
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => void openCloneModal()}>
              从其他项目复制
            </Button>
            <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => handleImport(file)}>
              <Button icon={<ImportOutlined />}>导入</Button>
            </Upload>
            <Button onClick={confirmRecalc}>按子任务重算父任务日期</Button>
            <Button
              type="primary"
              disabled={selectedKeys.length === 0}
              onClick={() => setBatchOpen(true)}
            >
              批量修改{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
            </Button>
          </Space>
        }
      >
        <Table<TaskNode>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={tree}
          pagination={false}
          defaultExpandAllRows
          scroll={{ x: 1250 }}
          size="small"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
          }}
        />
      </Card>

      <TaskFormModal
        open={modalOpen}
        task={editing}
        parent={editingParent}
        onCancel={() => { setModalOpen(false); setEditing(null); setEditingParent(null) }}
        onSubmit={handleSubmit}
      />

      <Modal
        title="从其他项目复制 WBS"
        open={cloneOpen}
        onCancel={() => setCloneOpen(false)}
        onOk={() => void handleCloneSubmit()}
        okText="开始复制"
        cancelText="取消"
        confirmLoading={cloneSaving}
        okButtonProps={{ disabled: !cloneSourceId }}
        width={560}
      >
        <Typography.Paragraph type="secondary">
          将把所选项目的整棵 WBS 树复制到当前项目，任务状态与进度重置为未开始 / 0%。
        </Typography.Paragraph>
        {tasks.length > 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
            当前项目已有 {tasks.length} 个任务，复制的任务会追加在现有任务之后，不会覆盖。
          </Typography.Paragraph>
        ) : null}
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Select
            placeholder="选择源项目"
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            value={cloneSourceId}
            onChange={setCloneSourceId}
            options={projects
              .filter((p) => p.id !== projectId)
              .map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))}
          />
          <Checkbox checked={cloneWithDates} onChange={(e) => setCloneWithDates(e.target.checked)}>
            同时复制计划日期
          </Checkbox>
        </Space>
      </Modal>

      <Modal
        title={`批量修改（已选 ${selectedKeys.length} 条任务）`}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={() => void handleBatchSubmit()}
        okText="提交"
        cancelText="取消"
        confirmLoading={batchSaving}
        width={560}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          勾选需要修改的字段，未勾选的字段保持不变（逐条提交，后端校验不通过的任务会被跳过）。
        </Typography.Paragraph>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Checkbox
              checked={batchUse.status}
              onChange={(e) => setBatchUse({ ...batchUse, status: e.target.checked })}
            >
              状态
            </Checkbox>
            <Select
              placeholder="选择状态"
              style={{ width: 180 }}
              disabled={!batchUse.status}
              allowClear
              value={batchValue.status}
              onChange={(v) => setBatchValue({ ...batchValue, status: v })}
              options={TASK_STATUS_OPTIONS.map((v) => ({ value: v, label: v }))}
            />
          </Space>

          <Space>
            <Checkbox
              checked={batchUse.owner}
              onChange={(e) => setBatchUse({ ...batchUse, owner: e.target.checked })}
            >
              负责人
            </Checkbox>
            <Input
              placeholder="负责人姓名（留空表示清空）"
              style={{ width: 220 }}
              disabled={!batchUse.owner}
              value={batchValue.owner ?? ''}
              onChange={(e) => setBatchValue({ ...batchValue, owner: e.target.value })}
            />
          </Space>

          <Space>
            <Checkbox
              checked={batchUse.plan_start}
              onChange={(e) => setBatchUse({ ...batchUse, plan_start: e.target.checked })}
            >
              计划开始
            </Checkbox>
            <DatePicker
              style={{ width: 180 }}
              disabled={!batchUse.plan_start}
              value={batchValue.plan_start ? dayjs(batchValue.plan_start) : null}
              onChange={(d) => setBatchValue({ ...batchValue, plan_start: d ? d.format('YYYY-MM-DD') : undefined })}
            />
          </Space>

          <Space>
            <Checkbox
              checked={batchUse.plan_end}
              onChange={(e) => setBatchUse({ ...batchUse, plan_end: e.target.checked })}
            >
              计划结束
            </Checkbox>
            <DatePicker
              style={{ width: 180 }}
              disabled={!batchUse.plan_end}
              value={batchValue.plan_end ? dayjs(batchValue.plan_end) : null}
              onChange={(d) => setBatchValue({ ...batchValue, plan_end: d ? d.format('YYYY-MM-DD') : undefined })}
            />
          </Space>

          <Space>
            <Checkbox
              checked={batchUse.progress}
              onChange={(e) => setBatchUse({ ...batchUse, progress: e.target.checked })}
            >
              进度
            </Checkbox>
            <InputNumber
              min={0}
              max={100}
              precision={0}
              style={{ width: 140 }}
              disabled={!batchUse.progress}
              addonAfter="%"
              value={batchValue.progress}
              onChange={(v) => setBatchValue({ ...batchValue, progress: typeof v === 'number' ? v : undefined })}
            />
          </Space>
        </Space>
      </Modal>

      <Modal
        title="任务依赖管理"
        open={depModalOpen}
        onCancel={() => setDepModalOpen(false)}
        footer={null}
        width={520}
      >
        <Space style={{ marginBottom: 12 }}>
          <Select
            placeholder="前置任务"
            style={{ width: 180 }}
            showSearch
            optionFilterProp="label"
            value={depPred}
            onChange={setDepPred}
            options={tasks.map((t) => ({ value: t.id, label: `${t.wbs_code} ${t.name}` }))}
          />
          <span>→</span>
          <Select
            placeholder="后置任务"
            style={{ width: 180 }}
            showSearch
            optionFilterProp="label"
            value={depSucc}
            onChange={setDepSucc}
            options={tasks.map((t) => ({ value: t.id, label: `${t.wbs_code} ${t.name}` }))}
          />
          <Button type="primary" onClick={() => void handleAddDep()} disabled={!depPred || !depSucc}>
            添加
          </Button>
        </Space>
        <Table<DependencyItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={deps}
          columns={[
            {
              title: '依赖',
              key: 'pair',
              render: (_: unknown, d) => {
                const pred = tasks.find((t) => t.id === d.predecessor_id)
                const succ = tasks.find((t) => t.id === d.successor_id)
                return `${pred ? `${pred.wbs_code} ${pred.name}` : '?'} → ${succ ? `${succ.wbs_code} ${succ.name}` : '?'}`
              },
            },
            { title: '类型', dataIndex: 'dep_type', width: 70 },
            {
              title: '操作',
              width: 80,
              render: (_: unknown, d) => (
                <Button size="small" type="link" danger onClick={() => void handleRemoveDep(d)}>
                  移除
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  )
}
