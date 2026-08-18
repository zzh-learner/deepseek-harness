# @deepseek-ai/dsh-client-ui-wallpaper

[English](README.md) | 中文

Web 壁纸注册表：设置面板的「壁纸」分区，以及背景层注册的页面级 `wallpaper.registry` 服务。注册表保存已注册的壁纸（各自的 `show`/`hide` 回调，约定隐藏时暂停渲染循环）与当前选择，选择持久化到 localStorage；消费方（ui-orbs、ui-blackhole）在 `inject` 中声明该服务。设置分区列出全部注册项与末尾的「无壁纸」行，选择即时生效——面板开着也能直接预览背后的切换效果。被选中的壁纸注销时回退到「无壁纸」；不再可解析的持久化 id 在下一次 `list()` 时回退。

## 组合

```yaml
- id: ui-wallpaper
  name: '@deepseek-ai/dsh-client-ui-wallpaper'
```

仅浏览器半：提供 `wallpaper.registry` 服务并注册一个 `settings.section` 条目（`order: 20`，标签「壁纸」）。节点半是惰性加载席位。该服务是页面级的——经 `ctx.provide` 存活在客户端 Context 中，从不跨越 wire；选择状态按浏览器保存（localStorage），不按会话或工作区。

## 模型体验

无，因为注册表与其选择页都是浏览器侧的查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **选择按浏览器而非按会话** —— 一个 localStorage 键为浏览器中的全部工作区与会话保存选择；按工作区的壁纸需要宿主侧设置项。
- **隐藏状态下注册的层是被通知的，而非被轮询的** —— 另一壁纸被选中时，注册表在注册时调用 `hide`；不遵守约定（继续渲染）的层只能通过其 GPU 开销察觉，注册表无法发现。
- **浮层内部没有层序规则** —— 壁纸依赖各自 `shell.overlay` 的 `order` 值；注册表决定可见性，不决定 z 序，因此两个可见层按 slot 顺序叠加，而非按任何注册表规则。
