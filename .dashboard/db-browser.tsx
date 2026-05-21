export function renderDatabaseBrowser() {
  return (
    <div id="panel-database" class="panel">
      <div class="db-container">
        {/* Left Sidebar: Discovered Tables & Schema Details */}
        <div class="sidebar">
          <div class="sidebar-search">
            <input 
              type="text" 
              id="db-table-search" 
              class="search-input" 
              placeholder="Search tables..." 
              oninput="filterTablesList()"
            />
          </div>
          <div class="sidebar-title">
            <span>DISCOVERED TABLES</span>
            <span id="tables-count">(0)</span>
          </div>
          <ul class="table-list" id="tables-list">
            <li class="results-empty" style="padding: 1rem 0;">
              Scanning schema...
            </li>
          </ul>
        </div>

        {/* Right Content Area: Main Browser and SQL Terminal */}
        <div class="console-container">
          
          {/* Visual Browser Header (Shown only when a table is selected) */}
          <div id="db-browser-view" class="browser-card" style="display: none; flex-direction: column; gap: 1rem; margin-bottom: 1rem;">
            <div class="browser-header">
              <div class="table-info">
                <h2 id="current-table-title" style="font-size: 1.15rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem; color: #ffffff;">
                  <iconify-icon icon="material-symbols:table-chart-outline" style="font-size: 1.25rem;"></iconify-icon>
                  <span>users</span>
                </h2>
                <span id="table-row-count-badge" class="badge">0 rows</span>
              </div>
              <div class="actions-group">
                <button class="btn btn-primary" onclick="openInsertModal()" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                  <iconify-icon icon="material-symbols:add-outline" style="font-size: 1.1rem;"></iconify-icon>
                  <span>Add Row</span>
                </button>
                <button class="btn btn-secondary" onclick="openImportModal()" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                  <iconify-icon icon="material-symbols:upload-file-outline" style="font-size: 1.1rem;"></iconify-icon>
                  <span>Import CSV</span>
                </button>
                <div class="export-dropdown-wrapper">
                  <button class="btn btn-secondary" onclick="toggleExportMenu()" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                    <iconify-icon icon="material-symbols:download-outline" style="font-size: 1.1rem;"></iconify-icon>
                    <span>Export ▾</span>
                  </button>
                  <div id="export-menu" class="export-menu" style="display: none;">
                    <button onclick="exportToCSV()">Export to CSV</button>
                    <button onclick="exportToJSON()">Export to JSON</button>
                  </div>
                </div>
                <button class="btn btn-secondary btn-danger" onclick="truncateCurrentTable()" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                  <iconify-icon icon="material-symbols:warning-outline" style="font-size: 1.1rem;"></iconify-icon>
                  <span>Truncate</span>
                </button>
              </div>
            </div>

            {/* Filter Query Builder Bar */}
            <div class="filter-builder-card">
              <div class="filter-builder-row">
                <span class="filter-label" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                  <iconify-icon icon="material-symbols:search-outline" style="font-size: 1.1rem;"></iconify-icon>
                  <span>Filters</span>
                </span>
                <select id="filter-col-select" class="filter-select">
                  <option value="">-- Choose Column --</option>
                </select>
                <select id="filter-op-select" class="filter-select">
                  <option value="like">contains</option>
                  <option value="=">equals</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  <option value="is_null">is null</option>
                  <option value="is_not_null">is not null</option>
                </select>
                <input 
                  type="text" 
                  id="filter-val-input" 
                  class="filter-input" 
                  placeholder="Filter value..." 
                />
                <button class="btn btn-secondary" onclick="addActiveFilter()" style="padding: 0.35rem 0.75rem;">
                  Apply
                </button>
                <button class="btn btn-secondary" onclick="clearActiveFilters()" style="padding: 0.35rem 0.75rem;">
                  Clear All
                </button>
              </div>
              <div id="active-filters-list" class="active-filters-list">
                {/* Dynamically generated filter chips */}
              </div>
            </div>

            {/* Pagination Controls */}
            <div class="pagination-bar">
              <div class="page-size-selector">
                <span>Show</span>
                <select id="db-page-size" class="filter-select" onchange="changePageSize()" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; width: 80px;">
                  <option value="10">10 rows</option>
                  <option value="25">25 rows</option>
                  <option value="50" selected>50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="500">500 rows</option>
                </select>
              </div>
              <div class="page-nav">
                <button id="btn-page-prev" class="btn btn-secondary" onclick="prevPage()" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.15rem;">
                  <iconify-icon icon="material-symbols:chevron-left-outline" style="font-size: 1rem;"></iconify-icon>
                  <span>Prev</span>
                </button>
                <span id="db-page-info" style="font-size: 0.85rem; font-weight: 500; min-width: 100px; text-align: center;">
                  Page 1 of 1
                </span>
                <button id="btn-page-next" class="btn btn-secondary" onclick="nextPage()" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.15rem;">
                  <span>Next</span>
                  <iconify-icon icon="material-symbols:chevron-right-outline" style="font-size: 1rem;"></iconify-icon>
                </button>
              </div>
              <div class="rows-meta">
                <span id="db-rows-meta" style="font-size: 0.8rem; color: var(--text-secondary);">
                  0 rows matching filters
                </span>
              </div>
            </div>

            {/* Interactive Data Table Grid */}
            <div class="results-card" style="margin: 0;">
              <div id="browser-grid-body" style="overflow-x: auto; max-height: 480px; position: relative;">
                <div class="results-empty">
                  <span>Loading table data...</span>
                </div>
              </div>
            </div>
          </div>

          {/* SQL Terminal Console */}
          <div class="editor-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <h2 style="font-size: 1rem; font-weight: 600;">
                SQLite SQL Terminal
              </h2>
              <span class="console-mode-badge">Read/Write Mode Enabled</span>
            </div>
            <textarea
              class="sql-textarea"
              id="sql-query"
              placeholder="SELECT * FROM users LIMIT 10;"
            ></textarea>
            <div class="actions-row">
              <span style="font-size: 0.8rem; color: var(--text-secondary);">
                Supports SELECT, UPDATE, INSERT, DELETE, and administrative statements.
              </span>
              <button class="btn" onclick="runQuery()" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                <iconify-icon icon="material-symbols:bolt-outline" style="font-size: 1.1rem;"></iconify-icon>
                <span>Run SQL Command</span>
              </button>
            </div>
          </div>

          {/* SQL Terminal Output */}
          <div class="results-card" id="sql-console-results-card">
            <div class="results-header">
              <span>SQL TERMINAL OUTPUT</span>
              <span id="results-meta"></span>
            </div>
            <div id="results-body">
              <div class="results-empty">
                <span>
                  No SQL query executed yet. Write a query above and click "Run SQL Command".
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Dynamic Insert Modal */}
      <div id="modal-insert" class="modal-overlay" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Add New Row</h3>
            <button class="modal-close" onclick="closeInsertModal()">&times;</button>
          </div>
          <form id="insert-row-form" onsubmit="submitInsertRow(event)">
            <div id="insert-fields-container" class="modal-fields-container">
              {/* Dynamically generated form fields */}
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="closeInsertModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Add Row</button>
            </div>
          </form>
        </div>
      </div>

      {/* Dynamic Edit Modal */}
      <div id="modal-edit" class="modal-overlay" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Edit Row Details</h3>
            <button class="modal-close" onclick="closeEditModal()">&times;</button>
          </div>
          <form id="edit-row-form" onsubmit="submitEditRow(event)">
            <input type="hidden" id="edit-row-rowid" />
            <div id="edit-fields-container" class="modal-fields-container">
              {/* Dynamically generated form fields */}
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      </div>

      {/* CSV Import Modal */}
      <div id="modal-import" class="modal-overlay" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <h3 style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <iconify-icon icon="material-symbols:upload-file-outline" style="font-size: 1.3rem;"></iconify-icon>
              <span>Bulk Import CSV Data</span>
            </h3>
            <button class="modal-close" onclick="closeImportModal()">&times;</button>
          </div>
          <div class="modal-fields-container">
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
              Paste CSV data below. The first row must contain column headers matching the table schema. Data values are automatically parsed.
            </p>
            <textarea 
              id="csv-import-textarea" 
              class="sql-textarea" 
              style="height: 180px; font-family: monospace; font-size: 0.8rem;"
              placeholder="username,email&#10;alice,alice@example.com&#10;bob,bob@example.com"
            ></textarea>
            <div style="margin-top: 0.75rem;">
              <span style="font-size: 0.8rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">Or upload a .csv file:</span>
              <input type="file" id="csv-file-input" accept=".csv" onchange="handleCsvFileSelect(event)" style="font-size: 0.8rem; color: var(--text-primary);" />
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeImportModal()">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="submitImportCsv()">Import Rows</button>
          </div>
        </div>
      </div>

    </div>
  );
}
