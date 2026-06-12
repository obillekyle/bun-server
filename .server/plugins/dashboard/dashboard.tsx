import { renderDatabaseBrowser } from '@plugins/dashboard/db-browser'

export default function Dashboard() {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Bakery Console</title>
        <link rel="stylesheet" href="/_dashboard/style.css" />
        <script src="https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js"></script>
      </head>
      <body>
        <header>
          <div class="brand">
            <iconify-icon icon="lucide:zap" class="logo-emoji"></iconify-icon>
            <h1>Bakery Console</h1>
          </div>
          <div class="header-actions">
            <div class="status-indicator" id="server-status-indicator">
              <span class="status-dot" id="server-status-dot"></span>
              <span id="server-status-text">Online (DEV)</span>
            </div>

            <div class="profile-dropdown-wrapper" id="profile-dropdown-wrapper">
              <button
                type="button"
                class="profile-trigger-btn"
                onclick="toggleProfileDropdown(event)"
                aria-label="User Menu">
                <div class="profile-avatar">A</div>
                <iconify-icon
                  icon="lucide:chevron-down"
                  class="profile-trigger-chevron"></iconify-icon>
              </button>

              <div class="profile-menu" id="profile-menu">
                <div class="profile-header-info">
                  <span class="profile-admin-name">Administrator</span>
                </div>
                <button
                  type="button"
                  onclick="resetAnalytics(); toggleProfileDropdown(event);">
                  <iconify-icon
                    icon="lucide:trash-2"
                    class="profile-menu-reset-icon"></iconify-icon>
                  <span>Reset Analytics</span>
                </button>
                {process.env.DASHPASS ? (
                  <a href="/_dashboard/logout" class="profile-menu-logout-link">
                    <iconify-icon icon="lucide:log-out"></iconify-icon>
                    <span>Logout</span>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main>
          <div class="tabs">
            <button
              type="button"
              class="tab-btn active"
              onclick="switchTab('stats')">
              <iconify-icon icon="lucide:activity"></iconify-icon>
              <span>System Stats</span>
            </button>
            <button
              type="button"
              class="tab-btn"
              onclick="switchTab('top-pages')">
              <iconify-icon icon="lucide:file-text"></iconify-icon>
              <span>Top Pages</span>
            </button>
            <button
              type="button"
              class="tab-btn"
              onclick="switchTab('sessions')">
              <iconify-icon icon="lucide:key"></iconify-icon>
              <span>Session Manager</span>
            </button>
            <button
              type="button"
              class="tab-btn"
              onclick="switchTab('database')">
              <iconify-icon icon="lucide:database"></iconify-icon>
              <span>Database Browser</span>
            </button>
            <button type="button" class="tab-btn" onclick="switchTab('logs')">
              <iconify-icon icon="lucide:terminal"></iconify-icon>
              <span>Server Logs</span>
            </button>
            <button type="button" class="tab-btn" onclick="switchTab('routes')">
              <iconify-icon icon="lucide:milestone"></iconify-icon>
              <span>Route Explorer</span>
            </button>
          </div>

          <div id="panel-stats" class="panel active">
            <div class="grid-stats">
              <div class="card glass-effect">
                <span class="card-title">Process Uptime</span>
                <span class="card-value" id="stat-uptime">
                  0s
                </span>
                <span class="card-sub" id="stat-pid">
                  PID: -
                </span>
              </div>
              <div class="card glass-effect">
                <span class="card-title">Ping Latency</span>
                <span class="card-value" id="stat-ping">
                  0 ms
                </span>
                <span class="card-sub">Client Latency</span>
              </div>
              <div class="card glass-effect">
                <span class="card-title">Memory Allocation</span>
                <span class="card-value" id="stat-memory">
                  0 MB
                </span>
                <span class="card-sub" id="stat-mem-total">
                  Total Alloc
                </span>
              </div>
              <div class="card glass-effect">
                <span class="card-title">Active Loggers</span>
                <span class="card-value" id="stat-loggers">
                  0
                </span>
                <span class="card-sub">Connections</span>
              </div>
              <div class="card glass-effect">
                <span class="card-title">Active Sessions</span>
                <span class="card-value" id="stat-sessions">
                  0
                </span>
                <span class="card-sub">In-Memory Store</span>
              </div>
              <div class="card glass-effect">
                <span class="card-title">Bun Runtime</span>
                <span class="card-value" id="stat-bun-version">
                  v-
                </span>
                <span class="card-sub" id="stat-arch">
                  Architecture
                </span>
              </div>
            </div>

            <div class="section-header">
              <h2>
                <iconify-icon icon="lucide:area-chart"></iconify-icon>
                <span>Performance History</span>
              </h2>
              <div class="timescale-selector">
                <button
                  type="button"
                  class="timescale-btn active"
                  id="timescale-1m"
                  onclick="changeTimescale('1m')">
                  1m
                </button>
                <button
                  type="button"
                  class="timescale-btn"
                  id="timescale-1h"
                  onclick="changeTimescale('1h')">
                  1h
                </button>
                <button
                  type="button"
                  class="timescale-btn"
                  id="timescale-1d"
                  onclick="changeTimescale('1d')">
                  1d
                </button>
                <button
                  type="button"
                  class="timescale-btn"
                  id="timescale-7d"
                  onclick="changeTimescale('7d')">
                  7d
                </button>
                <button
                  type="button"
                  class="timescale-btn"
                  id="timescale-30d"
                  onclick="changeTimescale('30d')">
                  30d
                </button>
              </div>
            </div>

            <div class="grid-charts">
              <div class="chart-card glass-effect">
                <span class="card-title">Ping Latency History</span>
                <span class="card-sub">
                  Client-to-server connection latency (last 1 min, 1s
                  resolution)
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
              <div class="chart-card glass-effect">
                <span class="card-title">Memory History</span>
                <span class="card-sub">
                  Heap/RSS RAM consumption (last 1 min, 1s resolution)
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
              <div class="chart-card glass-effect">
                <span class="card-title">WebSocket Connections</span>
                <span class="card-sub">
                  Active client logger tunnels (last 1 min, 1s resolution)
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
              <div class="chart-card glass-effect">
                <span class="card-title">Active Sessions</span>
                <span class="card-sub">
                  In-memory active user sessions (last 1 min, 1s resolution)
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
              <div class="chart-card glass-effect" id="chart-route-hits">
                <span class="card-title">Page Route Hits History</span>
                <span class="card-sub">
                  Application page requests (last 1 min, 1s resolution)
                </span>
                <canvas id="canvas-route-hits" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="pageHits-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="pageHits-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="pageHits-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card glass-effect" id="chart-api-hits">
                <span class="card-title">API Hits History</span>
                <span class="card-sub">
                  API endpoint requests (last 1 min, 1s resolution)
                </span>
                <canvas id="canvas-api-hits" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="apiHits-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="apiHits-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="apiHits-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card glass-effect" id="chart-unique-requests">
                <span class="card-title">Unique Requests History</span>
                <span class="card-sub">
                  Distinct request signatures (last 1 min, 1s resolution)
                </span>
                <canvas id="canvas-unique-requests" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="uniqueRequests-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="uniqueRequests-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="uniqueRequests-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card glass-effect" id="chart-db-hits">
                <span class="card-title">DB Hits History</span>
                <span class="card-sub">
                  Database query executions (last 1 min, 1s resolution)
                </span>
                <canvas id="canvas-db-hits" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="dbHits-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="dbHits-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="dbHits-avg">-</strong>
                  </span>
                </div>
              </div>
              <div class="chart-card glass-effect" id="chart-error-page-hits">
                <span class="card-title">Error Page Hits History</span>
                <span class="card-sub">
                  Custom error page renders (last 1 min, 1s resolution)
                </span>
                <canvas id="canvas-error-page-hits" class="big-chart"></canvas>
                <div class="chart-stats">
                  <span>
                    MIN: <strong id="errorPageHits-min">-</strong>
                  </span>
                  <span>
                    MAX: <strong id="errorPageHits-max">-</strong>
                  </span>
                  <span>
                    AVG: <strong id="errorPageHits-avg">-</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div id="panel-top-pages" class="panel">
            <div class="section-header">
              <h2>
                <iconify-icon icon="lucide:file-text"></iconify-icon>
                <span>Top Visited Pages</span>
              </h2>
              <div class="timescale-selector">
                <button
                  type="button"
                  class="pages-filter-btn"
                  id="pages-filter-1m"
                  onclick="changePagesFilter('1m')">
                  1m
                </button>
                <button
                  type="button"
                  class="pages-filter-btn"
                  id="pages-filter-1h"
                  onclick="changePagesFilter('1h')">
                  1h
                </button>
                <button
                  type="button"
                  class="pages-filter-btn active"
                  id="pages-filter-1d"
                  onclick="changePagesFilter('1d')">
                  1d
                </button>
                <button
                  type="button"
                  class="pages-filter-btn"
                  id="pages-filter-7d"
                  onclick="changePagesFilter('7d')">
                  7d
                </button>
                <button
                  type="button"
                  class="pages-filter-btn"
                  id="pages-filter-30d"
                  onclick="changePagesFilter('30d')">
                  30d
                </button>
              </div>
            </div>

            <div class="card glass-effect top-pages-card">
              <div id="top-pages-list-container">
                <div class="results-empty">
                  <span>Loading top pages...</span>
                </div>
              </div>
            </div>
          </div>

          <div id="panel-sessions" class="panel">
            <div class="session-browser-header glass-effect">
              <div class="actions-row session-browser-title-row">
                <div>
                  <h2>Active Evictable Sessions</h2>
                  <span class="session-browser-subtitle">
                    Search, sort, and page through in-memory session records.
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick="loadSessions()">
                  <iconify-icon icon="lucide:refresh-cw"></iconify-icon>
                  <span>Refresh Sessions</span>
                </button>
              </div>

              <div class="session-browser-controls">
                <input
                  id="session-search-input"
                  class="search-input session-search-input"
                  type="text"
                  placeholder="Search by session id or value..."
                  oninput="queueSessionSearch()"
                />
                <select
                  id="session-sort-by"
                  class="filter-select"
                  onchange="loadSessions()">
                  <option value="accessed">Last Accessed</option>
                  <option value="id">Session ID</option>
                  <option value="keys">Persisted Keys</option>
                </select>
                <select
                  id="session-sort-order"
                  class="filter-select"
                  onchange="loadSessions()">
                  <option value="DESC">Newest First</option>
                  <option value="ASC">Oldest First</option>
                </select>
                <select
                  id="session-page-size"
                  class="filter-select"
                  onchange="changeSessionPageSize()">
                  <option value="10">10 rows</option>
                  <option value="25" selected>
                    25 rows
                  </option>
                  <option value="50">50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="500">500 rows</option>
                </select>
              </div>

              <div class="session-browser-pagination pagination-bar compact">
                <div class="page-nav">
                  <button
                    type="button"
                    id="session-page-prev"
                    class="btn btn-secondary"
                    onclick="prevSessionPage()">
                    <iconify-icon icon="lucide:chevron-left"></iconify-icon>
                    <span>Prev</span>
                  </button>
                  <span id="session-page-info">Page 1 of 1</span>
                  <button
                    type="button"
                    id="session-page-next"
                    class="btn btn-secondary"
                    onclick="nextSessionPage()">
                    <span>Next</span>
                    <iconify-icon icon="lucide:chevron-right"></iconify-icon>
                  </button>
                </div>
                <div class="rows-meta">
                  <span id="session-rows-meta">
                    0 sessions matching filters
                  </span>
                </div>
              </div>
            </div>
            <div class="session-grid" id="session-container">
              <div class="results-empty">
                <span>Loading active sessions...</span>
              </div>
            </div>
          </div>

          {renderDatabaseBrowser()}

          <div id="panel-logs" class="panel">
            <div class="card glass-effect">
              <div class="actions-row">
                <h2>Real-time Server Logs</h2>
                <div class="actions-group">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onclick="toggleLogsPlay()"
                    id="btn-logs-play">
                    <iconify-icon icon="lucide:pause"></iconify-icon>
                    <span>Pause</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-danger"
                    onclick="clearLogs()">
                    <iconify-icon icon="lucide:trash-2"></iconify-icon>
                    <span>Clear Logs</span>
                  </button>
                  <label>
                    <input type="checkbox" id="logs-autoscroll" checked />{' '}
                    Auto-scroll
                  </label>
                </div>
              </div>

              <div id="logs-console" class="log-console">
                <div class="text-secondary">
                  Connecting to server log stream...
                </div>
              </div>
            </div>
          </div>

          <div id="panel-routes" class="panel">
            <div class="routes-layout">
              <div class="card glass-effect routes-sidebar-card">
                <h2>Registered Routes</h2>
                <div class="routes-list-wrap">
                  <ul id="routes-list" class="explorer-list">
                    <li class="results-empty tight">Scanning paths...</li>
                  </ul>
                </div>
              </div>

              <div class="card glass-effect routes-sandbox-card">
                <h2 id="sandbox-title">API Sandbox Runner</h2>

                <div id="sandbox-empty" class="results-empty sandbox-output">
                  <span>Select a route from the list to start testing.</span>
                </div>

                <div id="sandbox-runner" class="sandbox-form">
                  <div class="sandbox-controls">
                    <select
                      id="sandbox-method"
                      class="filter-select"
                      onchange="onSandboxMethodChange(this.value); updateAdvancedSectionVisibility(); updateSandboxUrlPreview();"></select>
                    <input
                      type="text"
                      id="sandbox-url"
                      class="sandbox-input"
                      readonly
                    />{' '}
                    <button
                      type="button"
                      class="btn"
                      onclick="sendSandboxRequest()">
                      <iconify-icon icon="lucide:send"></iconify-icon>
                      <span>Send Request</span>
                    </button>
                  </div>

                  {/* Dynamic Parameters Section */}
                  <div class="route-params-panel">
                    <div class="route-params-header">
                      <span class="section-label">Parameters</span>
                      <button
                        type="button"
                        class="btn btn-secondary btn-small-inline"
                        onclick="addSandboxParameter()">
                        <iconify-icon icon="lucide:plus"></iconify-icon>
                        <span>Add Parameter</span>
                      </button>
                    </div>

                    <div class="params-fields">
                      {/* Table Header */}
                      <div class="params-grid-header">
                        <div>Parameter</div>
                        <div>Type</div>
                        <div>Value</div>
                        <div></div>
                      </div>

                      {/* Parameter Rows Container */}
                      <div id="sandbox-params-list" class="params-fields"></div>
                    </div>
                  </div>

                  {/* Custom (Advanced) Section */}
                  <div id="sandbox-advanced-sec" class="request-body-group">
                    <span class="section-label">Custom (Advanced)</span>
                    <textarea
                      id="sandbox-body"
                      class="request-body-input"
                      placeholder='{\n  "name": "John Doe"\n}'></textarea>
                  </div>

                  <div class="send-section">
                    <div class="send-section-header">
                      <span class="send-label">Response Status & Time:</span>
                      <div class="view-toggle-group">
                        <div
                          class="sandbox-view-toggle"
                          id="sandbox-view-toggle">
                          <button
                            type="button"
                            class="sandbox-view-btn active"
                            id="sandbox-view-code"
                            onclick="switchSandboxView('code')">
                            <iconify-icon icon="lucide:code-2"></iconify-icon>
                            <span>Code</span>
                          </button>
                          <button
                            type="button"
                            class="sandbox-view-btn"
                            id="sandbox-view-preview"
                            onclick="switchSandboxView('preview')">
                            <iconify-icon icon="lucide:eye"></iconify-icon>
                            <span>Preview</span>
                          </button>
                        </div>
                        <span
                          id="sandbox-meta"
                          class="view-toggle-count"></span>
                      </div>
                    </div>
                    <pre id="sandbox-response" class="response-output">
                      No response received yet.
                    </pre>
                    <iframe
                      id="sandbox-preview-frame"
                      title="Sandbox response preview"
                      class="response-view"></iframe>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <script src="/_dashboard/dashboard.js"></script>
      </body>
    </html>
  )
}
