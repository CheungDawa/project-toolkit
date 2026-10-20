import { DatePicker, Form, Input, InputNumber, Modal, Select, Tag } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useEffect } from 'react'

import type { TaskItem, TaskPayload } from '../api/stage2'
import { STATUS_OPTIONS } from './ProjectFormModal'

interface TaskFormModalProps {
  open: boolean
  task: TaskItem | null
  parent: TaskItem | null
  onCancel: () => void
  onSubmit: (payload: TaskPayload) => Promise<void>
}

interface FormValues {
  name: string
  owner?: string
  collaborators?: string[]
  status?: string
  priority?: string
  plan?: [Dayjs, Dayjs] | null
  actual?: [Dayjs, Dayjs] | null
  work_hours?: number
  progress?: number
  acceptance_criteria?: string
  deliverable_name?: string
}

export default function TaskFormModal({
  open,
  task,
  parent,
  onCancel,
  onSubmit,
}: TaskFormModalProps) {
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (open) {
      form.setFieldsValue(
        task
          ? {
              name: task.name,
              owner: task.owner ?? undefined,
              collaborators: task.collaborators,
              status: task.status,
              priority: task.priority ?? undefined,
              plan:
                task.plan_start && task.plan_end
                  ? [dayjs(task.plan_start), dayjs(task.plan_end)]
                  : undefined,
              actual:
                task.actual_start && task.actual_end
                  ? [dayjs(task.actual_start), dayjs(task.actual_end)]
                  : undefined,
              work_hours: task.work_hours ?? undefined,
              progress: task.progress,
              acceptance_criteria: task.acceptance_criteria ?? undefined,
              deliverable_name: task.deliverable_name ?? undefined,
            }
          : {
              name: '',
              status: '未开始',
              progress: 0,
              collaborators: [],
            },
      )
    }
  }, [open, task, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    const payload: TaskPayload = {
      name: values.name,
      owner: values.owner ?? null,
      collaborators: values.collaborators ?? [],
      status: values.status ?? '未开始',
      priority: values.priority ?? null,
      plan_start: values.plan?.[0]?.format('YYYY-MM-DD') ?? null,
      plan_end: values.plan?.[1]?.format('YYYY-MM-DD') ?? null,
      actual_start: values.actual?.[0]?.format('YYYY-MM-DD') ?? null,
      actual_end: values.actual?.[1]?.format('YYYY-MM-DD') ?? null,
      work_hours: values.work_hours ?? null,
      progress: values.progress ?? 0,
      acceptance_criteria: values.acceptance_criteria ?? null,
      deliverable_name: values.deliverable_name ?? null,
    }
    if (!task) {
      payload.parent_id = parent?.id ?? null
    }
    await onSubmit(payload)
  }

  const title = task
    ? `编辑任务 · ${task.wbs_code} ${task.name}`
    : parent
      ? `新增子任务 · 父任务 ${parent.wbs_code} ${parent.name}`
      : '新建顶级任务'

  return (
    <Modal title={title} open={open} onCancel={onCancel} onOk={handleOk} width={640} destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="任务名称" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={STATUS_OPTIONS.map(v => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select
              allowClear
              options={[
                { value: '高', label: <Tag color="red">高</Tag> },
                { value: '中', label: <Tag color="orange">中</Tag> },
                { value: '低', label: <Tag color="green">低</Tag> },
              ]}
            />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="owner" label="负责人">
            <Input placeholder="负责人" />
          </Form.Item>
          <Form.Item name="collaborators" label="协作人员">
            <Select mode="tags" placeholder="输入后回车添加" open={false} suffixIcon={null} />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Form.Item name="plan" label="计划起止日期">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="work_hours" label="工时（汇总权重）">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="小时" />
          </Form.Item>
          <Form.Item name="progress" label="进度 %">
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="actual" label="实际起止日期">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="deliverable_name" label="交付物">
            <Input placeholder="本任务交付物说明" />
          </Form.Item>
        </div>
        <Form.Item name="acceptance_criteria" label="验收标准">
          <Input.TextArea rows={3} placeholder="任务验收标准" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
