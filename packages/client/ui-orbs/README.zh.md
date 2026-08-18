# @deepseek-ai/dsh-client-ui-orbs

[English](README.md) | 中文

Web 思考球体背景：将 orbs.jakubantalik.com（thinking-orbs）游乐场 —— 九种手工调校的点阵动画（轨道环、扫描球、扭转魔方、呼吸波场、信号网络、编织辫、丝带、圆环、形状变形）—— 渲染为居中于对话列的单个主画布，位于 shell 浮层层内所有可交互元素之下。实时相位由当前会话的 `orbActivity` 投影（dsh-orb-state：在途工具名、流式位、回合结局）与会话列表事实（运行位、待决审批、运行中谱系）合并而成：等待审批 → 魔方，失败回合 → 魔方加错误氛围，干净回合 → 圆环加完成氛围，委派并行 → 丝带，搜索工具 → 扫描球，文件写入 → 编织辫，其他工具 → 信号网络，流式输出 → 波场，思考中 → 轨道环，空闲 → 轮换全部九种。并发活跃度调节动画速度；模式间 0.9 秒交叉淡化；`prefers-reduced-motion` 只绘制一帧静态画面；墨色随主题解析的基础背景自动翻转。壁纸显示时右上角的可折叠面板可把每个相位重映射到任意模式、固定或释放空闲轮换，并调节密度/速度/尺寸；修改持久化到 localStorage，下一帧即生效。

## 组合

```yaml
- id: ui-orbs
  name: '@deepseek-ai/dsh-client-ui-orbs'
```

仅浏览器半：注册一个 `shell.overlay` 列表项（`order: -1000`，绘制于其他浮层元素之下），并在 `wallpaper.registry`（ui-wallpaper）中注册 `orbs`；经注册表被隐藏时渲染循环完全暂停。节点半是惰性加载席位；全部数据经标准 sessions 钩子与投影接缝到达。

## Model Experience

无。插件只渲染已推导的客户端状态，不触及任何提示词、消息、schema、流或工具结果。

#### KV Cache effect

无；插件从不组装或发送提供商请求。

## Known Limitations and Deferred Work

- **浮层平面渲染** —— shell 没有"内容之下"槽位，球体在全局浮层层内以较低画布不透明度绘制于兄弟元素之下，而非真正位于各列表面背后；结构性修复是 ui-layout 未来提供背景槽位。
- **几何靠测量而非声明** —— 居中通过标记的浮层祖先读取布局 frame 的内联网格轨道，并按节奏 + ResizeObserver 复查；由 ui-layout 提供 owner 参数可使列框成为权威来源。
- **工具名分类为固定集合** —— `web_search` 读作搜索，`write`/`edit` 读作写入；后续新增的工具归入 `tooling`，直到在此扩展分类。
- **整层 aria-hidden** —— 球体画布与其配置面板属于氛围装饰，位于无障碍树之外；面板仅以指针操作。
