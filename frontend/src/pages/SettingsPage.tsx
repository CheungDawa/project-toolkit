import { App, Button, Card, Form, Input, InputNumber, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { getAiStatus, testModelConnection, updateModelConfig } from '../api/ai'
import { listSettings } from '../api/settings'
import type { Setting } from '../api/settings'

export default function SettingsPage() {
  const { message } = App.useApp()
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; config: Record<string, unknown> | null }>({ configured: false, config: null })
  const [testing, setTesting] = useState(false)
  const [aiForm] = Form.useForm()

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setSettings(await listSettings())
        setAiStatus(await getAiStatus())
      } catch (err) {
        message.error(err instanceof Error ? err.message : '加载设置失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [message])

  const handleSaveAi = async () => {
    const values = await aiForm.validateFields()
    try {
      await updateModelConfig({
        provider: 'openai',
        base_url: values.base_url,
        model: values.model,
        api_key: values.api_key ?? '',
        timeout: values.timeout ?? 60,
        enabled: true,
      })
      message.success('模型配置已保存')
      setAiStatus(await getAiStatus())
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleTest = async () => {
    const values = await aiForm.validateFields()
    setTesting(true)
    try {
      await testModelConnection({
        base_url: values.base_url,
        model: values.model,
        api_key: values.api_key ?? '',
        timeout: values.timeout ?? 30,
      })
      message.success('连接成功')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '连接失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <Card title="AI 模型配置" style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary">
          <Tag color={aiStatus.configured ? 'green' : 'orange'}>
            {aiStatus.configured ? '已配置' : '未配置'}
          </Tag>
          兼容 OpenAI API 格式；密钥仅存服务端，不会回显（NFR-05）。未配置时其余功能不受影响。
          {aiStatus.config ? ` 当前模型：${String(aiStatus.config.model)}（${String(aiStatus.config.api_key_masked)}）` : ''}
        </Typography.Paragraph>
        <Form form={aiForm} layout="vertical" style={{ maxWidth: 560 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Form.Item name="base_url" label="API Base URL" rules={[{ required: true, message: '请输入 Base URL' }]}>
              <Input placeholder="https://api.example.com/v1" />
            </Form.Item>
            <Form.Item name="model" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
              <Input placeholder="如 gpt-4o-mini / deepseek-chat" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <Form.Item name="api_key" label="API 密钥（新配置时填写；留空表示不修改）">
                <Input.Password placeholder="sk-..." autoComplete="off" />
              </Form.Item>
              <Form.Item name="timeout" label="超时(秒)" initialValue={60}>
                <InputNumber min={5} max={600} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Space>
              <Button type="primary" onClick={() => void handleSaveAi()}>保存配置</Button>
              <Button onClick={() => void handleTest()} loading={testing}>连接测试</Button>
            </Space>
          </Space>
        </Form>
      </Card>

      <Card title="系统设置">
        <Typography.Paragraph type="secondary">
          基础参数存储在 app_settings 表中。工作日历/风险评分规则分别在阶段 2、3 已启用。
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