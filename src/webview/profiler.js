// SQL Server Profiler Tool - JavaScript

(function () {
    'use strict';

    // Get VS Code API
    const vscode = acquireVsCodeApi();

    // DOM Elements
    let startBtn, stopBtn, clearBtn, exportBtn, refreshBtn;
    let statusIcon, statusText, eventCount;
    let resultsBody, databaseFilter, eventTypeFilter, searchFilter;
    let connectionSelect, refreshConnectionsBtn, connectionStatus;

    // State
    let currentResults = [];
    let filteredResults = [];
    let sortColumn = 'timestamp';
    let sortDirection = 'desc';
    let isRunning = false;

    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', function () {
        initializeElements();
        attachEventListeners();
        requestResults();
    });

    function initializeElements() {
        // Buttons
        startBtn = document.getElementById('startBtn');
        stopBtn = document.getElementById('stopBtn');
        clearBtn = document.getElementById('clearBtn');
        exportBtn = document.getElementById('exportBtn');
        refreshBtn = document.getElementById('refreshBtn');

        // Status elements
        statusIcon = document.getElementById('statusIcon');
        statusText = document.getElementById('statusText');
        eventCount = document.getElementById('eventCount');

        // Connection elements
        connectionSelect = document.getElementById('connectionSelect');
        refreshConnectionsBtn = document.getElementById('refreshConnectionsBtn');
        connectionStatus = document.getElementById('connectionStatus');

        // Filter elements
        databaseFilter = document.getElementById('databaseFilter');
        eventTypeFilter = document.getElementById('eventTypeFilter');
        searchFilter = document.getElementById('searchFilter');

        // Results
        resultsBody = document.getElementById('resultsBody');
    }

    function attachEventListeners() {
        // Button events
        startBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'startProfiling' });
        });

        stopBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopProfiling' });
        });

        clearBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'clearResults' });
        });

        exportBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'exportResults' });
        });

        refreshBtn.addEventListener('click', () => {
            requestResults();
        });

        // Connection events
        connectionSelect.addEventListener('change', () => {
            const selectedConnection = connectionSelect.value;
            if (selectedConnection) {
                vscode.postMessage({
                    command: 'setConnection',
                    connectionName: selectedConnection
                });
                updateConnectionStatus(`Selected connection: ${selectedConnection}`, 'connected');
            } else {
                updateConnectionStatus('No connection selected', '');
            }
        });

        refreshConnectionsBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'refreshConnections' });
        });

        // Filter events
        databaseFilter.addEventListener('change', applyFilters);
        eventTypeFilter.addEventListener('change', applyFilters);
        searchFilter.addEventListener('input', debounce(applyFilters, 300));

        // Table header events for sorting
        document.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.column;
                if (sortColumn === column) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = column;
                    sortDirection = 'asc';
                }
                updateSortIndicators();
                sortResults();
                renderResults();
            });
        });
    }

    // Message handler for VS Code extension messages
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'updateResults':
                currentResults = message.data || [];
                updateDatabaseFilter();
                applyFilters();
                break;

            case 'updateConnections':
                updateConnectionsList(message.connections || []);
                break;

            case 'connectionSelected':
                updateConnectionStatus(`Connected to: ${message.connectionName}`, 'connected');
                break;

            case 'connectionError':
                updateConnectionStatus(`Error: ${message.error}`, 'error');
                break;

            case 'profilingStarted':
                setProfilingState(true);
                break;

            case 'profilingStopped':
                setProfilingState(false);
                break;

            case 'profilingError':
                setProfilingState(false);
                updateConnectionStatus(`Profiling Error: ${message.error}`, 'error');
                break;

            case 'resultsCleared':
                currentResults = [];
                filteredResults = [];
                renderResults();
                updateDatabaseFilter();
                break;
        }
    });

    function setProfilingState(running) {
        isRunning = running;

        if (running) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusIcon.className = 'status-icon running';
            statusText.textContent = 'Running';

            // Auto-refresh when running
            if (!window.autoRefreshInterval) {
                window.autoRefreshInterval = setInterval(requestResults, 2000);
            }
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusIcon.className = 'status-icon stopped';
            statusText.textContent = 'Stopped';

            // Stop auto-refresh
            if (window.autoRefreshInterval) {
                clearInterval(window.autoRefreshInterval);
                window.autoRefreshInterval = null;
            }
        }
    }

    function requestResults() {
        vscode.postMessage({ command: 'getResults' });
    }

    function updateDatabaseFilter() {
        const databases = new Set();
        currentResults.forEach(result => {
            if (result.databaseName && result.databaseName.trim()) {
                databases.add(result.databaseName);
            }
        });

        // Clear existing options (except "All Databases")
        databaseFilter.innerHTML = '<option value="">All Databases</option>';

        // Add unique databases
        Array.from(databases).sort().forEach(db => {
            const option = document.createElement('option');
            option.value = db;
            option.textContent = db;
            databaseFilter.appendChild(option);
        });
    }

    function applyFilters() {
        const dbFilter = databaseFilter.value;
        const eventFilter = eventTypeFilter.value;
        const searchText = searchFilter.value.toLowerCase();

        filteredResults = currentResults.filter(result => {
            // Database filter
            if (dbFilter && result.databaseName !== dbFilter) {
                return false;
            }

            // Event type filter
            if (eventFilter && !result.eventName.includes(eventFilter)) {
                return false;
            }

            // Search filter
            if (searchText && !result.statement.toLowerCase().includes(searchText)) {
                return false;
            }

            return true;
        });

        sortResults();
        renderResults();
        updateEventCount();
    }

    function sortResults() {
        filteredResults.sort((a, b) => {
            let aVal = a[sortColumn];
            let bVal = b[sortColumn];

            // Handle different data types
            if (sortColumn === 'timestamp') {
                aVal = new Date(aVal);
                bVal = new Date(bVal);
            } else if (sortColumn === 'duration') {
                aVal = aVal || 0;
                bVal = bVal || 0;
            } else {
                aVal = (aVal || '').toString().toLowerCase();
                bVal = (bVal || '').toString().toLowerCase();
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function updateSortIndicators() {
        document.querySelectorAll('.sortable').forEach(header => {
            header.classList.remove('sorted-asc', 'sorted-desc');
            if (header.dataset.column === sortColumn) {
                header.classList.add(`sorted-${sortDirection}`);
            }
        });
    }

    function renderResults() {
        if (filteredResults.length === 0) {
            resultsBody.innerHTML = '<tr class="no-results"><td colspan="6">No events match the current filters.</td></tr>';
            return;
        }

        resultsBody.innerHTML = filteredResults.map(result => {
            const timestamp = new Date(result.timestamp).toLocaleString();
            const duration = result.duration || 0;
            const durationClass = getDurationClass(duration);

            return `
                <tr>
                    <td>${timestamp}</td>
                    <td>${result.eventName || 'Unknown'}</td>
                    <td>${result.databaseName || ''}</td>
                    <td>${result.userName || ''}</td>
                    <td class="${durationClass}">${duration > 0 ? duration.toLocaleString() : ''}</td>
                    <td title="${escapeHtml(result.statement)}">${escapeHtml(truncateText(result.statement, 100))}</td>
                </tr>
            `;
        }).join('');
    }

    function getDurationClass(duration) {
        if (duration === 0 || !duration) return '';
        if (duration < 100) return 'duration-fast';
        if (duration < 1000) return 'duration-medium';
        return 'duration-slow';
    }

    function updateEventCount() {
        eventCount.textContent = filteredResults.length.toLocaleString();
    }

    function truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Connection management functions
    function updateConnectionsList(connections) {
        connectionSelect.innerHTML = '<option value="">Select a connection...</option>';

        connections.forEach(conn => {
            const option = document.createElement('option');
            option.value = conn.profileName;

            // Show authentication type
            const authType = conn.authenticationType === 'Integrated' ? 'Windows Auth' : 'SQL Auth';
            option.textContent = `${conn.profileName} (${conn.server}) - ${authType}`;

            connectionSelect.appendChild(option);
        });
    }

    function updateConnectionStatus(message, type = '') {
        connectionStatus.textContent = message;
        connectionStatus.className = `connection-status ${type}`;
    }

    // Initialize sort indicators
    updateSortIndicators();

    // Request initial results and connections
    setTimeout(() => {
        requestResults();
        vscode.postMessage({ command: 'refreshConnections' });
    }, 100);

})();