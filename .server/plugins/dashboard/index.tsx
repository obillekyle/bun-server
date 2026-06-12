import { definePlugin } from '@plugins/types'

export default function dashboardPlugin(options?: { whitelist?: string[] }) {
  return definePlugin({
    name: 'dashboard',
    setup: async () => {
      const { setupDashboard } = await import('./setup')
      setupDashboard(options)
    },
  })
}
