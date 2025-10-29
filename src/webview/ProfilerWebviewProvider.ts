import * as vscode from 'vscode';

export class ProfilerWebviewProvider {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel
    ) { }

    public getWebviewContent(): string {
        const scriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'profiler.js')
        );
        const styleUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'profiler.css')
        );

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
                    <header class="header">
                        <h1>SQL Server Profiler Tool</h1>
                        
                        <div class="connection-section">
                            <div class="connection-controls">
                                <label for="connectionSelect">SQL Server Connection:</label>
                                <select id="connectionSelect">
                                    <option value="">Select a connection...</option>
                                </select>
                                <button id="refreshConnectionsBtn" class="btn btn-small">
                                    <span class="icon">🔄</span> Refresh
                                </button>
                            </div>
                            <div class="connection-status" id="connectionStatus">
                                No connection selected
                            </div>
                        </div>
                        
                        <div class="controls">
                            <button id="startBtn" class="btn btn-primary">
                                <span class="icon">▶</span> Start Profiling
                            </button>
                            <button id="stopBtn" class="btn btn-secondary" disabled>
                                <span class="icon">⏹</span> Stop Profiling
                            </button>
                            <button id="clearBtn" class="btn btn-warning">
                                <span class="icon">🗑</span> Clear Results
                            </button>
                            <button id="exportBtn" class="btn btn-info">
                                <span class="icon">💾</span> Export Results
                            </button>
                            <button id="refreshBtn" class="btn btn-success">
                                <span class="icon">🔄</span> Refresh
                            </button>
                        </div>
                    </header>

                    <div class="status-bar">
                        <div class="status-indicator">
                            <span id="statusIcon" class="status-icon stopped">⏸</span>
                            <span id="statusText">Stopped</span>
                        </div>
                        <div class="event-count">
                            Events captured: <span id="eventCount">0</span>
                        </div>
                    </div>

                    <div class="filters">
                        <div class="filter-group">
                            <label for="databaseFilter">Database:</label>
                            <select id="databaseFilter">
                                <option value="">All Databases</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label for="eventTypeFilter">Event Type:</label>
                            <select id="eventTypeFilter">
                                <option value="">All Events</option>
                                <option value="rpc_completed">RPC Completed</option>
                                <option value="sql_batch_completed">SQL Batch Completed</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label for="searchFilter">Search:</label>
                            <input type="text" id="searchFilter" placeholder="Search in SQL statements...">
                        </div>
                    </div>

                    <div class="results-container">
                        <table id="resultsTable" class="results-table">
                            <thead>
                                <tr>
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
                                    <td colspan="6">No events captured yet. Start profiling to see results.</td>
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