import { PlusOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { RiskItem } from '../api/stage3'
import {
  addAssessment,
  archiveRisk,
  convertRisk,
  createRisk,
  listAssessments,
  listRisks,
  updateRisk,
} from '../api/stage3'
import RiskMatrixChart from '../components/RiskMatrixChart'

const LEVEL_COLORS: Record<string, string> = { 低: 'green', 中: 'orange', 高: 'red' }

export default function RisksPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [risks, setRisks] = useState<RiskItem[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [levelFilter, setLevelFilter] = useState<string | undefined>()
  const [highOnly, setHighOnly] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RiskItem | null>(null)
  const [form] = Form.useForm()
  const [assessmentOpen, setAssessmentOpen] = useState<RiskItem | null>(null)
  const [history, setHistory] = useState<unknown[]>([])
  const [convertOpen, setConvertOpen] = useState<RiskItem | null>(null)
  const [convertForm] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setRisks(
        await listRisks(projectId, {
          status: statusFilter,
          level: levelFilter,
          high_only: highOnly || undefined,
        }),
      )
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载风险失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, statusFilter, levelFilter, highOnly, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (risk: RiskItem) => {
    setEditing(risk)
    form.setFieldsValue({
      category: risk.category,
      description: risk.description,
      probability: risk.probability,
      impact: risk.impact,
      owner: risk.owner,
      trigger_condition: risk.trigger_condition,
      prevention: risk.prevention,
      contingency: risk.contingency,
      strategy: risk.strategy,
      residual_level: risk.residual_level,
      status: risk.status,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    const payload = { ...values }
    try {
      if (editing) {
        await updateRisk(editing.id, payload)
        message.success('风险已更新')
      } else {
        await createRisk(projectId, payload)
        message.success('风险已创建')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleArchive = async (risk: RiskItem) => {
    try {
      await archiveRisk(risk.id)
      message.success('风险已归档')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '归档失败')
    }
  }

  const openAssessments = async (risk: RiskItem) => {
    setAssessmentOpen(risk)
    setHistory(await listAssessments(risk.id))
  }

  const handleAddAssessment = async () => {
    if (!assessmentOpen) return
    const values = await convertForm.validateFields()
    try {
      await addAssessment(assessmentOpen.id, values)
      message.success('评估已记录')
      convertForm.resetFields()
      setHistory(await listAssessments(assessmentOpen.id))
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '记录失败')
    }
  }

  const handleConvert = async () => {
    if (!convertOpen) return
    const values = await convertForm.validateFields()
    try {
      const result = await convertRisk(convertOpen.id, values)
      message.success(`已转为${values.target === 'issue' ? '问题' : '任务'}，原始风险保留（${result.risk_status}）`)
      setConvertOpen(null)
      convertForm.resetFields()
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '转化失败')
    }
  }

  return (
    <div>
      <Card
        title="风险台账"
        extra={
          <Space wrap>
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 120 }}
              options={['未决', '已发生', '已关闭', '已转问题', '已转任务'].map((v) => ({ value: v, label: v }))}
              onChange={setStatusFilter}
            />
            <Select
              placeholder="等级"
              allowClear
              style={{ width: 110 }}
              options={['低', '中', '高'].map((v) => ({ value: v, label: v }))}
              onChange={setLevelFilter}
            />
            <Button
              type={highOnly ? 'primary' : 'default'}
              danger={highOnly}
              onClick={() => setHighOnly((v) => !v)}
            >
              仅高风险
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建风险
            </Button>
          </Space>
        }
      >
        <Card size="small" style={{ marginBottom: 12 }}>
          <RiskMatrixChart risks={risks} />
        </Card>
        <Table<RiskItem>
          rowKey="id"
          loading={loading}
          dataSource={risks}
          pagination={false}
          size="small"
          scroll={{ x: 1000 }}
          columns={[
            { title: '类别', dataIndex: 'category', width: 90, render: (v: string | null) => v ?? '-' },
            { title: '描述', dataIndex: 'description', width: 280 },
            {
              title: '评分',
              key: 'score',
              width: 120,
              render: (_: unknown, r) => (
                <span>
                  {r.probability}×{r.impact} = <b>{r.score}</b>{' '}
                  <Tag color={LEVEL_COLORS[r.level ?? '中']}>{r.level}</Tag>
                </span>
              ),
            },
            { title: '责任人', dataIndex: 'owner', width: 90, render: (v: string | null) => v ?? '-' },
            { title: '状态', dataIndex: 'status', width: 100 },
            { title: '剩余风险', dataIndex: 'residual_level', width: 90, render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              key: 'actions',
              width: 240,
              render: (_: unknown, r) => (
                <Space size="small" wrap>
                  <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                  <Button size="small" onClick={() => void openAssessments(r)}>评估</Button>
                  <Button size="small" type="primary" ghost onClick={() => { setConvertOpen(r); convertForm.setFieldsValue({ target: 'issue' }) }}>
                    转化
                  </Button>
                  <Popconfirm title="确认归档该风险？" onConfirm={() => void handleArchive(r)}>
                    <Button size="small">归档</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑风险' : '新建风险'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void handleOk()} width={620}>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="category" label="类别">
              <Select allowClear placeholder="技术/商务/进度等" options={['技术', '进度', '资源', '商务', '合规', '其他'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="owner" label="责任人">
              <Input placeholder="责任人" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="风险描述" rules={[{ required: true, message: '请输入风险描述' }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="probability" label="概率(1-5)" rules={[{ required: true }]}>
              <Select options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
            </Form.Item>
            <Form.Item name="impact" label="影响(1-5)" rules={[{ required: true }]}>
              <Select options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
            </Form.Item>
            <Form.Item name="strategy" label="应对策略">
              <Select allowClear options={['规避', '转移', '减轻', '接受'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="residual_level" label="剩余风险">
              <Select allowClear options={['低', '中', '高'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="trigger_condition" label="触发条件">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="prevention" label="预防措施">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="contingency" label="应急措施">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Drawer title={assessmentOpen ? `风险评估历史 · ${assessmentOpen.description.slice(0, 30)}` : '评估历史'} open={!!assessmentOpen} onClose={() => setAssessmentOpen(null)} width={520}>
        <Table
          rowKey="id"
          size="small"
          dataSource={history as Record<string, unknown>[]}
          pagination={false}
          columns={[
            { title: '评分', key: 'score', render: (_: unknown, r) => `${r.probability}×${r.impact} = ${r.score}` },
            { title: '等级', dataIndex: 'level', width: 70, render: (v: string) => (v ? <Tag color={LEVEL_COLORS[v]}>{v}</Tag> : '-') },
            { title: '时间', dataIndex: 'assessed_at', width: 170, render: (v: string) => v.slice(0, 16).replace('T', ' ') },
            { title: '依据', dataIndex: 'basis', render: (v: string | null) => v ?? '-' },
          ]}
        />
<div style={{ marginTop: 16 }}>
          <Form form={convertForm} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item name="probability" label="概率(1-5)" rules={[{ required: true }]}>
                <Select options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
              </Form.Item>
              <Form.Item name="impact" label="影响(1-5)" rules={[{ required: true }]}>
                <Select options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
              </Form.Item>
            </div>
            <Form.Item name="basis" label="评估依据">
              <Input placeholder="说明本次评估依据" />
            </Form.Item>
            <Button type="primary" onClick={() => void handleAddAssessment()}>记录本次评估</Button>
          </Form>
        </div>
      </Drawer>

      <Modal title="风险转化（原始风险保留）" open={!!convertOpen} onCancel={() => setConvertOpen(null)} onOk={() => void handleConvert()} destroyOnClose>
        <Form form={convertForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="target" label="转化为" rules={[{ required: true }]}>
            <Select options={[{ value: 'issue', label: '问题' }, { value: 'task', label: '行动任务' }]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.target !== cur.target}>
            {({ getFieldValue }) =>
              getFieldValue('target') === 'task' ? (
                <>
                  <Form.Item name="task_name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
                    <Input placeholder="行动任务名称" />
                  </Form.Item>
                  <Form.Item name="task_owner" label="任务负责人">
                    <Input placeholder="负责人" />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}