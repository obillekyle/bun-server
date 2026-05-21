# ⚙️ Server & Dev Architecture

This guide covers the core background systems that power the Bun Server dev loop.

---

## 🏗️ 1. On-the-Fly TypeScript Compilation

The server transpiles and serves frontend TypeScript (`.ts`) as JavaScript (`.js`) dynamically on request:

1.  When the browser requests `/script/main.js`, the server checks if `/script/main.ts` exists.
2.  If found, the server transpiles it on the fly using Bun's native transpile API.
3.  The transpiled JavaScript is cached in memory for near-instant subsequent loads.
4.  Saving edits to the `.ts` file automatically busts the compiler cache.

---

## 🌍 2. Global Utilities Injection

To reduce import statement noise, the server initializes core helpers directly onto the global scope (**`globalThis`**) on startup:

- `DB`: Autocompleted, type-safe query builder database connection.
- `respond`: Main API endpoint definition wrapper.
- `log` / `Logger`: Standardized terminal log wrappers.
- `match`: Functional pattern-matching engine.

The types for these are mapped in [`.server/global.d.ts`](.server/global.d.ts).

---

## 🎛️ 3. The Developer Console Dashboard (`.dashboard/`)

A premium monochrome admin console runs at `http://localhost:3000/_dashboard` in development mode.

- The console assets and routing logic live in the root **[`.dashboard/`](.dashboard)** folder.
- It supports database browsing, CSV/JSON transfers, SQL console operations, session key-value manipulation, stats polling, and API testing.

---

## 📦 4. Dynamic Auto Import Maps

Standard browsers cannot resolve bare NPM module imports natively. On startup, the server scans your `package.json` dependencies and injects a script block into the HTML page headers:

```html
<script type="importmap">
  ...
</script>
```

This maps bare imports (e.g. `canvas-confetti`) directly to `/node_modules/` files, letting you import NPM modules in the browser without a bundler.

---

## 🔄 5. Live Reloading & CSS Hot-Swaps

In development (`bun run dev`), the server automatically watches the file system and opens a WebSocket connection to the page at `/_livereload`.

- **Backend files saved:** The development server worker restarts in milliseconds.
- **HTML/JS files saved:** The page reloads automatically.
- **CSS files saved:** The stylesheet `<link>` is reloaded with a timestamp parameter, hot-swapping the styles in real-time **without reloading the page**.

---

## 💻 6. Client Logging Proxy

The live-reload script proxies client-side browser console outputs (`console.log`, `console.warn`, `console.error`) and forwards them over WebSockets back to the server. They are printed in color directly in your backend terminal.

**Pro Tip:** Press **`d`** in the terminal while running the dev server to spawn a dedicated terminal window that logs only browser console outputs.
