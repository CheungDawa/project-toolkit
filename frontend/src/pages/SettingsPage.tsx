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
        const all = await listSettings()
        // AI 模块已移除：model.default 配置已无效，不再展示
        setSettings(all.filter((s) => s.key !== 'model.default'))
      } catch (err) {
        message.error(err instanceof Error ? err.message : '加载设置失败')
      } finally {
        setLoading(false)
      }
    })
  }, [message])

  return (
    <div>
      <Card title="系统设置">
        <Typography.Paragraph type="secondary">
          基础参数存储在 app_settings 表中。工作日历（阶段 2）与风险评分规则（阶段 3）已启用，可直接调整阈值。
        </Typography.Paragraph>
        <Table<Setting>
          rowKey="key"
          loading={loading}
          dataSource={settings}
          pagination={false}
          columns={[
            { title: '配置键', dataIndex: 'key', width: 260, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
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
          <Tag color="blue">提示</Tag>
          模型/AI 模块已按用户决策移除；如需重启用可从 git 历史（迁移 0009 之前）恢复。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}