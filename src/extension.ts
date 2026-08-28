import * as vscode from 'vscode';
import { SqlProfilerManager } from './profiler/SqlProfilerManager';
import { ProfilerWebviewProvider } from './webview/ProfilerWebviewProvider';
import { Logger } from './utils/Logger';

let profilerManager: SqlProfilerManager | undefined;
let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger first
    Logger.initialize(context);
    Logger.info('SQL Server Profiler Tool extension is now active!');

    // Initialize the profiler manager
    profilerManager = new SqlProfilerManager(context);

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
    // Open Profiler command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.openProfiler', () => {
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
                        localResourceRoots: [
                            vscode.Uri.joinPath(context.extensionUri, 'media')
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
                        if (profilerManager) {
                            void profilerManager.stopProfiling().catch(error => {
                                Logger.error('Failed to stop profiling after the profiler panel closed', error);
                            });
                        }
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
            if (!profilerManager) {
                vscode.window.showErrorMessage('Profiler not initialized');
                return;
            }

            try {
                await profilerManager.startProfiling();
                vscode.window.showInformationMessage('SQL Server profiling started');

                // Update webview if open
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        command: 'profilingStarted'
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start profiling: ${error}`);
            }
        })
    );

    // Stop profiling command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.stopProfiling', async () => {
            if (!profilerManager) {
                vscode.window.showErrorMessage('Profiler not initialized');
                return;
            }

            try {
                await profilerManager.stopProfiling();
                vscode.window.showInformationMessage('SQL Server profiling stopped');

                // Update webview if open
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        command: 'profilingStopped'
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop profiling: ${error}`);
            }
        })
    );

    // Clear results command
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlProfiler.clearResults', () => {
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
}

function handleWebviewMessage(message: unknown) {
    if (typeof message !== 'object' || message === null) {
        return;
    }
    const msg = message as Record<string, unknown>;
    const command = typeof msg.command === 'string' ? msg.command : '';

    switch (command) {
        case 'startProfiling':
            startProfilingFromWebview();
            break;
        case 'stopProfiling':
            stopProfilingFromWebview();
            break;
        case 'clearResults':
            clearResultsFromWebview();
            break;
        case 'getResults':
            if (profilerManager && currentPanel) {
                const results = profilerManager.getResults();
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
            if (typeof msg.connectionName === 'string') {
                setConnection(msg.connectionName);
            }
            break;
        case 'openSqlInNewTab': {
            const sql = typeof msg.sql === 'string' ? msg.sql : '';
            if (!sql || sql.length > 5_000_000) {
                return;
            }
            const rawMeta = (typeof msg.metadata === 'object' && msg.metadata !== null)
                ? msg.metadata as Record<string, unknown>
                : {};
            openSqlInNewTab(sql, {
                timestamp: String(rawMeta.timestamp ?? ''),
                eventName: String(rawMeta.eventName ?? ''),
                database: String(rawMeta.database ?? ''),
                user: String(rawMeta.user ?? '')
            });
            break;
        }
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

    const confirm = await vscode.window.showWarningMessage(
        `Export ${results.length} captured event(s)? The file will contain raw SQL text, database names and user names in clear text.`,
        { modal: true },
        'Export'
    );
    if (confirm !== 'Export') {
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
        try {
            const content = JSON.stringify(results, null, 2);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
        } catch (error) {
            Logger.error('Failed to export results', error);
        }
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

interface SqlTabMetadata {
    timestamp: string;
    eventName: string;
    database: string;
    user: string;
}

async function openSqlInNewTab(sqlContent: string, metadata: SqlTabMetadata) {
    try {
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

        // Add metadata as SQL comments at the top
        const parsedTimestamp = metadata.timestamp ? new Date(metadata.timestamp) : undefined;
        const timestampText = parsedTimestamp && !isNaN(parsedTimestamp.getTime())
            ? parsedTimestamp.toLocaleString()
            : 'Unknown';
        const metadataComments = [
            `-- SQL statement from SQL Server Profiler`,
            `-- Timestamp: ${timestampText}`,
            `-- Event type: ${metadata.eventName || 'Unknown'}`,
            `-- Database: ${metadata.database || 'Unknown'}`,
            `-- User: ${metadata.user || 'Unknown'}`,
            `--`,
            ``
        ].join('\n');

        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), metadataComments);
        });

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
        await profilerManager.startProfiling();
        vscode.window.showInformationMessage('SQL Server profiling started');

        currentPanel.webview.postMessage({
            command: 'profilingStarted'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to start profiling: ${errorMessage}`);

        currentPanel.webview.postMessage({
            command: 'profilingError',
            error: errorMessage
        });
    }
}

async function stopProfilingFromWebview() {
    if (!profilerManager || !currentPanel) {
        return;
    }

    try {
        await profilerManager.stopProfiling();
        vscode.window.showInformationMessage('SQL Server profiling stopped');

        currentPanel.webview.postMessage({
            command: 'profilingStopped'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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

export async function deactivate(): Promise<void> {
    if (profilerManager) {
        await profilerManager.dispose();
    }
}