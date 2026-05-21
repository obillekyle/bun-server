# 🚀 Bun Server: The Zero-Config Full-Stack Stack

Welcome to the **Bun Server**! A ridiculously fast, developer-friendly full-stack starter built on [Bun](https://bun.sh/). We stripped out all config headaches, leaving you with pure coding bliss.

---

## ✨ Features

- **🔥 Blazing Fast Dev Server:** Native speed with on-the-fly TypeScript compilation.
- **🔄 Instant Live Reloading:** Server restarts on backend changes; browser refreshes on frontend changes; CSS hot-swaps in real-time _without_ a page reload.
- **🗄️ Heavily Typed ORM:** Type-safe SQLite query builder. Your editor autocomplete will love it.
- **📁 File-System Routing:** Drop `.ts` files in `api/` for instant endpoints.
- **📦 Auto Node Modules Mapping:** Frontend imports from `node_modules` just work natively. No bundler required!
- **🌐 Built-in Proxy:** Forward requests to bypass CORS or connect upstream via `server.config.ts`.
- **🎛️ Dev Console Dashboard:** An admin panel at `/_dashboard` (located to the root [`.dashboard`](.dashboard) folder). Manage sessions, browse DB tables, run SQL commands, stream logs, and test APIs.
- **💻 Client logging:** Stream browser logs directly to your backend terminal (Press **`d`** to open a dedicated client logger terminal).

---

## 🚀 Quick Start

Get running in seconds:

```bash
# 1. Install dependencies
bun install

# 2. Start the dev watcher
bun run dev
```

Your app is live at [http://localhost:3000](http://localhost:3000)! 🎉

---

## 📂 Project Architecture

- **`api/`** — Backend API. Any `.ts` file maps to an `/api/...` endpoint.
- **`.dashboard/`** — Codebase for the Web Admin Console.
- **`.database/`** — SQLite database (`server.db`), schema (`schema.ts`), and connection logic.
- **`.server/`** — Core server engine (live-reload, TS compilers, routing). You rarely need to touch this.
- **`styles/` & `script/`** — Static stylesheets and client-side TS scripts (compiled on the fly!).
- **`index.html`** — Frontend entry point.
- **`server.config.ts`** — Single configuration file for ports, proxies, and middleware.

---

## 🪄 Global Superpowers

These helper utilities are injected directly into the global scope—no import statements needed:

- `DB`: Your query-builder ORM gateway.
- `respond`: The API route wrapper (handles body parsing, error catches, and JSON formatting).
- `log` & `Logger`: Standardized color terminal logs.
- `match`: A clean pattern-matching utility.

---

## 📚 Documentation Guides

Ready to dive deeper? Check out our guides:

- 🛣️ **[API & File-System Routing](.docs/api.md)**: Endpoints, request bodies, and dynamic paths.
- 🗄️ **[The Built-in Typed ORM](.docs/orm.md)**: Master the query builder and thenables.
- 🎛️ **[Developer Console Dashboard](.docs/dashboard.md)**: Full guide to the admin cockpit.
- ⚙️ **[Server & Dev Tools Architecture](.docs/server.md)**: Under the hood (compilers, loaders, reloaders).
- 🛠️ **[Configuration Reference](.docs/configuration.md)**: Guide to tweaking `server.config.ts`.
- 🗃️ **[Database Migrations & Syncing](.docs/migrations.md)**: Smart schema syncing and seeding.
- 🧪 **[Testing Guide](.docs/testing.md)**: Run fast tests with `bun test`.
- 🎨 **[Frontend & Asset Management](.docs/frontend.md)**: ES Modules, hot-reload, and server-side TSX.
- 🚀 **[Deployment & Production](.docs/deployment.md)**: Docker, Nginx, PM2, and environment variables.

---

## 📜 Scripts

- `bun run dev` - Run development server with watchers and logs.
- `bun run serve` - Run high-performance production server.
- `bun run db:sync` - Sync SQLite DB with your TypeScript schema.

Happy coding! 🚀

_docs generated with Gemini (i'm very lazy to document manually lol)_
