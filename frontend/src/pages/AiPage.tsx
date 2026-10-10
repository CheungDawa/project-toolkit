import {
  BulbOutlined,
  FileTextOutlined,
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { AiMessage, AiProposal } from '../api/ai'
import {
  acceptProposal,
  askAi,
  listProposals,
  rejectProposal,
  riskAdvice,
  scheduleCheck,
  weeklyReport,
  wbsDraft,
} from '../api/ai'

export default function AiPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposals, setProposals] = useState<AiProposal[]>([])
  const [acceptOpen, setAcceptOpen] = useState<AiProposal | null>(null)

  const fetchProposals = useCallback(async () => {
    try {
      setProposals(await listProposals(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载建议失败')
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchProposals()
  }, [fetchProposals])

  const appendAssistant = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: 'assistant', content, call_status: 'succeeded' } as AiMessage,
    ])
  }

  const runCapability = async (capability: string) => {
    if (!projectId) return
    setBusy(true)
    try {
      if (capability === 'wbs') {
        await wbsDraft(projectId)
        message.success('已生成 WBS 初稿建议，请到下方建议中心确认')
        await fetchProposals()
      } else if (capability === 'schedule') {
        const r = await scheduleCheck(projectId)
        appendAssistant(r.content)
      } else if (capability === 'risk') {
        const r = await riskAdvice(projectId)
        appendAssistant(r.content)
      } else if (capability === 'report') {
        const r = await weeklyReport(projectId)
        appendAssistant(`${r.meta}\n\n${r.content}`)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '调用失败')
    } finally {
      setBusy(false)
    }
  }

  const askQuestion = async () => {
    const content = input.trim()
    if (!content || !projectId) return
    setBusy(true)
    try {
      const r = await askAi(projectId, content)
      setMessages((prev) => [
        ...prev,
        { id: `q-${Date.now()}`, role: 'user', content, call_status: 'succeeded' } as AiMessage,
        { id: `a-${Date.now()}`, role: 'assistant', content: r.content, call_status: 'succeeded' } as AiMessage,
      ])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '调用失败')
    } finally {
      setBusy(false)
      setInput('')
    }
  }

  const handleAccept = async () => {
    if (!acceptOpen) return
    try {
      await acceptProposal(acceptOpen.id, true)
      message.success('建议已应用并写入业务数据')
      setAcceptOpen(null)
      await fetchProposals()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '应用失败')
    }
  }

  const handleReject = async (proposal: AiProposal) => {
    try {
      await rejectProposal(proposal.id)
      message.success('建议已拒绝')
      await fetchProposals()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  return (
    <div>
      <Card
        title="AI 工作台"
        extra={
          <Space wrap>
            <Button icon={<BulbOutlined />} onClick={() => void runCapability('wbs')} loading={busy}>
              WBS 初稿
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void runCapability('schedule')} loading={busy}>
              工期/依赖检查
            </Button>
            <Button icon={<WarningOutlined />} onClick={() => void runCapability('risk')} loading={busy}>
              风险建议
            </Button>
            <Button icon={<FileTextOutlined />} onClick={() => void runCapability('report')} loading={busy}>
              周报初稿
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">
          <Tag color="blue">BR-05</Tag>
          AI 生成内容先进「建议中心」待确认，确认前不写任何业务数据；密钥仅存服务端（NFR-05）。
        </Typography.Paragraph>

        <Collapse
          defaultActiveKey={['qa']}
          items={[
            {
              key: 'qa',
              label: (
                <Space>
                  <MessageOutlined /> 项目管理问答（引用当前项目真实字段）
                </Space>
              ),
              children: (
                <div>
                  <div style={{ minHeight: 140, maxHeight: 320, overflow: 'auto', background: '#fafafa', padding: 12, borderRadius: 8 }}>
                    {messages.length === 0 ? (
                      <Empty description="暂无对话。使用上方能力按钮，或在下方提问。" />
                    ) : (
                      <List
                        size="small"
                        dataSource={messages}
                        renderItem={(m) => (
                          <List.Item>
                            <div style={{ width: '100%' }}>
                              <Tag color={m.role === 'user' ? 'blue' : 'green'}>{m.role === 'user' ? '我' : 'AI'}</Tag>
                              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.content || m.error_message}</Typography.Paragraph>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </div>
                  <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                    <Input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onPressEnter={() => void askQuestion()}
                      placeholder="针对当前项目提问…"
                      disabled={busy}
                    />
                    <Button type="primary" icon={<SendOutlined />} onClick={() => void askQuestion()} loading={busy}>
                      提问
                    </Button>
                  </Space.Compact>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card title="建议中心（AI 产物 → 人工确认 → 业务数据）" style={{ marginTop: 16 }}>
        <Spin spinning={busy}>
          {proposals.length === 0 ? (
            <Empty description="暂无待确认建议：使用「WBS 初稿」等能力生成" />
          ) : (
            <Table<AiProposal>
              rowKey="id"
              size="small"
              dataSource={proposals}
              pagination={false}
              columns={[
                { title: '类型', dataIndex: 'action_type', width: 150, render: (v: string) => <Tag color="purple">{v}</Tag> },
                {
                  title: '差异预览',
                  key: 'diff',
                  render: (_: unknown, r) => {
                    const adds = (r.diff_preview?.add as unknown[] | undefined)?.length ?? 0
                    const mods = (r.diff_preview?.modify as unknown[] | undefined)?.length ?? 0
                    const dels = (r.diff_preview?.delete as unknown[] | undefined)?.length ?? 0
                    return (
                      <Space size={4}>
                        <Tag color="green">新增 {adds}</Tag>
                        {mods > 0 && <Tag color="orange">修改 {mods}</Tag>}
                        {dels > 0 && <Tag color="red">删除 {dels}</Tag>}
                      </Space>
                    )
                  },
                },
                { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={v === 'pending' ? 'gold' : v === 'accepted' ? 'green' : 'default'}>{v}</Tag> },
                { title: '时间', dataIndex: 'created_at', width: 170, render: (v: string) => v.slice(0, 16).replace('T', ' ') },
                {
                  title: '操作',
                  key: 'actions',
                  width: 160,
                  render: (_: unknown, r) =>
                    r.status === 'pending' ? (
                      <Space size="small">
                        <Button size="small" type="primary" onClick={() => setAcceptOpen(r)}>确认应用</Button>
                        <Popconfirm title="确认拒绝该建议？" onConfirm={() => void handleReject(r)}>
                          <Button size="small" danger>拒绝</Button>
                        </Popconfirm>
                      </Space>
                    ) : (
                      <Tag color={r.status === 'accepted' ? 'green' : 'default'}>{r.status}</Tag>
                    ),
                },
              ]}
            />
          )}
        </Spin>
      </Card>

      <Modal
        title="确认应用 AI 建议？"
        open={!!acceptOpen}
        onCancel={() => setAcceptOpen(null)}
        onOk={() => void handleAccept()}
        okText="确认写入业务数据"
        cancelText="返回"
      >
        {acceptOpen?.diff_preview ? (
          <div>
            <Typography.Paragraph>
              将按差异预览写入：新增 <b>{acceptOpen.diff_preview.add?.length ?? 0}</b> 项
              {acceptOpen.diff_preview.modify?.length ? `、修改 ${acceptOpen.diff_preview.modify.length} 项` : ''}
              {acceptOpen.diff_preview.delete?.length ? `、删除 ${acceptOpen.diff_preview.delete.length} 项` : ''}
              。此操作会修改项目业务数据（BR-05）。
            </Typography.Paragraph>
            <List
              size="small"
              bordered
              dataSource={acceptOpen.diff_preview.add as unknown[]}
              renderItem={(item) => (
                <List.Item>
                  <Typography.Text code>{String((item as { wbs?: string }).wbs ?? '-')}</Typography.Text>{' '}
                  {String((item as { name?: string }).name ?? '')}
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}