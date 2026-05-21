# 🛠️ Configuration Reference

Tweak your development engine using the single configuration file: **[server.config.ts](server.config.ts)**.

---

## 📝 Configuration Options

Here is the complete configuration skeleton with all supported fields:

```typescript
// server.config.ts
import { defineConfig } from './.server/types';

export default defineConfig({
  /**
   * Server port.
   * @default 3000
   */
  port: 3000,

  /**
   * Host binding. Use '127.0.0.1' to restrict to localhost.
   * @default '0.0.0.0'
   */
  host: '0.0.0.0',

  /**
   * HTTP Proxy rules to bypass CORS.
   */
  proxy: {
    '/weather-api': 'https://api.weather.gov',
  },

  /**
   * Frontend path aliases mapped to client import maps.
   */
  importMap: {
    'helpers/': '/script/helpers/',
  },

  /**
   * Scripts injected into all HTML pages.
   */
  scripts: [
    '/script/analytics.js',
    { src: '/script/app-module.js', module: true, inBody: true },
  ],

  /**
   * Stylesheets injected into all HTML headers (hot-swapped dynamically in dev!).
   */
  styles: ['/styles/global.css'],

  /**
   * Sequential middleware array.
   */
  middleware: [
    async (req, server) => {
      console.log(`Request path: ${new URL(req.url).pathname}`);
    },
    async (req, server) => {
      // Short-circuiting the request by returning a Response!
      if (req.url.includes('/forbidden')) {
        return new Response('Forbidden', { status: 403 });
      }
    },
  ],

  /**
   * Callback executed once when server successfully starts.
   */
  async onStart(server) {
    console.log(`Server running on port ${server.port}`);
  },

  /**
   * Catch requests that bypass other routers (final fallback).
   */
  async onRequest(req, server) {
    if (new URL(req.url).pathname === '/healthz') {
      return new Response('OK');
    }
    return null;
  },

  /**
   * Catch global server errors for logging/custom handling.
   */
  async onError(error) {
    console.error('Global Error:', error.message);
    return new Response('Internal Server Error', { status: 500 });
  },
});
```

---

## 🔗 The Middleware Pipeline Chain

The functions in the `middleware` array run sequentially for every request:

```
Request ──► Middleware 1 ──► Middleware 2 ──► Middleware 3 ──► API Routing / Static Files
```

- **Sequential Execution:** Middlewares run in the exact order they are declared in the array.
- **Request Interception (Short-Circuiting):** If any middleware returns a `Response` object, execution halts immediately. The server skips all remaining middlewares, API routes, and static files, returning that `Response` directly to the client.
- **Inspection Mode:** If a middleware returns `null`, `undefined`, or nothing (`void`), the request passes passively to the next middleware.

---

## 🔄 Automatic `tsconfig.app.json` Syncing

When you specify frontend path aliases in `importMap` (e.g., `'helpers/': '/script/helpers/'`), the server automatically parses them on startup and synchronizes your **[tsconfig.app.json](tsconfig.app.json)** path options.

This ensures that your IDE understands absolute path imports instantly without any manual configuration.
