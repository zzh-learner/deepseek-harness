/**
 * The Settings 「壁纸」 section: one radio row per registered wallpaper plus
 * the terminal rows, selection applied immediately so the page behind the
 * open panel previews it.
 *
 * @module @deepseek-ai/dsh-client-ui-wallpaper/src/client/WallpaperSection
 */

import { useEffect, useState } from 'react'
import type { WallpaperRegistry } from './registry.ts'
import css from './WallpaperSection.module.css'

/** Section props: the registry face plus the shell's close affordance. */
export interface WallpaperSectionProps {
  readonly registry: WallpaperRegistry
  /** Close the settings panel (unused today; flows may leave settings). */
  readonly close?: () => void
}

/** The wallpaper selection page. */
export function WallpaperSection({ registry }: WallpaperSectionProps) {
  const [, setRevision] = useState(0)
  useEffect(() => registry.subscribe(() => { setRevision(n => n + 1) }), [registry])
  const rows = registry.list()
  const current = registry.current()
  return (
    <div className={css.page}>
      <div className={css.intro}>
        选择 Web 界面的背景层。被切走的壁纸会暂停渲染以节省性能；插件壁纸运行时会自动出现在列表中。
      </div>
      {rows.map(row => (
        <button
          key={row.id}
          type="button"
          className={row.id === current ? `${css.opt} ${css.on}` : css.opt}
          onClick={() => { registry.select(row.id) }}
        >
          <span className={css.dot} aria-hidden="true" />
          <span className={css.opttxt}>
            <span className={css.optlabel}>{row.label}</span>
            {row.note !== undefined && <span className={css.optnote}>{row.note}</span>}
          </span>
        </button>
      ))}
      <div className={css.hint}>
        黑洞与思考球体各自的参数面板挂在对应壁纸显示时的界面右上角；壁纸被隐藏时其面板一并隐藏。
      </div>
    </div>
  )
}
