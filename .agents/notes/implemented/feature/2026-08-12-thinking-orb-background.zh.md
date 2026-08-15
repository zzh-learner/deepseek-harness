# Agent Note：思考球体背景 —— session-projection 接缝与 ui-orbs 固化移植

Status: implemented

[English](2026-08-12-thinking-orb-background.md) | 中文

范围：`packages/session/orb-state`、`packages/client/ui-orbs`、web-app bundle 行。

## Problem

思考球体背景 —— orbs.jakubantalik.com（thinking-orbs）游乐场的持久化 Web 界面特性 —— 此前只存在于会话级动态插件（`orbs-1`）：其状态感知依赖页面轮询的宿主侧 RPC，进程重启即消失，也没有分享到其他机器的路径。固化它意味着找到能在重启后存活的组合接缝（web-app bundle 行），并用固化客户端无需新增线协议即可自有的事实，替换插件的临时感知方案。

## Decision

以两个包固化进 web-app bundle：

- `dsh-orb-state` 注册 `orbActivity` 会话投影单元：对持久日志的纯折叠，提供在途工具名（`tool/call` 减去配对的 `tool/result`，`turn/end` 清扫）、开放步骤的流式位（块置位，组装消息或 `step/end` 复位）、以及回合结局（`completed`→settle、`error`→error、单调 `outcomeSeq`）。
- `dsh-client-ui-orbs` 通过 `shell.overlay` 列表项（`order: -1000`，位于该层 stacking context 之内）渲染居中于对话列的单个主画布，九种源模式 1:1 移植自网站发布包（种子随机、偏航+倾角正交相机、按深度排序的灰度墨点、每模式速度常数）。

## Decisions worth keeping

- **相位映射在客户端、吃两条自有通道。** 组件从会话列表快照（运行位、`pendingInteraction === 'approval'`、运行中谱系计数）加上当前会话经 `SessionSummary.projectionValues` 读到的 `orbActivity` 投影值推导相位 —— 对象层发布这个引用稳定的全值映射，正是为了让全局消费者无需逐会话订阅。没有宿主轮询契约，没有新 Remote。等待审批持住魔方；委派显示丝带；搜索工具显示扫描球；写入显示编织；其他工具显示信号网；流式显示波场；思考显示轨道环；空闲轮换全部九种。
- **折叠里没有时钟。** 结局窗口（settle 1.7s、error 3.2s）归客户端：组件以 `performance.now()` 对 `outcomeSeq` 做边沿触发。这保证持久缓存回放与实时值相等 —— sessionStats 钉住的同一性质 —— 并把所有时序决策移到消费它的动画旁边。
- **几何靠测量而非声明。** 居中从标记的 `data-shell-overlay` 祖先读取布局 frame 的内联 `grid-template-columns`（ui-layout 的 AppFrame 同时写入这两者），按帧节奏 + ResizeObserver 复查。ui-layout 提供 owner 参数才是权威修复；在那之前测量保持特性可加性（README 限制已记录）。
- **引擎里的 `pick`** 对模运算/步进循环的索引读取做断言，而不是重新检查构造器已保证的边界；热循环的清晰优先于调用方无法违反的防御分支。
- **移植出处。** 几何常数与生成器在动态插件会话中从网站压缩的 `ThinkingOrb-*.js` 提取（参数表、相机、每模式生成器）并在移植前经人工视觉验证；动态插件（`orbs-1`，七个包）仍是调参比对的参考实现。

## Consequences

- Web 界面现在常驻一个逐帧 rAF 循环的环境动画；成本以单个球的点数封顶（最大模式约 700 点），并在 `prefers-reduced-motion` 下自降为单帧静态。重历史会话没有额外代价：折叠经投影接缝的持久缓存增量进行。
- 未来想要更丰富活动语义的界面（按工具的动画分类、独立的 max-tokens 结局）应以 `stateVersion` 提升扩展 `orbActivity`，而不是另起平行通道。
- 动态插件谱系（`orbs-1`）对此后每个会话都被本固化形态取代；其角色只剩调参参考。

## Alternatives considered

- **宿主侧相位服务 + 页面轮询**（动态插件的设计）。固化形态拒绝它：它重复客户端已有的事实，给每个页面加轮询契约，而且不挂宿主行就到不了其他组装。投影接缝通过每个页面已在消费的会话列表基础设施送达同样的事实。
- **把相位时序（保持窗口）折进投影。** 拒绝：折叠内的时钟窗口破坏回放与实时值的相等性 —— 持久缓存与 sessionStats 先例钉住的性质。全部时序在客户端，以单调计数器边沿触发。
- **ui-layout 的专属背景槽位。** 推迟：它是真正"内容之下"渲染的结构性修复，但要动固化的布局包；测量 frame 自己的内联网格轨道保持本特性可加（README 限制记录了后续）。

## Invariants and tests

`orb-state` 带注册表驱动的折叠规格（配对、原型名结果、清扫、结局表、回放纯度）与 Loader 组合证明。`ui-orbs` 钉住引擎（有限性、深度排序、确定性、每模式形状事实）、相位真值表与优先级、针对 frame 轨道格式的列测量（含一切未识别 shell 的 null）、以及组件（画布尺寸、经桩 2D 上下文的逐帧墨迹、固定时钟下的结局氛围边沿、减弱运动单帧、apply 注册）。
