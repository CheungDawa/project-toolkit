import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  InboxOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { App, Button, Card, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { archiveProject, createProject, deleteProject, listProjects, updateProject } from '../api/projects'
import type { Project, ProjectPayload } from '../api/projects'
import ProjectFormModal, { STATUS_OPTIONS } from '../components/ProjectFormModal'

const PAGE_SIZE = 10

export default function ProjectListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [items, setItems] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [archived, setArchived] = useState<'exclude' | 'only'>('exclude')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<string>('-created_at')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listProjects({
        q: keyword || undefined,
        status,
        archived,
        sort,
        page,
        size: PAGE_SIZE,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, status, archived, sort, page, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleSubmit = async (values: ProjectPayload) => {
    try {
      if (editing) {
        await updateProject(editing.id, values)
        message.success('项目已更新')
      } else {
        await createProject(values)
        message.success('项目已创建')
      }
      setModalOpen(false)
      setEditing(null)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleArchive = async (project: Project) => {
    try {
      await archiveProject(project.id)
      message.success(`项目 ${project.code} 已归档`)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '归档失败')
    }
  }

  const handleDelete = async (project: Project) => {
    try {
      await deleteProject(project.id)
      message.success(`项目 ${project.code} 已删除`)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: TableProps<Project>['columns'] = useMemo(
    () => [
      { title: '编号', dataIndex: 'code', width: 140, sorter: true },
      { title: '项目名称', dataIndex: 'name', width: 200 },
      { title: '客户', dataIndex: 'customer', width: 160, render: (v: string | null) => v ?? '-' },
      { title: '项目经理', dataIndex: 'manager', width: 110, render: (v: string | null) => v ?? '-' },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (v: string | null, record) => {
          if (record.archived_at) return <Tag color="gold">已归档</Tag>
          if (!v) return '-'
          return <Tag color={v === '已完成' ? 'green' : v === '进行中' ? 'blue' : 'default'}>{v}</Tag>
        },
      },
      {
        title: '计划起止',
        key: 'plan',
        width: 190,
        sorter: true,
        render: (_: unknown, r) =>
          r.plan_start && r.plan_end ? `${r.plan_start} ~ ${r.plan_end}` : '-',
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        width: 170,
        render: (v: string) => v.slice(0, 10),
      },
      {
        title: '操作',
        key: 'actions',
        width: 230,
        render: (_: unknown, record) => (
          <Space size="small">
            <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/projects/${record.id}`)}>
              查看
            </Button>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(record)
                setModalOpen(true)
              }}
            >
              编辑
            </Button>
            <Popconfirm
              title="确认归档该项目？"
              description="归档后从默认列表隐藏，可在“仅归档”视图查看"
              onConfirm={() => void handleArchive(record)}
            >
              <Button size="small" icon={<InboxOutlined />}>
                归档
              </Button>
            </Popconfirm>
            <Popconfirm
              title="确认删除该项目？"
              description="删除为软删除，编号不释放；操作记录将写入审计日志"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [navigate, message],
  )

  const handleTableChange: TableProps<Project>['onChange'] = (pagination, _filters, sorter) => {
    setPage(pagination.current ?? 1)
    const sortField = Array.isArray(sorter) ? sorter[0] : sorter
    if (sortField?.field) {
      setSort(`${sortField.order === 'descend' ? '-' : ''}${String(sortField.field)}`)
    }
  }

  return (
    <div>
      <Card title="项目列表">
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索编号 / 名称 / 客户"
            allowClear
            style={{ width: 280 }}
            onSearch={(v) => {
              setKeyword(v)
              setPage(1)
            }}
          />
          <Select
            placeholder="按状态筛选"
            allowClear
            style={{ width: 140 }}
            options={STATUS_OPTIONS.map((v) => ({ value: v, label: v }))}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          />
          <Select
            value={archived}
            style={{ width: 120 }}
            options={[
              { value: 'exclude', label: '隐藏归档' },
              { value: 'only', label: '仅归档' },
            ]}
            onChange={(v) => {
              setArchived(v)
              setPage(1)
            }}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setModalOpen(true) }}>
          新建项目
        </Button>
      </Card>

      <Table<Project>
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 个项目`,
        }}
        onChange={handleTableChange}
        locale={{ emptyText: <Typography.Text type="secondary">暂无项目，点击「新建项目」创建</Typography.Text> }}
        scroll={{ x: 1100 }}
      />

      <ProjectFormModal
        open={modalOpen}
        project={editing}
        onCancel={() => { setModalOpen(false); setEditing(null) }}
        onSubmit={handleSubmit}
      />
    </div>
  )
}