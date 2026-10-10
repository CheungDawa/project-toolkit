import { App, Card, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { listSettings } from '../api/settings'
import type { Setting } from '../api/settings'

export default function SettingsPage() {
  const { message } = App.useApp()
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setSettings(await listSettings())
      } catch (err) {
        message.error(err instanceof Error ? err.message : '加载设置失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [message])

  return (
    <div>
      <Card title="系统设置">
        <Typography.Paragraph type="secondary">
          基础参数存储在 app_settings 表中。AI 模型配置将在阶段 4 启用，工作日历/风险评分规则分别在阶段 2、3 启用。
        </Typography.Paragraph>
        <Table<Setting>
          rowKey="key"
          loading={loading}
          dataSource={settings}
          pagination={false}
          columns={[
            { title: '配置键', dataIndex: 'key', width: 260, render: (v: string) => <code>{v}</code> },
            {
              title: '当前值',
              dataIndex: 'value',
              render: (v: unknown) => (
                <Typography.Text code>
                  {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '(未配置)')}
                </Typography.Text>
              ),
            },
            { title: '说明', dataIndex: 'description', render: (v: string | null) => v ?? '-' },
            { title: '更新时间', dataIndex: 'updated_at', width: 180, render: (v: string) => v.slice(0, 19).replace('T', ' ') },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          <Tag color="blue">阶段 1 骨架</Tag>
          编辑功能随各阶段配置项落地逐步开放；密钥类配置仅存服务端，不回显。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}