import * as echarts from 'echarts'
import { useEffect, useRef } from 'react'

import type { RiskItem } from '../api/stage3'

interface RiskMatrixChartProps {
  risks: RiskItem[]
}

const LEVEL_COLORS: Record<string, string> = {
  低: '#52c41a',
  中: '#faad14',
  高: '#f5222d',
}

export default function RiskMatrixChart({ risks }: RiskMatrixChartProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const chart = echarts.init(container)

    // 概率×影响 5×5 网格 → 分数（低/中/高）
    const cells: [number, number, number][] = []
    for (let p = 1; p <= 5; p += 1) {
      for (let i = 1; i <= 5; i += 1) {
        const score = p * i
        cells.push([i - 1, p - 1, score <= 4 ? 1 : score <= 9 ? 2 : 3])
      }
    }
    // 现有风险点位
    const marks: { value: [number, number]; itemStyle: { color: string } }[] = risks
      .filter((r) => !r.description.startsWith('[已转'))
      .map((r) => ({
        value: [r.impact - 1, r.probability - 1],
        itemStyle: { color: LEVEL_COLORS[r.level ?? '中'] ?? '#1668dc' },
      }))

    chart.setOption({
      tooltip: {
        formatter: (params: { data?: { value?: [number, number, number] | number[] } }) => {
          if (params.data && Array.isArray(params.data.value)) {
            const [x, y, lv] = params.data.value as [number, number, number]
            const label = lv === 1 ? '低' : lv === 2 ? '中' : '高'
            return `影响 ${x + 1} · 概率 ${y + 1}<br/>等级：<b>${label}</b>`
          }
          return ''
        },
      },
      grid: { left: 60, top: 30, right: 20, bottom: 40 },
      xAxis: { type: 'category', name: '影响', data: ['1', '2', '3', '4', '5'] },
      yAxis: { type: 'category', name: '概率', data: ['5', '4', '3', '2', '1'] },
      visualMap: {
        min: 1,
        max: 3,
        show: false,
        inRange: { color: ['#d9f7be', '#fff1b8', '#ffccc7'] },
      },
      series: [
        { type: 'heatmap', data: cells, label: { show: false } },
        { type: 'scatter', data: marks, symbolSize: 14, emphasis: { scale: 1.6 } },
      ],
    })

    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [risks])

  return <div ref={ref} style={{ width: '100%', height: 320 }} />
}