# Agent Note: 可选背景层的页面级壁纸注册表

Status: implemented

[English](2026-08-18-wallpaper-registry-and-background-layers.md) | 中文

## 问题

web GUI 此前有两个环境背景层,却无法在它们之间选择或关掉:思考球体画布(ui-orbs)永久绘制,加入 GARGANTUA 黑洞壁纸又会在它下面再叠一条常开的 GPU 管线。两个层都在持续动画——让所有已注册层一直跑是一个用户无法参与的性能决策,而两张半透明画布只按 slot 顺序叠加。选择机制需要一个家:多个互不知晓的壁纸插件都能注册进去,而 shell 不必认识其中任何一个。

## 决策

由新包 `packages/client/ui-wallpaper` 提供页面级 `wallpaper.registry` 服务(`ctx.provide`,从不跨越 wire),外加设置面板的「壁纸」分区(`settings.section` 条目),列出全部注册项与末尾的「无壁纸」行,选择即时生效。壁纸包(`inject: ['slots', 'wallpaper.registry']`)在自己的 `shell.overlay` 条目旁注册一个描述符——稳定的 `id`、`label`、`note`,以及 `show`/`hide` 回调;选择持久化到 localStorage(`dsh.wallpaper.selected.v1`),默认 `gargantua`。未被选中时注册立即调用 `hide`;被选中的层注销时回退 `none`;不再可解析的持久化 id 在 `list()` 时回退。

**可见性走模块级桥,不走 props。** 注册表可能在组件挂载之前(持久化的选择)或卸载之后(HMR)隐藏一个层,因此 `show`/`hide` 无法调进组件实例。每个壁纸导出一个 `visibility` 对象(`{ apply, desired }`):注册回调设置 `desired` 并转发给 `apply`;组件在挂载时安装 `apply`(设置宿主的 `display`,暂停或恢复渲染循环),为挂载前的状态应用一次 `desired`,卸载时清空 `apply`。这座桥是包内的——注册表只见得到回调。

**隐藏即暂停。** 两个引擎在隐藏时停止全部工作:球体循环取消 rAF 链;黑洞引擎的 `pause()` 停止帧循环(全部 GPU pass),`resume()` 重启。约定写在描述符文档与设置页文案里;注册表调用 `hide` 并信任该层。

ui-orbs 在同一浮层条目内加入了用户配置面板(相位→模式映射、空闲模式、密度/速度/尺寸乘数,持久化到 localStorage);GARGANTUA 壁纸(`packages/client/ui-blackhole`)是独立项目的逐字移植——WebGL2 零测地线光线追踪,按亮度输出预乘 alpha,保留完整参数面板、低于 26fps 自动降档,以及 `prefers-reduced-motion` 单帧渲染。

位置裁决:

- **用 ctx 服务,不用 slot。** 壁纸选择是跨条目共享的数据加回调(设置分区读它;每个壁纸写它)——正是 client 架构 note 为 ctx 服务而非 slot 保留的情形。服务是页面级的,因为选择是按浏览器的查看状态,不按会话或工作区。
- **顺序留在 slot 那里。** 注册表只决定可见性;z 序仍是各层自己的 `shell.overlay` `order` 值(`-2000` 黑洞,`-1000` 球体)。两个可见层按 slot 顺序叠加——只在选择变更被应用的那一帧里可见。
- **ui-orbs 里带守卫的 `ctx.get`。** ui-orbs 的组件 spec 用仅含 slots 的 stub 上下文挂载浮层条目;其 apply 经 `typeof ctx.get === 'function' ? ctx.get('wallpaper.registry') : undefined` 读取注册表,缺席时跳过注册(该 spec 直接驱动注册表 seam)。
- **壁纸层整层 aria-hidden。** 两个宿主(画布加控制面板)都位于无障碍树之外,把球体画布的先例扩展到整个氛围层:被选中壁纸的面板否则会带着非确定的统计文本(实时 FPS/分辨率)进入每个全页 aria 快照,金样将无法稳定录制;装饰层仅以指针操作。

## 曾考虑的替代方案

- **slot 遮蔽(一个渲染被选中层的 `wallpaper` slot)。** 否决:slot 授权的是渲染,不是暂停——未被选中的层仍会挂载,或者 shell 需要一套交换协议;而且设置分区需要把注册列表当数据读,slot 元数据不带这些。
- **宿主侧设置 + wire 字段。** 暂时否决:选择是按浏览器的查看状态;为只有浏览器消费的事实加 wire 字段和设置命名空间不值。若将来需要按工作区的壁纸,以此作为被延期的形态记录在案。
- **常开的不透明度旋钮(不暂停)。** 否决:黑洞追踪器是全分辨率 GPU 管线;被隐藏的壁纸必须零开销,球体的 rAF 链负有同一义务。
- **一个同时拥有两个壁纸的「背景」包。** 否决:两个壁纸没有共享代码(2D 画布点阵 vs WebGL2 光线追踪),且独立演进;只有注册表是共享的——那正是服务 seam。

## 后果

- 未来的背景层就是一个包:注册 `shell.overlay` 条目 + 注册表描述符,它就会出现在设置里,无需改动 shell 或注册表。
- 注册表的逐文件覆盖、两个新包的引擎、面板与 apply 表面由各自的 component/engine spec 钉住;两个包携带经审计的 `No runtime invariant` companion。
- 选择按浏览器保存(跨工作区与会话一个 localStorage 键)——已记为两个包的已知限制。
