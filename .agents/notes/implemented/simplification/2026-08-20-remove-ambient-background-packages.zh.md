# Agent Note：移除环境背景包

Status: implemented

[English](2026-08-20-remove-ambient-background-packages.md) | 中文

范围:`packages/session/orb-state`、`packages/client/ui-orbs`、`packages/client/ui-wallpaper`、`packages/client/ui-blackhole`、web-app 组合行。

## Problem

Web GUI 曾积累出一条环境背景特性线:思考球体画布(2026-08-12,`orbActivity` 会话投影 + `ui-orbs` 九模式移植)与页面级壁纸选择机制(2026-08-18,`ui-wallpaper` 注册表 + `ui-blackhole` GARGANTUA 黑洞壁纸)。两个笔记记录的原始动机分别是把动态插件形态的球体背景固化为可重启存活的组合行,以及让用户能在多个互不知晓的背景层之间选择、关闭常开的动画与 GPU 管线。

这些层纯属装饰:aria-hidden、仅指针操作、不进无障碍树,也没有任何产品需求依赖它们。预发布仓库没有外部消费者,维持这条线却要供养四个包——画布/WebGL2 引擎、注册表服务、设置分区、各自的测试与生成目录面。范围收缩判定:装饰不是产品核心,不值得这块维护面。

## Decision

四个包全部删除,不留兼容包或别名。同一改动内一并移除:web-app 组合行与 workspace 依赖、tsconfig 路径映射与 project references、knip 工程、cordis/client/config 生成目录条目、`wallpaper.registry` 服务豁免、slot-catalog 的 `shell.overlay` 占用与 `settings.section` 壁纸分区、以及 11 个设置面板 golden 快照里的「壁纸」按钮。`pnpm-lock.yaml` 同步收缩。

本笔记按合并规则收编两篇被取代的记录——feature 类「Thinking-orb background — session-projection seam and the shipped ui-orbs port」(2026-08-12)与 architecture 类「A page-local wallpaper registry for selectable background layers」(2026-08-18)——两者的完整三件套(en/zh/sidecar)随之删除;git 历史保留原文,但不再是现行权威。

### 收编的记录

- **原始动机**:球体背景来自 orbs.jakubantalik.com 游乐场的动态插件固化,状态感知走 `SessionSummary.projectionValues` 的 `orbActivity` 纯折叠(无宿主轮询、折叠内无墙钟);壁纸注册表解决「多个常开动画层无法选择或关闭」,选择持久化于 localStorage,隐藏即暂停(rAF 链取消、帧循环停止)。
- **为何不再成立**:两层皆为装饰(前述 aria-hidden 事实),预发布期没有外部消费者;维持它们的成本是四个包的引擎、面板、注册表与全套测试/目录面,而产品对「思考可视化」或「可选壁纸」没有需求主张。
- **放弃的能力**:会话活动的环境可视化(在途工具、流式位、回合结局驱动的九种模式)与用户可选的背景层。`shell.overlay` 席位保留,占用清空。
- **复引条件**:未来的活动可视化或背景层必须从真实产品需求出发,重新走包边界与组装验收,而不是继承这批实现;若需要更丰富的活动语义,仍应按会话投影 seam 注册新单元而非另起平行通道。

## Verification

仓库检索与生成目录不再含这四个包名、`wallpaper.registry` 服务键或 `orbActivity` 投影键;`pnpm run build`、cordis-client-runner 单测、doc-sync 与 hygiene 的清单/目录子门禁、锁文件 `--frozen-lockfile` 安装全部通过;设置面板相关 web e2e golden(插件配置、设置 chrome、Agent 预设、模型、引导)已更新为无「壁纸」按钮的形态。

## Alternatives considered

**保留包但不进组合。** 否决:维护与目录/测试面原样保留,还把无人组装的界面继续呈现为产品表面;预发布期没有理由供养它。

**移到 examples 组。** 否决:移动代码不产生产品需求;示例也需要被维护的组装验收(与 TUI 移除笔记同一裁定)。

**保留注册表、只删两个壁纸。** 否决:注册表的存在理由就是仲裁这两个层;没有注册方的注册表是包规则禁止的投机表面。

**组合里 `disabled:` 默认关闭。** 否决:关闭的行仍然供养包、测试与目录面;装饰不应留在产品清单里占位。

## Consequences

Web GUI 没有环境背景层;会话投影 seam 本身保留,`orbActivity` 单元随包消失。浏览器里残留的 localStorage 键 `dsh.wallpaper.selected.v1` 成为无读取方的死数据,不做迁移。`SessionSummary.projectionValues` 机制仍服务其他投影消费者。

重新引入环境可视化或背景层,需要具名的产品需求、明确的包边界与组装生命周期/转写验收;实现应从当时的宿主与交互要求出发,而非恢复这批移植。
