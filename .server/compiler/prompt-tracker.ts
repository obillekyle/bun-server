import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { Try } from '@server/utils/common/try'

export const PromptTracker = {
  getFilePath(pid: number): string {
    return `.server/.cache/.prompt-active-${pid}`
  },

  isActive(pid: number): boolean {
    return existsSync(this.getFilePath(pid))
  },

  activate(pid: number): void {
    Try(() => {
      mkdirSync('.server/.cache', { recursive: true })
      writeFileSync(this.getFilePath(pid), '1')
    })
  },

  deactivate(pid: number): void {
    Try(() => unlinkSync(this.getFilePath(pid)))
  },
}
