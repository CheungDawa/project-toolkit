import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
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
  Input,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { DependencyItem, TaskItem, TaskPayload } from '../api/stage2'
import {
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
import TaskFormModal from '../components/TaskFormModal'

interface TaskNode extends TaskItem {
  children?: TaskNode[]
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
      const result = await importTasks(projectId, file)
      if (result.errors.length > 0) {
        Modal.warning({
          title: `导入完成：成功 ${result.created} 条，失败 ${result.errors.length} 条`,
          content: (
            <ul style={{ maxHeight: 240, overflow: 'auto', paddingLeft: 18 }}>
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>第 {e.row} 行：{e.message}</li>
              ))}
            </ul>
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
      width: 180,
      render: (_: unknown, r) => (r.plan_start && r.plan_end ? `${r.plan_start} ~ ${r.plan_end}` : '-'),
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
            <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => handleImport(file)}>
              <Button icon={<ImportOutlined />}>导入</Button>
            </Upload>
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
          scroll={{ x: 1100 }}
          size="small"
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
