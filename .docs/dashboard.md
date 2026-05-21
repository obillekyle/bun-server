# 🎛️ Developer Console Dashboard

When running in development (`bun run dev`), the Web Admin Console is accessible at `http://localhost:3000/_dashboard`. This console allows you to interact with your server stats, database records, active sessions, backend logs, and APIs.

---

## 🔐 1. Password Protection (`DASHPASS`)

If you want to secure the console access, define a `DASHPASS` environment variable inside your root `.env` file:

```env
# .env
DASHPASS=my_secret_password_123
```

If defined, the server prompts for password verification before establishing a session cookie. Click **Logout** in the dashboard header to terminate the session.

---

## 📈 2. Real-Time Telemetry & Charts

The **System Stats** tab queries the server telemetry:

- **6-Card Metrics:** Displays system uptime (updated every 500ms), client ping latency, RSS memory allocation, active WebSocket loggers, active user sessions, and database row totals.
- **Historical Backlog:** The server records stats in a rolling 1-minute background buffer. Opening the dashboard immediately imports this backlog, populating the charts instantly.
- **Telemetry calculations:** Displays minimum, maximum, and average values computed for all metrics since the dashboard was loaded.

---

## 🔑 3. Session Manager

The **Session Manager** tab allows inspection of all active memory-stored user sessions:

- **Key-Value Inspector:** Shows up to 3 session keys directly. Click on a session card to open a modal displaying all keys as formatted JSON.
- **Session CRUD:** Add, edit, or delete keys inside active sessions in real-time.
- **Session Eviction:** Click the **Delete** icon to completely terminate a session.

---

## 🗄️ 4. SQLite Database Browser

The database browser replaces external tools like DBeaver or DB Browser for SQLite:

- **Accordion Table Sidebar:** Lists tables and their actual row counts. Click any table to load its column schemas, keys, constraints, indexes, and paginated row data.
- **Data Grid:** Double-click cells to inline-edit fields. You can page results (`10` to `500` rows), toggle column sorting, and add multiple stacked search filters.
- **Record Operations:** Add rows using dynamic schema-matching forms, delete rows, or truncate tables (which automatically runs `VACUUM` to release disk space).
- **CSV & JSON Transfers:** Export filtered grids to CSV/JSON files, or paste/upload a `.csv` file to bulk-insert records within a single transaction.
- **SQL Terminal:** Write and execute raw queries. Displays formatted grids for `SELECT` statements or shows rows-affected counts and millisecond execution performance.

---

## 💻 5. Real-Time Logs Stream

The **Server Logs** tab opens a WebSocket to stream backend standard logs:

- **Controls:** Pause/Play stream logging, clear the log console window, and toggle terminal autoscroll lock.

---

## 🛣️ 6. Route Explorer & API Sandbox

Test your endpoints directly without launching Postman:

- **Scanned Routes:** Lists all backend endpoints (`/api/*`) and frontend template pages.
- **Interactive Sandbox:** Supports custom HTTP methods, headers, dynamic path substitutions, query builders, and an advanced JSON payload editor.
- **Response Panel:** Executes requests, rendering pretty-printed JSON payloads, headers, status codes, and execution times down to the millisecond.
