"""
LTmap — UI Template for Dashboard
5-Tab Navigation Layout:
1. Live Incoming Data ("what data coming")
2. Database Rows ("data saving" - ais_vessels)
3. Filter Table ("filter data saving" - ais_filter_mmsi)
4. Background Services (AISStream, Digitraffic, Batch Writer)
5. Clear DB & Maintenance (Prune & Clear)
"""

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LTmap — Mission Control & Database Center</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛰️</text></svg>">
  <style>
    :root {
      --bg: #070d18;
      --card-bg: #0d1829;
      --card-border: #1e293b;
      --cyan: #00e5ff;
      --cyan-glow: rgba(0, 229, 255, 0.18);
      --emerald: #10b981;
      --amber: #f59e0b;
      --rose: #f43f5e;
      --purple: #a855f7;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      padding: 20px 24px; line-height: 1.5;
    }

    /* Header */
    header {
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 16px; border-bottom: 1px solid var(--card-border); margin-bottom: 18px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand h1 { font-size: 19px; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
    .brand small { color: var(--cyan); font-size: 11px; font-family: monospace; display: block; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 9999px; font-size: 11px;
      font-weight: 700; text-transform: uppercase; font-family: monospace;
    }
    .pill-green { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .pill-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .pulse { animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.85)} }

    button {
      background: #1e293b; color: #f1f5f9; border: 1px solid #334155;
      padding: 6px 14px; border-radius: 6px; font-size: 11px; font-weight: 600;
      cursor: pointer; font-family: monospace; display: inline-flex; align-items: center; gap: 6px;
      transition: all .15s ease;
    }
    button:hover { background: #334155; }
    button.primary { background: var(--cyan); color: #070d18; border-color: var(--cyan); font-weight: 700; }
    button.primary:hover { background: #22d3ee; }
    button.danger { background: rgba(244,63,94,.15); color: #fb7185; border-color: rgba(244,63,94,.3); }
    button.danger:hover { background: rgba(244,63,94,.25); }

    input[type="text"], input[type="number"], select {
      background: #070d18; border: 1px solid var(--card-border);
      color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-family: monospace; outline: none;
    }
    input:focus, select:focus { border-color: var(--cyan); }

    /* Top Comparison Banner */
    .compare-banner {
      background: linear-gradient(90deg, #0d1b30 0%, #0c2338 50%, #0d1b30 100%);
      border: 1px solid #1e3a5f;
      border-radius: 12px;
      padding: 16px 22px;
      margin-bottom: 22px;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 20px;
    }
    .compare-side { display: flex; flex-direction: column; gap: 4px; }
    .compare-side.right { text-align: right; }
    .compare-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-family: monospace; font-weight: 700; }
    .compare-value { font-size: 28px; font-weight: 900; font-family: monospace; }
    .compare-meta { font-size: 11px; color: #94a3b8; font-family: monospace; }
    .compare-middle { text-align: center; }
    .sync-badge { background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; font-family: monospace; }

    /* Navigation Tabs Row */
    .tabs-nav {
      display: flex; gap: 8px; border-bottom: 1px solid var(--card-border);
      margin-bottom: 22px; padding-bottom: 10px; flex-wrap: wrap;
    }
    .tab-btn {
      background: transparent; border: none; color: var(--text-muted);
      padding: 9px 18px; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 700; font-family: monospace;
      transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 8px;
    }
    .tab-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active {
      background: var(--cyan-glow); color: var(--cyan); border: 1px solid rgba(0, 229, 255, 0.4);
    }

    /* Grid & Cards */
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 10px; padding: 16px;
    }
    .card-title { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; margin-bottom: 6px; font-family: monospace; }
    .card-value { font-size: 24px; font-weight: 800; font-family: monospace; }
    .card-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: monospace; }

    /* Tables */
    .table-container {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 12px; overflow: hidden; margin-bottom: 24px;
    }
    .table-header {
      padding: 14px 20px; border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .table-header h2 { font-size: 14px; font-weight: 700; color: #fff; font-family: monospace; display: flex; align-items: center; gap: 8px; }
    .toolbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
    th {
      background: #091322; color: var(--text-muted); font-weight: 700;
      padding: 10px 14px; border-bottom: 1px solid var(--card-border);
      text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; font-family: monospace;
      white-space: nowrap;
    }
    td {
      padding: 10px 14px; border-bottom: 1px solid #132238; font-family: monospace;
      color: #cbd5e1; vertical-align: middle; white-space: nowrap;
    }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 9px; font-weight: 700; text-transform: uppercase; font-family: monospace;
    }
    .badge-cargo { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
    .badge-tanker { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .badge-military { background: rgba(244, 63, 94, 0.15); color: #fb7185; }
    .badge-source-ais { background: rgba(0, 229, 255, 0.15); color: var(--cyan); }
    .badge-source-digi { background: rgba(168, 85, 247, 0.15); color: var(--purple); }

    .pagination-bar {
      padding: 10px 16px; background: #091322; border-top: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
    }

    /* Modal */
    .modal-backdrop {
      display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px); z-index: 1000; align-items: center; justify-content: center;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      background: #0d1829; border: 1px solid var(--cyan); border-radius: 12px;
      width: 90%; max-width: 780px; max-height: 85vh; display: flex; flex-direction: column;
    }
    .modal-header {
      padding: 14px 18px; border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .modal-header h3 { font-size: 14px; color: var(--cyan); font-family: monospace; }
    .modal-body {
      padding: 16px; overflow-y: auto; font-family: monospace; font-size: 11px;
      background: #070d18; color: #a5f3fc; flex: 1;
    }
    .modal-footer {
      padding: 10px 18px; border-top: 1px solid var(--card-border);
      display: flex; justify-content: flex-end; gap: 8px;
    }
  </style>
</head>
<body>

  <!-- Top Navigation & System Status -->
  <header>
    <div class="brand">
      <span style="font-size: 24px;">🛰️</span>
      <div>
        <h1>LTMAP MISSION CONTROL</h1>
        <small>DATABASE INSPECTOR & REAL-TIME AIS TELEMETRY</small>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <div class="pill pill-green">
        <span class="pill-dot pulse"></span>
        <span id="ws-status-text">WS LIVE (STREAMING)</span>
      </div>
      <button class="primary" onclick="refreshAllViews()">🔄 Refresh All</button>
    </div>
  </header>

  <!-- Comparative Ingestion Banner -->
  <div class="compare-banner">
    <div class="compare-side">
      <span class="compare-label">Incoming Stream Telemetry (Live Memory Cache)</span>
      <span id="comp-incoming" class="compare-value" style="color: var(--cyan);">0 vessels</span>
      <span class="compare-meta">Rate: <span id="comp-rate">0 pkts/s</span> | AISStream + Digitraffic</span>
    </div>
    <div class="compare-middle">
      <div class="sync-badge">⇄ PERSISTING CONTINUOUSLY</div>
      <div id="comp-sync-meta" style="font-size: 11px; color: #94a3b8; font-family: monospace; margin-top: 6px;">Queue: 0 pending | Flush: 2.0s</div>
      <div id="comp-filter" style="font-size: 11px; color: #a78bfa; font-family: monospace; margin-top: 6px;">Filter: 0 MMSIs active</div>
    </div>
    <div class="compare-side right">
      <span class="compare-label">Stored in Database (ais_vessels)</span>
      <span id="comp-database" class="compare-value" style="color: #34d399;">0 vessels</span>
      <span class="compare-meta">Total Track Points: <span id="comp-tracks">0</span> breadcrumbs</span>
    </div>
  </div>

  <!-- ── 5 UPDATED TABS ROW ───────────────────────────────── -->
  <div class="tabs-nav">
    <button id="tab-btn-incoming" class="tab-btn active" onclick="switchTab('incoming')">
      📡 1. Data Coming ("what data coming")
    </button>
    <button id="tab-btn-stored" class="tab-btn" onclick="switchTab('stored')">
      💾 2. Data Saving ("ais_vessels table")
    </button>
    <button id="tab-btn-filter" class="tab-btn" onclick="switchTab('filter')">
      🔒 3. Filter Data Saving ("ais_filter_mmsi")
    </button>
    <button id="tab-btn-services" class="tab-btn" onclick="switchTab('services')">
      ⚙️ 4. Background Services
    </button>
    <button id="tab-btn-cleardb" class="tab-btn" onclick="switchTab('cleardb')">
      🧹 5. Clear DB & Maintenance
    </button>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 1: DATA COMING                                            -->
  <!-- ============================================================== -->
  <div id="tab-content-incoming">
    <div class="grid-4">
      <div class="card">
        <div class="card-title">Live Ingestion Rate</div>
        <div id="stat-rate" class="card-value" style="color: var(--cyan);">0 pkts/s</div>
        <div class="card-sub">Throughput across active feeds</div>
      </div>
      <div class="card">
        <div class="card-title">Total Packets Received</div>
        <div id="stat-total-pkts" class="card-value" style="color: #38bdf8;">0</div>
        <div class="card-sub">Since ingestion worker started</div>
      </div>
      <div class="card">
        <div class="card-title">Active Vessels in Cache</div>
        <div id="stat-in-cache" class="card-value" style="color: #34d399;">0</div>
        <div class="card-sub">Real-time deduplicated vessels</div>
      </div>
      <div class="card">
        <div class="card-title">Stream Feed Status</div>
        <div id="stat-stream-status" class="card-value" style="color: #a78bfa;">LIVE STREAM</div>
        <div class="card-sub">Auto-refresh: 2.0s</div>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h2>
          <span>📡</span> Live Incoming Data Stream (Packets As They Arrive)
          <span id="incoming-live-tag" class="pill pill-green" style="font-size: 10px;">● STREAMING</span>
        </h2>
        <div class="toolbar-actions">
          <input type="text" id="incoming-search" placeholder="Filter by MMSI or Name..." oninput="handleIncomingSearch()">
          <select id="incoming-source" onchange="handleIncomingFilter()">
            <option value="all">All Sources</option>
            <option value="aisstream.io">aisstream.io</option>
            <option value="digitraffic.fi">digitraffic.fi</option>
          </select>
          <button id="btn-stream-pause" onclick="toggleStreamPause()">⏸ Pause Feed</button>
          <button onclick="fetchIncomingPackets()">🔄 Force Pull</button>
        </div>
      </div>
      <div style="overflow-x: auto; max-height: 520px;">
        <table>
          <thead>
            <tr>
              <th># ID</th>
              <th>Arrival Time</th>
              <th>Source</th>
              <th>Message Type</th>
              <th>MMSI</th>
              <th>Vessel Name</th>
              <th>Category</th>
              <th>Position (Lat, Lng)</th>
              <th>Speed</th>
              <th>Heading</th>
              <th>Destination</th>
              <th>Raw</th>
            </tr>
          </thead>
          <tbody id="incoming-tbody">
            <tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">Connecting to real-time incoming stream...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 2: DATA SAVING (ais_vessels table)                         -->
  <!-- ============================================================== -->
  <div id="tab-content-stored" style="display: none;">
    <div class="grid-4">
      <div class="card">
        <div class="card-title">Total Vessels Stored</div>
        <div id="stat-stored-vessels" class="card-value" style="color: #34d399;">0</div>
        <div class="card-sub">Rows in ais_vessels table</div>
      </div>
      <div class="card">
        <div class="card-title">Total Track Points</div>
        <div id="stat-stored-tracks" class="card-value" style="color: #38bdf8;">0</div>
        <div class="card-sub">GPS breadcrumbs in ais_track_points</div>
      </div>
      <div class="card">
        <div class="card-title">Oldest Stored Record</div>
        <div id="stat-oldest-record" class="card-value" style="color: var(--amber); font-size: 13px;">—</div>
        <div class="card-sub">Earliest vessel timestamp</div>
      </div>
      <div class="card">
        <div class="card-title">Newest Stored Record</div>
        <div id="stat-newest-record" class="card-value" style="color: var(--cyan); font-size: 13px;">—</div>
        <div class="card-sub">Most recent DB upsert</div>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h2>
          <span>💾</span> Stored Database Records (Table: ais_vessels)
        </h2>
        <div class="toolbar-actions">
          <input type="text" id="stored-search" placeholder="Search MMSI or Name..." oninput="handleStoredSearch()">
          <select id="stored-type" onchange="fetchStoredVessels(1)">
            <option value="all">All Ship Types</option>
            <option value="cargo">Cargo</option>
            <option value="tanker">Tanker</option>
            <option value="military">Military</option>
          </select>
          <button onclick="fetchStoredVessels(storedPage)">🔄 Reload Stored</button>
        </div>
      </div>
      <div style="overflow-x: auto; max-height: 520px;">
        <table>
          <thead>
            <tr>
              <th>MMSI</th>
              <th>Vessel Name</th>
              <th>Type</th>
              <th>Lat</th>
              <th>Lng</th>
              <th>Speed</th>
              <th>Heading</th>
              <th>Destination</th>
              <th>Size Class</th>
              <th>Track Points</th>
              <th>Distance (km)</th>
              <th>Last Seen (UTC)</th>
            </tr>
          </thead>
          <tbody id="stored-tbody">
            <tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">Loading stored vessels...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="pagination-bar">
        <div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">
          Showing Page <strong id="stored-page-num" style="color: #fff;">1</strong> of <strong id="stored-page-total" style="color: #fff;">1</strong> (<span id="stored-row-total" style="color: var(--cyan);">0</span> records in DB)
        </div>
        <div style="display: flex; gap: 4px;">
          <button onclick="fetchStoredVessels(1)">« First</button>
          <button onclick="fetchStoredVessels(Math.max(1, storedPage - 1))">‹ Prev</button>
          <button onclick="fetchStoredVessels(storedPage + 1)">Next ›</button>
          <button onclick="fetchStoredVessels(99999)">Last »</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 3: FILTER DATA SAVING (ais_filter_mmsi table)              -->
  <!-- ============================================================== -->
  <div id="tab-content-filter" style="display: none;">
    <div class="table-container" style="padding: 18px 22px; margin-bottom: 16px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #fff; font-family: monospace; margin-bottom: 8px;">
        🔒 Filter MMSI Allow-list Table (ais_filter_mmsi)
      </h2>
      <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
        When MMSIs are configured below, <strong>only listed MMSIs</strong> are written into <code>ais_vessels</code> and <code>ais_track_points</code>.
        If empty, all vessels are persisted.
      </p>
      <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;">
        <div>
          <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 4px; font-family: monospace;">MMSI *</label>
          <input type="number" id="filter-mmsi" placeholder="e.g. 211285970" style="width: 150px;">
        </div>
        <div>
          <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 4px; font-family: monospace;">Alias Name</label>
          <input type="text" id="filter-alias" placeholder="e.g. Patrol Vessel A" style="width: 170px;">
        </div>
        <div>
          <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 4px; font-family: monospace;">Notes / Purpose</label>
          <input type="text" id="filter-notes" placeholder="Optional notes" style="width: 220px;">
        </div>
        <button class="primary" onclick="addFilterMmsi()">+ Add MMSI to Filter Table</button>
        <button onclick="refreshFilterList()">🔄 Reload Filter Table</button>
        <button class="danger" onclick="clearFilterList()">⚠️ Clear Entire Filter</button>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h2>
          <span>📋</span> Active Records in Table: ais_filter_mmsi (<span id="filter-records-count" style="color: var(--cyan);">0</span> rows)
        </h2>
      </div>
      <div style="overflow-x: auto; max-height: 520px;">
        <table>
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>MMSI</th>
              <th>Alias</th>
              <th>Source</th>
              <th>Added At</th>
              <th>Status</th>
              <th>Notes</th>
              <th style="width: 90px;">Action</th>
            </tr>
          </thead>
          <tbody id="filter-tbody">
            <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">Loading filter records...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 4: BACKGROUND SERVICES                                     -->
  <!-- ============================================================== -->
  <div id="tab-content-services" style="display: none;">
    <div class="grid-4">
      <div class="card">
        <div class="card-title">AISStream Worker</div>
        <div id="svc-ais" class="card-value" style="color: #34d399;">RUNNING</div>
        <div class="card-sub">Global Maritime WebSocket feed</div>
      </div>
      <div class="card">
        <div class="card-title">Digitraffic Worker</div>
        <div id="svc-digi" class="card-value" style="color: #38bdf8;">CONNECTED</div>
        <div class="card-sub">Finnish Baltic MQTT over TLS</div>
      </div>
      <div class="card">
        <div class="card-title">MySQL Batch Writer</div>
        <div id="svc-worker" class="card-value" style="color: #a78bfa;">RUNNING</div>
        <div class="card-sub" id="svc-worker-sub">Pending: 0 | Flush: 2.0s</div>
      </div>
      <div class="card">
        <div class="card-title">Database Status</div>
        <div id="svc-engine" class="card-value" style="color: #f59e0b;">CONNECTED</div>
        <div class="card-sub" id="svc-db-sub">MySQL 8.4</div>
      </div>
    </div>

    <div class="table-container" style="padding: 22px;">
      <h2 style="font-size: 15px; font-weight: 700; color: #fff; font-family: monospace; margin-bottom: 12px;">
        ℹ️ Ingestion Pipeline Diagnostics
      </h2>
      <div style="font-family: monospace; font-size: 12px; color: #cbd5e1; line-height: 1.8;">
        <div>• <strong>AIS WebSocket:</strong> Subscribed to global bounding boxes with auto-reconnect.</div>
        <div>• <strong>Digitraffic Baltic:</strong> Connected to Finnish coastal MQTT telemetry feed.</div>
        <div>• <strong>Persistence Loop:</strong> Batches incoming ship updates in-memory and flushes to database every 2 seconds.</div>
        <div>• <strong>Auto-Prune:</strong> Periodically cleans up stale ship tracks older than 24 hours.</div>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 5: CLEAR DB & MAINTENANCE                                  -->
  <!-- ============================================================== -->
  <div id="tab-content-cleardb" style="display: none;">
    <div class="table-container" style="padding: 24px;">
      <h2 style="font-size: 16px; font-weight: 700; color: #fff; font-family: monospace; margin-bottom: 16px;">
        🧹 Database Maintenance & Data Clear Controls
      </h2>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 22px; max-width: 700px;">
        Execute routine cleanup operations or reset telemetry records directly on the database tables.
      </p>

      <div style="display: flex; gap: 16px; flex-wrap: wrap;">
        <div style="background: #070d18; border: 1px solid var(--card-border); border-radius: 8px; padding: 18px; flex: 1; min-width: 260px;">
          <h3 style="font-size: 13px; color: var(--cyan); margin-bottom: 6px; font-family: monospace;">Prune Stale Records</h3>
          <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 14px;">
            Deletes vessels not seen in the last 1 hour and track points older than 24 hours.
          </p>
          <button class="primary" onclick="pruneDatabase()">🧹 Run Prune Now</button>
        </div>

        <div style="background: #070d18; border: 1px solid rgba(244,63,94,0.3); border-radius: 8px; padding: 18px; flex: 1; min-width: 260px;">
          <h3 style="font-size: 13px; color: #fb7185; margin-bottom: 6px; font-family: monospace;">Wipe All AIS Telemetry</h3>
          <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 14px;">
            Deletes all records from <code>ais_vessels</code> and <code>ais_track_points</code>, and empties memory cache.
          </p>
          <button class="danger" onclick="clearDatabase()">⚠️ Clear All AIS Tables</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Raw Payload Modal -->
  <div id="json-modal" class="modal-backdrop">
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="modal-title">Raw Telemetry Packet</h3>
        <button onclick="closeModal()">✕</button>
      </div>
      <div id="modal-content" class="modal-body">
        <pre id="modal-pre"></pre>
      </div>
      <div class="modal-footer">
        <button onclick="copyModalJson()">📋 Copy JSON</button>
        <button class="primary" onclick="closeModal()">Close</button>
      </div>
    </div>
  </div>

  <script>
    let activeTab = 'incoming';
    let streamPaused = false;

    // ── Tab Switching ──────────────────────────────────────────
    function switchTab(tabId) {
      activeTab = tabId;
      ['incoming', 'stored', 'filter', 'services', 'cleardb'].forEach(id => {
        const btn = document.getElementById(`tab-btn-${id}`);
        const content = document.getElementById(`tab-content-${id}`);
        if (btn) btn.className = (id === tabId) ? 'tab-btn active' : 'tab-btn';
        if (content) content.style.display = (id === tabId) ? 'block' : 'none';
      });

      if (tabId === 'incoming') fetchIncomingPackets();
      if (tabId === 'stored') fetchStoredVessels(storedPage);
      if (tabId === 'filter') refreshFilterList();
      if (tabId === 'services') fetchGlobalMetrics();
    }

    function refreshAllViews() {
      fetchGlobalMetrics();
      if (activeTab === 'incoming') fetchIncomingPackets();
      if (activeTab === 'stored') fetchStoredVessels(storedPage);
      if (activeTab === 'filter') refreshFilterList();
    }

    // ── Tab 1: Live Incoming Packets ───────────────────────────
    let incomingPackets = [];
    let incomingFiltered = [];
    let incomingSearchTerm = '';
    let incomingSourceFilter = 'all';

    async function fetchIncomingPackets() {
      if (streamPaused && activeTab === 'incoming') return;
      try {
        const res = await fetch('/api/admin/stream/packets?limit=50');
        if (!res.ok) return;
        const data = await res.json();

        if (data.stats) {
          document.getElementById('stat-rate').innerText = `${data.stats.rate_per_sec} pkts/s`;
          document.getElementById('stat-total-pkts').innerText = data.stats.total_packets.toLocaleString();
          document.getElementById('stat-in-cache').innerText = data.stats.vessels_in_cache.toLocaleString();
          document.getElementById('comp-rate').innerText = `${data.stats.rate_per_sec} pkts/s`;
        }

        incomingPackets = data.packets || [];
        applyIncomingFilter();
      } catch (e) {}
    }

    function toggleStreamPause() {
      streamPaused = !streamPaused;
      const btn = document.getElementById('btn-stream-pause');
      const tag = document.getElementById('incoming-live-tag');
      if (streamPaused) {
        btn.innerText = '▶ Resume Feed';
        btn.className = 'primary';
        tag.className = 'pill';
        tag.innerText = '⏸ PAUSED';
      } else {
        btn.innerText = '⏸ Pause Feed';
        btn.className = '';
        tag.className = 'pill pill-green';
        tag.innerText = '● STREAMING';
        fetchIncomingPackets();
      }
    }

    function handleIncomingSearch() {
      incomingSearchTerm = document.getElementById('incoming-search').value.trim().toLowerCase();
      applyIncomingFilter();
    }

    function handleIncomingFilter() {
      incomingSourceFilter = document.getElementById('incoming-source').value;
      applyIncomingFilter();
    }

    function applyIncomingFilter() {
      let filtered = incomingPackets;
      if (incomingSourceFilter !== 'all') {
        filtered = filtered.filter(p => p.source === incomingSourceFilter);
      }
      if (incomingSearchTerm) {
        filtered = filtered.filter(p => 
          String(p.mmsi).includes(incomingSearchTerm) || 
          (p.name || '').toLowerCase().includes(incomingSearchTerm)
        );
      }
      incomingFiltered = filtered;
      renderIncomingTable();
    }

    function renderIncomingTable() {
      const tbody = document.getElementById('incoming-tbody');
      if (!incomingFiltered || incomingFiltered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">No incoming stream packets matching filter.</td></tr>';
        return;
      }

      tbody.innerHTML = incomingFiltered.map((p, idx) => {
        const srcClass = p.source === 'aisstream.io' ? 'badge-source-ais' : 'badge-source-digi';
        const typeClass = (p.type === 'tanker') ? 'badge-tanker' : (p.type === 'military') ? 'badge-military' : 'badge-cargo';
        const jsonSafe = encodeURIComponent(JSON.stringify(p.raw_payload || p, null, 2));

        return `
          <tr>
            <td style="color: #64748b;">#${p.id || (idx + 1)}</td>
            <td style="color: #38bdf8; font-weight: 700;">${p.time}</td>
            <td><span class="badge ${srcClass}">${p.source}</span></td>
            <td><span class="badge" style="background: rgba(255,255,255,0.08); color: #fff;">${p.msg_type}</span></td>
            <td style="color: var(--cyan); font-weight: 700;">${p.mmsi}</td>
            <td style="color: #fff; font-weight: 600;">${p.name || 'UNKNOWN'}</td>
            <td><span class="badge ${typeClass}">${p.type || 'cargo'}</span></td>
            <td>${p.lat != null ? p.lat.toFixed(4) + '°' : '—'}, ${p.lng != null ? p.lng.toFixed(4) + '°' : '—'}</td>
            <td style="color: #34d399;">${p.speed != null ? Number(p.speed).toFixed(1) + ' kts' : '0.0 kts'}</td>
            <td>${p.heading != null ? Math.round(p.heading) + '°' : '—'}</td>
            <td style="color: #94a3b8; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.destination || '—'}</td>
            <td>
              <button onclick="viewRawPayload('Packet #${p.id} (MMSI ${p.mmsi})', '${jsonSafe}')" style="padding: 2px 7px; font-size: 10px;">
                { }
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // ── Tab 2: Stored in Database (ais_vessels) ─────────────────
    let storedPage = 1;
    let storedSearchTimer = null;

    function handleStoredSearch() {
      clearTimeout(storedSearchTimer);
      storedSearchTimer = setTimeout(() => fetchStoredVessels(1), 300);
    }

    async function fetchStoredVessels(page) {
      storedPage = page;
      const q = document.getElementById('stored-search').value.trim();
      const t = document.getElementById('stored-type').value;
      const params = new URLSearchParams({ page: String(page), page_size: '25' });
      if (q) params.set('search', q);
      if (t !== 'all') params.set('type', t);

      try {
        const res = await fetch('/api/admin/db/vessels?' + params.toString());
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('stored-page-num').innerText = data.page;
        document.getElementById('stored-page-total').innerText = data.total_pages;
        document.getElementById('stored-row-total').innerText = data.total.toLocaleString();
        document.getElementById('stat-stored-vessels').innerText = data.total.toLocaleString();

        const tbody = document.getElementById('stored-tbody');
        if (!data.vessels || !data.vessels.length) {
          tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">No stored records found in ais_vessels.</td></tr>';
          return;
        }

        tbody.innerHTML = data.vessels.map(v => {
          const typeClass = (v.type === 'tanker') ? 'badge-tanker' : (v.type === 'military') ? 'badge-military' : 'badge-cargo';
          return `
            <tr>
              <td style="color: var(--cyan); font-weight: 700;">${v.mmsi}</td>
              <td style="color: #fff; font-weight: 600;">${v.name}</td>
              <td><span class="badge ${typeClass}">${v.type}</span></td>
              <td>${v.lat ?? '—'}</td>
              <td>${v.lng ?? '—'}</td>
              <td style="color: #34d399;">${v.speed} kts</td>
              <td>${v.heading != null ? v.heading + '°' : '—'}</td>
              <td style="color: #94a3b8; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${v.destination || '—'}</td>
              <td>${v.sizeClass}</td>
              <td style="color: #38bdf8;">${v.trackPoints}</td>
              <td>${v.trackDistanceKm} km</td>
              <td style="color: #a78bfa; font-size: 10px;">${v.lastSeenAt ? v.lastSeenAt.replace('T', ' ').slice(0, 19) : '—'}</td>
            </tr>
          `;
        }).join('');
      } catch (e) {}
    }

    // ── Tab 3: Filter Data Saving (ais_filter_mmsi) ──────────────
    async function refreshFilterList() {
      try {
        const res = await fetch('/api/admin/filter/mmsis');
        if (!res.ok) return;
        const data = await res.json();
        const records = data.records || [];
        const mmsis = data.mmsis || [];

        document.getElementById('filter-records-count').innerText = records.length;
        document.getElementById('comp-filter').innerText = `Filter: ${mmsis.length} MMSIs active`;

        const tbody = document.getElementById('filter-tbody');
        if (!records.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No records in ais_filter_mmsi table (all vessels will be saved).</td></tr>';
          return;
        }

        tbody.innerHTML = records.map((r, idx) => {
          let addedAt = '—';
          if (r.added_at) {
            const ms = r.added_at > 1e11 ? r.added_at : r.added_at * 1000;
            addedAt = new Date(ms).toLocaleString();
          }

          return `
            <tr>
              <td style="color: #64748b;">${idx + 1}</td>
              <td style="color: var(--cyan); font-weight: 700; font-size: 12px;">${r.mmsi}</td>
              <td style="color: #fff;">${r.alias || '—'}</td>
              <td><span class="badge" style="background: rgba(168, 85, 247, 0.15); color: var(--purple);">${r.source || 'user'}</span></td>
              <td style="color: #94a3b8; font-size: 10px;">${addedAt}</td>
              <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">${r.active ? 'ACTIVE' : 'DISABLED'}</span></td>
              <td style="color: #94a3b8; font-size: 11px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.notes || '—'}</td>
              <td>
                <button class="danger" onclick="removeFilterMmsi(${r.mmsi})" style="padding: 3px 8px; font-size: 10px;">✕ Remove</button>
              </td>
            </tr>
          `;
        }).join('');
      } catch (e) {}
    }

    async function addFilterMmsi() {
      const mmsiEl = document.getElementById('filter-mmsi');
      const aliasEl = document.getElementById('filter-alias');
      const notesEl = document.getElementById('filter-notes');
      const mmsi = parseInt(mmsiEl.value, 10);
      if (!mmsi) { alert("Please enter a valid numeric MMSI"); return; }

      try {
        const res = await fetch('/api/admin/filter/mmsis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mmsi, alias: aliasEl.value || null, source: 'user', notes: notesEl.value || null }),
        });
        if (!res.ok) throw new Error("Add failed");
        mmsiEl.value = '';
        aliasEl.value = '';
        notesEl.value = '';
        await refreshFilterList();
        fetchGlobalMetrics();
      } catch (e) {
        alert("Failed to add MMSI: " + e.message);
      }
    }

    async function removeFilterMmsi(mmsi) {
      if (!confirm(`Remove MMSI ${mmsi} from the filter table?`)) return;
      try {
        const res = await fetch(`/api/admin/filter/mmsis/${mmsi}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Remove failed");
        await refreshFilterList();
        fetchGlobalMetrics();
      } catch (e) {
        alert("Failed to remove MMSI: " + e.message);
      }
    }

    async function clearFilterList() {
      if (!confirm("WARNING: Clear entire filter table? All incoming vessels will be saved.")) return;
      try {
        const res = await fetch('/api/admin/filter/mmsis', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mmsis: [] }),
        });
        if (!res.ok) throw new Error("Clear failed");
        await refreshFilterList();
        fetchGlobalMetrics();
      } catch (e) {
        alert("Failed to clear filter: " + e.message);
      }
    }

    // ── Tab 5: Prune & Clear DB Controls ───────────────────────
    async function pruneDatabase() {
      if (!confirm("Delete vessels older than 1 hour and track points older than 24 hours?")) return;
      try {
        const res = await fetch('/api/admin/db/prune', { method: 'POST' });
        const data = await res.json();
        alert(`Prune Complete: Removed ${data.deleted_stale_vessels} stale vessels and ${data.deleted_old_tracks} old tracks.`);
        fetchGlobalMetrics();
        fetchStoredVessels(1);
      } catch (e) {
        alert("Prune failed: " + e.message);
      }
    }

    async function clearDatabase() {
      if (!confirm("WARNING: Are you sure you want to wipe all stored AIS vessels and track points?")) return;
      try {
        const res = await fetch('/api/admin/db/clear', { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        fetchGlobalMetrics();
        fetchStoredVessels(1);
      } catch (e) {
        alert("Clear failed: " + e.message);
      }
    }

    // ── Global Metrics ─────────────────────────────────────────
    async function fetchGlobalMetrics() {
      try {
        const [statsRes, statusRes] = await Promise.all([
          fetch('/api/admin/db/stats'),
          fetch('/api/admin/status')
        ]);

        if (statsRes.ok) {
          const stats = await statsRes.json();
          document.getElementById('comp-database').innerText = `${stats.vessels_count.toLocaleString()} vessels`;
          document.getElementById('comp-incoming').innerText = `${stats.incoming_stream_count.toLocaleString()} vessels`;
          document.getElementById('comp-tracks').innerText = stats.track_points_count.toLocaleString();
          document.getElementById('stat-stored-vessels').innerText = stats.vessels_count.toLocaleString();
          document.getElementById('stat-stored-tracks').innerText = stats.track_points_count.toLocaleString();
          document.getElementById('stat-oldest-record').innerText = stats.oldest_record ? stats.oldest_record.replace('T', ' ').slice(0, 19) : '—';
          document.getElementById('stat-newest-record').innerText = stats.newest_record ? stats.newest_record.replace('T', ' ').slice(0, 19) : '—';
        }

        if (statusRes.ok) {
          const status = await statusRes.json();
          document.getElementById('comp-sync-meta').innerText = 
            `Queue: ${status.services.ais_db_worker.pending_queue_size} pending | Flush: 2.0s`;
          document.getElementById('svc-ais').innerText = status.services.ais_stream.status;
          document.getElementById('svc-digi').innerText = status.services.digitraffic.status;
          document.getElementById('svc-worker').innerText = status.services.ais_db_worker.status;
          document.getElementById('svc-worker-sub').innerText = `Pending: ${status.services.ais_db_worker.pending_queue_size} | Flush: 2.0s`;
          document.getElementById('svc-engine').innerText = status.database.status.toUpperCase();
          document.getElementById('svc-db-sub').innerText = `${status.database.host}:${status.database.port}`;
        }
      } catch (e) {}
    }

    // ── Modal ──────────────────────────────────────────────────
    function viewRawPayload(title, encodedJson) {
      const decoded = decodeURIComponent(encodedJson);
      document.getElementById('modal-title').innerText = title;
      try {
        const obj = JSON.parse(decoded);
        document.getElementById('modal-pre').innerText = JSON.stringify(obj, null, 2);
      } catch (e) {
        document.getElementById('modal-pre').innerText = decoded;
      }
      document.getElementById('json-modal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('json-modal').classList.remove('open');
    }

    function copyModalJson() {
      const text = document.getElementById('modal-pre').innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert("Copied JSON to clipboard!");
      });
    }

    // ── Initial Boot ───────────────────────────────────────────
    fetchGlobalMetrics();
    fetchIncomingPackets();
    refreshFilterList();
    fetchStoredVessels(1);

    // Auto-update active views every few seconds
    setInterval(fetchGlobalMetrics, 3000);
    setInterval(() => {
      if (activeTab === 'incoming') fetchIncomingPackets();
      else if (activeTab === 'stored') fetchStoredVessels(storedPage);
      else if (activeTab === 'filter') refreshFilterList();
    }, 2500);
  </script>
</body>
</html>
"""
