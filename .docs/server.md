# ⚙️ Server & Dev Architecture

If you just want to build features, you can ignore the `.server/` folder completely. But if you're curious about how we achieved this zero-config, blazing-fast developer experience, grab a coffee and read on.

The `bun-server` does a *lot* of heavy lifting behind the scenes to make your life easier.

## 🏗️ 1. On-the-Fly TypeScript Compilation

Normally, you have to run a build step (like Vite, Webpack, or tsc) to turn your frontend `.ts` files into `.js` so the browser can read them. Not here.

When a browser requests a `.js` file (e.g., `/script/main.js`), our server does a quick check:
1. "Does `/script/main.ts` exist?"
2. If yes, it dynamically intercepts the request.
3. It passes the file to our lightning-fast `compiler.ts`.
4. The TS is compiled to JS instantly and served to the browser.

**The best part?** The compiled result is cached in memory. The first load is fast, and subsequent loads are near-instantaneous. If you edit the file, the cache is busted automatically!

## 🌍 2. Global Utilities Injection

To save you from typing hundreds of import statements, `.server/init.ts` forcefully assigns our most used utilities directly onto `globalThis`. 

Because of this, you can just use these everywhere without importing:
- `respond` (API route wrapper)
- `DB` (The typed ORM)
- `log` / `Logger` (Terminal logging)
- `match` (Pattern matching)

## 🎛️ 3. The Central `server.config.ts`

While the core server is locked down in `.server/`, you control the behavior via the `server.config.ts` file in your root directory. This is where you configure ports, setup proxies, and define import maps.

```typescript
// server.config.ts
import { defineConfig } from './.server/types'; // (or wherever your types are)

export default defineConfig({
  port: 3000,
  
  // Need to bypass CORS to talk to an external API? Use a proxy!
  proxy: {
    '/weather_api': 'https://api.weather.gov', 
  },
  
  // Want custom path aliases for your frontend?
  importMap: {
    'components/': '/styles/components/'
  }
});
```

## 📦 4. Auto Node Modules Mapping

If you've ever tried to use standard ES imports in the browser with `node_modules`, you know it usually requires a bundler. 

We built a clever workaround: **Auto Import Mapping**.
During startup, the server scans your `package.json`. It finds all your dependencies and dynamically generates an HTML `<script type="importmap">`. 

If you install `lodash-es`, you can just `import { cloneDeep } from 'lodash-es'` in your frontend `.ts` files, and the server automatically maps it to the correct file in `/node_modules/`. It's pure magic.

## 🔄 5. True Zero-Config Live Reloading

When you run `bun run dev`, the server enters Watcher Mode.

Any `.html` file served is aggressively intercepted, and a tiny, unobtrusive `<script>` tag is injected into it. This script opens a persistent WebSocket connection back to the server at `/_livereload`.

Meanwhile, the server watches your file system:
- **Change a `.ts` backend file?** The dev worker gracefully restarts.
- **Change an `.html` or `.js`/`.ts` frontend file?** The WebSocket yells at the browser to do a clean `location.reload()`.
- **Change a `.css` file?** The WebSocket tells the browser to dynamically hot-swap the stylesheet by appending a timestamp query parameter. **The page never even refreshes!**

## 💻 6. The Client Logging Terminal

Constantly switching between your editor and the Chrome DevTools console is annoying. So, we fixed it.

The live-reload script we inject also **proxies your browser's console** (`console.log`, `console.warn`, `console.error`). 

Whenever your frontend code logs something, it sends it over the WebSocket to the server, and the server prints it beautifully in your terminal. You can see your backend logs and frontend logs in one unified place!

**Pro Developer Move:** Press the `d` key in your terminal while the dev server is running. It will spawn a completely separate, dedicated terminal window just for your client-side logs! 🤯
