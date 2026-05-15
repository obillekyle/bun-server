# 🚀 Bun Server: The Ultimate Dev-Friendly Stack

Welcome to the **Bun Server**! This isn't just another boilerplate; it's a meticulously crafted, ridiculously fast, and intensely developer-friendly full-stack starter built on top of [Bun](https://bun.sh/).

We stripped out all the boring boilerplate, configuration headaches, and import soups, leaving you with pure, unadulterated coding bliss.

## ✨ What's the Vibe?

We believe in **Zero-Config Magic**. You shouldn't have to spend hours setting up Webpack, Babel, or complex database connection logic. With this starter, you get:

- **🔥 Blazing Fast Dev Server:** Powered by Bun, featuring on-the-fly TypeScript compilation.
- **🔄 Instant Live Reloading:** No configuration needed. Change a CSS file? It hot-swaps. Change HTML/JS? It reloads.
- **🗄️ Heavily Typed ORM:** A built-in, type-safe SQL query builder. Your editor will auto-complete everything.
- **📁 File-System Routing:** Drop a `.ts` file in the `api/` folder, and boom, it's an endpoint.
- **📦 Auto Node Modules Mapping:** Frontend imports from `node_modules` just work out of the box. No bundler required!
- **🌐 Built-in Proxy:** Easily forward requests to other services via `server.config.ts`.
- **💻 Client Logging Terminal:** See your browser's `console.log` directly in your terminal, or even spawn a dedicated terminal window just for client logs!

## 🚀 Quick Start

Get up and running in literal seconds. No joke.

```bash
# 1. Install dependencies (it's Bun, so it takes 0.01 seconds)
bun install

# 2. Fire up the magical dev watcher
bun run dev
```

That's it. You're live! 🎉

## 📂 Project Architecture

Here's the lay of the land. It's clean, intuitive, and stays out of your way.

- **`api/`** — Your backend playground. Any `.ts` file here automatically becomes an accessible `/api/...` endpoint.
- **`.server/`** — The brain of the operation. Contains the custom dev server, TypeScript compiler, WebSocket live-reloader, and proxy logic. You rarely need to touch this unless you're hacking the core!
- **`.database/`** — Your type-safe SQL ORM lives here. Define your schema in `schema.ts`, and the sync engine handles the rest.
- **`styles/` & `script/`** — Drop your frontend CSS and TS files here. They are served statically and compiled on the fly.
- **`index.html`** — Your main entry point for the frontend.
- **`server.config.ts`** — The one and only configuration file you need for setting ports, proxies, and custom import maps.

## 🪄 Global Superpowers

To keep your code ridiculously clean, we inject a few highly useful utilities directly into the global scope. No more `import { ... } from '../../../../utils'`!

- `DB`: Your gateway to the fully typed ORM.
- `respond`: The wrapper you use to define awesome API endpoints.
- `log` & `Logger`: Beautiful, standardized terminal logging.
- `match`: A powerful, functional pattern-matching utility.

## 📚 Deep Dive Documentation

Ready to become a Bun Server master? Check out our casual, rich guides to learn all the secrets:

- 🛣️ **[API & File-System Routing](.docs/api.md)**: Learn how to build endpoints without writing routing logic.
- 🗄️ **[The Built-in Typed ORM](.docs/orm.md)**: Master the query builder and never write a bad SQL query again.
- ⚙️ **[Server & Dev Tools Architecture](.docs/server.md)**: Peek under the hood and see how the magic live-reloading and compilation actually work.
- 🚀 **[Deployment & Production](.docs/deployment.md)**: How to run the server in production, use PM2, Docker, and Nginx.
- 🎨 **[Frontend & Asset Management](.docs/frontend.md)**: Learn about the TS compilation, CSS hot-swapping, and using Node modules in the browser.
- 🛠️ **[Configuration Reference](.docs/configuration.md)**: A complete guide to tweaking `server.config.ts`.
- 🗃️ **[Database Migrations & Syncing](.docs/migrations.md)**: Best practices for managing your SQLite schema over time.
- 🧪 **[Testing Guide](.docs/testing.md)**: How to write blazing fast tests for your API endpoints using `bun test`.

## 📜 Available Scripts

- `bun run dev` - Starts the development server with the amazing file watcher and live-reload engine.
- `bun run serve` - Runs the lean, production-ready server (no watchers, max performance).
- `bun run db:sync` - Synchronizes your SQLite database with your TypeScript schema definitions. Run this whenever you change `schema.ts`.

_docs generated with Gemini (i'm very lazy to document manually lol)_
