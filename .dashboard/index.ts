import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { setLogCallback } from '../.server/logger';
import {
  getAllSessions,
  deleteSession,
  getSession,
  getSessionById,
} from '../.server/session';
import { processBody, jsonResponse, tryCatch } from '../.server/utils';
import { handleTS } from '../.server/handlers/ts';
import renderDashboard from './dashboard.tsx';

const getElapsed = (start: number) =>
  parseFloat(((Bun.nanoseconds() - start) / 1000000).toFixed(2));

export const connectedLoggers = new Set<any>();

const statsHistoryLimit = 60;
interface StatsHistoryItem {
  timestamp: number;
  memoryUsed: number;
  activeLoggers: number;
  activeSessions: number;
}
export const statsHistory: StatsHistoryItem[] = [];

// 🛡️ DEV STATE FIX: If we are a dev worker, we are intrinsically in dev mode!
const isDevWorker = process.argv.includes('--dev-worker');
const isDev = process.argv.includes('--dev') || isDevWorker;

export function setupDashboard() {
  if (!isDev) return;

  setLogCallback((entry) => {
    const message = JSON.stringify({
      type: 'server_log',
      level: entry.level,
      by: entry.by,
      payload: entry.msg,
      timestamp: Date.now(),
    });
    connectedLoggers.forEach((loggerWs) => {
      try {
        loggerWs.send(message);
      } catch {}
    });
  });

  setInterval(() => {
    try {
      const mem = process.memoryUsage();
      const memoryUsed = Math.round(mem.rss / 1024 / 1024);
      const activeLoggers = connectedLoggers.size;
      const activeSessions = getAllSessions ? getAllSessions().length : 0;
      statsHistory.push({
        timestamp: Date.now(),
        memoryUsed,
        activeLoggers,
        activeSessions,
      });
      if (statsHistory.length > statsHistoryLimit) {
        statsHistory.shift();
      }
    } catch (e) {
      // Ignore background errors
    }
  }, 1000);
}

export async function handleDashboardRequest(
  req: Request,
  server: any,
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (!path.startsWith('/_dashboard') && !path.startsWith('/api/_dashboard')) {
    return null;
  }

  if (!isDev) {
    return new Response('Forbidden', { status: 403 });
  }

  const dashpass = process.env.DASHPASS;
  if (dashpass) {
    const [_, session] = await tryCatch(async () => getSession(req));
    const isAuthenticated =
      session && (session as any).dashpassAuthenticated === true;

    // Handle logout
    if (path === '/_dashboard/logout') {
      if (session) {
        (session as any).dashpassAuthenticated = false;
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/_dashboard',
        },
      });
    }

    // Handle login submission
    if (path === '/_dashboard/login' && req.method === 'POST') {
      try {
        const body = await processBody(req);
        if (body && body.password === dashpass) {
          if (session) {
            (session as any).dashpassAuthenticated = true;
          }
          return new Response(null, {
            status: 302,
            headers: {
              Location: '/_dashboard',
            },
          });
        } else {
          return new Response(
            renderLoginForm('Incorrect password. Please try again.'),
            {
              status: 400,
              headers: { 'Content-Type': 'text/html' },
            },
          );
        }
      } catch (err) {
        return new Response(
          renderLoginForm('Failed to process login. Please try again.'),
          {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
          },
        );
      }
    }

    // Enforce authentication
    if (!isAuthenticated) {
      if (path.startsWith('/api/_dashboard')) {
        return jsonResponse.object(401, 'Unauthorized');
      }
      return new Response(renderLoginForm(), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }
  }

  if (path === '/_dashboard') {
    const htmlContent = await renderDashboard(req, {}, server);
    return new Response(htmlContent, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (path === '/_dashboard/style.css') {
    return new Response(Bun.file('./.dashboard/dashboard.css'), {
      headers: { 'Content-Type': 'text/css' },
    });
  }

  if (path === '/_dashboard/dashboard.js') {
    return handleTS('./.dashboard/dashboard.ts');
  }

  if (path === '/api/_dashboard/stats') {
    const mem = process.memoryUsage();
    const stats = {
      uptime: Math.round(process.uptime()) + 's',
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
      memoryUsed: Math.round(mem.rss / 1024 / 1024) + ' MB',
      memoryExternal: Math.round(mem.external / 1024 / 1024) + ' MB',
      bunVersion: Bun.version,
      platform: process.platform,
      arch: process.arch,
      activeLoggers: connectedLoggers.size,
      activeSessions: getAllSessions().length,
      history: statsHistory,
    };
    return jsonResponse.object(200, 'success', stats);
  }

  if (path === '/api/_dashboard/sessions') {
    return jsonResponse.object(200, 'success', getAllSessions());
  }

  if (path === '/api/_dashboard/sessions/delete') {
    const body = await processBody(req);
    const deleted = deleteSession(body?.id);
    if (deleted) {
      return jsonResponse.object(200, 'Session deleted');
    }
    return jsonResponse.object(404, 'Session not found');
  }

  if (path === '/api/_dashboard/sessions/update') {
    const body = await processBody(req);
    const { id, key, value, remove } = body || {};
    if (typeof id !== 'string' || typeof key !== 'string') {
      return jsonResponse.object(400, 'Invalid session update payload');
    }
    const session = getSessionById(id);
    if (!session) return jsonResponse.object(404, 'Session not found');
    if (remove) {
      delete (session as any)[key];
    } else {
      (session as any)[key] = value;
    }
    return jsonResponse.object(200, 'Session updated');
  }

  if (path === '/api/_dashboard/schema') {
    const { connection } = await import('../.database/conn');
    const [err, tables] = await tryCatch(async () => {
      const res = connection
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[];
      return res.map((t) => {
        const countRes = connection
          .query(`SELECT COUNT(*) as count FROM \`${t.name}\``)
          .get() as { count: number };
        const cols = connection
          .query(`PRAGMA table_info(\`${t.name}\`)`)
          .all() as {
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }[];
        const idxs = connection
          .query(`PRAGMA index_list(\`${t.name}\`)`)
          .all() as { name: string; unique: number }[];
        return {
          name: t.name,
          rowCount: countRes?.count || 0,
          columns: cols.map((c) => ({
            name: c.name,
            type: c.type,
            notnull: c.notnull === 1,
            pk: c.pk === 1,
          })),
          indexes: idxs.map((i) => ({
            name: i.name,
            unique: i.unique === 1,
          })),
        };
      });
    });
    if (err) {
      console.error('Schema exploration error:', err);
      return jsonResponse.object(500, err.message);
    }
    return jsonResponse.object(200, 'success', tables);
  }

  if (path === '/api/_dashboard/table-data') {
    const url = new URL(req.url);
    const tableName = url.searchParams.get('tableName');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
    const sortBy = url.searchParams.get('sortBy');
    const sortOrder = url.searchParams.get('sortOrder') || 'ASC';
    const filtersJson = url.searchParams.get('filters') || '{}';

    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return jsonResponse.object(400, 'Invalid table name');
    }

    const { connection } = await import('../.database/conn');
    const [err, result] = await tryCatch(async () => {
      const cols = connection
        .query(`PRAGMA table_info(\`${tableName}\`)`)
        .all() as { name: string; type: string }[];
      const colNames = new Set(cols.map((c) => c.name));

      let sql = `SELECT rowid AS rowid, * FROM \`${tableName}\``;
      const whereClauses: string[] = [];
      const params: any[] = [];

      const filters = JSON.parse(filtersJson);
      for (const [col, val] of Object.entries(filters)) {
        if (
          colNames.has(col) &&
          val !== undefined &&
          val !== null &&
          val !== ''
        ) {
          whereClauses.push(`\`${col}\` LIKE ?`);
          params.push(`%${val}%`);
        }
      }

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      let countSql = `SELECT COUNT(*) as count FROM \`${tableName}\``;
      if (whereClauses.length > 0) {
        countSql += ` WHERE ${whereClauses.join(' AND ')}`;
      }
      const countRes = connection.query(countSql).get(...params) as {
        count: number;
      };
      const totalRows = countRes?.count || 0;

      if (sortBy && colNames.has(sortBy)) {
        const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        sql += ` ORDER BY \`${sortBy}\` ${order}`;
      }

      const offset = (page - 1) * pageSize;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(pageSize, offset);

      const rows = connection.query(sql).all(...params);

      return {
        rows,
        totalRows,
        page,
        pageSize,
        totalPages: Math.ceil(totalRows / pageSize),
      };
    });

    if (err) {
      console.error('Table data fetch error:', err);
      return jsonResponse.object(400, err.message);
    }
    return jsonResponse.object(200, 'success', result);
  }

  if (path === '/api/_dashboard/query') {
    const body = await processBody(req);
    const sql = body?.sql;
    if (typeof sql !== 'string') {
      return jsonResponse.object(400, 'Invalid SQL query');
    }

    const { connection } = await import('../.database/conn');
    const start = Bun.nanoseconds();
    const sqlLower = sql.trim().toLowerCase();

    // Check if it is a read query
    const isSelect =
      sqlLower.startsWith('select') ||
      sqlLower.startsWith('with') ||
      sqlLower.startsWith('pragma table_info') ||
      sqlLower.startsWith('pragma index_list') ||
      sqlLower.startsWith('pragma foreign_key_list') ||
      sqlLower.startsWith('explain');

    let result: any;
    const [err] = await tryCatch(async () => {
      if (isSelect) {
        const rows = connection.query(sql).all();
        result = { rows, isSelect: true };
      } else {
        const info = connection.query(sql).run();
        result = {
          rows: [
            { lastInsertRowid: info.lastInsertRowid, changes: info.changes },
          ],
          isSelect: false,
        };
      }
    });
    const elapsed = getElapsed(start);

    if (err) {
      console.error('Query execution error:', err);
      return jsonResponse.object(400, err.message);
    }
    return jsonResponse.object(200, 'success', {
      rows: result.rows,
      isSelect: result.isSelect,
      time: elapsed,
    });
  }

  if (path === '/api/_dashboard/execute-action') {
    const body = await processBody(req);
    const { action, tableName, rowid } = body || {};

    if (typeof tableName !== 'string' || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return jsonResponse.object(400, 'Invalid table name');
    }

    const { connection } = await import('../.database/conn');

    if (action === 'delete-row') {
      if (rowid === undefined || rowid === null) {
        return jsonResponse.object(400, 'Invalid row ID');
      }
      const [err] = await tryCatch(async () => {
        connection
          .query(`DELETE FROM \`${tableName}\` WHERE rowid = ?`)
          .run(rowid);
      });
      if (err) return jsonResponse.object(400, err.message);
      return jsonResponse.object(200, 'Row deleted successfully');
    }

    if (action === 'truncate') {
      const [err] = await tryCatch(async () => {
        connection.query(`DELETE FROM \`${tableName}\``).run();
        connection.query(`VACUUM`).run();
      });
      if (err) return jsonResponse.object(400, err.message);
      return jsonResponse.object(200, 'Table truncated successfully');
    }

    if (action === 'insert-row') {
      const { row } = body || {};
      if (!row || typeof row !== 'object') {
        return jsonResponse.object(400, 'Invalid row data');
      }
      const [err] = await tryCatch(async () => {
        const keys = Object.keys(row);
        const values = Object.values(row);
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO \`${tableName}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${placeholders})`;
        connection.query(sql).run(...(values as any[]));
      });
      if (err) return jsonResponse.object(400, err.message);
      return jsonResponse.object(200, 'Row inserted successfully');
    }

    if (action === 'update-row') {
      const { row } = body || {};
      if (
        !row ||
        typeof row !== 'object' ||
        rowid === undefined ||
        rowid === null
      ) {
        return jsonResponse.object(400, 'Invalid row data or row ID');
      }
      const [err] = await tryCatch(async () => {
        const keys = Object.keys(row).filter((k) => k !== 'rowid');
        const values = keys.map((k) => row[k]);
        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const sql = `UPDATE \`${tableName}\` SET ${setClause} WHERE rowid = ?`;
        connection.query(sql).run(...values, rowid);
      });
      if (err) return jsonResponse.object(400, err.message);
      return jsonResponse.object(200, 'Row updated successfully');
    }

    if (action === 'import-csv') {
      const { csvContent } = body || {};
      if (typeof csvContent !== 'string') {
        return jsonResponse.object(400, 'Invalid CSV content');
      }
      const [err, count] = await tryCatch(async () => {
        const lines = parseCSV(csvContent);
        if (lines.length < 2)
          throw new Error('CSV must contain at least headers and one data row');
        const headers = lines[0];
        const rowsToInsert = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i];
          if (vals.length === 0 || (vals.length === 1 && vals[0] === ''))
            continue;
          const rObj: Record<string, any> = {};
          headers.forEach((h, idx) => {
            let val: any = vals[idx];
            if (val === undefined || val === '') {
              val = null;
            } else {
              const num = Number(val);
              if (!isNaN(num) && val.trim() !== '') {
                val = num;
              }
            }
            rObj[h] = val;
          });
          rowsToInsert.push(rObj);
        }

        if (rowsToInsert.length === 0) return 0;

        const insertTx = connection.transaction((items: any[]) => {
          const keys = Object.keys(items[0]);
          const placeholders = keys.map(() => '?').join(', ');
          const sql = `INSERT INTO \`${tableName}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${placeholders})`;
          const stmt = connection.query(sql);
          for (const item of items) {
            stmt.run(...Object.values<any>(item));
          }
          return items.length;
        });

        return insertTx(rowsToInsert);
      });
      if (err) return jsonResponse.object(400, err.message);
      return jsonResponse.object(200, `Successfully imported ${count} rows`);
    }

    return jsonResponse.object(400, 'Unknown action');
  }

  if (path === '/api/_dashboard/routes') {
    const routes: Array<{ path: string; file: string; type: 'api' | 'page' }> =
      [];

    // Scan API directory
    const scanApiDir = (dir: string, baseRoute: string) => {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          const fullPath = join(dir, file);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            if (file !== 'node_modules' && !file.startsWith('.')) {
              scanApiDir(fullPath, `${baseRoute}/${file}`);
            }
          } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            const nameWithoutExt = file.substring(0, file.lastIndexOf('.'));
            const routePath =
              nameWithoutExt === 'index'
                ? baseRoute
                : `${baseRoute}/${nameWithoutExt}`;
            routes.push({
              path: routePath || '/',
              file: fullPath.replace(/\\/g, '/'),
              type: 'api',
            });
          }
        }
      } catch {}
    };
    scanApiDir('./api', '/api');

    // Scan pages recursively starting from root
    const scanPagesDir = (dir: string, baseRoute: string) => {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          const fullPath = join(dir, file);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            if (
              !file.startsWith('.') &&
              file !== 'node_modules' &&
              file !== 'api' &&
              file !== 'scratch' &&
              file !== 'script' &&
              file !== 'styles'
            ) {
              scanPagesDir(fullPath, `${baseRoute}/${file}`);
            }
          } else if (file.endsWith('.tsx') || file.endsWith('.html')) {
            if (dir === './' && file === 'server.config.ts') continue;
            const nameWithoutExt = file.substring(0, file.lastIndexOf('.'));
            let routePath =
              nameWithoutExt === 'index'
                ? baseRoute
                : `${baseRoute}/${nameWithoutExt}`;
            if (!routePath) routePath = '/';
            routes.push({
              path: routePath,
              file: fullPath.replace(/\\/g, '/'),
              type: 'page',
            });
          }
        }
      } catch {}
    };
    scanPagesDir('./', '');

    return jsonResponse.object(200, 'success', routes);
  }

  return null;
}

function renderLoginForm(errorMessage?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bun Server Console - Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>
  <style>
    :root {
      --bg: #000000;
      --card-bg: rgba(14, 14, 14, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-main: #ffffff;
      --text-muted: #888888;
      --input-bg: rgba(255, 255, 255, 0.04);
      --input-border: rgba(255, 255, 255, 0.1);
      --input-focus: rgba(255, 255, 255, 0.5);
      --error-bg: rgba(239, 68, 68, 0.1);
      --error-border: rgba(239, 68, 68, 0.25);
      --error-text: #fca5a5;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      overflow: hidden;
      position: relative;
    }

    body::before, body::after {
      content: '';
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.025);
      filter: blur(80px);
      opacity: 1;
      z-index: 0;
    }
    body::before {
      top: -10%;
      left: -10%;
    }
    body::after {
      bottom: -10%;
      right: -10%;
    }

    .login-container {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 420px;
      animation: fadeIn 0.6s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .login-card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 2.5rem;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.04), 0 24px 48px rgba(0, 0, 0, 0.6);
    }

    .logo-area {
      text-align: center;
      margin-bottom: 2rem;
    }

    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      font-size: 2rem;
      margin-bottom: 1rem;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .title {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-bottom: 0.5rem;
      color: #ffffff;
    }

    .subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      letter-spacing: 0.02em;
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    .label-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .input-field {
      width: 100%;
      padding: 0.875rem 1.25rem;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 12px;
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.9375rem;
      transition: all 0.2s ease;
      outline: none;
    }

    .input-field::placeholder {
      color: rgba(255, 255, 255, 0.25);
    }

    .input-field:focus {
      border-color: var(--input-focus);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.06);
    }

    .login-btn {
      width: 100%;
      padding: 0.875rem;
      background: #ffffff;
      border: none;
      border-radius: 12px;
      color: #000000;
      font-family: inherit;
      font-size: 0.9375rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      box-shadow: 0 4px 16px rgba(255, 255, 255, 0.15);
      letter-spacing: 0.01em;
    }

    .login-btn:hover {
      background: #f0f0f0;
      box-shadow: 0 6px 20px rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }

    .login-btn:active {
      transform: translateY(0);
      box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
    }

    .error-box {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      border-radius: 12px;
      padding: 0.875rem 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
      color: var(--error-text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      animation: shake 0.4s ease;
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-4px); }
      40%, 80% { transform: translateX(4px); }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <div class="logo-area">
        <div class="logo-badge">
          <iconify-icon icon="material-symbols:bolt-outline" style="font-size: 2.25rem; color: #ffffff;"></iconify-icon>
        </div>
        <h1 class="title">Bun Server</h1>
        <p class="subtitle">Console Login</p>
      </div>

      <form method="POST" action="/_dashboard/login">
        ${
          errorMessage
            ? `
        <div class="error-box">
          <svg style="flex-shrink: 0;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>${errorMessage}</span>
        </div>
        `
            : ''
        }

        <div class="form-group">
          <div class="label-row">
            <label class="label" for="password">Password</label>
          </div>
          <input class="input-field" type="password" id="password" name="password" placeholder="Enter DASHPASS password" required autofocus />
        </div>

        <button type="submit" class="login-btn">
          <span>Sign In</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function parseCSV(content: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (char === '\n' || char === '\r') {
        row.push(cell.trim());
        cell = '';
        if (row.length > 0 && (row.length > 1 || row[0] !== '')) {
          lines.push(row);
        }
        row = [];
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
      } else {
        cell += char;
      }
    }
  }
  if (cell || row.length > 0) {
    row.push(cell.trim());
    lines.push(row);
  }
  return lines;
}
