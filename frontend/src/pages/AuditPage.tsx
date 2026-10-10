import { App, Card, Select, Space, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { AuditLogItem } from '../api/stage3'
import { listAuditLogs } from '../api/stage3'

const ACTION_TAG: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  archive: 'gold',
  close: 'purple',
  assess: 'cyan',
  convert_from_risk: 'orange',
}

export default function AuditPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [actionFilter, setActionFilter] = useState<string | undefined>()
  const [objectFilter, setObjectFilter] = useState<string | undefined>()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listAuditLogs(projectId, { action: actionFilter, object_type: objectFilter }))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载审计失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, actionFilter, objectFilter, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Select
          placeholder="按操作类型"
          allowClear
          style={{ width: 160 }}
          options={['create', 'update', 'delete', 'archive', 'close', 'assess', 'convert_from_risk'].map((v) => ({ value: v, label: v }))}
          onChange={setActionFilter}
        />
        <Select
          placeholder="按对象类型"
          allowClear
          style={{ width: 160 }}
          options={['project', 'task', 'risk', 'issue', 'change', 'dependency', 'baseline'].map((v) => ({ value: v, label: v }))}
          onChange={setObjectFilter}
        />
      </Space>
      <Table<AuditLogItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={{ pageSize: 50 }}
        size="small"
        scroll={{ x: 1000 }}
        columns={[
          { title: '时间', dataIndex: 'occurred_at', width: 170, render: (v: string) => v.slice(0, 19).replace('T', ' ') },
          { title: '对象', dataIndex: 'object_type', width: 110, render: (v: string) => <Tag>{v}</Tag> },
          {
            title: '操作',
            dataIndex: 'action',
            width: 140,
            render: (v: string) => <Tag color={ACTION_TAG[v] ?? 'default'}>{v}</Tag>,
          },
          { title: '摘要', dataIndex: 'summary' },
          { title: '操作人', dataIndex: 'operator', width: 100 },
        ]}
      />
    </div>
  )
}