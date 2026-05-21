function switchTab(tabId: string) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));

  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.getAttribute('onclick')?.includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');

  const activePanel = document.getElementById('panel-' + tabId);
  if (activePanel) activePanel.classList.add('active');

  if (tabId === 'sessions') {
    loadSessions();
  } else if (tabId === 'database') {
    loadSchema();
  } else if (tabId === 'logs') {
    initLogsWebSocket();
  } else if (tabId === 'routes') {
    loadRoutes();
  }
}

// History tracking for charts
const historyPing: number[] = [];
const historyMemory: number[] = [];
const historyLoggers: number[] = [];
const historySessions: number[] = [];

interface Tracker {
  min: number;
  max: number;
  sum: number;
  count: number;
}

// Cumulative metrics trackers (min, max, sum, count)
const trackers: Record<string, Tracker> = {
  ping: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  memory: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  loggers: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  sessions: { min: Infinity, max: -Infinity, sum: 0, count: 0 }
};

function updateTracker(key: string, val: number) {
  const t = trackers[key];
  if (val < t.min) t.min = val;
  if (val > t.max) t.max = val;
  t.sum += val;
  t.count += 1;
  const avg = t.sum / t.count;

  const suffix = key === 'ping' ? 'ms' : key === 'memory' ? 'MB' : '';
  const minEl = document.getElementById(key + '-min');
  const maxEl = document.getElementById(key + '-max');
  const avgEl = document.getElementById(key + '-avg');
  if (minEl) minEl.innerText = t.min.toFixed(0) + ' ' + suffix;
  if (maxEl) maxEl.innerText = t.max.toFixed(0) + ' ' + suffix;
  if (avgEl) avgEl.innerText = avg.toFixed(1) + ' ' + suffix;
}

// Uptime tracking variables
let lastStatsTime = Date.now();
let serverUptimeBase = 0;

// Helper to format uptime duration
function formatUptime(totalSeconds: number) {
  if (totalSeconds < 0) return '0s';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const secsStr = secs + 's';
  if (hrs > 0) return hrs + 'h ' + mins + 'm ' + secsStr;
  if (mins > 0) return mins + 'm ' + secsStr;
  return secsStr;
}

// Dynamic Uptime updater running every 500ms
setInterval(() => {
  if (serverUptimeBase > 0) {
    const elapsedMs = Date.now() - lastStatsTime;
    const currentUptimeMs = (serverUptimeBase * 1000) + elapsedMs;
    const uptimeEl = document.getElementById('stat-uptime');
    if (uptimeEl) uptimeEl.innerText = formatUptime(currentUptimeMs / 1000);
  }
}, 500);

function drawSparkline(canvasId: string, dataPoints: number[], colorStart: string, colorEnd: string) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Handle high DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  ctx.clearRect(0, 0, width, height);

  if (dataPoints.length < 2) {
    // Draw placeholder line if not enough points
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();
    return;
  }

  const min = Math.min(...dataPoints);
  const max = Math.max(...dataPoints);
  const range = max - min === 0 ? 1 : max - min;

  // Draw horizontal dashed grid lines and labels on the right
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;

  const gridLines = [0.25, 0.5, 0.75];
  gridLines.forEach(ratio => {
    const y = height - 12 - ratio * (height - 24);
    ctx.moveTo(0, y);
    ctx.lineTo(width - 50, y); // Leave room for label

    const val = min + ratio * range;
    const roundedVal = Math.round(val * 10) / 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '9px monospace';
    ctx.fillText(roundedVal.toString(), width - 42, y + 3);
  });
  ctx.stroke();
  ctx.restore();

  // Draw line path
  ctx.beginPath();
  for (let i = 0; i < dataPoints.length; i++) {
    const x = (i / (dataPoints.length - 1)) * (width - 50); // reserve space on right
    const y = height - 12 - ((dataPoints[i] - min) / range) * (height - 24);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = colorStart;
  ctx.stroke();

  // Draw gradient fill under the line
  ctx.lineTo(width - 50, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colorEnd);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fill();
}

async function loadStats() {
  const start = Date.now();
  try {
    const res = await fetch('/api/_dashboard/stats');
    const latency = Date.now() - start;
    const data = await res.json();
    if (data.status === 200) {
      const s = data.data;
      
      // Track uptime stats
      lastStatsTime = Date.now();
      serverUptimeBase = s.uptimeSeconds || 0;
      const uptimeEl = document.getElementById('stat-uptime');
      if (uptimeEl) uptimeEl.innerText = formatUptime(serverUptimeBase);

      const pidEl = document.getElementById('stat-pid');
      const memoryEl = document.getElementById('stat-memory');
      const memTotalEl = document.getElementById('stat-mem-total');
      const bunVersionEl = document.getElementById('stat-bun-version');
      const archEl = document.getElementById('stat-arch');
      const loggersEl = document.getElementById('stat-loggers');
      const sessionsEl = document.getElementById('stat-sessions');
      const pingEl = document.getElementById('stat-ping');

      if (pidEl) pidEl.innerText = 'PID: ' + s.pid;
      if (memoryEl) memoryEl.innerText = s.memoryUsed;
      if (memTotalEl) memTotalEl.innerText = 'External: ' + s.memoryExternal;
      if (bunVersionEl) bunVersionEl.innerText = s.bunVersion;
      if (archEl) archEl.innerText = s.platform + ' (' + s.arch + ')';
      if (loggersEl) loggersEl.innerText = s.activeLoggers;
      if (sessionsEl) sessionsEl.innerText = s.activeSessions;
      if (pingEl) pingEl.innerText = latency + ' ms';

      // If this is the first load, populate history from server-side backlog
      if (historyMemory.length === 0 && s.history && s.history.length > 0) {
        s.history.forEach((item: any) => {
          historyMemory.push(item.memoryUsed);
          historyLoggers.push(item.activeLoggers);
          historySessions.push(item.activeSessions);
          historyPing.push(0); // Server-side does not know client latency, pad with 0
          
          updateTracker('memory', item.memoryUsed);
          updateTracker('loggers', item.activeLoggers);
          updateTracker('sessions', item.activeSessions);
        });
      }

      // Update charts
      historyPing.push(latency);
      if (historyPing.length > 60) historyPing.shift();
      drawSparkline('canvas-ping', historyPing, '#f43f5e', 'rgba(244, 63, 94, 0.25)');
      updateTracker('ping', latency);

      const memVal = parseFloat(s.memoryUsed) || 0;
      historyMemory.push(memVal);
      if (historyMemory.length > 60) historyMemory.shift();
      drawSparkline('canvas-memory', historyMemory, '#3b82f6', 'rgba(59, 130, 246, 0.25)');
      updateTracker('memory', memVal);

      const loggersVal = s.activeLoggers || 0;
      historyLoggers.push(loggersVal);
      if (historyLoggers.length > 60) historyLoggers.shift();
      drawSparkline('canvas-loggers', historyLoggers, '#10b981', 'rgba(16, 185, 129, 0.25)');
      updateTracker('loggers', loggersVal);

      const sessionsVal = s.activeSessions || 0;
      historySessions.push(sessionsVal);
      if (historySessions.length > 60) historySessions.shift();
      drawSparkline('canvas-sessions', historySessions, '#fbbf24', 'rgba(251, 191, 36, 0.25)');
      updateTracker('sessions', sessionsVal);
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadSessions() {
  const container = document.getElementById('session-container');
  if (!container) return;
  container.innerHTML = '<div class="results-empty"><span>Fetching sessions...</span></div>';

  try {
    const res = await fetch('/api/_dashboard/sessions');
    const json = await res.json();

    if (json.status !== 200 || !json.data || json.data.length === 0) {
      container.innerHTML = '<div class="results-empty"><span>No active sessions found in memory.</span></div>';
      return;
    }

    container.innerHTML = '';
    json.data.forEach((s: any) => {
      const card = document.createElement('div');
      card.className = 'session-card';

      // ─── Header ─────────────────────────────────────────────────────────
      const header = document.createElement('div');
      header.className = 'session-card-header';
      header.innerHTML = `<span class="session-id">${s.id}</span>`;

      const revokeBtn = document.createElement('button');
      revokeBtn.className = 'btn btn-secondary btn-danger';
      revokeBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.75rem;';
      revokeBtn.innerText = 'Revoke';
      revokeBtn.onclick = () => revokeSession(s.id);
      header.appendChild(revokeBtn);

      // ─── Timestamps ──────────────────────────────────────────────────────
      const createdAt = new Date(s.createdAt);
      const expiresAt = new Date(s.createdAt + 24 * 60 * 60 * 1000); // always createdAt + 24h
      const info = document.createElement('div');
      info.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);display:flex;gap:1.5rem;margin-bottom:0.5rem;';
      info.innerHTML = `
        <span>Created: <strong style="color:var(--text-primary)">${createdAt.toLocaleTimeString()}</strong></span>
        <span>Expires: <strong style="color:var(--text-primary)">${expiresAt.toLocaleString()}</strong></span>
      `;

      // ─── Key-Value rows ───────────────────────────────────────────────────
      const kvSection = document.createElement('div');
      kvSection.style.cssText = 'display:flex;flex-direction:column;gap:0.35rem;margin-top:0.5rem;';

      const entries = Object.entries(s.data as Record<string, any>);
      const SHOW_LIMIT = 3;

      function renderKVRows(showAll: boolean) {
        kvSection.innerHTML = '';
        const visible = showAll ? entries : entries.slice(0, SHOW_LIMIT);

        visible.forEach(([k, v]) => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:0.375rem;padding:0.3rem 0.6rem;';

          const keyEl = document.createElement('span');
          keyEl.style.cssText = 'font-size:0.8rem;font-weight:600;color:var(--text-secondary);min-width:120px;font-family:monospace;';
          keyEl.innerText = k;

          const valEl = document.createElement('span');
          valEl.style.cssText = 'font-size:0.8rem;color:var(--text-primary);flex:1;font-family:monospace;word-break:break-all;';
          valEl.innerText = typeof v === 'object' ? JSON.stringify(v) : String(v);

          const editBtn = document.createElement('button');
          editBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text-secondary);font-size:0.85rem;padding:0.1rem 0.25rem;border-radius:0.25rem;transition:color 0.15s;';
          editBtn.title = 'Edit value';
          editBtn.innerHTML = '<iconify-icon icon="material-symbols:edit-outline" style="font-size: 0.95rem; vertical-align: middle;"></iconify-icon>';
          editBtn.onmouseenter = () => editBtn.style.color = 'var(--text-primary)';
          editBtn.onmouseleave = () => editBtn.style.color = 'var(--text-secondary)';
          editBtn.onclick = () => openSessionKeyEditor(s.id, k, String(typeof v === 'object' ? JSON.stringify(v) : v), () => loadSessions());

          const delBtn = document.createElement('button');
          delBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--accent-red);font-size:0.85rem;padding:0.1rem 0.25rem;border-radius:0.25rem;opacity:0.7;transition:opacity 0.15s;';
          delBtn.title = 'Delete key';
          delBtn.innerHTML = '<iconify-icon icon="material-symbols:delete-outline" style="font-size: 0.95rem; vertical-align: middle;"></iconify-icon>';
          delBtn.onmouseenter = () => delBtn.style.opacity = '1';
          delBtn.onmouseleave = () => delBtn.style.opacity = '0.7';
          delBtn.onclick = async () => {
            await sessionKeyAction(s.id, k, null, true);
            loadSessions();
          };

          row.appendChild(keyEl);
          row.appendChild(valEl);
          row.appendChild(editBtn);
          row.appendChild(delBtn);
          kvSection.appendChild(row);
        });

        // Show more / collapse toggle
        if (entries.length > SHOW_LIMIT) {
          const toggle = document.createElement('button');
          toggle.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);background:none;border:none;cursor:pointer;text-align:left;padding:0.1rem 0;margin-top:0.1rem;transition:color 0.15s;';
          toggle.innerText = showAll ? `▲ Show fewer` : `▼ Show all ${entries.length} keys`;
          toggle.onmouseenter = () => toggle.style.color = 'var(--text-primary)';
          toggle.onmouseleave = () => toggle.style.color = 'var(--text-secondary)';
          toggle.onclick = () => renderKVRows(!showAll);
          kvSection.appendChild(toggle);
        }

        if (entries.length === 0) {
          const empty = document.createElement('span');
          empty.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);font-style:italic;';
          empty.innerText = 'No data stored in this session.';
          kvSection.appendChild(empty);
        }

        // Add key button
        const addRow = document.createElement('div');
        addRow.style.cssText = 'margin-top:0.35rem;';
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-secondary';
        addBtn.style.cssText = 'font-size:0.75rem;padding:0.25rem 0.65rem;';
        addBtn.innerText = '+ Add Key';
        addBtn.onclick = () => openSessionKeyEditor(s.id, '', '', () => loadSessions(), true);
        addRow.appendChild(addBtn);
        kvSection.appendChild(addRow);
      }

      renderKVRows(false);

      card.appendChild(header);
      card.appendChild(info);
      card.appendChild(kvSection);
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div class="results-empty"><span>Error loading sessions.</span></div>';
  }
}

async function sessionKeyAction(sessionId: string, key: string, value: any, remove = false) {
  try {
    const res = await fetch('/api/_dashboard/sessions/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId, key, value, remove }),
    });
    const json = await res.json();
    if (json.status !== 200) alert('Failed: ' + json.message);
  } catch {
    alert('Connection error.');
  }
}

function openSessionKeyEditor(sessionId: string, key: string, currentValue: string, onDone: () => void, isNew = false) {
  // Remove any existing editor modal
  document.getElementById('session-key-editor-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'session-key-editor-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '200';

  const card = document.createElement('div');
  card.className = 'modal-card';
  card.style.maxWidth = '420px';
  card.innerHTML = `
    <div class="modal-header">
      <h3>${isNew ? 'Add Session Key' : `Edit Key: <code style="font-size:0.85em;font-weight:400;">${key}</code>`}</h3>
      <button class="modal-close" id="skey-close">×</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:0.75rem;">
      ${isNew ? `
        <div class="form-group">
          <label class="label">Key</label>
          <input class="input-field" id="skey-key-input" type="text" placeholder="e.g. userId" value="${key}" />
        </div>
      ` : ''}
      <div class="form-group">
        <label class="label">Value <span style="font-size:0.7rem;color:var(--text-secondary);">(string)</span></label>
        <input class="input-field" id="skey-val-input" type="text" placeholder="value" value="${escapeHtml(currentValue)}" />
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="skey-cancel">Cancel</button>
      <button class="btn" id="skey-save">Save</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('skey-close')!.onclick = close;
  document.getElementById('skey-cancel')!.onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('skey-save')!.onclick = async () => {
    const finalKey = isNew ? (document.getElementById('skey-key-input') as HTMLInputElement)?.value?.trim() : key;
    const val = (document.getElementById('skey-val-input') as HTMLInputElement)?.value ?? '';
    if (!finalKey) { alert('Key cannot be empty.'); return; }
    await sessionKeyAction(sessionId, finalKey, val);
    close();
    onDone();
  };

  // Focus the right input
  setTimeout(() => {
    const el = document.getElementById(isNew ? 'skey-key-input' : 'skey-val-input') as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, 50);
}

async function revokeSession(sessionId: string) {
  if (!confirm('Are you sure you want to revoke this session?')) return;
  try {
    const res = await fetch('/api/_dashboard/sessions/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId })
    });
    const data = await res.json();
    if (data.status === 200) {
      loadSessions();
    } else {
      alert('Failed to revoke session: ' + data.message);
    }
  } catch (err) {
    alert('Error revoking session.');
  }
}


// Database Browser State variables
let currentInspectedTable: string | null = null;
let dbCurrentPage = 1;
let dbPageSize = 50;
let dbTotalPages = 1;
let dbActiveFilters: Array<{ column: string; operator: string; value: string }> = [];
let dbSortBy: string | null = null;
let dbSortOrder: 'ASC' | 'DESC' = 'ASC';
let dbSchemaCache: any[] = [];

async function loadSchema() {
  const list = document.getElementById('tables-list');
  if (!list) return;
  try {
    const res = await fetch('/api/_dashboard/schema');
    const json = await res.json();

    if (json.status !== 200 || !json.data || json.data.length === 0) {
      list.innerHTML = '<li class="results-empty" style="padding: 1rem 0;">No tables found</li>';
      const countEl = document.getElementById('tables-count');
      if (countEl) countEl.innerText = '(0)';
      dbSchemaCache = [];
      return;
    }

    dbSchemaCache = json.data;
    list.innerHTML = '';
    const countEl = document.getElementById('tables-count');
    if (countEl) countEl.innerText = `(${json.data.length})`;

    json.data.forEach((t: any) => {
      const li = document.createElement('li');
      li.className = 'table-group';

      const details = document.createElement('details');
      details.className = 'table-details';
      
      if (currentInspectedTable === t.name) {
        details.setAttribute('open', '');
      }

      const summary = document.createElement('summary');
      summary.className = 'table-summary';
      summary.innerHTML = `
        <div class="table-item-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="table-item-name" style="display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500;">
            <iconify-icon icon="material-symbols:table-chart-outline" style="font-size: 1rem;"></iconify-icon>
            <span>${t.name}</span>
          </span>
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <span class="table-item-rows">${t.rowCount} rows</span>
            <button class="btn btn-secondary" style="padding: 0.15rem 0.4rem; font-size: 0.7rem; border-radius: 0.25rem; display: inline-flex; align-items: center; gap: 0.15rem;" onclick="event.preventDefault(); event.stopPropagation(); selectDatabaseTable('${t.name}')">
              <iconify-icon icon="material-symbols:visibility-outline" style="font-size: 0.85rem;"></iconify-icon>
              <span>View</span>
            </button>
          </div>
        </div>
      `;
      details.appendChild(summary);

      const info = document.createElement('div');
      info.className = 'table-schema-info';

      // Columns section
      let colsHtml = '';
      if (t.columns && t.columns.length > 0) {
        colsHtml = `
          <div class="schema-sec">
            <span class="schema-sec-title">Columns</span>
            <ul class="schema-fields">
              ${t.columns.map((c: any) => `
                <li>
                  ${c.name}
                  <span class="field-type">${c.type || 'NUMERIC'}</span>
                  ${c.pk ? '<span class="field-badge pk">PK</span>' : ''}
                  ${c.notnull ? '<span class="field-badge nn">NN</span>' : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      // Indexes section
      let idxsHtml = '';
      if (t.indexes && t.indexes.length > 0) {
        idxsHtml = `
          <div class="schema-sec">
            <span class="schema-sec-title">Indexes</span>
            <ul class="schema-fields">
              ${t.indexes.map((i: any) => `
                <li>
                  ${i.name}
                  ${i.unique ? '<span class="field-badge pk">UNIQ</span>' : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      info.innerHTML = `
        ${colsHtml}
        ${idxsHtml}
        <button class="btn-inspect" onclick="inspectTable('${t.name}')">Console Inspect</button>
      `;

      details.appendChild(info);
      li.appendChild(details);
      list.appendChild(li);
    });

    if (!currentInspectedTable && json.data.length > 0) {
      selectDatabaseTable(json.data[0].name);
    }
  } catch (err) {
    list.innerHTML = '<li class="results-empty" style="padding: 1rem 0;">Error scanning tables</li>';
  }
}

function filterTablesList() {
  const searchInput = document.getElementById('db-table-search') as HTMLInputElement | null;
  const filter = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const listItems = document.querySelectorAll('#tables-list > li.table-group');
  listItems.forEach((item: any) => {
    const nameEl = item.querySelector('.table-item-name');
    if (nameEl) {
      const tableName = nameEl.textContent.trim().toLowerCase();
      if (tableName.includes(filter)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    }
  });
}

function selectDatabaseTable(tableName: string) {
  currentInspectedTable = tableName;
  dbCurrentPage = 1;
  dbActiveFilters = [];
  dbSortBy = null;
  dbSortOrder = 'ASC';

  const viewCard = document.getElementById('db-browser-view');
  if (viewCard) viewCard.style.display = 'flex';

  const titleEl = document.getElementById('current-table-title');
  if (titleEl) {
    titleEl.innerHTML = `
      <iconify-icon icon="material-symbols:table-chart-outline" style="font-size: 1.25rem;"></iconify-icon>
      <span>${tableName}</span>
    `;
  }

  const colSelect = document.getElementById('filter-col-select') as HTMLSelectElement | null;
  if (colSelect) {
    const tableSchema = dbSchemaCache.find(t => t.name === tableName);
    colSelect.innerHTML = '<option value="">-- Choose Column --</option>';
    if (tableSchema && tableSchema.columns) {
      tableSchema.columns.forEach((c: any) => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.innerText = `${c.name} (${c.type || 'NUMERIC'})`;
        colSelect.appendChild(opt);
      });
    }
  }

  const queryEl = document.getElementById('sql-query') as HTMLTextAreaElement | null;
  if (queryEl) {
    queryEl.value = `SELECT * FROM \`${tableName}\` LIMIT 50;`;
  }

  renderFilterChips();
  fetchTableData();
}

async function fetchTableData() {
  if (!currentInspectedTable) return;
  const gridContainer = document.getElementById('browser-grid-body');
  if (gridContainer) {
    gridContainer.innerHTML = '<div class="results-empty"><span>Loading data...</span></div>';
  }

  try {
    const filterObj: Record<string, string> = {};
    dbActiveFilters.forEach(f => {
      filterObj[f.column] = f.value;
    });

    const params = new URLSearchParams({
      tableName: currentInspectedTable,
      page: dbCurrentPage.toString(),
      pageSize: dbPageSize.toString(),
      filters: JSON.stringify(filterObj),
    });

    if (dbSortBy) {
      params.append('sortBy', dbSortBy);
      params.append('sortOrder', dbSortOrder);
    }

    const res = await fetch(`/api/_dashboard/table-data?${params.toString()}`);
    const json = await res.json();

    if (json.status !== 200) {
      if (gridContainer) {
        gridContainer.innerHTML = `<div class="results-empty" style="color: var(--accent-red);"><span style="display: inline-flex; align-items: center; gap: 0.25rem;"><iconify-icon icon="material-symbols:warning-outline" style="font-size: 1.1rem;"></iconify-icon>Error: ${json.message}</span></div>`;
      }
      return;
    }

    const { rows, totalRows, page, pageSize, totalPages } = json.data;
    dbTotalPages = totalPages || 1;

    const metaEl = document.getElementById('db-rows-meta');
    if (metaEl) metaEl.innerText = `${totalRows} rows matching filters`;
    
    const countBadge = document.getElementById('table-row-count-badge');
    if (countBadge) countBadge.innerText = `${totalRows} rows`;

    const pageInfo = document.getElementById('db-page-info');
    if (pageInfo) pageInfo.innerText = `Page ${page} of ${dbTotalPages}`;

    const prevBtn = document.getElementById('btn-page-prev') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('btn-page-next') as HTMLButtonElement | null;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= dbTotalPages;

    if (rows.length === 0) {
      if (gridContainer) {
        gridContainer.innerHTML = '<div class="results-empty"><span>Empty set returned. Click "Add Row" to insert data.</span></div>';
      }
      return;
    }

    const tableSchema = dbSchemaCache.find(t => t.name === currentInspectedTable);
    const columns = tableSchema ? tableSchema.columns.map((c: any) => c.name) : Object.keys(rows[0]).filter(k => k !== 'rowid');
    
    let tableHtml = '<div class="table-wrapper"><table class="interactive-grid"><thead><tr>';
    
    const hasRowid = rows[0].hasOwnProperty('rowid');
    if (hasRowid) {
      tableHtml += `<th style="color: var(--text-secondary); width: 60px;">rowid</th>`;
    }

    columns.forEach((col: string) => {
      const isSorted = dbSortBy === col;
      const arrow = isSorted ? (dbSortOrder === 'ASC' ? ' ▴' : ' ▾') : '';
      const activeClass = isSorted ? 'class="sorted-column"' : '';
      tableHtml += `<th onclick="toggleGridSort('${col}')" style="cursor: pointer; user-select: none;" ${activeClass}>${col}${arrow}</th>`;
    });

    tableHtml += '<th style="width: 120px;">Actions</th></tr></thead><tbody>';

    rows.forEach((row: any) => {
      const rowidVal = row['rowid'];
      tableHtml += '<tr>';

      if (hasRowid) {
        tableHtml += `<td style="color: var(--text-secondary); font-weight: 500;">${rowidVal}</td>`;
      }

      columns.forEach((col: string) => {
        const val = row[col];
        let displayVal = '';
        let cellClass = '';
        
        if (val === null) {
          displayVal = '<em>null</em>';
          cellClass = 'cell-null';
        } else if (typeof val === 'object') {
          displayVal = JSON.stringify(val);
          cellClass = 'cell-json';
        } else if (typeof val === 'boolean' || (col.toLowerCase().includes('status') && (val === 0 || val === 1))) {
          displayVal = val ? '<span class="badge badge-success">true</span>' : '<span class="badge badge-secondary">false</span>';
          cellClass = 'cell-boolean';
        } else {
          displayVal = escapeHtml(String(val));
        }

        tableHtml += `
          <td 
            class="${cellClass} editable-cell" 
            ondblclick="startInlineEdit(this, '${currentInspectedTable}', ${rowidVal}, '${col}')"
            title="Double-click to inline edit"
          >
            ${displayVal}
          </td>
        `;
      });

      const rowEscapedJson = encodeURIComponent(JSON.stringify(row));
      tableHtml += `
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <button class="btn btn-secondary" style="padding: 0.15rem 0.35rem; font-size: 0.7rem; border-radius: 0.25rem; display: inline-flex; align-items: center; gap: 0.2rem;" onclick="openEditModal('${rowEscapedJson}')">
              <iconify-icon icon="material-symbols:edit-outline" style="font-size: 0.85rem;"></iconify-icon>
              <span>Edit</span>
            </button>
            <button class="btn btn-secondary btn-danger" style="padding: 0.15rem 0.35rem; font-size: 0.7rem; border-radius: 0.25rem; display: inline-flex; align-items: center; gap: 0.2rem;" onclick="deleteTableRow('${currentInspectedTable}', ${rowidVal})">
              <iconify-icon icon="material-symbols:delete-outline" style="font-size: 0.85rem;"></iconify-icon>
              <span>Delete</span>
            </button>
          </div>
        </td>
      `;

      tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table></div>';
    if (gridContainer) gridContainer.innerHTML = tableHtml;

  } catch (err) {
    if (gridContainer) {
      gridContainer.innerHTML = '<div class="results-empty" style="color: var(--accent-red);"><span style="display: inline-flex; align-items: center; gap: 0.25rem;"><iconify-icon icon="material-symbols:warning-outline" style="font-size: 1.1rem;"></iconify-icon>Network connection error.</span></div>';
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toggleGridSort(columnName: string) {
  if (dbSortBy === columnName) {
    dbSortOrder = dbSortOrder === 'ASC' ? 'DESC' : 'ASC';
  } else {
    dbSortBy = columnName;
    dbSortOrder = 'ASC';
  }
  fetchTableData();
}

function prevPage() {
  if (dbCurrentPage > 1) {
    dbCurrentPage--;
    fetchTableData();
  }
}

function nextPage() {
  if (dbCurrentPage < dbTotalPages) {
    dbCurrentPage++;
    fetchTableData();
  }
}

function changePageSize() {
  const sizeEl = document.getElementById('db-page-size') as HTMLSelectElement | null;
  if (sizeEl) {
    dbPageSize = parseInt(sizeEl.value, 10);
    dbCurrentPage = 1;
    fetchTableData();
  }
}

function startInlineEdit(cell: HTMLTableCellElement, tableName: string, rowid: number, column: string) {
  if (cell.querySelector('input')) return;
  
  const originalHtml = cell.innerHTML;
  let text = cell.innerText;
  
  if (cell.classList.contains('cell-null')) {
    text = '';
  }

  cell.classList.add('editing-active');
  cell.removeAttribute('title');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'grid-inline-input';
  input.value = text;
  
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();

  const finishEdit = async (save: boolean) => {
    cell.classList.remove('editing-active');
    cell.setAttribute('title', 'Double-click to inline edit');
    
    if (!save || input.value.trim() === text.trim()) {
      cell.innerHTML = originalHtml;
      return;
    }

    const newVal = input.value.trim();
    
    try {
      const updateData: Record<string, any> = {};
      updateData[column] = newVal === '' ? null : (isNaN(Number(newVal)) ? newVal : Number(newVal));
      
      const res = await fetch('/api/_dashboard/execute-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-row', tableName, rowid, row: updateData })
      });
      const json = await res.json();
      if (json.status === 200) {
        fetchTableData();
      } else {
        alert('Failed to update: ' + json.message);
        cell.innerHTML = originalHtml;
      }
    } catch (err) {
      alert('Error updating row cell inline');
      cell.innerHTML = originalHtml;
    }
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') finishEdit(true);
    if (e.key === 'Escape') finishEdit(false);
  };

  input.onblur = () => {
    finishEdit(true);
  };
}

function addActiveFilter() {
  const colSelect = document.getElementById('filter-col-select') as HTMLSelectElement | null;
  const opSelect = document.getElementById('filter-op-select') as HTMLSelectElement | null;
  const valInput = document.getElementById('filter-val-input') as HTMLInputElement | null;

  if (!colSelect || !opSelect || !valInput) return;

  const column = colSelect.value;
  const operator = opSelect.value;
  const value = valInput.value.trim();

  if (!column) {
    alert('Please choose a column to filter by.');
    return;
  }

  const isNoValOp = ['is_null', 'is_not_null'].includes(operator);
  if (!isNoValOp && value === '') {
    alert('Please enter a filter value.');
    return;
  }

  dbActiveFilters.push({ column, operator, value: isNoValOp ? operator : value });
  valInput.value = '';

  renderFilterChips();
  dbCurrentPage = 1;
  fetchTableData();
}

function removeActiveFilter(idx: number) {
  dbActiveFilters.splice(idx, 1);
  renderFilterChips();
  dbCurrentPage = 1;
  fetchTableData();
}

function clearActiveFilters() {
  dbActiveFilters = [];
  renderFilterChips();
  dbCurrentPage = 1;
  fetchTableData();
}

function renderFilterChips() {
  const container = document.getElementById('active-filters-list');
  if (!container) return;
  container.innerHTML = '';

  if (dbActiveFilters.length === 0) {
    container.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic;">No filters applied</span>';
    return;
  }

  dbActiveFilters.forEach((f, idx) => {
    const chip = document.createElement('div');
    chip.className = 'filter-chip';
    
    let opDisplay = f.operator;
    if (f.operator === 'like') opDisplay = 'contains';
    else if (f.operator === 'is_null') opDisplay = 'is null';
    else if (f.operator === 'is_not_null') opDisplay = 'is not null';

    chip.innerHTML = `
      <span>${f.column} <strong>${opDisplay}</strong> ${['is_null', 'is_not_null'].includes(f.operator) ? '' : `"${f.value}"`}</span>
      <button onclick="removeActiveFilter(${idx})">&times;</button>
    `;
    container.appendChild(chip);
  });
}

function openInsertModal() {
  if (!currentInspectedTable) return;
  const modal = document.getElementById('modal-insert');
  const container = document.getElementById('insert-fields-container');
  if (!modal || !container) return;

  const tableSchema = dbSchemaCache.find(t => t.name === currentInspectedTable);
  if (!tableSchema) return;

  container.innerHTML = '';
  tableSchema.columns.forEach((c: any) => {
    if (c.pk && (c.type || '').toUpperCase() === 'INTEGER') {
      return;
    }

    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';
    
    const isBool = (c.type || '').toUpperCase() === 'BOOLEAN' || c.name.toLowerCase().includes('status');
    const isNum = ['INTEGER', 'REAL', 'NUMERIC', 'FLOAT'].includes((c.type || '').toUpperCase());

    formGroup.innerHTML = `
      <label class="label" for="insert-field-${c.name}">
        ${c.name} <span class="field-type-sub">${c.type || 'TEXT'}</span>
      </label>
      ${
        isBool ? `
          <select class="input-field" id="insert-field-${c.name}" name="${c.name}">
            <option value="1">true</option>
            <option value="0">false</option>
          </select>
        ` : `
          <input 
            class="input-field" 
            type="${isNum ? 'number' : 'text'}" 
            id="insert-field-${c.name}" 
            name="${c.name}" 
            placeholder="Enter ${c.name}..."
            ${c.notnull ? 'required' : ''}
          />
        `
      }
    `;
    container.appendChild(formGroup);
  });

  modal.style.display = 'flex';
}

function closeInsertModal() {
  const modal = document.getElementById('modal-insert');
  if (modal) modal.style.display = 'none';
}

async function submitInsertRow(e: Event) {
  e.preventDefault();
  if (!currentInspectedTable) return;

  const form = document.getElementById('insert-row-form') as HTMLFormElement | null;
  if (!form) return;

  const formData = new FormData(form);
  const rowData: Record<string, any> = {};
  
  const tableSchema = dbSchemaCache.find(t => t.name === currentInspectedTable);
  if (!tableSchema) return;

  tableSchema.columns.forEach((c: any) => {
    if (c.pk && (c.type || '').toUpperCase() === 'INTEGER') return;
    
    let val: any = formData.get(c.name);
    if (val === '' || val === null) {
      rowData[c.name] = null;
    } else {
      const isNum = ['INTEGER', 'REAL', 'NUMERIC', 'FLOAT'].includes((c.type || '').toUpperCase());
      if (isNum) {
        rowData[c.name] = Number(val);
      } else {
        rowData[c.name] = val;
      }
    }
  });

  try {
    const res = await fetch('/api/_dashboard/execute-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insert-row', tableName: currentInspectedTable, row: rowData })
    });
    const json = await res.json();
    if (json.status === 200) {
      closeInsertModal();
      loadSchema();
      fetchTableData();
    } else {
      alert('Failed to insert row: ' + json.message);
    }
  } catch (err) {
    alert('Connection error while inserting row');
  }
}

function openEditModal(rowEscapedJson: string) {
  if (!currentInspectedTable) return;
  const modal = document.getElementById('modal-edit');
  const container = document.getElementById('edit-fields-container');
  if (!modal || !container) return;

  const row = JSON.parse(decodeURIComponent(rowEscapedJson));
  const tableSchema = dbSchemaCache.find(t => t.name === currentInspectedTable);
  if (!tableSchema) return;

  const rowidEl = document.getElementById('edit-row-rowid') as HTMLInputElement | null;
  if (rowidEl) rowidEl.value = row.rowid !== undefined && row.rowid !== null ? String(row.rowid) : '';

  container.innerHTML = '';
  tableSchema.columns.forEach((c: any) => {
    const isReadOnly = c.pk;

    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';
    
    const isBool = (c.type || '').toUpperCase() === 'BOOLEAN' || c.name.toLowerCase().includes('status');
    const isNum = ['INTEGER', 'REAL', 'NUMERIC', 'FLOAT'].includes((c.type || '').toUpperCase());
    const cellVal = row[c.name] !== undefined ? row[c.name] : '';

    formGroup.innerHTML = `
      <label class="label" for="edit-field-${c.name}">
        ${c.name} <span class="field-type-sub">${c.type || 'TEXT'}</span> ${isReadOnly ? '<span class="field-badge pk" style="margin-left: 0.25rem;">READ-ONLY</span>' : ''}
      </label>
      ${
        isReadOnly ? `
          <input class="input-field" type="text" id="edit-field-${c.name}" name="${c.name}" value="${escapeHtml(String(cellVal))}" disabled />
        ` : isBool ? `
          <select class="input-field" id="edit-field-${c.name}" name="${c.name}">
            <option value="1" ${cellVal == 1 ? 'selected' : ''}>true</option>
            <option value="0" ${cellVal == 0 ? 'selected' : ''}>false</option>
          </select>
        ` : `
          <input 
            class="input-field" 
            type="${isNum ? 'number' : 'text'}" 
            id="edit-field-${c.name}" 
            name="${c.name}" 
            value="${cellVal === null ? '' : escapeHtml(String(cellVal))}"
            ${c.notnull ? 'required' : ''}
          />
        `
      }
    `;
    container.appendChild(formGroup);
  });

  modal.style.display = 'flex';
}

function closeEditModal() {
  const modal = document.getElementById('modal-edit');
  if (modal) modal.style.display = 'none';
}

async function submitEditRow(e: Event) {
  e.preventDefault();
  if (!currentInspectedTable) return;

  const form = document.getElementById('edit-row-form') as HTMLFormElement | null;
  const rowidEl = document.getElementById('edit-row-rowid') as HTMLInputElement | null;
  if (!form || !rowidEl) return;

  const rowid = parseInt(rowidEl.value, 10);
  const formData = new FormData(form);
  const rowData: Record<string, any> = {};
  
  const tableSchema = dbSchemaCache.find(t => t.name === currentInspectedTable);
  if (!tableSchema) return;

  tableSchema.columns.forEach((c: any) => {
    if (c.pk) return;
    
    let val: any = formData.get(c.name);
    if (val === '' || val === null) {
      rowData[c.name] = null;
    } else {
      const isNum = ['INTEGER', 'REAL', 'NUMERIC', 'FLOAT'].includes((c.type || '').toUpperCase());
      if (isNum) {
        rowData[c.name] = Number(val);
      } else {
        rowData[c.name] = val;
      }
    }
  });

  try {
    const res = await fetch('/api/_dashboard/execute-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-row', tableName: currentInspectedTable, rowid, row: rowData })
    });
    const json = await res.json();
    if (json.status === 200) {
      closeEditModal();
      fetchTableData();
    } else {
      alert('Failed to update row: ' + json.message);
    }
  } catch (err) {
    alert('Connection error while saving edits');
  }
}

function openImportModal() {
  const modal = document.getElementById('modal-import');
  const txt = document.getElementById('csv-import-textarea') as HTMLTextAreaElement | null;
  const fileInput = document.getElementById('csv-file-input') as HTMLInputElement | null;
  if (txt) txt.value = '';
  if (fileInput) fileInput.value = '';
  if (modal) modal.style.display = 'flex';
}

function closeImportModal() {
  const modal = document.getElementById('modal-import');
  if (modal) modal.style.display = 'none';
}

function handleCsvFileSelect(e: Event) {
  const fileInput = e.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    const text = evt.target?.result;
    const txtArea = document.getElementById('csv-import-textarea') as HTMLTextAreaElement | null;
    if (txtArea && typeof text === 'string') {
      txtArea.value = text;
    }
  };
  reader.readAsText(file);
}

async function submitImportCsv() {
  if (!currentInspectedTable) return;
  const txtArea = document.getElementById('csv-import-textarea') as HTMLTextAreaElement | null;
  const csvContent = txtArea ? txtArea.value.trim() : '';

  if (!csvContent) {
    alert('Please paste CSV content or upload a CSV file first.');
    return;
  }

  try {
    const res = await fetch('/api/_dashboard/execute-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import-csv', tableName: currentInspectedTable, csvContent })
    });
    const json = await res.json();
    if (json.status === 200) {
      closeImportModal();
      loadSchema();
      fetchTableData();
      alert(json.message || 'CSV imported successfully!');
    } else {
      alert('Import failed: ' + json.message);
    }
  } catch (err) {
    alert('Network error while importing CSV');
  }
}

let exportMenuOpen = false;
function toggleExportMenu() {
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  exportMenuOpen = !exportMenuOpen;
  menu.style.display = exportMenuOpen ? 'block' : 'none';
}

window.addEventListener('click', (e) => {
  const menu = document.getElementById('export-menu');
  const trigger = document.querySelector('.export-dropdown-wrapper button');
  if (menu && trigger && !trigger.contains(e.target as Node) && !menu.contains(e.target as Node)) {
    exportMenuOpen = false;
    menu.style.display = 'none';
  }
});

async function exportToCSV() {
  if (!currentInspectedTable) return;
  exportMenuOpen = false;
  const menu = document.getElementById('export-menu');
  if (menu) menu.style.display = 'none';

  try {
    const filterObj: Record<string, string> = {};
    dbActiveFilters.forEach(f => {
      filterObj[f.column] = f.value;
    });

    const params = new URLSearchParams({
      tableName: currentInspectedTable,
      page: '1',
      pageSize: '100000',
      filters: JSON.stringify(filterObj),
    });
    if (dbSortBy) {
      params.append('sortBy', dbSortBy);
      params.append('sortOrder', dbSortOrder);
    }

    const res = await fetch(`/api/_dashboard/table-data?${params.toString()}`);
    const json = await res.json();

    if (json.status !== 200) {
      alert('Failed to fetch data for export');
      return;
    }

    const rows = json.data.rows;
    if (rows.length === 0) {
      alert('No data rows to export.');
      return;
    }

    const headers = Object.keys(rows[0]).filter(k => k !== 'rowid');
    let csvStr = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';
    
    rows.forEach((row: any) => {
      const line = headers.map(h => {
        let val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') val = JSON.stringify(val);
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvStr += line.join(',') + '\n';
    });

    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${currentInspectedTable}_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert('Error generating CSV export file');
  }
}

async function exportToJSON() {
  if (!currentInspectedTable) return;
  exportMenuOpen = false;
  const menu = document.getElementById('export-menu');
  if (menu) menu.style.display = 'none';

  try {
    const filterObj: Record<string, string> = {};
    dbActiveFilters.forEach(f => {
      filterObj[f.column] = f.value;
    });

    const params = new URLSearchParams({
      tableName: currentInspectedTable,
      page: '1',
      pageSize: '100000',
      filters: JSON.stringify(filterObj),
    });
    if (dbSortBy) {
      params.append('sortBy', dbSortBy);
      params.append('sortOrder', dbSortOrder);
    }

    const res = await fetch(`/api/_dashboard/table-data?${params.toString()}`);
    const json = await res.json();

    if (json.status !== 200) {
      alert('Failed to fetch data for export');
      return;
    }

    const rows = json.data.rows;
    const cleanRows = rows.map((r: any) => {
      const copy = { ...r };
      delete copy.rowid;
      return copy;
    });

    const blob = new Blob([JSON.stringify(cleanRows, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${currentInspectedTable}_export_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert('Error generating JSON export file');
  }
}

async function truncateCurrentTable() {
  if (!currentInspectedTable) return;
  await truncateTable(currentInspectedTable);
}

async function truncateTable(tableName: string) {
  if (!confirm('WARNING: Are you absolutely sure you want to truncate the table "' + tableName + '"? This will delete all rows and reclaim disk space.')) return;
  try {
    const res = await fetch('/api/_dashboard/execute-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'truncate', tableName })
    });
    const json = await res.json();
    if (json.status === 200) {
      loadSchema();
      dbCurrentPage = 1;
      fetchTableData();
      
      const sqlBody = document.getElementById('results-body');
      if (sqlBody) sqlBody.innerHTML = '<div class="results-empty"><span>Table truncated successfully.</span></div>';
      const sqlMeta = document.getElementById('results-meta');
      if (sqlMeta) sqlMeta.innerText = '';
    } else {
      alert('Failed to truncate table: ' + json.message);
    }
  } catch (err) {
    alert('Error executing truncate action');
  }
}

async function deleteTableRow(tableName: string, rowid: number) {
  if (!confirm('Are you sure you want to delete this row?')) return;
  try {
    const res = await fetch('/api/_dashboard/execute-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-row', tableName, rowid })
    });
    const json = await res.json();
    if (json.status === 200) {
      loadSchema();
      fetchTableData();
    } else {
      alert('Failed to delete row: ' + json.message);
    }
  } catch (err) {
    alert('Error executing delete action');
  }
}

function inspectTable(tableName: string) {
  selectDatabaseTable(tableName);
}

function inspectTableData(tableName: string) {
  selectDatabaseTable(tableName);
}

async function runQuery() {
  const queryEl = document.getElementById('sql-query') as HTMLTextAreaElement | null;
  const sql = queryEl ? queryEl.value.trim() : '';
  if (!sql) return;

  const resultsBody = document.getElementById('results-body');
  const meta = document.getElementById('results-meta');
  if (resultsBody) resultsBody.innerHTML = '<div class="results-empty"><span>Executing command...</span></div>';
  if (meta) meta.innerText = '';

  try {
    const res = await fetch('/api/_dashboard/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    const json = await res.json();

    if (json.status !== 200) {
      if (resultsBody) {
        resultsBody.innerHTML = `
          <div class="results-empty" style="color: var(--accent-red);">
            <span style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <iconify-icon icon="material-symbols:warning-outline" style="font-size: 1.1rem;"></iconify-icon>
              <span>Query failed: ${json.message}</span>
            </span>
          </div>
        `;
      }
      return;
    }

    const { rows, isSelect, time } = json.data;

    if (meta) meta.innerText = `${isSelect ? `${rows.length} rows returned` : 'Command executed successfully'} in ${time}ms`;

    if (rows.length === 0) {
      if (resultsBody) resultsBody.innerHTML = '<div class="results-empty"><span>Query executed successfully. Empty set returned.</span></div>';
      return;
    }

    const keys = Object.keys(rows[0]);
    
    let tableHtml = '<div class="table-wrapper"><table><thead><tr>';
    keys.forEach(k => {
      if (k === 'rowid') {
        tableHtml += '<th style="color: var(--text-secondary);">rowid</th>';
      } else {
        tableHtml += `<th>${k}</th>`;
      }
    });
    
    tableHtml += '</tr></thead><tbody>';

    rows.forEach((row: any) => {
      tableHtml += '<tr>';
      keys.forEach(k => {
        const val = row[k];
        tableHtml += `<td>${val === null ? '<em>null</em>' : typeof val === 'object' ? JSON.stringify(val) : escapeHtml(String(val))}</td>`;
      });
      tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table></div>';
    if (resultsBody) resultsBody.innerHTML = tableHtml;
    
    if (!isSelect) {
      loadSchema();
      if (currentInspectedTable) fetchTableData();
    }

  } catch (err) {
    if (resultsBody) resultsBody.innerHTML = '<div class="results-empty" style="color: var(--accent-red);"><span>Connection error.</span></div>';
  }
}

// Real-time server logs websocket client
let logsWs: WebSocket | null = null;
let logsPaused = false;

function initLogsWebSocket() {
  if (logsWs && logsWs.readyState === WebSocket.OPEN) return;
  
  const consoleEl = document.getElementById('logs-console');
  if (!consoleEl) return;
  consoleEl.innerHTML = '<div style="color: var(--text-secondary);">Connecting to server log stream...</div>';
  
  try {
    logsWs = new WebSocket('ws://' + location.host + '/_livereload');
    
    logsWs.onopen = () => {
      consoleEl.innerHTML = '<div style="color: var(--accent-green); display: flex; align-items: center; gap: 0.25rem;"><iconify-icon icon="material-symbols:check-circle-outline" style="font-size: 1.1rem;"></iconify-icon><span>Connected to logs pipeline. Listening for events...</span></div>';
      logsWs?.send(JSON.stringify({ type: 'subscribe_logger' }));
    };
    
    logsWs.onmessage = (event) => {
      if (logsPaused) return;
      
      try {
        const parsed = JSON.parse(event.data);
        const isServerLog = parsed.type === 'server_log';
        const isClientLog = parsed.type === 'client_log';
        
        if (!isServerLog && !isClientLog) return;
        
        const timestamp = new Date(parsed.timestamp || Date.now()).toLocaleTimeString();
        const level = (parsed.level || 'info').toUpperCase();
        const by = parsed.by || 'global';
        const payload = parsed.payload || '';
        
        // Style colors based on level
        let levelColor = '#34d399'; // Info = Green
        if (level === 'WARN') levelColor = '#f59e0b'; // Yellow
        if (level === 'ERROR' || level === 'FATAL') levelColor = '#ef4444'; // Red
        if (level === 'DEBUG') levelColor = '#a855f7'; // Purple
        
        const logRow = document.createElement('div');
        logRow.style.padding = '0.15rem 0';
        logRow.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
        
        logRow.innerHTML = `
          <span style="color: var(--text-secondary); margin-right: 0.5rem;">[${timestamp}]</span>
          <span style="color: ${levelColor}; font-weight: bold; margin-right: 0.5rem;">[${level}]</span>
          <span style="color: #60a5fa; font-weight: 500; margin-right: 0.5rem;">${by}:</span>
          <span style="color: #f1f5f9; white-space: pre-wrap;">${escapeHtml(payload)}</span>
        `;
        
        consoleEl.appendChild(logRow);
        
        // Handle auto-scroll
        const scrollCheck = document.getElementById('logs-autoscroll') as HTMLInputElement | null;
        if (scrollCheck && scrollCheck.checked) {
          consoleEl.scrollTop = consoleEl.scrollHeight;
        }
      } catch (e) {
        // Fallback for raw text message
        const logRow = document.createElement('div');
        logRow.style.color = '#cbd5e1';
        logRow.innerText = event.data;
        consoleEl.appendChild(logRow);
        const scrollCheck = document.getElementById('logs-autoscroll') as HTMLInputElement | null;
        if (scrollCheck && scrollCheck.checked) {
          consoleEl.scrollTop = consoleEl.scrollHeight;
        }
      }
    };
    
    logsWs.onclose = () => {
      const logRow = document.createElement('div');
      logRow.style.color = '#f59e0b';
      logRow.innerHTML = '<span style="display: flex; align-items: center; gap: 0.25rem;"><iconify-icon icon="material-symbols:warning-outline" style="font-size: 1rem;"></iconify-icon><span>Logs pipeline disconnected. Reconnecting in 3s...</span></span>';
      consoleEl.appendChild(logRow);
      setTimeout(initLogsWebSocket, 3000);
    };
  } catch (err) {
    consoleEl.innerHTML = '<div style="color: var(--accent-red);">Failed to establish log stream connection.</div>';
  }
}

function toggleLogsPlay() {
  logsPaused = !logsPaused;
  const btn = document.getElementById('btn-logs-play');
  if (btn) {
    btn.innerHTML = logsPaused ? 
      '<iconify-icon icon="material-symbols:play-circle-outline" style="font-size: 1.1rem;"></iconify-icon><span>Resume</span>' : 
      '<iconify-icon icon="material-symbols:pause-circle-outline" style="font-size: 1.1rem;"></iconify-icon><span>Pause</span>';
    btn.classList.toggle('btn-success', logsPaused);
  }
}

function clearLogs() {
  const consoleEl = document.getElementById('logs-console');
  if (consoleEl) consoleEl.innerHTML = '<div style="color: var(--text-secondary);">Console cleared.</div>';
}

function escapeHtml(text: string) {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Route Explorer & API Sandbox Client Logic
let registeredRoutes: any[] = [];
let activeSelectedRouteObj: any = null;

async function loadRoutes() {
  const list = document.getElementById('routes-list');
  if (!list) return;
  list.innerHTML = '<li class="results-empty" style="padding: 1rem 0;">Scanning paths...</li>';
  
  try {
    const res = await fetch('/api/_dashboard/routes');
    const json = await res.json();
    
    if (json.status !== 200 || !json.data || json.data.length === 0) {
      list.innerHTML = '<li class="results-empty" style="padding: 1rem 0;">No routes found</li>';
      return;
    }
    
    registeredRoutes = json.data;
    list.innerHTML = '';
    
    registeredRoutes.forEach(r => {
      const li = document.createElement('li');
      li.className = 'route-item';
      li.onclick = () => selectRoute(r, li);
      
      li.innerHTML = `
        <span class="route-path" title="${r.path}">${r.path}</span>
        <span class="route-badge ${r.type}">${r.type}</span>
      `;
      
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '<li class="results-empty" style="padding: 1rem 0;">Error scanning routes</li>';
  }
}

function toggleCustomSelect(event: MouseEvent) {
  event.stopPropagation();
  const container = document.getElementById('sandbox-method-container');
  if (!container || container.classList.contains('disabled')) return;
  container.classList.toggle('open');
}

function closeCustomSelect() {
  const container = document.getElementById('sandbox-method-container');
  if (container) container.classList.remove('open');
}

// Close custom select when clicking outside
document.addEventListener('click', closeCustomSelect);

function selectCustomOption(value: string) {
  const labelEl = document.getElementById('sandbox-method-label');
  const inputEl = document.getElementById('sandbox-method') as HTMLInputElement | null;
  const container = document.getElementById('sandbox-method-container');
  
  if (labelEl) labelEl.innerText = value;
  if (inputEl) {
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('change'));
  }
  
  // Highlight selected option
  document.querySelectorAll('.custom-select-option').forEach(opt => {
    if (opt.getAttribute('data-value') === value) {
      opt.classList.add('selected');
    } else {
      opt.classList.remove('selected');
    }
  });

  if (container) container.classList.remove('open');

  onSandboxMethodChange(value);
  updateAdvancedSectionVisibility();
  updateSandboxUrlPreview();
}

function setCustomSelectOptions(options: string[], disabled: boolean = false) {
  const container = document.getElementById('sandbox-method-container');
  const dropdown = document.getElementById('sandbox-method-dropdown');
  
  if (container) {
    if (disabled) {
      container.classList.add('disabled');
    } else {
      container.classList.remove('disabled');
    }
  }

  if (dropdown) {
    dropdown.innerHTML = '';
    options.forEach(optVal => {
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      optDiv.setAttribute('data-value', optVal);
      optDiv.innerText = optVal;
      optDiv.onclick = (e) => {
        e.stopPropagation();
        selectCustomOption(optVal);
      };
      dropdown.appendChild(optDiv);
    });
  }

  // Select the first option by default
  if (options.length > 0) {
    selectCustomOption(options[0]);
  }
}

function isBlobSupported(): boolean {
  const methodEl = document.getElementById('sandbox-method') as HTMLInputElement | null;
  const method = methodEl ? methodEl.value : 'GET';
  return ['POST', 'PUT', 'PATCH'].includes(method);
}

function updateAdvancedSectionVisibility() {
  const methodEl = document.getElementById('sandbox-method') as HTMLInputElement | null;
  const method = methodEl ? methodEl.value : 'GET';
  const advSec = document.getElementById('sandbox-advanced-sec');
  if (advSec) {
    if (['POST', 'PUT', 'PATCH'].includes(method) && activeSelectedRouteObj && activeSelectedRouteObj.type !== 'page') {
      advSec.style.display = 'flex';
    } else {
      advSec.style.display = 'none';
    }
  }
}

function onSandboxMethodChange(method: string) {
  const supportsBlob = ['POST', 'PUT', 'PATCH'].includes(method);
  const rows = document.querySelectorAll('.sandbox-param-row');
  rows.forEach(row => {
    const typeSelect = row.querySelector('.sandbox-param-type') as HTMLSelectElement | null;
    if (typeSelect) {
      const blobOption = typeSelect.querySelector('option[value="blob"]') as HTMLOptionElement | null;
      if (blobOption) {
        if (supportsBlob) {
          blobOption.removeAttribute('disabled');
        } else {
          blobOption.setAttribute('disabled', 'true');
          if (typeSelect.value === 'blob') {
            typeSelect.value = 'string';
            onParameterTypeChange(typeSelect);
          }
        }
      }
    }
  });
}

function onParameterTypeChange(selectEl: HTMLSelectElement) {
  const row = selectEl.closest('.sandbox-param-row') as HTMLElement;
  if (!row) return;
  const valContainer = row.querySelector('.sandbox-param-val-container');
  if (!valContainer) return;
  
  if (selectEl.value === 'blob') {
    valContainer.innerHTML = `<input type="file" class="sandbox-param-val-file" onchange="updateSandboxUrlPreview()" style="width: 100%; font-family: monospace; font-size: 0.85rem; color: var(--text-secondary);" />`;
  } else {
    valContainer.innerHTML = `<input type="text" class="sandbox-param-val" placeholder="Value" oninput="updateSandboxUrlPreview()" style="width: 100%; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;" />`;
  }
  updateSandboxUrlPreview();
}

function addSandboxParameter(name: string = '', type: 'string' | 'blob' = 'string', value: string = '') {
  const paramsList = document.getElementById('sandbox-params-list');
  if (!paramsList) return;
  
  const row = document.createElement('div');
  row.className = 'sandbox-param-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '2fr 1.5fr 3fr 40px';
  row.style.gap = '0.5rem';
  row.style.alignItems = 'center';
  
  const blobDisabled = !isBlobSupported();
  
  row.innerHTML = `
    <div>
      <input type="text" class="sandbox-param-name" placeholder="Param name" value="${name}" oninput="updateSandboxUrlPreview()" style="width: 100%; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;" />
    </div>
    <div>
      <select class="sandbox-param-type" onchange="onParameterTypeChange(this)" style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem; padding: 0.35rem 0.5rem; outline: none; height: 31px;">
        <option value="string" ${type === 'string' ? 'selected' : ''}>string</option>
        <option value="blob" ${type === 'blob' ? 'selected' : ''} ${blobDisabled ? 'disabled' : ''}>blob</option>
      </select>
    </div>
    <div class="sandbox-param-val-container" style="display: flex; align-items: center; width: 100%;">
      ${type === 'blob' ? 
        `<input type="file" class="sandbox-param-val-file" onchange="updateSandboxUrlPreview()" style="width: 100%; font-family: monospace; font-size: 0.85rem; color: var(--text-secondary);" />` :
        `<input type="text" class="sandbox-param-val" placeholder="Value" value="${value}" oninput="updateSandboxUrlPreview()" style="width: 100%; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;" />`
      }
    </div>
    <div style="display: flex; justify-content: center;">
      <button class="btn btn-danger" onclick="removeSandboxParameter(this)" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--accent-red); box-shadow: none; border-radius: 0.25rem; display: inline-flex; align-items: center; justify-content: center;">
        <iconify-icon icon="material-symbols:close-outline" style="font-size: 0.85rem;"></iconify-icon>
      </button>
    </div>
  `;
  
  paramsList.appendChild(row);
  updateSandboxUrlPreview();
}

function removeSandboxParameter(btn: HTMLElement) {
  const row = btn.closest('.sandbox-param-row');
  if (row) {
    row.remove();
  }
  updateSandboxUrlPreview();
}

function selectRoute(route: any, element: HTMLElement) {
  document.querySelectorAll('.route-item').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
  
  activeSelectedRouteObj = route;
  
  const emptyEl = document.getElementById('sandbox-empty');
  const runnerEl = document.getElementById('sandbox-runner');
  const titleEl = document.getElementById('sandbox-title');
  if (emptyEl) emptyEl.style.display = 'none';
  if (runnerEl) runnerEl.style.display = 'flex';
  if (titleEl) titleEl.innerText = 'API Sandbox: ' + route.path;
  
  const urlInput = document.getElementById('sandbox-url') as HTMLInputElement | null;
  if (urlInput) urlInput.value = route.path;
  
  if (route.type === 'page') {
    setCustomSelectOptions(['GET'], true);
  } else {
    setCustomSelectOptions(['GET', 'POST', 'PUT', 'DELETE'], false);
  }
  
  // Check dynamic params [name]
  const params: string[] = [];
  const matches = route.path.match(/\[([^\]]+)\]/g);
  if (matches) {
    matches.forEach((m: string) => {
      params.push(m.slice(1, -1));
    });
  }
  
  const paramsList = document.getElementById('sandbox-params-list');
  if (paramsList) {
    paramsList.innerHTML = '';
    params.forEach(p => {
      addSandboxParameter(p, 'string');
    });
  }
  
  const methodEl = document.getElementById('sandbox-method') as HTMLInputElement | null;
  const method = methodEl ? methodEl.value : 'GET';
  onSandboxMethodChange(method);
  updateAdvancedSectionVisibility();
  updateSandboxUrlPreview();
}

function updateSandboxUrlPreview() {
  if (!activeSelectedRouteObj) return;
  
  let path = activeSelectedRouteObj.path;
  
  const rows = document.querySelectorAll('.sandbox-param-row');
  const queryParams: string[] = [];
  
  const methodEl = document.getElementById('sandbox-method') as HTMLInputElement | null;
  const method = methodEl ? methodEl.value : 'GET';
  
  rows.forEach(row => {
    const nameEl = row.querySelector('.sandbox-param-name') as HTMLInputElement | null;
    const typeEl = row.querySelector('.sandbox-param-type') as HTMLSelectElement | null;
    
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) return;
    
    // Get value
    let val = '';
    if (typeEl && typeEl.value === 'blob') {
      const fileEl = row.querySelector('.sandbox-param-val-file') as HTMLInputElement | null;
      if (fileEl && fileEl.files && fileEl.files[0]) {
        val = fileEl.files[0].name;
      } else {
        val = '[file]';
      }
    } else {
      const valEl = row.querySelector('.sandbox-param-val') as HTMLInputElement | null;
      val = valEl ? valEl.value : '';
    }
    
    // Replace in path if placeholder exists
    const placeholder = '[' + name + ']';
    if (path.includes(placeholder)) {
      path = path.replace(placeholder, val || placeholder);
    } else {
      // It's a query parameter for preview if GET/DELETE
      if (['GET', 'DELETE'].includes(method)) {
        if (val) {
          queryParams.push(encodeURIComponent(name) + '=' + encodeURIComponent(val));
        }
      }
    }
  });
  
  if (queryParams.length > 0) {
    path += '?' + queryParams.join('&');
  }
  
  const urlEl = document.getElementById('sandbox-url') as HTMLInputElement | null;
  if (urlEl) urlEl.value = path;
}

async function sendSandboxRequest() {
  if (!activeSelectedRouteObj) return;
  
  const methodEl = document.getElementById('sandbox-method') as HTMLSelectElement | null;
  const urlEl = document.getElementById('sandbox-url') as HTMLInputElement | null;
  const method = methodEl ? methodEl.value : 'GET';
  const path = urlEl ? urlEl.value : '';
  
  const meta = document.getElementById('sandbox-meta');
  const responseContainer = document.getElementById('sandbox-response');
  
  if (meta) meta.innerText = 'Executing...';
  if (responseContainer) responseContainer.innerText = 'Sending request...';
  
  const headers: Record<string, string> = {};
  let body: any = undefined;
  
  const rows = document.querySelectorAll('.sandbox-param-row');
  let hasBlob = false;
  rows.forEach(row => {
    const typeEl = row.querySelector('.sandbox-param-type') as HTMLSelectElement | null;
    if (typeEl && typeEl.value === 'blob') {
      hasBlob = true;
    }
  });
  
  if (['POST', 'PUT', 'PATCH'].includes(method) && activeSelectedRouteObj.type !== 'page') {
    if (hasBlob) {
      const formData = new FormData();
      rows.forEach(row => {
        const nameEl = row.querySelector('.sandbox-param-name') as HTMLInputElement | null;
        const typeEl = row.querySelector('.sandbox-param-type') as HTMLSelectElement | null;
        
        if (!nameEl) return;
        const name = nameEl.value.trim();
        if (!name) return;
        
        const placeholder = '[' + name + ']';
        if (activeSelectedRouteObj.path.includes(placeholder)) return;
        
        if (typeEl && typeEl.value === 'blob') {
          const fileEl = row.querySelector('.sandbox-param-val-file') as HTMLInputElement | null;
          if (fileEl && fileEl.files && fileEl.files[0]) {
            formData.append(name, fileEl.files[0]);
          }
        } else {
          const valEl = row.querySelector('.sandbox-param-val') as HTMLInputElement | null;
          formData.append(name, valEl ? valEl.value : '');
        }
      });
      body = formData;
    } else {
      const bodyObj: Record<string, any> = {};
      rows.forEach(row => {
        const nameEl = row.querySelector('.sandbox-param-name') as HTMLInputElement | null;
        
        if (!nameEl) return;
        const name = nameEl.value.trim();
        if (!name) return;
        
        const placeholder = '[' + name + ']';
        if (activeSelectedRouteObj.path.includes(placeholder)) return;
        
        const valEl = row.querySelector('.sandbox-param-val') as HTMLInputElement | null;
        bodyObj[name] = valEl ? valEl.value : '';
      });
      
      const bodyEl = document.getElementById('sandbox-body') as HTMLTextAreaElement | null;
      const rawBody = bodyEl ? bodyEl.value.trim() : '';
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody);
          Object.assign(bodyObj, parsed);
        } catch (e) {
          alert('Invalid Advanced JSON body');
          if (meta) meta.innerText = 'Error';
          if (responseContainer) responseContainer.innerText = 'Invalid JSON request body format in Custom (Advanced).';
          return;
        }
      }
      
      if (Object.keys(bodyObj).length > 0 || rawBody) {
        body = JSON.stringify(bodyObj, null, 2);
        headers['Content-Type'] = 'application/json';
      }
    }
  }
  
  const start = performance.now();
  try {
    const res = await fetch(path, {
      method,
      headers,
      body
    });
    
    const duration = (performance.now() - start).toFixed(1);
    const contentType = res.headers.get('Content-Type') || '';
    
    if (meta) meta.innerText = `STATUS: ${res.status} ${res.statusText} | ${duration}ms`;
    
    if (responseContainer) {
      if (contentType.includes('application/json')) {
        const json = await res.json();
        responseContainer.innerText = JSON.stringify(json, null, 2);
        responseContainer.style.color = '#a5f3fc'; // Cyan for JSON
      } else {
        const text = await res.text();
        responseContainer.innerText = text;
        responseContainer.style.color = '#cbd5e1'; // Grey/white for HTML/text
      }
    }
  } catch (err: any) {
    const duration = (performance.now() - start).toFixed(1);
    if (meta) meta.innerText = `FAILED | ${duration}ms`;
    if (responseContainer) {
      responseContainer.innerText = 'Network error: ' + err.message;
      responseContainer.style.color = '#ef4444';
    }
  }
}

// Expose functions globally for inline HTML event handlers
(window as any).switchTab = switchTab;
(window as any).loadSessions = loadSessions;
(window as any).revokeSession = revokeSession;
(window as any).runQuery = runQuery;
(window as any).toggleLogsPlay = toggleLogsPlay;
(window as any).clearLogs = clearLogs;
(window as any).sendSandboxRequest = sendSandboxRequest;
(window as any).toggleCustomSelect = toggleCustomSelect;
(window as any).selectCustomOption = selectCustomOption;
(window as any).inspectTable = inspectTable;
(window as any).inspectTableData = inspectTableData;
(window as any).deleteTableRow = deleteTableRow;
(window as any).truncateTable = truncateTable;
(window as any).updateSandboxUrlPreview = updateSandboxUrlPreview;
(window as any).addSandboxParameter = addSandboxParameter;
(window as any).onParameterTypeChange = onParameterTypeChange;
(window as any).removeSandboxParameter = removeSandboxParameter;

// Initial loads
loadStats();
setInterval(loadStats, 1000);
