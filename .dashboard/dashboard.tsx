import { renderDatabaseBrowser } from './db-browser';

export default html((req, body, server) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Bun Server Console</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/_dashboard/style.css" />
        <script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>
      </head>
      <body>
        <header>
          <div class="brand" style="display: flex; align-items: center; gap: 0.5rem;">
            <iconify-icon icon="material-symbols:bolt-outline" class="logo-emoji" style="color: #ffffff; font-size: 1.75rem;"></iconify-icon>
            <h1>Bun Server Console</h1>
          </div>
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div class="status-indicator">
              <span class="status-dot"></span>
              <span>Online (DEV)</span>
            </div>
            {process.env.DASHPASS ? (
              <a
                href="/_dashboard/logout"
                class="logout-btn"
                style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem 0.85rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 500; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s;"
                onmouseover="this.style.background='rgba(239, 68, 68, 0.1)'"
                onmouseout="this.style.background='none'"
              >
                Logout
              </a>
            ) : null}
          </div>
        </header>

        <main>
          <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('stats')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <iconify-icon icon="material-symbols:monitoring-outline" style="font-size: 1.15rem;"></iconify-icon>
              <span>System Stats</span>
            </button>
            <button class="tab-btn" onclick="switchTab('sessions')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <iconify-icon icon="material-symbols:key-outline" style="font-size: 1.15rem;"></iconify-icon>
              <span>Session Manager</span>
            </button>
            <button class="tab-btn" onclick="switchTab('database')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <iconify-icon icon="material-symbols:database-outline" style="font-size: 1.15rem;"></iconify-icon>
              <span>Database Browser</span>
            </button>
            <button class="tab-btn" onclick="switchTab('logs')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <iconify-icon icon="material-symbols:terminal-outline" style="font-size: 1.15rem;"></iconify-icon>
              <span>Server Logs</span>
            </button>
            <button class="tab-btn" onclick="switchTab('routes')" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <iconify-icon icon="material-symbols:alt-route-outline" style="font-size: 1.15rem;"></iconify-icon>
              <span>Route Explorer</span>
            </button>
          </div>

          <div id="panel-stats" class="panel active">
            <div
              class="grid-stats"
              style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));"
            >
              <div class="card" style="padding: 1rem 1.25rem;">
                <span class="card-title">Process Uptime</span>
                <span
                  class="card-value"
                  id="stat-uptime"
                  style="font-size: 1.5rem; margin-top: 0.25rem;"
                >
                  0s
                </span>
                <span class="card-sub" id="stat-pid">
                  PID: -
                </span>
              </div>
              <div class="card" style="padding: 1rem 1.25rem;">
                <span class="card-title">Ping Latency</span>
                <span
                  class="card-value"
                  id="stat-ping"
                  style="font-size: 1.5rem; margin-top: 0.25rem;"
                >
                  0 ms
                </span>
                <span class="card-sub">Client Latency</span>
              </div>
              <div class="card" style="padding: 1rem 1.25rem;">
                <span class="card-title">Memory Allocation</span>
                <span
                  class="card-value"
                  id="stat-memory"
                  style="font-size: 1.5rem; margin-top: 0.25rem;"
                >
                  0 MB
                </span>
                <span class="card-sub" id="stat-mem-total">
                  Total Alloc
                </span>
              </div>
              <div class="card" style="padding: 1rem 1.25rem;">
                <span class="card-title">Active Loggers</span>
                <span
                  class="card-value"
                  id="stat-loggers"
                  style="font-size: 1.5rem; margin-top: 0.25rem;"
                >
                  0
                </span>
                <span class="card-sub">Connections</span>
              </div>
              <div class="card" style="padding: 1rem 1.25rem;">
                <span class="card-title">Active Sessions</span>
                <span
                  class="card-value"
                  id="stat-sessions"
                  style="font-size: 1.5rem; margin-top: 0.25rem;"
                >
                  0
                </span>
                <span class="card-sub">In-Memory Store</span>
              </div>
              <div class="card" style="padding: 1rem 1.25rem;">
                <span class="card-title">Bun Runtime</span>
                <span
                  class="card-value"
                  id="stat-bun-version"
                  style="font-size: 1.5rem; margin-top: 0.25rem;"
                >
                  v-
                </span>
                <span class="card-sub" id="stat-arch">
                  Architecture
                </span>
              </div>
            </div>

            <div class="grid-charts">
              <div class="chart-card">
                <span class="card-title">Ping Latency History</span>
                <span class="card-sub">
                  Client-to-server connection latency (last 1 min)
                </span>
                <canvas id="canvas-ping" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="ping-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="ping-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="ping-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card">
                <span class="card-title">Memory History</span>
                <span class="card-sub">
                  Heap/RSS RAM consumption (last 1 min)
                </span>
                <canvas id="canvas-memory" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="memory-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="memory-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="memory-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card">
                <span class="chart-title">WebSocket Connections</span>
                <span class="card-sub">
                  Active client logger tunnels (last 1 min)
                </span>
                <canvas id="canvas-loggers" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="loggers-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="loggers-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="loggers-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card">
                <span class="card-title">Active Sessions</span>
                <span class="card-sub">
                  In-memory active user sessions (last 1 min)
                </span>
                <canvas id="canvas-sessions" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="sessions-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="sessions-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="sessions-avg">-</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div id="panel-sessions" class="panel">
            <div class="actions-row" style="margin-bottom: 1.5rem;">
              <h2 style="font-size: 1.1rem; font-weight: 600;">
                Active Evictable Sessions
              </h2>
              <button class="btn btn-secondary" onclick="loadSessions()" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                <iconify-icon icon="material-symbols:refresh-outline" style="font-size: 1.1rem;"></iconify-icon>
                <span>Refresh Sessions</span>
              </button>
            </div>
            <div class="session-grid" id="session-container">
              <div class="results-empty">
                <span>Loading active sessions...</span>
              </div>
            </div>
          </div>

          {renderDatabaseBrowser()}

          <div id="panel-logs" class="panel">
            <div
              class="card"
              style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;"
            >
              <div class="actions-row" style="margin-bottom: 0;">
                <h2 style="font-size: 1.1rem; font-weight: 600; margin: 0;">
                  Real-time Server Logs
                </h2>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <button
                    class="btn btn-secondary"
                    onclick="toggleLogsPlay()"
                    id="btn-logs-play"
                    style="display: inline-flex; align-items: center; gap: 0.35rem;"
                  >
                    <iconify-icon icon="material-symbols:pause-circle-outline" style="font-size: 1.1rem;"></iconify-icon>
                    <span>Pause</span>
                  </button>
                  <button
                    class="btn btn-secondary btn-danger"
                    onclick="clearLogs()"
                    style="display: inline-flex; align-items: center; gap: 0.35rem;"
                  >
                    <iconify-icon icon="material-symbols:delete-outline" style="font-size: 1.1rem;"></iconify-icon>
                    <span>Clear Logs</span>
                  </button>
                  <label style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; color: var(--text-secondary); cursor: pointer; user-select: none; margin-left: 0.5rem;">
                    <input type="checkbox" id="logs-autoscroll" checked />{' '}
                    Auto-scroll
                  </label>
                </div>
              </div>

              <div
                id="logs-console"
                style="background: #090d16; border: 1px solid var(--border-color); border-radius: 0.5rem; height: 420px; overflow-y: auto; padding: 1rem; font-family: monospace; font-size: 0.85rem; line-height: 1.5; color: #e2e8f0; display: flex; flex-direction: column; gap: 0.25rem;"
              >
                <div style="color: var(--text-secondary);">
                  Connecting to server log stream...
                </div>
              </div>
            </div>
          </div>

          <div id="panel-routes" class="panel">
            <div style="display: grid; grid-template-columns: 320px 1fr; gap: 1.5rem;">
              <div
                class="card"
                style="padding: 1.25rem; height: fit-content; display: flex; flex-direction: column; gap: 0.75rem;"
              >
                <h2 style="font-size: 1rem; font-weight: 600; margin: 0;">
                  Registered Routes
                </h2>
                <div style="max-height: 480px; overflow-y: auto;">
                  <ul
                    id="routes-list"
                    style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0; margin: 0; list-style: none;"
                  >
                    <li class="results-empty" style="padding: 1rem 0;">
                      Scanning paths...
                    </li>
                  </ul>
                </div>
              </div>

              <div
                class="card"
                style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;"
              >
                <h2
                  style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0;"
                  id="sandbox-title"
                >
                  API Sandbox Runner
                </h2>

                <div
                  id="sandbox-empty"
                  class="results-empty"
                  style="height: 380px;"
                >
                  <span>Select a route from the list to start testing.</span>
                </div>

                <div
                  id="sandbox-runner"
                  style="display: none; flex-direction: column; gap: 1rem;"
                >
                  <div style="display: flex; gap: 0.75rem;">
                    <div class="custom-select" id="sandbox-method-container">
                      <div
                        class="custom-select-trigger"
                        onclick="toggleCustomSelect(event)"
                        id="sandbox-method-trigger"
                      >
                        <span id="sandbox-method-label">GET</span>
                        <span class="custom-select-arrow">▾</span>
                      </div>
                      <div
                        class="custom-select-dropdown"
                        id="sandbox-method-dropdown"
                      ></div>
                      <input type="hidden" id="sandbox-method" value="GET" />
                    </div>

                    <input
                      type="text"
                      id="sandbox-url"
                      style="flex: 1; padding: 0.5rem 0.75rem; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-color); border-radius: 0.375rem; color: var(--text-primary); font-family: monospace; font-size: 0.9rem;"
                      readonly
                    />                      <button class="btn" onclick="sendSandboxRequest()" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                      <iconify-icon icon="material-symbols:send-outline" style="font-size: 1.1rem;"></iconify-icon>
                      <span>Send Request</span>
                    </button>
                  </div>

                  {/* Dynamic Parameters Section */}
                  <div style="display: flex; flex-direction: column; gap: 0.75rem; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); padding: 1rem 0; margin-top: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                        Parameters
                      </span>
                      <button
                        class="btn btn-secondary"
                        style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem;"
                        onclick="addSandboxParameter()"
                      >
                        <iconify-icon icon="material-symbols:add-outline" style="font-size: 1rem;"></iconify-icon>
                        <span>Add Parameter</span>
                      </button>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                      {/* Table Header */}
                      <div style="display: grid; grid-template-columns: 2fr 1.5fr 3fr 40px; gap: 0.5rem; padding: 0 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">
                        <div>Parameter</div>
                        <div>Type</div>
                        <div>Value</div>
                        <div></div>
                      </div>

                      {/* Parameter Rows Container */}
                      <div
                        id="sandbox-params-list"
                        style="display: flex; flex-direction: column; gap: 0.5rem;"
                      ></div>
                    </div>
                  </div>

                  {/* Custom (Advanced) Section */}
                  <div
                    id="sandbox-advanced-sec"
                    style="display: flex; flex-direction: column; gap: 0.5rem;"
                  >
                    <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                      Custom (Advanced)
                    </span>
                    <textarea
                      id="sandbox-body"
                      style="width: 100%; height: 90px; padding: 0.5rem 0.75rem; background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border-color); border-radius: 0.375rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;"
                      placeholder='{\n  "name": "John Doe"\n}'
                    ></textarea>
                  </div>

                  <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">
                        Response Status & Time:
                      </span>
                      <span
                        id="sandbox-meta"
                        style="font-size: 0.85rem; font-family: monospace; font-weight: bold;"
                      ></span>
                    </div>
                    <pre
                      id="sandbox-response"
                      style="background: #090d16; border: 1px solid var(--border-color); border-radius: 0.375rem; max-height: 220px; overflow-y: auto; padding: 0.75rem 1rem; margin: 0; font-family: monospace; font-size: 0.85rem; color: #a5f3fc; white-space: pre-wrap; word-break: break-all;"
                    >
                      No response received yet.
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <script src="/_dashboard/dashboard.js"></script>
      </body>
    </html>
  );
});
