"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfilerWebviewProvider = void 0;
const vscode = require("vscode");
class ProfilerWebviewProvider {
    constructor(context, panel) {
        this.context = context;
        this.panel = panel;
    }
    getWebviewContent() {
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'profiler.js'));
        const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'profiler.css'));
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src ${this.panel.webview.cspSource};">
                <link rel="stylesheet" href="${styleUri}">
                <title>SQL Server Profiler</title>
            </head>
            <body>
                <div class="container">
                    <!-- Compact Toolbar -->
                    <div class="compact-toolbar">
                        <!-- Left Section: Connection & Status -->
                        <div class="toolbar-section left-section">
                            <select id="connectionSelect" class="compact-select">
                                <option value="">Select connection...</option>
                            </select>
                            <button id="refreshConnectionsBtn" class="btn-icon" title="Refresh Connections">🔄</button>
                            
                            <div class="status-compact">
                                <span id="statusIcon" class="status-icon stopped">⏸</span>
                                <span id="statusText">Stopped</span>
                                <span class="separator">•</span>
                                <span id="eventCount">0</span> events
                            </div>
                        </div>
                        
                        <!-- Center Section: Main Controls -->
                        <div class="toolbar-section center-section">
                            <button id="startBtn" class="btn btn-primary btn-compact">
                                <span class="icon">▶</span> Start
                            </button>
                            <button id="stopBtn" class="btn btn-secondary btn-compact" disabled>
                                <span class="icon">⏹</span> Stop
                            </button>
                            <button id="clearBtn" class="btn btn-warning btn-compact">
                                <span class="icon">🗑</span> Clear
                            </button>
                            <button id="exportBtn" class="btn btn-info btn-compact">
                                <span class="icon">💾</span> Export
                            </button>
                            <button id="refreshBtn" class="btn btn-success btn-compact">
                                <span class="icon">🔄</span> Refresh
                            </button>
                        </div>
                        
                        <!-- Right Section: Filters -->
                        <div class="toolbar-section right-section">
                            <select id="databaseFilter" class="compact-filter">
                                <option value="">All DBs</option>
                            </select>
                            <select id="eventTypeFilter" class="compact-filter">
                                <option value="">All Events</option>
                                <option value="rpc_completed">RPC</option>
                                <option value="sql_batch_completed">Batch</option>
                            </select>
                            <input type="text" id="searchFilter" class="compact-search" placeholder="Search SQL...">
                        </div>
                    </div>
                    
                    <!-- Connection Status Toast (only when needed) -->
                    <div class="connection-toast" id="connectionStatus" style="display: none;">
                        No connection selected
                    </div>

                    <div class="results-container">
                        <table id="resultsTable" class="results-table">
                            <thead>
                                <tr>
                                    <th width="30px"></th>
                                    <th class="sortable" data-column="timestamp">Timestamp</th>
                                    <th class="sortable" data-column="eventName">Event Type</th>
                                    <th class="sortable" data-column="databaseName">Database</th>
                                    <th class="sortable" data-column="userName">User</th>
                                    <th class="sortable" data-column="duration">Duration (ms)</th>
                                    <th>SQL Statement</th>
                                </tr>
                            </thead>
                            <tbody id="resultsBody">
                                <tr class="no-results">
                                    <td colspan="7">No events captured yet. Start profiling to see results.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
exports.ProfilerWebviewProvider = ProfilerWebviewProvider;
//# sourceMappingURL=ProfilerWebviewProvider.js.map