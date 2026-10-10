import { DownloadOutlined } from '@ant-design/icons'
import { App, Button, Card, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { reportExportUrl, weeklyText } from '../api/stage5'

export default function ReportsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()
  const [weekly, setWeekly] = useState<{ meta: string; content: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchWeekly = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setWeekly(await weeklyText(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成周报失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchWeekly()
  }, [fetchWeekly])

  return (
    <div>
      <Card
        title="报告中心"
        extra={
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => window.open(reportExportUrl(projectId!, 'weekly'))}>
              导出周报 Word
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => window.open(reportExportUrl(projectId!, 'final'))}>
              导出收尾报告 Word
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">
          <Tag color="blue">TD-03</Tag>
          Word 导出基于真实数据库字段（python-docx 模板字段映射）；周报正文含统计截止日期、数据来源、生成时间。
        </Typography.Paragraph>

        <Card size="small" title="周报预览（真实数据聚合）" loading={loading}>
          {weekly ? (
            <>
              <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                {weekly.meta}
              </Typography.Paragraph>
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{weekly.content}</Typography.Paragraph>
            </>
          ) : (
            <Typography.Text type="secondary">生成中…</Typography.Text>
          )}
        </Card>
      </Card>
    </div>
  )
}