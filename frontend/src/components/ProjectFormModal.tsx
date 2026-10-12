import { DatePicker, Form, Input, Modal, Select } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useEffect } from 'react'

import type { Project, ProjectPayload } from '../api/projects'

export const PHASE_OPTIONS = ['立项启动', '规划设计', '实施建设', '测试验收', '运维服务', '已收尾']
export const STATUS_OPTIONS = ['未启动', '进行中', '已完成', '已暂停', '已取消', '已归档']

interface ProjectFormModalProps {
  open: boolean
  project: Project | null
  onCancel: () => void
  onSubmit: (values: ProjectPayload) => Promise<void>
}

interface FormValues {
  code: string
  name: string
  customer?: string
  manager?: string
  phase?: string
  status?: string
  plan?: [Dayjs, Dayjs] | null
  actual?: [Dayjs, Dayjs] | null
  description?: string
}

export default function ProjectFormModal({ open, project, onCancel, onSubmit }: ProjectFormModalProps) {
  const [form] = Form.useForm<FormValues>()

  // 回填修复：antd initialValues 仅在 Form store 首次创建时生效一次，
  // form 实例随组件持久存在，必须用 setFieldsValue 在每次打开时回填/重置
  useEffect(() => {
    if (!open) return
    if (project) {
      form.setFieldsValue({
        code: project.code,
        name: project.name,
        customer: project.customer ?? undefined,
        manager: project.manager ?? undefined,
        phase: project.phase ?? undefined,
        status: project.status ?? undefined,
        plan:
          project.plan_start && project.plan_end
            ? ([dayjs(project.plan_start), dayjs(project.plan_end)] as [Dayjs, Dayjs])
            : undefined,
        actual:
          project.actual_start && project.actual_end
            ? ([dayjs(project.actual_start), dayjs(project.actual_end)] as [Dayjs, Dayjs])
            : undefined,
        description: project.description ?? undefined,
      })
    } else {
      form.resetFields()
    }
  }, [open, project, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    const payload: ProjectPayload = {
      code: values.code,
      name: values.name,
      customer: values.customer ?? null,
      manager: values.manager ?? null,
      phase: values.phase ?? null,
      status: values.status ?? null,
      plan_start: values.plan?.[0]?.format('YYYY-MM-DD') ?? null,
      plan_end: values.plan?.[1]?.format('YYYY-MM-DD') ?? null,
      actual_start: values.actual?.[0]?.format('YYYY-MM-DD') ?? null,
      actual_end: values.actual?.[1]?.format('YYYY-MM-DD') ?? null,
      description: values.description ?? null,
    }
    await onSubmit(payload)
  }

  return (
    <Modal
      title={project ? `编辑项目 · ${project.code}` : '新建项目'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnClose
      width={640}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Form.Item
            name="code"
            label="项目编号"
            rules={[
              { required: true, message: '请输入项目编号' },
              { max: 32, message: '不超过 32 个字符' },
            ]}
          >
            <Input placeholder="如 PT-2026-001" disabled={!!project} />
          </Form.Item>
          <Form.Item
            name="name"
            label="项目名称"
            rules={[
              { required: true, message: '请输入项目名称' },
              { max: 200, message: '不超过 200 个字符' },
            ]}
          >
            <Input placeholder="项目名称" />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Form.Item name="customer" label="客户">
            <Input placeholder="客户单位" />
          </Form.Item>
          <Form.Item name="manager" label="项目经理">
            <Input placeholder="负责人" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select placeholder="选择状态" allowClear options={STATUS_OPTIONS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="phase" label="项目阶段">
            <Select placeholder="选择阶段" allowClear options={PHASE_OPTIONS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="plan" label="计划起止日期">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="actual" label="实际起止日期">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} placeholder="项目描述（后续将作为 AI 生成 WBS 的上下文）" />
        </Form.Item>
      </Form>
    </Modal>
  )
}