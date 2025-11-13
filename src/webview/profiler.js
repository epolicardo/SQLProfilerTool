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

    // Estado para mantener elementos expandidos
    const expandedEvents = new Set(); // IDs de eventos expandidos
    let currentScrollPosition = 0;

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
            console.log('Stop button clicked, isRunning:', isRunning, 'button disabled:', stopBtn.disabled);
            if (!stopBtn.disabled) {
                console.log('Sending stopProfiling message');
                vscode.postMessage({ command: 'stopProfiling' });
            } else {
                console.log('Stop button is disabled, ignoring click');
            }
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
                updateConnectionStatus(`Selected: ${selectedConnection}`, 'connected');
            } else {
                updateConnectionStatus('', '');
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
                console.log('=== WEBVIEW RECEIVED RESULTS ===');
                console.log('Raw message data length:', message.data ? message.data.length : 0);
                console.log('First 3 events:', message.data ? message.data.slice(0, 3) : 'No data');

                currentResults = message.data || [];
                console.log('currentResults length after assignment:', currentResults.length);

                updateDatabaseFilter();
                applyFilters();

                console.log('filteredResults length after applyFilters:', filteredResults.length);
                break;

            case 'updateConnections':
                updateConnectionsList(message.connections || []);
                break;

            case 'connectionSelected':
                updateConnectionStatus(`Selected connection: ${message.connectionName}`, 'connected');
                break;

            case 'connectionError':
                updateConnectionStatus(`Error: ${message.error}`, 'error');
                break;

            case 'profilingStarting':
                setProfilingState('starting');
                break;

            case 'profilingStarted':
                setProfilingState(true);
                break;

            case 'profilingStopping':
                setProfilingState('stopping');
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
                expandedEvents.clear(); // Limpiar estado de expansión
                currentScrollPosition = 0;
                renderResults();
                updateDatabaseFilter();
                break;
        }
    });

    function setProfilingState(running) {
        console.log('Setting profiling state to:', running);
        isRunning = running;

        if (running === 'starting') {
            console.log('Setting starting state - disabling both buttons');
            startBtn.disabled = true;
            stopBtn.disabled = true;
            statusIcon.className = 'status-icon starting';
            statusText.textContent = 'Starting...';

            // Don't start auto-refresh yet
        } else if (running === true) {
            console.log('Enabling stop button, disabling start button');
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusIcon.className = 'status-icon running';
            statusText.textContent = 'Running';

            // Auto-refresh when running
            if (!window.autoRefreshInterval) {
                window.autoRefreshInterval = setInterval(requestResults, 2000);
            }
        } else if (running === 'stopping') {
            console.log('Setting stopping state - disabling both buttons');
            startBtn.disabled = true;
            stopBtn.disabled = true;
            statusIcon.className = 'status-icon stopping';
            statusText.textContent = 'Stopping...';

            // Keep auto-refresh during stopping process
        } else {
            console.log('Enabling start button, disabling stop button');
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
        // Guardar posición de scroll antes de renderizar
        const tableContainer = document.querySelector('.table-container');
        if (tableContainer) {
            currentScrollPosition = tableContainer.scrollTop;
        }

        if (filteredResults.length === 0) {
            resultsBody.innerHTML = '<tr class="no-results"><td colspan="7">No events match the current filters.</td></tr>';
            return;
        }

        resultsBody.innerHTML = filteredResults.map((result, index) => {
            const timestamp = new Date(result.timestamp).toLocaleString();
            const duration = result.duration || 0;
            const durationClass = getDurationClass(duration);
            const eventId = result.id; // Usar el ID único del evento
            const rowId = `row-${eventId}`;
            const expandedId = `expanded-${eventId}`;

            // Verificar si este evento debe estar expandido
            const isExpanded = expandedEvents.has(eventId);
            const expandIcon = isExpanded ? '▼' : '▶';
            const expandedClass = isExpanded ? 'show' : '';
            const buttonClass = isExpanded ? 'expanded' : '';

            return `
                <tr class="expandable-row" data-row-id="${rowId}" data-expanded-id="${expandedId}" data-index="${index}" data-event-id="${eventId}">
                    <td>
                        <button class="expand-btn ${buttonClass}" id="expand-btn-${rowId}">${expandIcon}</button>
                    </td>
                    <td>${timestamp}</td>
                    <td>${result.eventName || 'Unknown'}</td>
                    <td>${result.databaseName || ''}</td>
                    <td>${result.userName || ''}</td>
                    <td class="${durationClass}">${duration > 0 ? duration.toLocaleString() : ''}</td>
                    <td class="sql-statement-cell" data-sql="${escapeHtml(result.statement)}">${escapeHtml(truncateText(result.statement, 100))}</td>
                </tr>
                <tr class="expanded-content ${expandedClass}" id="${expandedId}">
                    <td colspan="7">
                        <div class="expanded-details">
                            ${renderExpandedContent(result, index)}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Add event listeners after rendering
        attachRowEventListeners();

        // Restaurar posición de scroll después del renderizado
        setTimeout(() => {
            const tableContainer = document.querySelector('.table-container');
            if (tableContainer && currentScrollPosition > 0) {
                tableContainer.scrollTop = currentScrollPosition;
            }
        }, 0);
    }

    function renderExpandedContent(result, index) {
        const timestamp = new Date(result.timestamp).toLocaleString();
        const duration = result.duration || 0;

        return `
            <div class="detail-section">
                <h4>📊 Event Details</h4>
                <div class="detail-grid">
                    <span class="detail-label">Timestamp:</span>
                    <span class="detail-value">${timestamp}</span>
                    
                    <span class="detail-label">Event Type:</span>
                    <span class="detail-value">${result.eventName || 'Unknown'}</span>
                    
                    <span class="detail-label">Database:</span>
                    <span class="detail-value">${result.databaseName || 'N/A'}</span>
                    
                    <span class="detail-label">User:</span>
                    <span class="detail-value">${result.userName || 'N/A'}</span>
                    
                    <span class="detail-label">Application:</span>
                    <span class="detail-value">${result.applicationName || 'N/A'}</span>
                    
                    <span class="detail-label">Duration:</span>
                    <span class="detail-value">${duration > 0 ? duration.toLocaleString() + ' ms' : 'N/A'}</span>
                </div>
            </div>
            
            <div class="detail-section">
                <h4>📝 SQL Statement</h4>
                <div class="sql-container">
                    <div class="sql-content" id="sql-content-${index}">${escapeHtml(result.statement || 'No SQL statement captured')}</div>
                    <div class="sql-actions">
                        <button class="btn copy-btn" data-index="${index}" id="copy-btn-${index}">
                            📋 Copy SQL
                        </button>
                        <button class="btn open-btn" data-index="${index}">
                            📄 Open in New Tab
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function attachRowEventListeners() {
        // Attach click listeners to expandable rows
        document.querySelectorAll('.expandable-row').forEach(row => {
            row.addEventListener('click', function (e) {
                // Don't trigger if clicking on the expand button directly
                if (e.target.classList.contains('expand-btn')) {
                    return;
                }

                const rowId = this.dataset.rowId;
                const expandedId = this.dataset.expandedId;
                toggleRow(rowId, expandedId);
            });
        });

        // Attach click listeners to expand buttons
        document.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const row = this.closest('.expandable-row');
                const rowId = row.dataset.rowId;
                const expandedId = row.dataset.expandedId;
                toggleRow(rowId, expandedId);
            });
        });

        // Attach click listeners to copy buttons
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const index = parseInt(this.dataset.index);
                copySqlToClipboard(index);
            });
        });

        // Attach click listeners to open buttons
        document.querySelectorAll('.open-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const index = parseInt(this.dataset.index);
                openSqlInNewTab(index);
            });
        });

        // Attach hover listeners to SQL statement cells
        document.querySelectorAll('.sql-statement-cell').forEach(cell => {
            let tooltip = null;
            let hoverTimeout = null;

            cell.addEventListener('mouseenter', function (e) {
                // Delay para evitar tooltips accidentales
                hoverTimeout = setTimeout(() => {
                    const sqlText = this.dataset.sql;
                    if (!sqlText || sqlText.trim() === '') return;

                    // Crear tooltip
                    tooltip = document.createElement('div');
                    tooltip.className = 'sql-tooltip visible';
                    tooltip.textContent = sqlText;

                    // Posicionar tooltip
                    this.appendChild(tooltip);

                    // Ajustar posición si se sale de la pantalla
                    const rect = tooltip.getBoundingClientRect();
                    if (rect.right > window.innerWidth) {
                        tooltip.style.left = 'auto';
                        tooltip.style.right = '0';
                    }
                    if (rect.bottom > window.innerHeight) {
                        tooltip.style.top = 'auto';
                        tooltip.style.bottom = '100%';
                    }
                }, 300);
            });

            cell.addEventListener('mouseleave', function () {
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
                if (tooltip) {
                    tooltip.remove();
                    tooltip = null;
                }
            });
        });
    }

    function toggleRow(rowId, expandedId) {
        const expandedRow = document.getElementById(expandedId);
        const expandBtn = document.getElementById(`expand-btn-${rowId}`);

        // Extraer el eventId del rowId (formato: row-evt_timestamp_hash)
        const eventId = rowId.replace('row-', '');

        if (expandedRow.classList.contains('show')) {
            // Colapsar
            expandedRow.classList.remove('show');
            expandBtn.textContent = '▶';
            expandBtn.classList.remove('expanded');
            expandedEvents.delete(eventId); // Remover del estado
        } else {
            // Expandir
            expandedRow.classList.add('show');
            expandBtn.textContent = '▼';
            expandBtn.classList.add('expanded');
            expandedEvents.add(eventId); // Agregar al estado
        }
    }

    function copySqlToClipboard(index) {
        const result = filteredResults[index];
        const sqlContent = result.statement || 'No SQL statement captured';

        navigator.clipboard.writeText(sqlContent).then(() => {
            const copyBtn = document.getElementById(`copy-btn-${index}`);
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅ Copied!';
            copyBtn.classList.add('copy-success');

            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.classList.remove('copy-success');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy SQL:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = sqlContent;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        });
    }

    function openSqlInNewTab(index) {
        const result = filteredResults[index];
        const sqlContent = result.statement || 'No SQL statement captured';

        // Send message to VS Code extension to open SQL in new tab
        vscode.postMessage({
            command: 'openSqlInNewTab',
            sql: sqlContent,
            metadata: {
                timestamp: result.timestamp,
                eventName: result.eventName,
                database: result.databaseName,
                user: result.userName
            }
        });
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
        // Show/hide connection toast based on message
        if (message && message !== 'No connection selected') {
            connectionStatus.textContent = message;
            connectionStatus.className = `connection-toast ${type}`;
            connectionStatus.style.display = 'block';

            // Auto-hide success messages after 3 seconds
            if (type === 'connected') {
                setTimeout(() => {
                    connectionStatus.style.display = 'none';
                }, 3000);
            }
        } else {
            connectionStatus.style.display = 'none';
        }
    }

    // Initialize sort indicators
    updateSortIndicators();

    // Request initial results and connections
    setTimeout(() => {
        requestResults();
        vscode.postMessage({ command: 'refreshConnections' });
    }, 100);

})();