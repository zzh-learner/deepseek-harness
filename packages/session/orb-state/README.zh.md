# @deepseek-ai/dsh-orb-state

[English](README.md) | 中文

函数插件，注册 `orbActivity` 投影单元：为思考球体背景提供会话的实时活动状态 —— 在途工具名、开放步骤的流式位、以及值得单独呈现的回合结局 —— 从步骤边界、流式块、工具配对与回合结束事件折叠而来，经 session-projection 接缝（注册表快照、变更推送、所有投影载体）提供服务。参考消费者是 Web 的 `ui-orbs` 背景：它把该值与会话列表事实（运行位、待决交互、谱系）合并为动画状态。折叠本身不携带时钟，因此缓存回放重现与实时完全一致的值。

## 折叠语义

- `openTools` 按调用顺序列出尚未落地 `tool/result` 的 `tool/call` 工具名；结果按 callId 配对并做自有键检查（callId 是模型生成的 JSON，未记录调用上的原型属性名视为不匹配）。`turn/end` 清扫被取消或失败回合遗留的全部在途状态 —— 结果总在其回合内落地。
- `streaming` 是开放步骤的块标志：属于该步骤的任意 `assistant/chunk` 置位，其组装完成的 `assistant/message` 复位（步骤继续执行其中的工具调用），`step/end` 亦复位。来自其他步骤或已关闭步骤的块被忽略。
- `outcome` 记录值得动画的 `turn/end` 结局：`completed` → `settle`，`error`（结构化 `LlmFailure`）→ `error`；aborted、blocked、max-tokens 与崩溃关闭的回合记为 null。`outcomeSeq` 单调计数非空结局，客户端以计数边沿触发动画而无需比较负载。
- 每个字段都由事件推导；客户端基于自身时钟掌控全部时序（结局窗口、流式新鲜度）。

## 组合

```yaml
- id: orb-state
  name: '@deepseek-ai/dsh-orb-state'
```

注入 `sessionProjections` —— 这是插件的全部职责；缺少注册表的组装中 fiber 保持等待，不注册任何键。

## Model Experience

无。插件只对已记录的会话事件计算面向客户端的读模型，不触及任何提示词、消息、schema、流或工具结果。

#### KV Cache effect

无；插件从不组装或发送提供商请求。

## Known Limitations and Deferred Work

- **在途状态按日志而非按窗口** —— `openTools` 与 `streaming` 只描述会话当前回合；折叠状态按构造就是日志尾部，分页旧历史的客户端不会看到陈旧的在途值。
- **结局粒度较粗** —— max-tokens 回合记为 null（usage-host 消息已有自己的提示渲染）；未来需要独立 max-tokens 动画的界面需以缓存兼容的 `stateVersion` 提升扩展 outcome 联合类型。
- **仅挂载于 web-app bundle** —— 其他组装不提供 `orbActivity` 键，消费者仅回退到会话列表事实（运行位、待决交互）。
