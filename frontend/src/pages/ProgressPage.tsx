import { CameraOutlined } from '@ant-design/icons'
import * as echarts from 'echarts'
import { App, Button, Card, Empty, Segmented, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { BurndownResponse, SnapshotItem } from '../api/stage5'
import { burndown, captureSnapshot, listSnapshots } from '../api/stage5'

export default function ProgressPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()
  const [data, setData] = useState<BurndownResponse | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [metric, setMetric] = useState<'tasks' | 'hours'>('tasks')
  const [loading, setLoading] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setData(await burndown(projectId))
      setSnapshots(await listSnapshots(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载燃尽数据失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const container = chartRef.current
    if (!container || !data) return
    const chart = echarts.init(container)
    const points = data.snapshots
    const series: Record<string, unknown>[] = []
    if (metric === 'tasks') {
      series.push(
        {
          name: '实际剩余任务数',
          type: 'line',
          data: points.map((p) => [p.date, p.remaining_tasks]),
          symbol: 'circle',
          lineStyle: { width: 2 },
        },
        {
          name: '理想曲线（任务）',
          type: 'line',
          data: data.ideal.map((p) => [p.date, p.remaining_tasks]),
          lineStyle: { type: 'dashed', opacity: 0.6 },
          symbol: 'none',
        },
      )
    } else {
      series.push(
        {
          name: '实际剩余工时',
          type: 'line',
          data: points.map((p) => [p.date, p.remaining_hours]),
          symbol: 'circle',
          lineStyle: { width: 2 },
        },
        {
          name: '理想曲线（工时）',
          type: 'line',
          data: data.ideal.map((p) => [p.date, p.remaining_hours]),
          lineStyle: { type: 'dashed', opacity: 0.6 },
          symbol: 'none',
        },
      )
    }
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: series.map((s) => String(s.name)) },
      grid: { left: 60, right: 20, top: 40, bottom: 40 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', minInterval: 1 },
      series,
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [data, metric])

  const handleCapture = async () => {
    if (!projectId) return
    try {
      await captureSnapshot(projectId)
      message.success('快照已记录')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '记录失败')
    }
  }

  const isEmpty = !data || data.snapshots.length === 0

  return (
    <div>
      <Card
        title="进度快照与燃尽图"
        extra={
          <Space>
            <Tag color="blue">BR-03</Tag>
            <Typography.Text type="secondary">仅基于真实快照绘制，不生成虚假历史</Typography.Text>
            <Segmented
              value={metric}
              onChange={(v) => setMetric(v as 'tasks' | 'hours')}
              options={[
                { label: '任务数', value: 'tasks' },
                { label: '剩余工时', value: 'hours' },
              ]}
            />
            <Button type="primary" icon={<CameraOutlined />} onClick={() => void handleCapture()} loading={loading}>
              记录今日快照
            </Button>
          </Space>
        }
      >
        {isEmpty ? (
          <Empty description="暂无历史快照：点击「记录今日快照」开始采集；未记录的过去不会生成曲线（BR-03）" />
        ) : (
          <div ref={chartRef} style={{ width: '100%', height: 360 }} />
        )}
        {!isEmpty ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            数据更新时间：{snapshots[snapshots.length - 1]?.captured_at?.slice(0, 16).replace('T', ' ')}
          </Typography.Paragraph>
        ) : null}
      </Card>

      <Card title="快照记录" style={{ marginTop: 16 }}>
        <Table<SnapshotItem>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={snapshots}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '日期', dataIndex: 'snapshot_date', width: 120 },
            { title: '任务总数', dataIndex: 'total_tasks', width: 100 },
            { title: '已完成', dataIndex: 'completed_tasks', width: 90 },
            { title: '剩余任务', dataIndex: 'remaining_tasks', width: 100 },
            { title: '总工时', dataIndex: 'total_hours', width: 90, render: (v: number) => v.toFixed(1) },
            { title: '剩余工时', dataIndex: 'remaining_hours', width: 90, render: (v: number) => v.toFixed(1) },
            { title: '采集时间', dataIndex: 'captured_at', render: (v: string) => v.slice(0, 19).replace('T', ' ') },
          ]}
        />
      </Card>
    </div>
  )
}