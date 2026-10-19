import { PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { Baseline, BaselineDiffRow } from '../api/stage2'
import { baselineDiff, createBaseline, listBaselines } from '../api/stage2'
import type { ChangeItem } from '../api/stage3'
import { createChange, deleteChange, listChanges, updateChange } from '../api/stage3'

const APPROVAL_OPTIONS = ['草拟', '审批中', '已批准', '已驳回', '实施中', '已完成']
const APPROVAL_TAG: Record<string, string> = {
  草拟: 'default',
  审批中: 'blue',
  已批准: 'green',
  已驳回: 'red',
  实施中: 'orange',
  已完成: 'purple',
}
/** 审批通过（含后续流转状态）后才可以拍基线留痕 */
const SNAPSHOT_ALLOWED = ['已批准', '实施中', '已完成']
const BASELINE_NOTE = '由变更单自动创建'

/**
 * 匹配由该变更单创建过的基线。
 * 后端无 change↔baseline 关联字段（不为此改后端），故按 note 中的变更单 ID/标题、
 * 退化为按基线名称（变更基线-<标题>）匹配；匹配不到返回空数组（页面显示 -）。
 */
function matchBaselines(change: ChangeItem, baselines: Baseline[]): Baseline[] {
  const title = change.title.trim()
  return baselines.filter(b => {
    if (b.note && b.note.includes(change.id)) return true
    if (title && b.note && b.note.includes(title)) return true
    return title.length > 0 && b.name.includes(title)
  })
}

/** 基线值与当前值不一致的字段列表 */
function changedKeys(row: BaselineDiffRow): string[] {
  return Object.keys(row.baseline ?? {}).filter(
    key => JSON.stringify(row.baseline[key]) !== JSON.stringify(row.current?.[key]),
  )
}

export default function ChangesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<ChangeItem[]>([])
  const [baselines, setBaselines] = useState<Baseline[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ChangeItem | null>(null)
  const [form] = Form.useForm()
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState<Baseline | null>(null)
  const [diffRows, setDiffRows] = useState<BaselineDiffRow[]>([])
  const [diffLoading, setDiffLoading] = useState(false)

  const loadBaselines = useCallback(async () => {
    if (!projectId) return
    try {
      setBaselines(await listBaselines(projectId))
    } catch {
      // 基线加载失败不影响变更列表本身
      setBaselines([])
    }
  }, [projectId])

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listChanges(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载变更失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
    void loadBaselines()
  }, [fetchData, loadBaselines])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (item: ChangeItem) => {
    setEditing(item)
    form.setFieldsValue({
      title: item.title,
      origin: item.origin,
      scope_impact: item.scope_impact,
      schedule_impact: item.schedule_impact,
      approval_status: item.approval_status,
      implementation_plan: item.implementation_plan,
      verification_result: item.verification_result,
      requested_by: item.requested_by,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    try {
      if (editing) {
        await updateChange(editing.id, values)
        message.success('变更已更新')
      } else {
        await createChange(projectId, values)
        message.success('变更已创建')
      }
      setModalOpen(false)
      await fetchData()
      if (values.approval_status === '已批准') {
        message.info('变更已批准：可在列表点击「拍基线」冻结当前计划，留痕并支持后续比对')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (item: ChangeItem) => {
    try {
      await deleteChange(item.id)
      message.success('变更已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  /** 审批通过后拍基线：冻结当前计划快照，供后续比对 */
  const handleSnapshot = async (item: ChangeItem) => {
    if (!projectId) return
    setSnapshotId(item.id)
    try {
      const baseline = await createBaseline(projectId, {
        name: `变更基线-${item.title}`,
        note: `${BASELINE_NOTE} · 变更ID:${item.id}`,
      })
      message.success(
        `已拍基线：${baseline.name}（v${baseline.version}，${baseline.frozen_at.slice(0, 10)}）`,
      )
      await loadBaselines()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '拍基线失败')
    } finally {
      setSnapshotId(null)
    }
  }

  /** 打开基线比对：查看变更后当前计划与该基线的差异 */
  const openDiff = async (baseline: Baseline) => {
    if (!projectId) return
    setDiffOpen(baseline)
    setDiffRows([])
    setDiffLoading(true)
    try {
      setDiffRows(await baselineDiff(projectId, baseline.id))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载基线差异失败')
    } finally {
      setDiffLoading(false)
    }
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="变更流程：提出变更 → 评估影响 → 审批通过 → 拍基线留痕"
        description="审批通过后点击「拍基线」冻结当前计划快照，之后可随时「比对」查看变更后与基线快照的差异，做到变更有据可查。"
      />
      <Card
        title="变更跟踪"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建变更
          </Button>
        }
      >
        <Table<ChangeItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          size="small"
          scroll={{ x: 1200 }}
          columns={[
            { title: '变更内容', dataIndex: 'title', width: 200 },
            { title: '原因', dataIndex: 'origin', render: (v: string | null) => v ?? '-' },
            {
              title: '范围影响',
              dataIndex: 'scope_impact',
              width: 160,
              render: (v: string | null) => v ?? '-',
            },
            {
              title: '工期影响',
              dataIndex: 'schedule_impact',
              width: 140,
              render: (v: string | null) => v ?? '-',
            },
            {
              title: '审批状态',
              dataIndex: 'approval_status',
              width: 110,
              render: (v: string) => <Tag color={APPROVAL_TAG[v] ?? 'default'}>{v}</Tag>,
            },
            {
              title: '关联基线',
              key: 'baseline',
              width: 200,
              render: (_: unknown, r) => {
                const linked = matchBaselines(r, baselines)
                if (linked.length === 0) return <span style={{ color: '#bfbfbf' }}>-</span>
                return (
                  <Space size={4} wrap>
                    {linked.map(b => (
                      <Tag
                        key={b.id}
                        color="blue"
                        style={{ cursor: 'pointer' }}
                        onClick={() => void openDiff(b)}
                      >
                        {b.name} v{b.version}
                      </Tag>
                    ))}
                  </Space>
                )
              },
            },
            {
              title: '实施计划',
              dataIndex: 'implementation_plan',
              render: (v: string | null) => v ?? '-',
            },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              render: (_: unknown, r) => {
                const linked = matchBaselines(r, baselines)
                const allowed = SNAPSHOT_ALLOWED.includes(r.approval_status)
                return (
                  <Space size="small" wrap>
                    <Button size="small" onClick={() => openEdit(r)}>
                      编辑
                    </Button>
                    <Tooltip
                      title={
                        allowed
                          ? '冻结当前计划快照，作为该变更的留痕基线'
                          : '审批通过后才能拍基线留痕'
                      }
                    >
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        disabled={!allowed}
                        loading={snapshotId === r.id}
                        onClick={() => void handleSnapshot(r)}
                      >
                        {linked.length > 0 ? '再拍基线' : '拍基线'}
                      </Button>
                    </Tooltip>
                    <Popconfirm title="确认删除该变更？" onConfirm={() => void handleDelete(r)}>
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                )
              },
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑变更' : '新建变更'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleOk()}
        width={620}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Form.Item
              name="title"
              label="变更内容"
              rules={[{ required: true, message: '请输入变更内容' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="approval_status" label="审批状态" initialValue="草拟">
              <Select options={APPROVAL_OPTIONS.map(v => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="origin" label="变更原因">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="scope_impact" label="范围影响">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="schedule_impact" label="工期影响">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="implementation_plan" label="实施计划">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="verification_result" label="验证结果">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <Form.Item name="requested_by" label="申请人">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={diffOpen ? `基线比对 · ${diffOpen.name}（v${diffOpen.version}）` : '基线比对'}
        open={!!diffOpen}
        onCancel={() => setDiffOpen(null)}
        footer={null}
        width={760}
        destroyOnClose
      >
        <div style={{ marginBottom: 8, fontSize: 12, color: '#8c8c8c' }}>
          冻结时间：{diffOpen ? diffOpen.frozen_at.slice(0, 16).replace('T', ' ') : '-'}
          {diffOpen?.note ? ` · ${diffOpen.note}` : ''}
        </div>
        <Table<BaselineDiffRow>
          rowKey="task_id"
          size="small"
          loading={diffLoading}
          dataSource={diffRows}
          pagination={false}
          scroll={{ x: 640 }}
          columns={[
            { title: 'WBS', dataIndex: 'wbs_code', width: 90 },
            { title: '任务名称', dataIndex: 'name', width: 200 },
            {
              title: '差异',
              key: 'changed',
              width: 90,
              render: (_: unknown, r) =>
                r.changed ? <Tag color="orange">有变化</Tag> : <Tag>无变化</Tag>,
            },
            {
              title: '基线值 → 当前值',
              key: 'detail',
              render: (_: unknown, r) => {
                const keys = changedKeys(r)
                if (keys.length === 0) return '-'
                return (
                  <div>
                    {keys.map(key => (
                      <div key={key}>
                        {key}：{String(r.baseline?.[key] ?? '-')} →{' '}
                        {String(r.current?.[key] ?? '-')}
                      </div>
                    ))}
                  </div>
                )
              },
            },
          ]}
        />
      </Modal>
    </div>
  )
}
