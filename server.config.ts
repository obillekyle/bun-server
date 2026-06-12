import analyticsPlugin from '@plugins/analytics'
import dashboardPlugin from '@plugins/dashboard'
import { defineConfig } from '@server/core'

export default defineConfig({
  root: './src',
  port: 3000,
  plugins: [dashboardPlugin(), analyticsPlugin()],

  scripts: [],
  styles: ['/styles/global.css'],
})
