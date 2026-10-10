import { MessageOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  App,
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { StakeholderItem } from '../api/stage3'
import {
  createCommunication,
  createStakeholder,
  deleteStakeholder,
  listCommunications,
  listStakeholders,
  updateStakeholder,
} from '../api/stage3'

const PLAN_CODES: Record<string, string> = { A: '日报', B: '周报', E: '月度远程', F: '线下' }
const CHANNEL_CODES: Record<string, string> = { G: '微信', H: '会议', I: '报告', J: '邮件', K: '电话' }
const ATT_KEYS = ['unknown', 'resist', 'neutral', 'support', 'lead'] as const
const ATT_NAMES: Record<string, string> = { unknown: '不知晓', resist: '抵制', neutral: '中立', support: '支持', lead: '领导' }
const PRIORITY_COLORS: Record<string, string> = { P0: '#c0392b', P1: '#e8a33d', P2: '#1e8449' }

/** 自动评分建议优先级（与原版一致） */
function calcPriority(influence: number, interest: number): string {
  if (influence >= 4 && interest >= 4) return 'P0'
  if (influence >= 4 || interest >= 4) return 'P1'
  return 'P2'
}

function decodeCodes(code: string | null, table: Record<string, string>): string[] {
  return [...(code || '').toUpperCase()].filter((c) => table[c]).map((c) => table[c])
}

function parseParticipation(text: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text) return result
  for (const line of text.split(/[;；]/)) {
    const m = line.match(/^(.+?)（(当前|期望)）$/)
    if (m) {
      const key = ATT_KEYS.find((k) => ATT_NAMES[k] === m[1].trim())
      if (key) result[key] = m[2] === '当前' ? 'C' : 'D'
    }
  }
  return result
}

function buildParticipation(attrs: Record<string, string>): string {
  return ATT_KEYS
    .filter((k) => attrs[k])
    .map((k) => `${ATT_NAMES[k]}（${attrs[k] === 'C' ? '当前' : '期望'}）`)
    .join('；') || null
}

/** 象限定义（与原版一致） */
const QUADRANTS = [
  { id: 'q-hi-hi', title: '高影响 · 高关注', desc: '重点管理，保持紧密沟通', cls: 'hi-hi' },
  { id: 'q-hi-lo', title: '高影响 · 低关注', desc: '令其满意，防患于未然', cls: 'hi-lo' },
  { id: 'q-lo-hi', title: '低影响 · 高关注', desc: '随时告知，保持知情', cls: 'lo-hi' },
  { id: 'q-lo-lo', title: '低影响 · 低关注', desc: '监督即可，定期关注', cls: 'lo-lo' },
]

const QUAD_STYLE: Record<string, { bg: string; border: string }> = {
  'hi-hi': { bg: '#fdeceb', border: '#f0c4bf' },
  'hi-lo': { bg: '#fdf3e3', border: '#ead9b0' },
  'lo-hi': { bg: '#e8f3e8', border: '#bcd8bc' },
  'lo-lo': { bg: '#eef1f4', border: '#d6dde4' },
}

export default function StakeholdersPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<StakeholderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StakeholderItem | null>(null)
  const [form] = Form.useForm()
  const [commOpen, setCommOpen] = useState<StakeholderItem | null>(null)
  const [comms, setComms] = useState<unknown[]>([])
  const [commForm] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [filterAttrs, setFilterAttrs] = useState<Set<string>>(new Set())
  const [filterPrios, setFilterPrios] = useState<Set<string>>(new Set())
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [autoHint, setAutoHint] = useState('')

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listStakeholders(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载干系人失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // ==================== 筛选逻辑 ====================
  const filtered = useMemo(() => {
    let result = items
    const kw = searchText.trim().toLowerCase()
    if (kw) {
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          (r.role || '').toLowerCase().includes(kw) ||
          (r.org || '').toLowerCase().includes(kw) ||
          (r.sub_pos || '').toLowerCase().includes(kw) ||
          (r.demands || '').toLowerCase().includes(kw) ||
          (r.participation || '').toLowerCase().includes(kw),
      )
    }
    if (filterAttrs.size > 0) {
      result = result.filter((r) => {
        const p = parseParticipation(r.participation)
        return [...filterAttrs].some((k) => p[k])
      })
    }
    if (filterPrios.size > 0) {
      result = result.filter((r) => r.priority && filterPrios.has(r.priority))
    }
    return result
  }, [items, searchText, filterAttrs, filterPrios])

  // ==================== 仪表盘统计 ====================
  const stats = useMemo(() => {
    const p0 = filtered.filter((r) => r.priority === 'P0').length
    const p1 = filtered.filter((r) => r.priority === 'P1').length
    const p2 = filtered.filter((r) => r.priority === 'P2').length
    const hiInfluence = filtered.filter((r) => r.influence >= 4).length
    const total = filtered.length
    return { p0, p1, p2, hiInfluence, total }
  }, [filtered])

  // ==================== 分组（单位→角色分类） ====================
  type GroupedData = {
    org: string
    subGroups: { subPos: string; children: StakeholderItem[] }[]
    children: StakeholderItem[]
  }

  const groupedData = useMemo((): GroupedData[] => {
    const map = new Map<string, Map<string, StakeholderItem[]>>()
    for (const row of filtered) {
      const org = row.org || '未分类'
      const subPos = row.sub_pos || '未分类'
      if (!map.has(org)) map.set(org, new Map())
      const subMap = map.get(org)!
      if (!subMap.has(subPos)) subMap.set(subPos, [])
      subMap.get(subPos)!.push(row)
    }
    return [...map.entries()].map(([org, subMap]) => ({
      org,
      subGroups: [...subMap.entries()].map(([subPos, children]) => ({ subPos, children })),
      children: [...subMap.values()].flat(),
    }))
  }, [filtered])

  // ==================== 矩阵象限分配 ====================
  const quadMap = useMemo(() => {
    const result: Record<string, StakeholderItem[]> = { 'hi-hi': [], 'hi-lo': [], 'lo-hi': [], 'lo-lo': [] }
    for (const r of filtered) {
      const hiInfluence = r.influence >= 4
      const hiInterest = r.interest >= 4
      if (hiInfluence && hiInterest) result['hi-hi'].push(r)
      else if (hiInfluence && !hiInterest) result['hi-lo'].push(r)
      else if (!hiInfluence && hiInterest) result['lo-hi'].push(r)
      else result['lo-lo'].push(r)
    }
    return result
  }, [filtered])

  // ==================== 表单操作 ====================
  const openCreate = () => {
    setEditing(null)
    setAttrs({})
    setAutoHint('')
    form.resetFields()
    form.setFieldsValue({ influence: 3, interest: 3, priority: 'P2' })
    setModalOpen(true)
  }

  const openEdit = (item: StakeholderItem) => {
    setEditing(item)
    setAttrs(parseParticipation(item.participation))
    setAutoHint('')
    form.setFieldsValue({
      name: item.name,
      org: item.org,
      sub_pos: item.sub_pos,
      role: item.role,
      contact_phone: item.contact_phone,
      contact_wechat: item.contact_wechat,
      contact_email: item.contact_email,
      influence: item.influence,
      interest: item.interest,
      priority: item.priority,
      demands: item.demands,
      strategy: item.strategy,
      comm_frequency: item.comm_frequency,
    })
    setModalOpen(true)
  }

  const handleAutoScore = () => {
    const influence = form.getFieldValue('influence') || 3
    const interest = form.getFieldValue('interest') || 3
    const suggested = calcPriority(influence, interest)
    form.setFieldsValue({ priority: suggested })
    setAutoHint(`影响力 ${influence} × 关注度 ${interest} → 建议优先级：${suggested}`)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    const payload = {
      ...values,
      participation: buildParticipation(attrs),
    }
    try {
      if (editing) {
        await updateStakeholder(editing.id, payload)
        message.success('干系人已更新')
      } else {
        await createStakeholder(projectId, payload)
        message.success('干系人已登记')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (item: StakeholderItem) => {
    try {
      await deleteStakeholder(item.id)
      message.success('干系人已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const openComms = async (item: StakeholderItem) => {
    setCommOpen(item)
    setComms(await listCommunications(item.id))
    commForm.resetFields()
  }

  const handleAddComm = async () => {
    if (!commOpen) return
    const values = await commForm.validateFields()
    try {
      await createCommunication(commOpen.id, values)
      message.success('沟通记录已添加')
      commForm.resetFields()
      setComms(await listCommunications(commOpen.id))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const toggleFilter = (key: string, type: 'attr' | 'prio') => {
    if (type === 'attr') {
      setFilterAttrs((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    } else {
      setFilterPrios((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }
  }

  // ==================== 渲染 ====================
  const statCard = (label: string, value: number, color?: string, sub?: string) => (
    <Card size="small" style={{ textAlign: 'center', borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: '#6b7c8c' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#1c2b36' }}>{value}</div>
      {sub ? <div style={{ fontSize: 10, color: '#8a9ba8' }}>{sub}</div> : null}
    </Card>
  )

  const renderMatrix = () => (
    <Card size="small" style={{ marginBottom: 12, borderRadius: 10 }}>
      <Typography.Text strong style={{ fontSize: 14, color: '#123c58' }}>干系人影响力 × 关注度矩阵</Typography.Text>
      <div style={{ fontSize: 11, color: '#6b7c8c', margin: '4px 0 10px' }}>
        点击人名可跳转编辑。颜色即优先级（红=P0 / 黄=P1 / 绿=P2）。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minHeight: 120 }}>
        {QUADRANTS.map((q) => {
          const people = quadMap[q.cls] || []
          const style = QUAD_STYLE[q.cls]
          return (
            <div key={q.id} style={{ background: style.bg, border: `1px solid ${style.border}`, borderRadius: 8, padding: 10, minHeight: 60 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{q.title}</div>
              <div style={{ fontSize: 10, color: '#6b7c8c', marginBottom: 6 }}>{q.desc}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {people.map((p) => (
                  <span
                    key={p.id}
                    onClick={() => openEdit(p)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#fff',
                      background: PRIORITY_COLORS[p.priority || 'P2'] || '#6b7c8c',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}
                  </span>
                ))}
                {people.length === 0 ? <span style={{ fontSize: 10, color: '#aab' }}>（无）</span> : null}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )

  const columns = [
    {
      title: '干系人',
      dataIndex: 'name',
      width: 120,
      render: (v: string, r: StakeholderItem) => (
        <div>
          <div style={{ fontWeight: 600 }}>{v}</div>
          {r.sub_pos ? <div style={{ fontSize: 10, color: '#8a9ba8' }}>{r.sub_pos}</div> : null}
        </div>
      ),
    },
    { title: '职位/角色', dataIndex: 'role', width: 130, render: (v: string | null) => v ?? '-' },
    {
      title: '联系方式',
      key: 'contact',
      width: 140,
      render: (_: unknown, r: StakeholderItem) => (
        <div style={{ fontSize: 11, lineHeight: 1.5 }}>
          {r.contact_phone ? <div>📱 {r.contact_phone}</div> : null}
          {r.contact_wechat ? <div>💬 {r.contact_wechat}</div> : null}
          {r.contact_email ? <div>✉️ {r.contact_email}</div> : null}
          {!r.contact_phone && !r.contact_wechat && !r.contact_email ? '-' : null}
        </div>
      ),
    },
    ...ATT_KEYS.map((k) => ({
      title: ATT_NAMES[k],
      key: k,
      width: 60,
      align: 'center' as const,
      render: (_: unknown, r: StakeholderItem) => {
        const p = parseParticipation(r.participation)
        const mark = p[k]
        if (!mark) return <div style={{ width: 20, height: 20, border: '1px dashed #c3cfda', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#c3cfda' }}>—</div>
        return (
          <div
            style={{
              width: 20, height: 20, borderRadius: 4, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
              background: mark === 'C' ? '#1a5e8a' : '#e8a33d', color: '#fff',
            }}
          >
            {mark}
          </div>
        )
      },
    })),
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 70,
      align: 'center' as const,
      render: (v: string | null) =>
        v ? (
          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: '#fff', background: PRIORITY_COLORS[v] || '#6b7c8c' }}>{v}</span>
        ) : '-',
    },
    {
      title: '需求/核心诉求',
      dataIndex: 'demands',
      width: 200,
      render: (v: string | null, r: StakeholderItem) => (
        <div style={{ maxWidth: 200, lineHeight: 1.5 }}>
          {v || '-'}
          {r.strategy ? <div style={{ fontSize: 10, color: '#6b7c8c', marginTop: 2 }}>{r.strategy}</div> : null}
        </div>
      ),
    },
    {
      title: '沟通计划',
      dataIndex: 'comm_frequency',
      width: 120,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, r: StakeholderItem) => (
        <Space size={4}>
          <Button size="small" icon={<MessageOutlined />} onClick={() => void openComms(r)} />
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => void handleDelete(r)}>
            <Button size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* 仪表盘统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 12 }}>
        {statCard('干系人总数', stats.total)}
        {statCard('P0 重点管理', stats.p0, PRIORITY_COLORS.P0)}
        {statCard('P1 重点关注', stats.p1, PRIORITY_COLORS.P1)}
        {statCard('P2 一般跟进', stats.p2, PRIORITY_COLORS.P2)}
        {statCard('高影响力(≥4)', stats.hiInfluence, '#1a5e8a')}
      </div>

      {/* 工具条 */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 10 }}>
        <Space wrap>
          <Input.Search
            placeholder="搜索姓名 / 职位 / 单位 / 需求…"
            style={{ width: 240 }}
            onSearch={setSearchText}
            allowClear
          />
          {ATT_KEYS.map((k) => (
            <Tag.CheckableTag
              key={k}
              checked={filterAttrs.has(k)}
              onChange={() => toggleFilter(k, 'attr')}
            >
              {ATT_NAMES[k]}
            </Tag.CheckableTag>
          ))}
          <span style={{ width: 1, height: 20, background: '#d9e2ea' }} />
          {['P0', 'P1', 'P2'].map((p) => (
            <Tag.CheckableTag
              key={p}
              checked={filterPrios.has(p)}
              onChange={() => toggleFilter(p, 'prio')}
            >
              {p}
            </Tag.CheckableTag>
          ))}
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增干系人</Button>
        </Space>
      </Card>

      {/* 矩阵 */}
      {renderMatrix()}

      {/* 分组表格 */}
      <Card size="small" style={{ borderRadius: 10 }}>
        <Table<StakeholderItem>
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          pagination={false}
          size="small"
          scroll={{ x: 1300 }}
          columns={columns}
        />
      </Card>

      {/* 编辑弹窗 */}
      <Modal title={editing ? `编辑干系人 · ${editing.name}` : '新增干系人'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void handleOk()} width={720} destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="org" label="单位名称">
              <Input placeholder="选择或输入" />
            </Form.Item>
            <Form.Item name="sub_pos" label="角色分类">
              <Input placeholder="决策层/管理层/使用方…" />
            </Form.Item>
            <Form.Item name="name" label="干系人姓名" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="role" label="职位/角色">
              <Input />
            </Form.Item>
            <Form.Item name="contact_phone" label="电话">
              <Input />
            </Form.Item>
            <Form.Item name="contact_wechat" label="微信">
              <Input />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input />
            </Form.Item>
            <Form.Item name="influence" label="影响力(1-5)" initialValue={3}>
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="interest" label="关注度(1-5)" initialValue={3}>
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select options={['P0', 'P1', 'P2'].map((v) => ({ value: v, label: `${v} ${v === 'P0' ? '重点管理' : v === 'P1' ? '重点关注' : '一般跟进'}` }))} />
            </Form.Item>
            <Form.Item>
              <Button icon={<ThunderboltOutlined />} onClick={handleAutoScore}>自动建议优先级</Button>
              {autoHint ? <div style={{ fontSize: 11, color: '#1e8449', marginTop: 4 }}>{autoHint}</div> : null}
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="demands" label="需求/核心诉求">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="strategy" label="沟通策略/备注">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <Form.Item name="comm_frequency" label="沟通计划">
            <Input placeholder="A日报 B周报 E月度远程 F线下" />
          </Form.Item>

          <div style={{ borderTop: '1px solid #d9e2ea', paddingTop: 10, marginTop: 8, fontSize: 12, color: '#6b7c8c', fontWeight: 600, marginBottom: 8 }}>
            参与程度标记（C=当前 D=期望）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 10 }}>
            {ATT_KEYS.map((k) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: '#6b7c8c', marginBottom: 4 }}>{ATT_NAMES[k]}</div>
                <Select
                  value={attrs[k] || undefined}
                  allowClear
                  placeholder="—"
                  style={{ width: '100%' }}
                  onChange={(v) => setAttrs((prev) => ({ ...prev, [k]: v || '' }))}
                  options={[
                    { value: 'C', label: 'C 当前' },
                    { value: 'D', label: 'D 期望' },
                  ]}
                />
              </div>
            ))}
          </div>
        </Form>
      </Modal>

      {/* 沟通历史抽屉 */}
      <Drawer title={commOpen ? `沟通历史 · ${commOpen.name}` : ''} open={!!commOpen} onClose={() => setCommOpen(null)} width={560}>
        <Table
          rowKey="id"
          size="small"
          dataSource={comms as Record<string, unknown>[]}
          pagination={false}
          columns={[
            { title: '日期', dataIndex: 'comm_date', width: 100, render: (v: string | null) => v ?? '-' },
            { title: '渠道', dataIndex: 'channel', width: 80, render: (v: string | null) => v ?? '-' },
            { title: '内容/结论', key: 'content', render: (_: unknown, r) => `${r.content ?? ''}${r.conclusion ? `（结论：${r.conclusion}）` : ''}` },
            { title: '后续行动', dataIndex: 'follow_up_action', render: (v: string | null) => v ?? '-' },
          ]}
        />
        <Form form={commForm} layout="vertical" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="comm_date" label="沟通日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="channel" label="渠道">
              <Select allowClear options={['电话', '微信', '邮件', '会议', '现场'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="content" label="沟通内容">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="conclusion" label="结论">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="follow_up_action" label="后续行动">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <Button type="primary" onClick={() => void handleAddComm()}>记录沟通</Button>
        </Form>
      </Drawer>
    </div>
  )
}