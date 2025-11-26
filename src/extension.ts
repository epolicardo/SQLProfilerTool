
import * as vscode from 'vscode';
import { SqlProfilerManager } from './profiler/SqlProfilerManager';
import { ProfilerWebviewProvider } from './webview/ProfilerWebviewProvider';
import { Logger } from './utils/Logger';
import { TelemetryService } from './utils/TelemetryService';

let profilerManager: SqlProfilerManager | undefined;
let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger first
    Logger.initialize(context);
    Logger.info('SQL Server Profiler Tool extension is now active!');

    // --- TelemetryService: inicialización segura ---
    try {
        // TODO: Reemplazar por tu Application Insights Key real
        const aiKey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY || '';
        if (aiKey) {
            TelemetryService.initialize(context, aiKey);
            TelemetryService.getInstance()?.sendEvent('extensionActivated');
        } else {
            Logger.info('Telemetry not initialized: No Application Insights key found.');
        }
    } catch (err) {
        Logger.error('Error initializing telemetry: ' + (err instanceof Error ? err.message : String(err)));
    }

    // Initialize the profiler manager
    profilerManager = new SqlProfilerManager(context);

    // Create Status Bar button
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(database) SQL Profiler';
    statusBarItem.tooltip = 'Click to open SQL Server Profiler';
    statusBarItem.command = 'sqlProfiler.openProfiler';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    registerCommands(context);

    // Command to show logs
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.showLogs', () => {
            Logger.show();
            vscode.window.showInformationMessage(
                'SQL Profiler logs are now visible in the Output panel. You can also access them via View → Output → "SQL Server Profiler"'
            );
        })
    );

    // Command to clear stored password for a specific connection
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.clearStoredPassword', async () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            try {
                // Get connections with stored passwords
                const connectionsWithPasswords = await profilerManager.getConnectionsWithStoredPasswords();

                if (connectionsWithPasswords.length === 0) {
                    vscode.window.showInformationMessage('No stored passwords found for any connection profiles');
                    return;
                }

                // Let user select which connection password to clear
                const selectedConnection = await vscode.window.showQuickPick(
                    connectionsWithPasswords.map(name => ({ label: name, value: name })),
                    {
                        placeHolder: 'Select connection to clear stored password',
                        ignoreFocusOut: true
                    }
                );

                if (selectedConnection) {
                    await profilerManager.clearStoredPassword(selectedConnection.value);
                    vscode.window.showInformationMessage(`Stored password cleared for connection: ${selectedConnection.value}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to clear stored password: ${error.message}`);
            }
        })
    );

    // Command to clear all stored passwords
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.clearAllStoredPasswords', async () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            try {
                const connectionsWithPasswords = await profilerManager.getConnectionsWithStoredPasswords();

                if (connectionsWithPasswords.length === 0) {
                    vscode.window.showInformationMessage('No stored passwords found');
                    return;
                }

                // Confirm action
                const confirmClear = await vscode.window.showWarningMessage(
                    `Are you sure you want to clear stored passwords for ${connectionsWithPasswords.length} connection(s)?`,
                    { modal: true },
                    'Yes, Clear All',
                    'Cancel'
                );

                if (confirmClear === 'Yes, Clear All') {
                    await profilerManager.clearAllStoredPasswords();
                    vscode.window.showInformationMessage(`Cleared stored passwords for ${connectionsWithPasswords.length} connection profiles`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to clear stored passwords: ${error.message}`);
            }
        })
    );

    // Command to show connections with stored passwords
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.showStoredPasswords', async () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            try {
                const connectionsWithPasswords = await profilerManager.getConnectionsWithStoredPasswords();

                if (connectionsWithPasswords.length === 0) {
                    vscode.window.showInformationMessage('No stored passwords found for any connection profiles');
                } else {
                    const connectionsList = connectionsWithPasswords.join('\n• ');
                    vscode.window.showInformationMessage(
                        `Connections with stored passwords (${connectionsWithPasswords.length}):\n\n• ${connectionsList}`,
                        { modal: true }
                    );
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to check stored passwords: ${error.message}`);
            }
        })
    );
}

function registerCommands(context: vscode.ExtensionContext) {
    // Command to change profiler mode (default/ads)
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.changeProfilerMode', async () => {
            const config = vscode.workspace.getConfiguration('sqlProfiler');
            const currentMode = config.get<string>('profilerMode', 'default');
            const options = [
                { label: 'Default (Extension Logic)', value: 'default', description: 'Use the extension\'s own event capture and filters.' },
                { label: 'ADS Compatible', value: 'ads', description: 'Use the same event capture and mapping as Azure Data Studio Profiler.' }
            ];
            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: `Current mode: ${currentMode === 'ads' ? 'ADS Compatible' : 'Default (Extension Logic)'}`,
                ignoreFocusOut: true
            });
            if (selected && selected.value !== currentMode) {
                await config.update('profilerMode', selected.value, vscode.ConfigurationTarget.Global);
                // Telemetry: mode change
                const telemetry = TelemetryService.getInstance();
                telemetry?.sendEvent('profilerModeChanged', {
                    previousMode: currentMode,
                    newMode: selected.value
                });
                vscode.window.showInformationMessage(`Profiler mode changed to: ${selected.label}`);
            } else if (selected) {
                vscode.window.showInformationMessage(`Profiler mode is already set to: ${selected.label}`);
            }
        })
    );
    // Open Profiler command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.openProfiler', () => {
            const telemetry = TelemetryService.getInstance();
            telemetry?.sendEvent('openProfiler');
            if (currentPanel) {
                currentPanel.reveal(vscode.ViewColumn.One);
            } else {
                currentPanel = vscode.window.createWebviewPanel(
                    'sqlProfiler',
                    'SQL Server Profiler',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        enableFindWidget: true,
                        localResourceRoots: [
                            vscode.Uri.joinPath(context.extensionUri, 'src', 'webview'),
                            vscode.Uri.joinPath(context.extensionUri)
                        ]
                    }
                );

                const webviewProvider = new ProfilerWebviewProvider(context, currentPanel);
                currentPanel.webview.html = webviewProvider.getWebviewContent();

                // Handle webview messages
                currentPanel.webview.onDidReceiveMessage(
                    message => handleWebviewMessage(message),
                    undefined,
                    context.subscriptions
                );

                // Reset when the panel is disposed
                currentPanel.onDidDispose(
                    () => {
                        currentPanel = undefined;
                    },
                    null,
                    context.subscriptions
                );
            }
        })
    );

    // Start profiling command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.startProfiling', async () => {
            const telemetry = TelemetryService.getInstance();
            if (!profilerManager) {
                vscode.window.showErrorMessage('Profiler not initialized');
                telemetry?.sendError('startProfiling.error', new Error('Profiler not initialized'));
                return;
            }

            try {
                const config = vscode.workspace.getConfiguration('sqlProfiler');
                const connectionString = config.get<string>('connectionString');

                if (!connectionString) {
                    const inputConnectionString = await vscode.window.showInputBox({
                        prompt: 'Enter SQL Server connection string',
                        placeHolder: 'Server=localhost;Database=master;Integrated Security=true;',
                        ignoreFocusOut: true
                    });

                    if (!inputConnectionString) {
                        return;
                    }

                    await config.update('connectionString', inputConnectionString, vscode.ConfigurationTarget.Workspace);
                }

                await profilerManager.startProfiling();
                vscode.window.showInformationMessage('SQL Server profiling started');
                telemetry?.sendEvent('startProfiling');

                // Update webview if open
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        command: 'profilingStarted'
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start profiling: ${error}`);
                telemetry?.sendError('startProfiling.error', error instanceof Error ? error : new Error(String(error)));
            }
        })
    );

    // Stop profiling command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.stopProfiling', async () => {
            const telemetry = TelemetryService.getInstance();
            if (!profilerManager) {
                vscode.window.showErrorMessage('Profiler not initialized');
                telemetry?.sendError('stopProfiling.error', new Error('Profiler not initialized'));
                return;
            }

            try {
                await profilerManager.stopProfiling();
                vscode.window.showInformationMessage('SQL Server profiling stopped');
                telemetry?.sendEvent('stopProfiling');

                // Update webview if open
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        command: 'profilingStopped'
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop profiling: ${error}`);
                telemetry?.sendError('stopProfiling.error', error instanceof Error ? error : new Error(String(error)));
            }
        })
    );

    // Clear results command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.clearResults', () => {
            const telemetry = TelemetryService.getInstance();
            telemetry?.sendEvent('clearResults');
            if (profilerManager) {
                profilerManager.clearResults();

                // Update webview if open
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        command: 'resultsCleared'
                    });
                }

                vscode.window.showInformationMessage('Profiler results cleared');
            }
        })
    );

    // 🚀 Auto-Reconnect System Commands

    // Show reconnection statistics
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.showReconnectStats', () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            try {
                const connectionStatus = profilerManager.getConnectionStatus();
                const allStats = profilerManager.getAllReconnectStats();

                // Format connection status
                const statusInfo = [
                    `**Connection Status**`,
                    `• Connected: ${connectionStatus.isConnected ? '✅ Yes' : '❌ No'}`,
                    `• Pool Key: ${connectionStatus.poolKey || 'N/A'}`,
                    `• Database Type: ${connectionStatus.databaseType || 'Unknown'}`,
                    `• Last Health Check: ${connectionStatus.lastHealthCheck?.toLocaleString() || 'Never'}`,
                    ``
                ];

                // Format pool statistics
                if (connectionStatus.poolStats) {
                    const poolStats = connectionStatus.poolStats;
                    statusInfo.push(
                        `**Pool Statistics**`,
                        `• Pool Name: ${poolStats.poolName}`,
                        `• Connections: ${poolStats.borrowed}/${poolStats.max} (${poolStats.available} available)`,
                        `• Min/Max: ${poolStats.min}/${poolStats.max}`,
                        `• Pending: ${poolStats.pending}`,
                        `• Idle Timeout: ${Math.round(poolStats.idleTimeout / 1000)}s`,
                        ``
                    );
                }

                // Format reconnection statistics
                if (connectionStatus.reconnectStats) {
                    const reconnectStats = connectionStatus.reconnectStats;
                    statusInfo.push(
                        `**Reconnection Statistics**`,
                        `• Total Attempts: ${reconnectStats.totalAttempts}`,
                        `• Consecutive Failures: ${reconnectStats.consecutiveFailures}`,
                        `• Circuit Breaker: ${reconnectStats.circuitBreakerState}`,
                        `• Last Success: ${reconnectStats.lastSuccessTime?.toLocaleString() || 'Never'}`,
                        `• Currently Reconnecting: ${reconnectStats.isReconnecting ? '🔄 Yes' : '✅ No'}`,
                        ``
                    );
                } else {
                    statusInfo.push(`**Reconnection Statistics**`, `• No reconnection data available`, ``);
                }

                // Show all pool statistics if multiple pools exist
                const poolCount = Object.keys(allStats).length;
                if (poolCount > 1) {
                    statusInfo.push(`**All Pools (${poolCount} active)**`);
                    Object.entries(allStats).forEach(([poolKey, stats]: [string, any]) => {
                        if (stats) {
                            statusInfo.push(
                                `• ${poolKey}:`,
                                `  - Attempts: ${stats.totalAttempts}`,
                                `  - Circuit Breaker: ${stats.circuitBreakerState}`,
                                `  - Reconnecting: ${stats.isReconnecting ? 'Yes' : 'No'}`
                            );
                        }
                    });
                }

                const message = statusInfo.join('\n');

                // Create and show a new document with the statistics
                vscode.workspace.openTextDocument({
                    content: message,
                    language: 'markdown'
                }).then(doc => {
                    vscode.window.showTextDocument(doc, {
                        viewColumn: vscode.ViewColumn.Beside,
                        preview: true
                    });
                });

            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to get reconnection statistics: ${error.message}`);
            }
        })
    );

    // Reset circuit breaker
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.resetCircuitBreaker', () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            try {
                profilerManager.forceResetCircuitBreaker();
                vscode.window.showInformationMessage('Circuit breaker has been reset manually');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to reset circuit breaker: ${error.message}`);
            }
        })
    );

    // Configure auto-reconnect settings
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.configureAutoReconnect', async () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            // Show quick pick with common configuration presets
            const preset = await vscode.window.showQuickPick([
                {
                    label: '🏠 Development (Local)',
                    description: 'Optimized for local SQL Server instances',
                    detail: 'Fast reconnection, fewer retries, no circuit breaker',
                    value: 'development'
                },
                {
                    label: '☁️ Azure SQL Database',
                    description: 'Optimized for Azure SQL Database connections',
                    detail: 'More retries, circuit breaker enabled, longer delays',
                    value: 'azure'
                },
                {
                    label: '🏢 SQL Server On-Premise',
                    description: 'Balanced settings for on-premise SQL Server',
                    detail: 'Standard retries, circuit breaker enabled',
                    value: 'onpremise'
                },
                {
                    label: '🔧 Custom Settings',
                    description: 'Open VS Code settings to configure manually',
                    detail: 'Fine-tune all reconnection parameters',
                    value: 'custom'
                },
                {
                    label: '📊 Show Current Settings',
                    description: 'Display current auto-reconnect configuration',
                    detail: 'View all current settings and their values',
                    value: 'show'
                }
            ], {
                placeHolder: 'Select auto-reconnection configuration preset',
                ignoreFocusOut: true
            });

            if (!preset) {
                return;
            }

            try {
                switch (preset.value) {
                    case 'development':
                        profilerManager.updateAutoReconnectConfig({
                            maxRetries: 3,
                            initialDelay: 500,
                            backoffFactor: 1.5,
                            maxDelay: 5000,
                            enableCircuitBreaker: false,
                            connectionTimeout: 10000
                        });
                        vscode.window.showInformationMessage('Auto-reconnect configured for Development (Local)');
                        break;

                    case 'azure':
                        profilerManager.updateAutoReconnectConfig({
                            maxRetries: 8,
                            initialDelay: 1000,
                            backoffFactor: 2.0,
                            maxDelay: 30000,
                            enableCircuitBreaker: true,
                            circuitBreakerThreshold: 5,
                            circuitBreakerCooldown: 60000,
                            connectionTimeout: 20000
                        });
                        vscode.window.showInformationMessage('Auto-reconnect configured for Azure SQL Database');
                        break;

                    case 'onpremise':
                        profilerManager.updateAutoReconnectConfig({
                            maxRetries: 5,
                            initialDelay: 1000,
                            backoffFactor: 2.0,
                            maxDelay: 15000,
                            enableCircuitBreaker: true,
                            circuitBreakerThreshold: 3,
                            circuitBreakerCooldown: 45000,
                            connectionTimeout: 15000
                        });
                        vscode.window.showInformationMessage('Auto-reconnect configured for SQL Server On-Premise');
                        break;

                    case 'custom':
                        vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler.autoReconnect');
                        break;

                    case 'show':
                        const currentStats = profilerManager.getConnectionStatus();
                        const configInfo = [
                            `# Current Auto-Reconnection Configuration`,
                            ``,
                            `*Last updated: ${new Date().toLocaleString()}*`,
                            ``,
                            `## Connection Status`,
                            `- **Connected**: ${currentStats.isConnected ? '✅ Yes' : '❌ No'}`,
                            `- **Pool Key**: ${currentStats.poolKey || 'N/A'}`,
                            `- **Database Type**: ${currentStats.databaseType || 'Unknown'}`,
                            ``,
                            `## Current Settings`,
                            `To modify these settings, use **Ctrl+Shift+P** → "Configure Auto-Reconnection Settings" → "Custom Settings"`,
                            ``,
                            `### Reconnection Behavior`,
                            `- **Max Retries**: \`sqlProfiler.autoReconnect.maxRetries\``,
                            `- **Initial Delay**: \`sqlProfiler.autoReconnect.initialDelay\` ms`,
                            `- **Backoff Factor**: \`sqlProfiler.autoReconnect.backoffFactor\``,
                            `- **Max Delay**: \`sqlProfiler.autoReconnect.maxDelay\` ms`,
                            `- **Connection Timeout**: \`sqlProfiler.autoReconnect.connectionTimeout\` ms`,
                            ``,
                            `### Circuit Breaker`,
                            `- **Enabled**: \`sqlProfiler.autoReconnect.enableCircuitBreaker\``,
                            `- **Failure Threshold**: \`sqlProfiler.autoReconnect.circuitBreakerThreshold\``,
                            `- **Cooldown Period**: \`sqlProfiler.autoReconnect.circuitBreakerCooldown\` ms`,
                            ``,
                            `## Available Presets`,
                            `1. **Development (Local)** - Fast, minimal retries`,
                            `2. **Azure SQL Database** - Robust, many retries`,
                            `3. **SQL Server On-Premise** - Balanced approach`,
                            ``,
                            `## Statistics`,
                            currentStats.reconnectStats ? [
                                `- **Total Attempts**: ${currentStats.reconnectStats.totalAttempts}`,
                                `- **Consecutive Failures**: ${currentStats.reconnectStats.consecutiveFailures}`,
                                `- **Circuit Breaker State**: ${currentStats.reconnectStats.circuitBreakerState}`,
                                `- **Last Success**: ${currentStats.reconnectStats.lastSuccessTime?.toLocaleString() || 'Never'}`,
                                `- **Currently Reconnecting**: ${currentStats.reconnectStats.isReconnecting ? '🔄 Yes' : '✅ No'}`
                            ].join('\n') : `- No reconnection statistics available`
                        ].join('\n');

                        vscode.workspace.openTextDocument({
                            content: configInfo,
                            language: 'markdown'
                        }).then(doc => {
                            vscode.window.showTextDocument(doc, {
                                viewColumn: vscode.ViewColumn.Beside,
                                preview: true
                            });
                        });
                        break;
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to configure auto-reconnect: ${error.message}`);
            }
        })
    );

    // Start profiling with enhanced auto-recovery
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.startWithAutoRecovery', () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            vscode.window.showInformationMessage('Starting SQL Profiler with enhanced auto-recovery...');

            // This will be available in the SqlProfilerManager
            (profilerManager as any).startProfilingWithAutoRecovery?.().catch((error: any) => {
                vscode.window.showErrorMessage(`Failed to start profiling with auto-recovery: ${error.message}`);
            });
        })
    );

    // Azure SQL Database connection diagnostics
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.diagnoseAzureSQL', async () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('SQL Profiler is not initialized');
                return;
            }

            try {
                await (profilerManager as any).diagnoseAzureSQLConnection?.();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to run Azure SQL diagnostics: ${error.message}`);
            }
        })
    );
}

function handleWebviewMessage(message: any) {
    console.log('Received webview message:', message.command);
    switch (message.command) {
        case 'startProfiling':
            console.log('Handling startProfiling command');
            startProfilingFromWebview();
            break;
        case 'stopProfiling':
            console.log('Handling stopProfiling command');
            stopProfilingFromWebview();
            break;
        case 'clearResults':
            clearResultsFromWebview();
            break;
        case 'getResults':
            if (profilerManager && currentPanel) {
                const results = profilerManager.getResults();
                console.log('=== EXTENSION SENDING RESULTS ===');
                console.log('Results to send:', results.length);
                console.log('First result sample:', results[0] ? {
                    timestamp: results[0].timestamp,
                    eventName: results[0].eventName,
                    statement: results[0].statement?.substring(0, 50) + '...'
                } : 'No results');

                // FUTURE ENHANCEMENT: Update sidebar view with event count (disabled for now)
                // const isRunning = (profilerManager as any).isRunning || false;
                // profilerViewProvider?.updateStatus(isRunning, undefined, results.length);

                currentPanel.webview.postMessage({
                    command: 'updateResults',
                    data: results
                });
            }
            break;
        case 'exportResults':
            exportResults();
            break;
        case 'refreshConnections':
            refreshConnections();
            break;
        case 'setConnection':
            setConnection(message.connectionName);
            break;
        case 'openSqlInNewTab':
            openSqlInNewTab(message.sql, message.metadata);
            break;
    }
}

async function exportResults() {
    if (!profilerManager) {
        return;
    }

    const results = profilerManager.getResults();
    if (results.length === 0) {
        vscode.window.showInformationMessage('No results to export');
        return;
    }

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('profiler-results.json'),
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
        }
    });

    if (uri) {
        const content = JSON.stringify(results, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));

        // Telemetry: results exported
        const telemetry = TelemetryService.getInstance();
        telemetry?.sendMetric('resultsExported', results.length, {
            format: uri.path.endsWith('.json') ? 'json' : 'other'
        });

        vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
    }
}

function refreshConnections() {
    if (!profilerManager || !currentPanel) {
        return;
    }

    const connections = profilerManager.getMssqlConnections();
    currentPanel.webview.postMessage({
        command: 'updateConnections',
        connections: connections
    });
}

async function setConnection(connectionName: string) {
    if (!profilerManager || !currentPanel) {
        return;
    }

    try {
        await profilerManager.setSelectedConnection(connectionName);
        currentPanel.webview.postMessage({
            command: 'connectionSelected',
            connectionName: connectionName
        });
    } catch (error) {
        currentPanel.webview.postMessage({
            command: 'connectionError',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

async function openSqlInNewTab(sqlContent: string, metadata: any) {
    try {
        // Telemetry: open SQL in new tab
        const telemetry = TelemetryService.getInstance();
        telemetry?.sendEvent('sqlOpenedInNewTab', {
            eventType: metadata?.eventName || 'unknown'
        });

        // Create a new untitled document with SQL content
        const doc = await vscode.workspace.openTextDocument({
            content: sqlContent,
            language: 'sql'
        });

        // Open the document in a new editor tab
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: false
        });

        // Optionally add metadata as comments at the top
        if (metadata) {
            const metadataComments = [
                `-- SQL Statement from Profiler`,
                `-- Timestamp: ${new Date(metadata.timestamp).toLocaleString()}`,
                `-- Event Type: ${metadata.eventName || 'Unknown'}`,
                `-- Database: ${metadata.database || 'Unknown'}`,
                `-- User: ${metadata.user || 'Unknown'}`,
                `-- `,
                ``
            ].join('\n');

            await editor.edit(editBuilder => {
                editBuilder.insert(new vscode.Position(0, 0), metadataComments);
            });
        }

        vscode.window.showInformationMessage('SQL statement opened in new tab');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to open SQL in new tab: ${errorMessage}`);
    }
}

async function startProfilingFromWebview() {
    if (!profilerManager || !currentPanel) {
        return;
    }

    try {
        // Show immediate notification to user
        vscode.window.showInformationMessage('SQL Server profiler is starting...');

        // Update webview to show starting status
        console.log('Sending profilingStarting message to webview');
        currentPanel.webview.postMessage({
            command: 'profilingStarting'
        });

        console.log('Calling profilerManager.startProfiling()');
        await profilerManager.startProfiling();
        console.log('Profiling started successfully');
        vscode.window.showInformationMessage('SQL Server profiling started');

        console.log('Sending profilingStarted message to webview');
        currentPanel.webview.postMessage({
            command: 'profilingStarted'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error starting profiling:', error);
        vscode.window.showErrorMessage(`Failed to start profiling: ${errorMessage}`);

        currentPanel.webview.postMessage({
            command: 'profilingError',
            error: errorMessage
        });
    }
}

async function stopProfilingFromWebview() {
    console.log('stopProfilingFromWebview called');
    if (!profilerManager || !currentPanel) {
        console.log('No profilerManager or currentPanel available');
        return;
    }

    try {
        // Show immediate notification to user
        vscode.window.showInformationMessage('SQL Server profiler is stopping...');

        // Update webview to show stopping status
        console.log('Sending profilingStopping message to webview');
        currentPanel.webview.postMessage({
            command: 'profilingStopping'
        });

        console.log('Calling profilerManager.stopProfiling()');
        await profilerManager.stopProfiling();
        console.log('Profiling stopped successfully');
        vscode.window.showInformationMessage('SQL Server profiling stopped');

        console.log('Sending profilingStopped message to webview');
        currentPanel.webview.postMessage({
            command: 'profilingStopped'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error stopping profiling:', error);
        vscode.window.showErrorMessage(`Failed to stop profiling: ${errorMessage}`);
    }
}

function clearResultsFromWebview() {
    if (!profilerManager || !currentPanel) {
        return;
    }

    profilerManager.clearResults();

    currentPanel.webview.postMessage({
        command: 'updateResults',
        data: []
    });

    vscode.window.showInformationMessage('Profiler results cleared');
}

export async function deactivate() {
    try {
        // Send telemetry before disposing
        TelemetryService.getInstance()?.sendEvent('extensionDeactivated');

        if (profilerManager) {
            // Dispose del profiler manager primero
            await profilerManager.dispose();

            // Cerrar todos los pools de conexiones
            const { ConnectionPoolManager } = await import('./database/ConnectionPoolManager');
            const poolManager = ConnectionPoolManager.getInstance();
            await poolManager.closeAllPools();

            Logger.info('Extension deactivated successfully - all resources cleaned up');
        }

        // Dispose telemetry service last
        TelemetryService.getInstance()?.dispose();
    } catch (error) {
        Logger.error('Error during extension deactivation:', error);
        // Asegurar que el error no impida la desactivación
        console.error('SQL Profiler Extension deactivation error:', error);
    }
}