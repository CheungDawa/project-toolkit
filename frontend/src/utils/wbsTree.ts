/**
 * WBS 树形结构的公共工具（WbsPage / GanttPage 共用）。
 *
 * 两条设计约束：
 * 1. 入参只用「最小结构约束」描述，**不** import 页面里的业务类型（TaskItem 等）。
 *    否则 utils -> pages 会形成循环依赖，其它页面想复用也得先继承那个类型。
 * 2. 这里全是纯函数：不修改入参、不读全局状态、不产生副作用。
 *
 * 复杂度约定见各函数注释；`descendantRange` 单次调用是 O(子树)，但同一
 * childrenMap 上连续调用多次时靠内部缓存摊薄为整体 O(n)，见「为什么带缓存」。
 */

/** 树节点最小结构约束：只需要 id 与指向父节点的 parent_id（null = 顶级） */
export interface WbsTreeNodeLike {
  readonly id: string
  readonly parent_id?: string | null
}

/** 带计划日期的树节点：descendantRange / buildDescendantRanges 需要读计划起止 */
export interface WbsRangeNode extends WbsTreeNodeLike {
  readonly plan_start?: string | null
  readonly plan_end?: string | null
}

/** 计划区间聚合结果：无有效日期时两端都为 null */
export interface WbsRange {
  start: string | null
  end: string | null
}

/** 后代聚合结果：计划区间 + 后代叶子数（叶子 = 自身没有子节点的节点，不含节点自身） */
export interface WbsDescendantRange extends WbsRange {
  leafCount: number
}

/** 每次新建空累加器：聚合过程中会被就地写入，不能共享同一个对象 */
function emptyRange(): WbsDescendantRange {
  return { start: null, end: null, leafCount: 0 }
}

/** 把 source 的区间并入 target（就地修改 target；source 缺字段时跳过） */
function mergeInto(target: WbsDescendantRange, source: WbsRange | null | undefined): void {
  if (!source) return
  if (source.start && (!target.start || source.start < target.start)) target.start = source.start
  if (source.end && (!target.end || source.end > target.end)) target.end = source.end
}

/** 节点自身的计划区间（不含后代） */
function ownRange(node: WbsRangeNode): WbsRange {
  return { start: node.plan_start ?? null, end: node.plan_end ?? null }
}

/**
 * 构建 parent_id -> 直接子任务 的索引（key 为 null 表示顶级任务）。
 *
 * parent_id 为 undefined 时归一为 null（当作顶级任务），保证 key 只有 string | null 两种，
 * 调用方不必再处理 undefined 分支。
 *
 * 复杂度 O(n)，一次遍历。
 */
export function buildChildrenMap<T extends WbsTreeNodeLike>(
  items: readonly T[],
): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>()
  for (const item of items) {
    const key = item.parent_id ?? null
    const list = map.get(key)
    if (list) {
      // 直接 push 到已有数组：旧实现用 [...(map.get(key) ?? []), item] 会在每个节点上
      // 复制整个数组，n 个同级节点就是 O(n²) 次拷贝。
      list.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

/**
 * 一次后序遍历算出「每个节点的全部后代」的聚合区间（含所有层级，不含节点自身）。
 *
 * 实现要点：
 * - 显式栈 + 状态机（visiting/done），不用递归 —— WBS 层级再深也不会爆调用栈；
 * - 每个节点只出栈一次，子节点的结果算完就并入父节点，整体 O(n)（n = 节点数）；
 * - 数据里有环（A 是 B 的父、B 又是 A 的父）时跳过回边，不会死循环。
 *
 * 旧实现是「对每个父节点各跑一次后代遍历」，深度大 / 父节点多时退化成 O(n²)，
 * 这正是 WbsPage 汇总区间与 GanttPage 汇总条卡顿的来源。
 */
export function buildDescendantRanges<T extends WbsRangeNode>(
  childrenMap: Map<string | null, T[]>,
): Map<string, WbsDescendantRange> {
  const result = new Map<string, WbsDescendantRange>()
  const state = new Map<string, 'visiting' | 'done'>()

  /** 遍历栈帧：kids 为该节点的直接子节点，index 为待处理下标，acc 为已并入的后代聚合 */
  interface Frame {
    id: string
    kids: readonly T[]
    index: number
    acc: WbsDescendantRange
  }

  // childrenMap 里每个节点恰好作为某一个 key 的子项出现一次，故这些就是全部节点
  const allNodes: T[] = []
  for (const list of childrenMap.values()) {
    for (const node of list) allNodes.push(node)
  }

  for (const root of allNodes) {
    if (state.has(root.id)) continue
    state.set(root.id, 'visiting')
    const stack: Frame[] = [
      { id: root.id, kids: childrenMap.get(root.id) ?? [], index: 0, acc: emptyRange() },
    ]

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame.index < frame.kids.length) {
        const kid = frame.kids[frame.index]
        const kidState = state.get(kid.id)

        // 环：kid 还在当前 DFS 路径上，跳过这条边，避免无限递归
        if (kidState === 'visiting') {
          frame.index += 1
          continue
        }
        // 未处理过：先下去把 kid 的后代算完。注意此处 **不推进 index**，
        // 等 kid 变成 done 后再回到同一支做合并。
        if (kidState !== 'done') {
          state.set(kid.id, 'visiting')
          stack.push({
            id: kid.id,
            kids: childrenMap.get(kid.id) ?? [],
            index: 0,
            acc: emptyRange(),
          })
          continue
        }

        // kid 已算完：把「kid 自身的计划日期」与「kid 的后代聚合」一起并入当前节点
        frame.index += 1
        mergeInto(frame.acc, ownRange(kid))
        const kidAgg = result.get(kid.id)
        if (kidAgg) {
          mergeInto(frame.acc, kidAgg)
          frame.acc.leafCount += kidAgg.leafCount
        }
        // kid 自己没有子节点 -> 它本身就是一个叶子
        if ((childrenMap.get(kid.id)?.length ?? 0) === 0) frame.acc.leafCount += 1
        continue
      }

      stack.pop()
      state.set(frame.id, 'done')
      result.set(frame.id, frame.acc)
    }
  }

  return result
}

/**
 * 同一份 childrenMap 上的聚合结果缓存。
 *
 * 为什么带缓存：调用方（WbsPage 汇总区间、GanttPage 汇总条）都是「建一次 map，
 * 然后对所有父节点各调一次 descendantRange」，逐次重算就是 O(n²)。缓存后整轮
 * 只做一次 O(n) 后序遍历，其余都是 Map 查询。
 *
 * 前置条件：childrenMap 构建后**不得再增删**（重建一个新 Map 才会拿到新缓存）。
 * 现有调用点都在 useMemo 里现建现用，满足该前提。
 */
const descendantRangeCache = new WeakMap<object, Map<string, WbsDescendantRange>>()

/**
 * 汇总某节点全部后代（含所有层级）的计划区间：最小 plan_start ~ 最大 plan_end。
 *
 * 语义与抽取前逐字等价：只统计后代，不含节点自身；后代都没排期时返回 {start:null,end:null}。
 * 同一 childrenMap 上多次调用整体 O(n)，首次调用为一次 O(n) 后序遍历。
 */
export function descendantRange<T extends WbsRangeNode>(
  parentId: string,
  childrenMap: Map<string | null, T[]>,
): WbsRange {
  let all = descendantRangeCache.get(childrenMap)
  if (!all) {
    all = buildDescendantRanges(childrenMap)
    descendantRangeCache.set(childrenMap, all)
  }
  const hit = all.get(parentId)
  return { start: hit?.start ?? null, end: hit?.end ?? null }
}

/**
 * WBS 编码比较器：'1.10' 应排在 '1.2' 之后，字符串比较会得出相反结果。
 * 逐段转数字比元组；非数字段用 1e6 兜底（与后端 app/services/wbs.py::wbs_sort_key 同口径）。
 *
 * 从 GanttPage 原样搬出（WbsPage 侧无等价实现，按 sort_order + created_at 排序）。
 */
export function compareWbsCode(a: string, b: string): number {
  const toKey = (code: string): number[] =>
    code.split('.').map(part => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 1e6
    })
  const left = toKey(a)
  const right = toKey(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
