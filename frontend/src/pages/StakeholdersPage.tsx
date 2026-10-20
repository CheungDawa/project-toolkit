import {
  DeleteOutlined,
  MessageOutlined,
  PlusOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { useParams } from 'react-router-dom'

import type { CommunicationItem, StakeholderItem } from '../api/stage3'
import {
  createCommunication,
  createStakeholder,
  deleteCommunication,
  deleteStakeholder,
  listCommunications,
  listStakeholders,
  updateStakeholder,
} from '../api/stage3'

const ATT_KEYS = ['unknown', 'resist', 'neutral', 'support', 'lead'] as const
const ATT_NAMES: Record<string, string> = {
  unknown: '不知晓',
  resist: '抵制',
  neutral: '中立',
  support: '支持',
  lead: '领导',
}
const PRIORITY_COLORS: Record<string, string> = { P0: '#c0392b', P1: '#e8a33d', P2: '#1e8449' }

/**
 * 影响力/关注度「高」阈值：量表为 1-5 分（表单与数据库约束均如此），
 * 与页面既有口径（优先级自动建议、高影响力统计）保持一致，≥4 视为高。
 */
const HIGH_THRESHOLD = 4

function calcPriority(influence: number, interest: number): string {
  if (influence >= 4 && interest >= 4) return 'P0'
  if (influence >= 4 || interest >= 4) return 'P1'
  return 'P2'
}

function parseParticipation(text: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text) return result
  for (const line of text.split(/[;；]/)) {
    const m = line.match(/^(.+?)（(当前|期望)）$/)
    if (m) {
      const key = ATT_KEYS.find(k => ATT_NAMES[k] === m[1].trim())
      if (key) result[key] = m[2] === '当前' ? 'C' : 'D'
    }
  }
  return result
}

function buildParticipation(attrs: Record<string, string>): string | null {
  return (
    ATT_KEYS.filter(k => attrs[k])
      .map(k => `${ATT_NAMES[k]}（${attrs[k] === 'C' ? '当前' : '期望'}）`)
      .join('；') || null
  )
}

/** 行类型：org=单位分组行 / sub=角色分类子行 / person=干系人行 */
type RowType = 'org' | 'sub' | 'person'
interface TableRow {
  key: string
  type: RowType
  label: string
  count: number
  data?: StakeholderItem
}

/** 按单位→角色分类→人 构建分层行序列 */
function buildHierarchicalRows(items: StakeholderItem[]): TableRow[] {
  const orgMap = new Map<string, Map<string, StakeholderItem[]>>()
  for (const item of items) {
    const org = item.org || '未分类'
    const subPos = item.sub_pos || '未分类'
    if (!orgMap.has(org)) orgMap.set(org, new Map())
    const subMap = orgMap.get(org)!
    if (!subMap.has(subPos)) subMap.set(subPos, [])
    subMap.get(subPos)!.push(item)
  }
  const rows: TableRow[] = []
  for (const [org, subMap] of orgMap) {
    const total = [...subMap.values()].flat().length
    rows.push({ key: `org:${org}`, type: 'org', label: org, count: total })
    for (const [subPos, people] of subMap) {
      rows.push({ key: `sub:${org}:${subPos}`, type: 'sub', label: subPos, count: people.length })
      for (const p of people) {
        rows.push({ key: p.id, type: 'person', label: p.name, count: 1, data: p })
      }
    }
  }
  return rows
}

/** 四象限：红=重点管理 / 橙=令其满意 / 黄=随时告知 / 灰=监督即可 */
const QUADRANTS = [
  { cls: 'hi-hi', title: '高影响 · 高关注', desc: '重点管理' },
  { cls: 'hi-lo', title: '高影响 · 低关注', desc: '令其满意' },
  { cls: 'lo-hi', title: '低影响 · 高关注', desc: '随时告知' },
  { cls: 'lo-lo', title: '低影响 · 低关注', desc: '监督即可' },
]
const QUAD_STYLE: Record<string, { bg: string; border: string; title: string }> = {
  // 红（高/高）
  'hi-hi': { bg: '#fee2e2', border: '#fca5a5', title: '#b91c1c' },
  // 橙（高/低）
  'hi-lo': { bg: '#ffedd5', border: '#fdba74', title: '#c2410c' },
  // 黄（低/高）
  'lo-hi': { bg: '#fef9c3', border: '#fde047', title: '#a16207' },
  // 灰（低/低）
  'lo-lo': { bg: '#f3f4f6', border: '#d1d5db', title: '#6b7280' },
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
  const [comms, setComms] = useState<CommunicationItem[]>([])
  const [commForm] = Form.useForm()
  /** 沟通统计：干系人 id → { 次数, 最近沟通日期 }，用于列表视图展示 */
  const [commStats, setCommStats] = useState<
    Record<string, { count: number; lastDate: string | null }>
  >({})
  const [searchText, setSearchText] = useState('')
  const [filterAttrs, setFilterAttrs] = useState<Set<string>>(new Set())
  const [filterPrios, setFilterPrios] = useState<Set<string>>(new Set())
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [autoHint, setAutoHint] = useState('')

  // 视图切换：list=平铺列表（支持勾选批量操作）/ group=按单位分组分层展示
  const [viewMode, setViewMode] = useState<'list' | 'group'>('group')
  // 批量选择（两种视图下 person 行均可勾选，key 即干系人 id）
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchForm] = Form.useForm()

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

  /**
   * 沟通统计（列表视图「沟通记录」列数据源）：
   * 逐个干系人并行拉取沟通记录（现有 API 仅有按干系人查询的端点，无项目级汇总），
   * 单个失败跳过不阻断；列表按 comm_date 降序，首条即最近一次。
   */
  useEffect(() => {
    if (items.length === 0) {
      setCommStats({})
      return
    }
    let cancelled = false
    void (async () => {
      const results = await Promise.allSettled(items.map(s => listCommunications(s.id)))
      if (cancelled) return
      const stats: Record<string, { count: number; lastDate: string | null }> = {}
      results.forEach((r, idx) => {
        if (r.status !== 'fulfilled') return
        const list = r.value
        stats[items[idx].id] = { count: list.length, lastDate: list[0]?.comm_date ?? null }
      })
      setCommStats(stats)
    })()
    return () => {
      cancelled = true
    }
  }, [items])

  const filtered = useMemo(() => {
    let result = items
    const kw = searchText.trim().toLowerCase()
    if (kw) {
      result = result.filter(
        r =>
          r.name.toLowerCase().includes(kw) ||
          (r.role || '').toLowerCase().includes(kw) ||
          (r.org || '').toLowerCase().includes(kw) ||
          (r.sub_pos || '').toLowerCase().includes(kw) ||
          (r.demands || '').toLowerCase().includes(kw),
      )
    }
    if (filterAttrs.size > 0) {
      result = result.filter(r => {
        const p = parseParticipation(r.participation)
        return [...filterAttrs].some(k => p[k])
      })
    }
    if (filterPrios.size > 0) {
      result = result.filter(r => r.priority && filterPrios.has(r.priority))
    }
    return result
  }, [items, searchText, filterAttrs, filterPrios])

  const stats = useMemo(
    () => ({
      p0: filtered.filter(r => r.priority === 'P0').length,
      p1: filtered.filter(r => r.priority === 'P1').length,
      p2: filtered.filter(r => r.priority === 'P2').length,
      hiInfluence: filtered.filter(r => r.influence >= 4).length,
      total: filtered.length,
    }),
    [filtered],
  )

  const tableRows = useMemo(() => buildHierarchicalRows(filtered), [filtered])

  const quadMap = useMemo(() => {
    const result: Record<string, StakeholderItem[]> = {
      'hi-hi': [],
      'hi-lo': [],
      'lo-hi': [],
      'lo-lo': [],
    }
    for (const r of filtered) {
      if (r.influence >= HIGH_THRESHOLD && r.interest >= HIGH_THRESHOLD) result['hi-hi'].push(r)
      else if (r.influence >= HIGH_THRESHOLD) result['hi-lo'].push(r)
      else if (r.interest >= HIGH_THRESHOLD) result['lo-hi'].push(r)
      else result['lo-lo'].push(r)
    }
    return result
  }, [filtered])

  const openCreate = () => {
    setEditing(null)
    setAttrs({})
    setAutoHint('')
    form.resetFields()
    form.setFieldsValue({ influence: 3, interest: 3, priority: 'P2' })
    setModalOpen(true)
  }

  const openEdit = useCallback(
    (item: StakeholderItem) => {
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
    },
    [form],
  )

  const handleAutoScore = () => {
    const inf = form.getFieldValue('influence') || 3
    const int = form.getFieldValue('interest') || 3
    const p = calcPriority(inf, int)
    form.setFieldsValue({ priority: p })
    setAutoHint(`影响力 ${inf} × 关注度 ${int} → 建议优先级：${p}`)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    try {
      const payload = { ...values, participation: buildParticipation(attrs) }
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

  const handleDelete = useCallback(
    async (item: StakeholderItem) => {
      try {
        await deleteStakeholder(item.id)
        message.success('干系人已删除')
        await fetchData()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败')
      }
    },
    [fetchData, message],
  )

  /** 用最新拉取的记录列表同步某干系人的沟通统计（次数 / 最近沟通） */
  const updateCommStats = useCallback((stakeholderId: string, list: CommunicationItem[]) => {
    setCommStats(prev => ({
      ...prev,
      [stakeholderId]: { count: list.length, lastDate: list[0]?.comm_date ?? null },
    }))
  }, [])

  /** 打开沟通历史抽屉：日期默认今天，加载该干系人的沟通记录 */
  const openComms = useCallback(
    async (item: StakeholderItem) => {
      setCommOpen(item)
      commForm.resetFields()
      commForm.setFieldsValue({ comm_date: dayjs() })
      try {
        const list = await listCommunications(item.id)
        setComms(list)
        updateCommStats(item.id, list)
      } catch (err) {
        setComms([])
        message.error(err instanceof Error ? err.message : '加载沟通记录失败')
      }
    },
    [commForm, message, updateCommStats],
  )

  const handleAddComm = async () => {
    if (!commOpen) return
    const values = await commForm.validateFields()
    try {
      await createCommunication(commOpen.id, {
        comm_date: values.comm_date ? values.comm_date.format('YYYY-MM-DD') : null,
        channel: values.channel ?? null,
        content: values.content,
        conclusion: values.conclusion ?? null,
        follow_up_action: values.follow_up_action ?? null,
      })
      message.success('沟通记录已添加')
      commForm.resetFields()
      commForm.setFieldsValue({ comm_date: dayjs() })
      const list = await listCommunications(commOpen.id)
      setComms(list)
      updateCommStats(commOpen.id, list)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDeleteComm = useCallback(
    async (commId: string) => {
      if (!commOpen) return
      try {
        await deleteCommunication(commId)
        message.success('沟通记录已删除')
        const list = await listCommunications(commOpen.id)
        setComms(list)
        updateCommStats(commOpen.id, list)
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败')
      }
    },
    [commOpen, message, updateCommStats],
  )

  const toggleFilter = (key: string, type: 'attr' | 'prio') => {
    if (type === 'attr') {
      setFilterAttrs(prev => {
        const n = new Set(prev)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
    } else {
      setFilterPrios(prev => {
        const n = new Set(prev)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
    }
  }

  /** 批量设置：对勾选的干系人逐条更新，留空字段保持不变，完成后汇总成功/失败 */
  const handleBatchOk = async () => {
    if (selectedKeys.length === 0) return
    const values = await batchForm.validateFields()
    const payload: Record<string, unknown> = {}
    if (values.influence !== undefined && values.influence !== null)
      payload.influence = values.influence
    if (values.interest !== undefined && values.interest !== null)
      payload.interest = values.interest
    if (values.priority) payload.priority = values.priority
    if (Object.keys(payload).length === 0) {
      message.warning('请至少填写一项要批量修改的字段（留空表示保持不变）')
      return
    }
    setBatchSaving(true)
    let ok = 0
    let fail = 0
    try {
      for (const key of selectedKeys) {
        try {
          await updateStakeholder(String(key), payload)
          ok += 1
        } catch {
          fail += 1
        }
      }
    } finally {
      setBatchSaving(false)
    }
    if (fail === 0) message.success(`批量设置完成：成功更新 ${ok} 条`)
    else message.warning(`批量设置完成：成功 ${ok} 条，失败 ${fail} 条`)
    setBatchOpen(false)
    batchForm.resetFields()
    setSelectedKeys([])
    await fetchData()
  }

  const statCard = (label: string, value: number, color?: string) => (
    <Card size="small" style={{ textAlign: 'center', borderRadius: 10, minWidth: 110 }}>
      <div style={{ fontSize: 11, color: '#6b7c8c' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#1c2b36' }}>{value}</div>
    </Card>
  )

  // ==================== 表格列（区分 group / sub / person） ====================
  // 下面这些单元格渲染函数只读取 props/模块常量，用 useCallback 固定引用，
  // 使其可以作为列定义 useMemo 的稳定依赖（避免每次渲染都重建列定义）。
  const cellFor = useCallback(
    (r: TableRow, personRender: (d: StakeholderItem) => ReactNode, groupText = ''): ReactNode => {
      if (r.type === 'org')
        return <span style={{ fontWeight: 700, fontSize: 13, color: '#123c58' }}>{groupText}</span>
      if (r.type === 'sub')
        return (
          <span style={{ fontWeight: 600, fontSize: 12, color: '#1a5e8a', paddingLeft: 20 }}>
            {groupText}
          </span>
        )
      return personRender(r.data!)
    },
    [],
  )

  const scoreCell = useCallback(
    (v: number) => (
      <span
        style={{
          display: 'inline-block',
          minWidth: 26,
          padding: '1px 6px',
          borderRadius: 6,
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 700,
          background: v >= HIGH_THRESHOLD ? '#fdeceb' : '#eef1f4',
          color: v >= HIGH_THRESHOLD ? '#c0392b' : '#6b7c8c',
        }}
      >
        {v}
      </span>
    ),
    [],
  )

  const priorityCell = useCallback(
    (v: string | null) =>
      v ? (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            background: PRIORITY_COLORS[v] || '#6b7c8c',
          }}
        >
          {v}
        </span>
      ) : (
        '-'
      ),
    [],
  )

  const contactCell = useCallback(
    (d: StakeholderItem) => (
      <div style={{ fontSize: 11, lineHeight: 1.5 }}>
        {d.contact_phone ? <div>📱 {d.contact_phone}</div> : null}
        {d.contact_wechat ? <div>💬 {d.contact_wechat}</div> : null}
        {d.contact_email ? <div>✉️ {d.contact_email}</div> : null}
        {!d.contact_phone && !d.contact_wechat && !d.contact_email ? '-' : null}
      </div>
    ),
    [],
  )

  const actionCell = useCallback(
    (d: StakeholderItem) => (
      <Space size={4}>
        <Button size="small" icon={<MessageOutlined />} onClick={() => void openComms(d)} />
        <Button size="small" onClick={() => openEdit(d)}>
          编辑
        </Button>
        <Popconfirm title="确认删除？" onConfirm={() => void handleDelete(d)}>
          <Button size="small" danger icon={<DeleteOutlined />} title="删除干系人" />
        </Popconfirm>
      </Space>
    ),
    [handleDelete, openComms, openEdit],
  )

  const rowBg = useCallback((r: TableRow): string => {
    if (r.type === 'org') return '#f0f5fa'
    if (r.type === 'sub') return '#f6f9fc'
    return '#ffffff'
  }, [])

  /** 分组视图列定义：依赖的辅助渲染函数均已稳定（useCallback），memo 后引用恒定 */
  const columns: {
    title: string
    key: string
    dataIndex?: string
    width?: number
    align?: 'left' | 'center' | 'right'
    fixed?: 'right'
    onCell?: (record: TableRow, rowIndex?: number) => { style?: CSSProperties }
    render: (_: unknown, record: TableRow) => ReactNode
  }[] = useMemo(
    () => [
      {
        title: '干系人',
        key: 'name',
        width: 140,
        render: (_: unknown, r) =>
          cellFor(
            r,
            d => (
              <div>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                {d.role ? <div style={{ fontSize: 10, color: '#8a9ba8' }}>{d.role}</div> : null}
              </div>
            ),
            r.type === 'org'
              ? `${r.label}（${r.count} 人）`
              : r.type === 'sub'
                ? `└ ${r.label}（${r.count} 人）`
                : '',
          ),
      },
      {
        title: '单位',
        key: 'org',
        width: 140,
        render: (_, r) => cellFor(r, d => <span style={{ fontSize: 12 }}>{d.org || '-'}</span>, ''),
      },
      {
        title: '联系方式',
        key: 'contact',
        width: 140,
        render: (_, r) => cellFor(r, d => contactCell(d)),
      },
      ...ATT_KEYS.map(k => ({
        title: ATT_NAMES[k],
        key: k,
        width: 55,
        align: 'center' as const,
        render: (_: unknown, r: TableRow) => {
          if (r.type !== 'person') return null
          const p = parseParticipation(r.data!.participation)
          const mark = p[k]
          if (!mark)
            return (
              <div
                style={{
                  width: 18,
                  height: 18,
                  border: '1px dashed #c3cfda',
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  color: '#c3cfda',
                }}
              >
                —
              </div>
            )
          return (
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                background: mark === 'C' ? '#1a5e8a' : '#e8a33d',
                color: '#fff',
              }}
            >
              {mark}
            </div>
          )
        },
      })),
      {
        title: '优先级',
        key: 'priority',
        width: 65,
        align: 'center' as const,
        render: (_, r) => {
          if (r.type !== 'person') return null
          return priorityCell(r.data!.priority)
        },
      },
      {
        title: '需求/核心诉求',
        key: 'demands',
        width: 180,
        render: (_, r) => {
          if (r.type === 'org') return null
          if (r.type === 'sub') return null
          return (
            <div style={{ maxWidth: 180, fontSize: 12, lineHeight: 1.4 }}>
              {r.data!.demands || '-'}
            </div>
          )
        },
      },
      {
        title: '沟通计划',
        key: 'comm',
        width: 110,
        render: (_, r) => {
          if (r.type !== 'person') return null
          return r.data!.comm_frequency || '-'
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 130,
        fixed: 'right' as const,
        onCell: (r: TableRow) => ({ style: { background: rowBg(r) } }),
        render: (_, r) => {
          if (r.type !== 'person') return null
          return actionCell(r.data!)
        },
      },
    ],
    [actionCell, cellFor, contactCell, priorityCell, rowBg],
  )

  /** 列表视图列定义：仅「沟通记录」列读 commStats，其余依赖已稳定的辅助函数 */
  const listColumns: TableProps<StakeholderItem>['columns'] = useMemo(
    () => [
      {
        title: '干系人',
        key: 'name',
        width: 150,
        fixed: 'left' as const,
        render: (_: unknown, d) => (
          <div>
            <div style={{ fontWeight: 600 }}>{d.name}</div>
            {d.role ? <div style={{ fontSize: 10, color: '#8a9ba8' }}>{d.role}</div> : null}
          </div>
        ),
      },
      {
        title: '单位',
        key: 'org',
        width: 130,
        render: (_: unknown, d) => <span style={{ fontSize: 12 }}>{d.org || '-'}</span>,
      },
      {
        title: '角色分类',
        key: 'sub_pos',
        width: 100,
        render: (_: unknown, d) => <span style={{ fontSize: 12 }}>{d.sub_pos || '-'}</span>,
      },
      { title: '联系方式', key: 'contact', width: 140, render: (_: unknown, d) => contactCell(d) },
      {
        title: '影响力',
        key: 'influence',
        width: 70,
        align: 'center' as const,
        render: (_: unknown, d) => scoreCell(d.influence),
      },
      {
        title: '关注度',
        key: 'interest',
        width: 70,
        align: 'center' as const,
        render: (_: unknown, d) => scoreCell(d.interest),
      },
      {
        title: '优先级',
        key: 'priority',
        width: 70,
        align: 'center' as const,
        render: (_: unknown, d) => priorityCell(d.priority),
      },
      {
        title: '需求/核心诉求',
        key: 'demands',
        width: 200,
        ellipsis: true,
        render: (_: unknown, d) => <span style={{ fontSize: 12 }}>{d.demands || '-'}</span>,
      },
      {
        title: '沟通计划',
        key: 'comm',
        width: 100,
        render: (_: unknown, d) => d.comm_frequency || '-',
      },
      {
        title: '沟通记录',
        key: 'commStat',
        width: 120,
        render: (_: unknown, d) => {
          const stat = commStats[d.id]
          if (!stat) return <span style={{ color: '#c3cfda' }}>—</span>
          return (
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: stat.count > 0 ? '#1a5e8a' : '#8a9ba8' }}>
                {stat.count} 次
              </span>
              {stat.lastDate ? (
                <div style={{ color: '#8a9ba8' }}>最近 {stat.lastDate}</div>
              ) : (
                <div style={{ color: '#c3cfda' }}>暂无记录</div>
              )}
            </div>
          )
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 130,
        fixed: 'right' as const,
        onCell: () => ({ style: { background: '#ffffff' } }),
        render: (_: unknown, d) => actionCell(d),
      },
    ],
    [actionCell, commStats, contactCell, priorityCell, scoreCell],
  )

  /** 沟通历史列定义：仅依赖已稳定的 handleDeleteComm */
  const commColumns: TableProps<CommunicationItem>['columns'] = useMemo(
    () => [
      { title: '日期', dataIndex: 'comm_date', width: 95, render: (v: string | null) => v ?? '-' },
      { title: '渠道', dataIndex: 'channel', width: 70, render: (v: string | null) => v ?? '-' },
      {
        title: '内容/结论',
        key: 'content',
        render: (_: unknown, r) =>
          `${r.content ?? ''}${r.conclusion ? `（结论：${r.conclusion}）` : ''}`,
      },
      {
        title: '后续行动',
        dataIndex: 'follow_up_action',
        width: 130,
        render: (v: string | null) => v ?? '-',
      },
      {
        title: '',
        key: 'actions',
        width: 50,
        render: (_: unknown, r) => (
          <Popconfirm title="确认删除该沟通记录？" onConfirm={() => void handleDeleteComm(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ),
      },
    ],
    [handleDeleteComm],
  )

  const rowStyle = (r: TableRow): CSSProperties => {
    if (r.type === 'org') return { background: '#f0f5fa', fontWeight: 700, color: '#123c58' }
    if (r.type === 'sub') return { background: '#f6f9fc', color: '#1a5e8a' }
    return {}
  }

  /** 批量勾选配置（两种视图共用，key 均为干系人 id） */
  const selectionShared = {
    selectedRowKeys: selectedKeys,
    onChange: (keys: React.Key[]) => setSelectedKeys(keys),
  }

  return (
    <div>
      {/* 仪表盘 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))',
          gap: 10,
          marginBottom: 12,
        }}
      >
        {statCard('干系人总数', stats.total)}
        {statCard('P0 重点管理', stats.p0, PRIORITY_COLORS.P0)}
        {statCard('P1 重点关注', stats.p1, PRIORITY_COLORS.P1)}
        {statCard('P2 一般跟进', stats.p2, PRIORITY_COLORS.P2)}
        {statCard(`高影响力(≥${HIGH_THRESHOLD})`, stats.hiInfluence, '#1a5e8a')}
      </div>

      {/* 工具条 */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 10 }}>
        <Space wrap>
          <Input.Search
            placeholder="搜索姓名 / 职位 / 单位 / 需求…"
            style={{ width: 220 }}
            onSearch={setSearchText}
            allowClear
          />
          {ATT_KEYS.map(k => (
            <Tag.CheckableTag
              key={k}
              checked={filterAttrs.has(k)}
              onChange={() => toggleFilter(k, 'attr')}
            >
              {ATT_NAMES[k]}
            </Tag.CheckableTag>
          ))}
          <span style={{ width: 1, height: 20, background: '#d9e2ea' }} />
          {['P0', 'P1', 'P2'].map(p => (
            <Tag.CheckableTag
              key={p}
              checked={filterPrios.has(p)}
              onChange={() => toggleFilter(p, 'prio')}
            >
              {p}
            </Tag.CheckableTag>
          ))}
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增干系人
          </Button>
          <Button
            icon={<SettingOutlined />}
            disabled={selectedKeys.length === 0}
            onClick={() => {
              batchForm.resetFields()
              setBatchOpen(true)
            }}
          >
            批量设置{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
          </Button>
          <Button
            onClick={() => window.open(`/api/projects/${projectId}/stakeholders/report/export`)}
          >
            导出报告
          </Button>
        </Space>
      </Card>

      {/* 矩阵 */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 10 }}>
        <Typography.Text strong style={{ fontSize: 14, color: '#123c58' }}>
          干系人影响力 × 关注度矩阵
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 10 }}>
          着色：红框=高影响+高关注（重点管理）关键干系人，点击姓名可直接编辑 · 橙=高/低（令其满意）·
          黄=低/高（随时告知）· 灰=低/低（监督即可）；1-5 分制，≥{HIGH_THRESHOLD} 视为高
        </Typography.Text>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            minHeight: 120,
            marginTop: 8,
          }}
        >
          {QUADRANTS.map(q => {
            const people = quadMap[q.cls] || []
            const s = QUAD_STYLE[q.cls]
            return (
              <div
                key={q.cls}
                style={{
                  background: s.bg,
                  border: `1.5px solid ${s.border}`,
                  borderRadius: 8,
                  padding: 10,
                  minHeight: 60,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: s.title }}>
                  {q.title} — {q.desc}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 3,
                    maxHeight: 130,
                    overflowY: 'auto',
                  }}
                >
                  {people.map(p => (
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
                  {people.length === 0 ? (
                    <span style={{ fontSize: 10, color: '#aab' }}>（无）</span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* 干系人列表：列表 / 按单位分组 */}
      <Card size="small" style={{ borderRadius: 10 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Segmented
            value={viewMode}
            onChange={v => setViewMode(v as 'list' | 'group')}
            options={[
              { label: '列表', value: 'list' },
              { label: '按单位分组', value: 'group' },
            ]}
          />
          {selectedKeys.length > 0 ? (
            <Space size={8}>
              <span style={{ fontSize: 12, color: '#1a5e8a' }}>已选 {selectedKeys.length} 项</span>
              <Button type="link" size="small" onClick={() => setSelectedKeys([])}>
                清空选择
              </Button>
            </Space>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {viewMode === 'list'
                ? '勾选多条后可使用上方「批量设置」'
                : '按单位 → 角色分类分层展示，便于会前逐单位过一遍'}
            </Typography.Text>
          )}
        </div>

        {viewMode === 'list' ? (
          <Table<StakeholderItem>
            rowKey="id"
            loading={loading}
            dataSource={filtered}
            pagination={
              filtered.length > 20 ? { pageSize: 20, showTotal: t => `共 ${t} 条` } : false
            }
            size="small"
            scroll={{ x: 1320 }}
            rowSelection={selectionShared}
            columns={listColumns}
          />
        ) : (
          <Table<TableRow>
            rowKey="key"
            loading={loading}
            dataSource={tableRows}
            pagination={false}
            size="small"
            scroll={{ x: 1300 }}
            columns={columns as never}
            rowSelection={{
              ...selectionShared,
              getCheckboxProps: (r: TableRow) => ({ disabled: r.type !== 'person' }),
            }}
            onRow={r => ({ style: rowStyle(r) })}
            components={{
              body: {
                row: (
                  props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: string },
                ) => {
                  const key = props['data-row-key'] as string
                  const row = tableRows.find(r => r.key === key)
                  return <tr {...props} style={{ ...props.style, ...(row ? rowStyle(row) : {}) }} />
                },
              },
            }}
          />
        )}
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        title={editing ? `编辑干系人 · ${editing.name}` : '新增干系人'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleOk()}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="org" label="单位名称">
              <Input placeholder="选择或输入" />
            </Form.Item>
            <Form.Item name="sub_pos" label="角色分类">
              <Input placeholder="决策层/管理层/使用方…" />
            </Form.Item>
            <Form.Item
              name="name"
              label="干系人姓名"
              rules={[{ required: true, message: '请输入姓名' }]}
            >
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
              <Select
                options={['P0', 'P1', 'P2'].map(v => ({
                  value: v,
                  label: `${v} ${v === 'P0' ? '重点管理' : v === 'P1' ? '重点关注' : '一般跟进'}`,
                }))}
              />
            </Form.Item>
            <Form.Item>
              <Button icon={<ThunderboltOutlined />} onClick={handleAutoScore}>
                自动建议优先级
              </Button>
              {autoHint ? (
                <div style={{ fontSize: 11, color: '#1e8449', marginTop: 4 }}>{autoHint}</div>
              ) : null}
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
          <div
            style={{
              borderTop: '1px solid #d9e2ea',
              paddingTop: 10,
              marginTop: 8,
              fontSize: 12,
              color: '#6b7c8c',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            参与程度标记（C=当前 D=期望）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 10 }}>
            {ATT_KEYS.map(k => (
              <div key={k}>
                <div style={{ fontSize: 11, color: '#6b7c8c', marginBottom: 4 }}>
                  {ATT_NAMES[k]}
                </div>
                <Select
                  value={attrs[k] || undefined}
                  allowClear
                  placeholder="—"
                  style={{ width: '100%' }}
                  onChange={v => setAttrs(prev => ({ ...prev, [k]: v || '' }))}
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

      {/* 批量设置弹窗：影响度 / 关注度 / 优先级，留空保持不变 */}
      <Modal
        title={`批量设置（已选 ${selectedKeys.length} 人）`}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={() => void handleBatchOk()}
        confirmLoading={batchSaving}
        okText="应用"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          将对选中的 {selectedKeys.length} 位干系人逐条更新；留空的字段保持原值不变。
        </Typography.Paragraph>
        <Form form={batchForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="influence" label="影响力(1-5)">
              <InputNumber min={1} max={5} placeholder="不修改" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="interest" label="关注度(1-5)">
              <InputNumber min={1} max={5} placeholder="不修改" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="priority" label="优先级">
            <Select
              allowClear
              placeholder="不修改"
              options={['P0', 'P1', 'P2'].map(v => ({
                value: v,
                label: `${v} ${v === 'P0' ? '重点管理' : v === 'P1' ? '重点关注' : '一般跟进'}`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 沟通历史 */}
      <Drawer
        title={commOpen ? `沟通历史 · ${commOpen.name}` : ''}
        open={!!commOpen}
        onClose={() => setCommOpen(null)}
        width={640}
      >
        <Table<CommunicationItem>
          rowKey="id"
          size="small"
          dataSource={comms}
          pagination={false}
          columns={commColumns}
        />
        <Form form={commForm} layout="vertical" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="comm_date" label="沟通日期（默认今天）">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="channel" label="渠道">
              <Select
                allowClear
                options={['电话', '微信', '邮件', '会议', '现场'].map(v => ({
                  value: v,
                  label: v,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="content"
            label="沟通内容"
            rules={[{ required: true, message: '请输入沟通内容' }]}
          >
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
          <Button type="primary" onClick={() => void handleAddComm()}>
            记录沟通
          </Button>
        </Form>
      </Drawer>
    </div>
  )
}
