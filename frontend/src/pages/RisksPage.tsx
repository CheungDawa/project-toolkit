import { PlusOutlined } from '@ant-design/icons'
import {
  Alert,
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
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import type { TableProps } from 'antd'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
const LEVEL_COLORS: Record<string, string> = { 低: 'green', 中: 'orange', 高: 'red' }

/** 已终结状态口径与后端驾驶舱一致（backend/app/api/overview.py:25 _RISK_CLOSED） */
const CLOSED_STATUSES = ['已关闭', '已转问题', '已转任务']

/** 矩阵底色：与风险矩阵网格保持一致（低绿 / 中黄 / 高红） */
const MATRIX_BG: Record<string, string> = { 低: '#d9f7be', 中: '#fff1b8', 高: '#ffccc7' }

const IMPACT_AXIS = [1, 2, 3, 4, 5]
const PROBABILITY_AXIS = [5, 4, 3, 2, 1]

/**
 * 概率 × 影响 → 等级，与后端评分口径一致。
 * score <= 4 低，<= 9 中，其余 高。
 */
function levelOf(probability: number, impact: number): string {
  const score = probability * impact
  if (score <= 4) return '低'
  if (score <= 9) return '中'
  return '高'
}

/** 评估历史表列定义不读取任何组件状态，提到模块级：渲染间引用恒定 */
const HISTORY_COLUMNS: TableProps<Record<string, unknown>>['columns'] = [
  {
    title: '评分',
    key: 'score',
    render: (_: unknown, r) => `${r.probability}×${r.impact} = ${r.score}`,
  },
  {
    title: '等级',
    dataIndex: 'level',
    width: 70,
    render: (v: string) => (v ? <Tag color={LEVEL_COLORS[v]}>{v}</Tag> : '-'),
  },
  {
    title: '时间',
    dataIndex: 'assessed_at',
    width: 170,
    render: (v: string) => v.slice(0, 16).replace('T', ' '),
  },
  { title: '依据', dataIndex: 'basis', render: (v: string | null) => v ?? '-' },
]

interface RiskMatrixOverviewProps {
  risks: RiskItem[]
}

/**
 * 紧凑版风险矩阵概览：影响（列，左低右高）× 概率（行，上高下低）。
 * 格子按等级着色并直接显示风险名称，未关闭风险才纳入统计。
 */
function RiskMatrixOverview({ risks }: RiskMatrixOverviewProps) {
  const active = risks.filter(r => !CLOSED_STATUSES.includes(r.status))
  return (
    <div>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>
        行 = 概率（上高下低）· 列 = 影响（左低右高）· 格内为风险名称（仅统计活跃风险，每格最多显示 3
        条）
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(5, 1fr)', gap: 3 }}>
        <div />
        {IMPACT_AXIS.map(impact => (
          <div
            key={`head-${impact}`}
            style={{ textAlign: 'center', fontSize: 12, color: '#8c8c8c' }}
          >
            影响 {impact}
          </div>
        ))}
        {PROBABILITY_AXIS.map(probability => (
          <Fragment key={`row-${probability}`}>
            <div style={{ fontSize: 12, color: '#8c8c8c', display: 'flex', alignItems: 'center' }}>
              概率 {probability}
            </div>
            {IMPACT_AXIS.map(impact => {
              const hit = active.filter(r => r.probability === probability && r.impact === impact)
              return (
                <div
                  key={`cell-${probability}-${impact}`}
                  style={{
                    minHeight: 46,
                    padding: 3,
                    borderRadius: 3,
                    background: MATRIX_BG[levelOf(probability, impact)],
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  {hit.length === 0 ? (
                    <span style={{ color: '#bfbfbf' }}>·</span>
                  ) : (
                    <>
                      {hit.slice(0, 3).map(r => (
                        <Tooltip key={r.id} title={r.description}>
                          <div
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            · {r.description.slice(0, 14)}
                          </div>
                        </Tooltip>
                      ))}
                      {hit.length > 3 ? (
                        <div style={{ color: '#8c8c8c' }}>等 {hit.length} 条</div>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export default function RisksPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [risks, setRisks] = useState<RiskItem[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [levelFilter, setLevelFilter] = useState<string | undefined>()
  const [highOnly, setHighOnly] = useState(false)
  // keyword = 输入框当前值（受控），search = 已提交的搜索词（后端 q 参数，匹配描述/责任人/类别）
  const [keyword, setKeyword] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RiskItem | null>(null)
  const [form] = Form.useForm()
  const [assessmentOpen, setAssessmentOpen] = useState<RiskItem | null>(null)
  const [history, setHistory] = useState<unknown[]>([])
  const [assessForm] = Form.useForm()
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
          q: search || undefined,
        }),
      )
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载风险失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, statusFilter, levelFilter, highOnly, search, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // 顶部汇总：活跃（未终结）风险条数 + 其中高等级条数（口径同后端驾驶舱）
  const activeRisks = risks.filter(r => !CLOSED_STATUSES.includes(r.status))
  const highCount = activeRisks.filter(r => r.level === '高').length
  const occurredCount = activeRisks.filter(r => r.status === '已发生').length

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = useCallback(
    (risk: RiskItem) => {
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
    },
    [form],
  )

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

  const handleArchive = useCallback(
    async (risk: RiskItem) => {
      try {
        await archiveRisk(risk.id)
        message.success('风险已归档')
        await fetchData()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '归档失败')
      }
    },
    [fetchData, message],
  )

  const openAssessments = useCallback(
    async (risk: RiskItem) => {
      setAssessmentOpen(risk)
      assessForm.setFieldsValue({ probability: risk.probability, impact: risk.impact, basis: '' })
      setHistory(await listAssessments(risk.id))
    },
    [assessForm],
  )

  const handleAddAssessment = async () => {
    if (!assessmentOpen) return
    const values = await assessForm.validateFields()
    try {
      await addAssessment(assessmentOpen.id, values)
      message.success('评估已记录')
      assessForm.resetFields()
      setHistory(await listAssessments(assessmentOpen.id))
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '记录失败')
    }
  }

  /** 打开转化弹窗：默认任务名取风险描述、负责人取风险责任人 */
  const openConvert = useCallback(
    (risk: RiskItem, target: 'issue' | 'task') => {
      setConvertOpen(risk)
      convertForm.setFieldsValue({
        target,
        task_name: risk.description.slice(0, 50),
        task_owner: risk.owner ?? '',
      })
    },
    [convertForm],
  )

  const handleConvert = async () => {
    if (!convertOpen) return
    const values = (await convertForm.validateFields()) as {
      target: string
      task_name?: string
      task_owner?: string
    }
    const payload: { target: string; task_name?: string; task_owner?: string } = {
      target: values.target,
    }
    if (values.target === 'task') {
      payload.task_name = values.task_name?.trim() || convertOpen.description.slice(0, 50)
      if (values.task_owner) payload.task_owner = values.task_owner
    }
    try {
      // 后端已同步把风险状态置为「已转问题」/「已转任务」（backend/app/api/risks.py:157/175），此处不再二次改状态
      const result = await convertRisk(convertOpen.id, payload)
      message.success(
        `已转为${payload.target === 'issue' ? '问题' : '行动任务'}，原始风险保留（当前状态：${result.risk_status}）`,
      )
      setConvertOpen(null)
      convertForm.resetFields()
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '转化失败')
    }
  }

  /** 风险表列定义：依赖的 4 个打开/归档回调均已稳定（useCallback），memo 后引用恒定 */
  const columns: TableProps<RiskItem>['columns'] = useMemo(
    () => [
      {
        title: '类别',
        dataIndex: 'category',
        width: 90,
        render: (v: string | null) => v ?? '-',
      },
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
      {
        title: '责任人',
        dataIndex: 'owner',
        width: 90,
        render: (v: string | null) => v ?? '-',
      },
      { title: '状态', dataIndex: 'status', width: 100 },
      {
        title: '剩余风险',
        dataIndex: 'residual_level',
        width: 90,
        render: (v: string | null) => v ?? '-',
      },
      {
        title: '操作',
        key: 'actions',
        width: 300,
        render: (_: unknown, r) => {
          const converted = CLOSED_STATUSES.includes(r.status)
          return (
            <Space size="small" wrap>
              <Button size="small" onClick={() => openEdit(r)}>
                编辑
              </Button>
              <Button size="small" onClick={() => void openAssessments(r)}>
                评估
              </Button>
              <Tooltip
                title={
                  converted
                    ? '该风险已终结，不可重复转化'
                    : '生成一条问题，原风险保留并标记「已转问题」'
                }
              >
                <Button
                  size="small"
                  type="primary"
                  ghost
                  disabled={converted}
                  onClick={() => openConvert(r, 'issue')}
                >
                  转问题
                </Button>
              </Tooltip>
              <Tooltip
                title={
                  converted
                    ? '该风险已终结，不可重复转化'
                    : '在任务计划生成行动任务，原风险保留并标记「已转任务」'
                }
              >
                <Button
                  size="small"
                  type="primary"
                  ghost
                  disabled={converted}
                  onClick={() => openConvert(r, 'task')}
                >
                  转任务
                </Button>
              </Tooltip>
              <Popconfirm title="确认归档该风险？" onConfirm={() => void handleArchive(r)}>
                <Button size="small">归档</Button>
              </Popconfirm>
            </Space>
          )
        },
      },
    ],
    [handleArchive, openAssessments, openConvert, openEdit],
  )

  return (
    <div>
      <Card
        title="风险台账"
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索描述 / 责任人 / 类别"
              style={{ width: 200 }}
              value={keyword}
              onChange={e => {
                const next = e.target.value
                setKeyword(next)
                // 清空（含点击清除图标）时立即恢复全量，无需再点一次搜索
                if (next === '') setSearch('')
              }}
              onSearch={value => setSearch(value.trim())}
            />
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 120 }}
              options={['未决', '已发生', '已关闭', '已转问题', '已转任务'].map(v => ({
                value: v,
                label: v,
              }))}
              onChange={setStatusFilter}
            />
            <Select
              placeholder="等级"
              allowClear
              style={{ width: 110 }}
              options={['低', '中', '高'].map(v => ({ value: v, label: v }))}
              onChange={setLevelFilter}
            />
            <Button
              type={highOnly ? 'primary' : 'default'}
              danger={highOnly}
              onClick={() => setHighOnly(v => !v)}
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
          <Space size="large" wrap>
            <Statistic title="活跃风险（当前筛选结果）" value={activeRisks.length} suffix="条" />
            <Statistic
              title="其中高等级"
              value={highCount}
              suffix="条"
              valueStyle={{ color: highCount > 0 ? '#cf1322' : undefined }}
            />
            <Statistic
              title="已发生待处置"
              value={occurredCount}
              suffix="条"
              valueStyle={{ color: occurredCount > 0 ? '#d46b08' : undefined }}
            />
          </Space>
        </Card>
        <Card size="small" style={{ marginBottom: 12 }} title="风险矩阵（影响 × 概率）">
          <RiskMatrixOverview risks={risks} />
        </Card>
        <Table<RiskItem>
          rowKey="id"
          loading={loading}
          dataSource={risks}
          pagination={false}
          size="small"
          scroll={{ x: 1100 }}
          columns={columns}
        />
      </Card>

      <Modal
        title={editing ? '编辑风险' : '新建风险'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleOk()}
        width={620}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="category" label="类别">
              <Select
                allowClear
                placeholder="技术/商务/进度等"
                options={['技术', '进度', '资源', '商务', '合规', '其他'].map(v => ({
                  value: v,
                  label: v,
                }))}
              />
            </Form.Item>
            <Form.Item name="owner" label="责任人">
              <Input placeholder="责任人" />
            </Form.Item>
          </div>
          <Form.Item
            name="description"
            label="风险描述"
            rules={[{ required: true, message: '请输入风险描述' }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="probability" label="概率(1-5)" rules={[{ required: true }]}>
              <Select options={[1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) }))} />
            </Form.Item>
            <Form.Item name="impact" label="影响(1-5)" rules={[{ required: true }]}>
              <Select options={[1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) }))} />
            </Form.Item>
            <Form.Item name="strategy" label="应对策略">
              <Select
                allowClear
                options={['规避', '转移', '减轻', '接受'].map(v => ({ value: v, label: v }))}
              />
            </Form.Item>
            <Form.Item name="residual_level" label="剩余风险">
              <Select allowClear options={['低', '中', '高'].map(v => ({ value: v, label: v }))} />
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

      <Drawer
        title={
          assessmentOpen ? `风险评估历史 · ${assessmentOpen.description.slice(0, 30)}` : '评估历史'
        }
        open={!!assessmentOpen}
        onClose={() => setAssessmentOpen(null)}
        width={520}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={history as Record<string, unknown>[]}
          pagination={false}
          columns={HISTORY_COLUMNS}
        />
        <div style={{ marginTop: 16 }}>
          <Form form={assessForm} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item name="probability" label="概率(1-5)" rules={[{ required: true }]}>
                <Select options={[1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) }))} />
              </Form.Item>
              <Form.Item name="impact" label="影响(1-5)" rules={[{ required: true }]}>
                <Select options={[1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) }))} />
              </Form.Item>
            </div>
            <Form.Item name="basis" label="评估依据">
              <Input placeholder="说明本次评估依据" />
            </Form.Item>
            <Button type="primary" onClick={() => void handleAddAssessment()}>
              记录本次评估
            </Button>
          </Form>
        </div>
      </Drawer>

      <Modal
        title={convertOpen ? `风险转化 · ${convertOpen.description.slice(0, 20)}` : '风险转化'}
        open={!!convertOpen}
        onCancel={() => setConvertOpen(null)}
        onOk={() => void handleConvert()}
        okText="确认转化"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={convertForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="target" label="转化为" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'issue', label: '问题' },
                { value: 'task', label: '行动任务' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.target !== cur.target}>
            {({ getFieldValue }) =>
              getFieldValue('target') === 'task' ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="将在任务计划中生成一条行动任务（WBS 自动重算），原风险保留并标记为「已转任务」。"
                  />
                  <Form.Item
                    name="task_name"
                    label="任务名称"
                    rules={[{ required: true, message: '请输入任务名称' }]}
                  >
                    <Input placeholder="行动任务名称" />
                  </Form.Item>
                  <Form.Item name="task_owner" label="任务负责人">
                    <Input placeholder="负责人" />
                  </Form.Item>
                </>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="将在问题台账中生成一条问题（严重度沿用风险等级），原风险保留并标记为「已转问题」。"
                />
              )
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
