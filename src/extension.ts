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
                            vscode.Uri.joinPath(context.extensionUri, 'src', 'webview')
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
            if (!profilerManager) {
                vscode.window.showErrorMessage('Profiler not initialized');
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

function handleWebviewMessage(message: any) {
    switch (message.command) {
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
            setConnection(message.connectionName);
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

export function deactivate() {
    if (profilerManager) {
        profilerManager.dispose();
    }
}