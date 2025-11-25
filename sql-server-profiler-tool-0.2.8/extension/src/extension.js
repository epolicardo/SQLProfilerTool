"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const SqlProfilerManager_1 = require("./profiler/SqlProfilerManager");
const ProfilerWebviewProvider_1 = require("./webview/ProfilerWebviewProvider");
const Logger_1 = require("./utils/Logger");
let profilerManager;
let currentPanel;
function activate(context) {
    // Initialize logger first
    Logger_1.Logger.initialize(context);
    Logger_1.Logger.info('SQL Server Profiler Tool extension is now active!');
    // Initialize the profiler manager
    profilerManager = new SqlProfilerManager_1.SqlProfilerManager(context);
    // Register commands
    registerCommands(context);
    // Command to show logs
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.showLogs', () => {
        Logger_1.Logger.show();
        vscode.window.showInformationMessage('SQL Profiler logs are now visible in the Output panel. You can also access them via View → Output → "SQL Server Profiler"');
    }));
    // Command to clear stored password for a specific connection
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.clearStoredPassword', async () => {
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
            const selectedConnection = await vscode.window.showQuickPick(connectionsWithPasswords.map(name => ({ label: name, value: name })), {
                placeHolder: 'Select connection to clear stored password',
                ignoreFocusOut: true
            });
            if (selectedConnection) {
                await profilerManager.clearStoredPassword(selectedConnection.value);
                vscode.window.showInformationMessage(`Stored password cleared for connection: ${selectedConnection.value}`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to clear stored password: ${error.message}`);
        }
    }));
    // Command to clear all stored passwords
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.clearAllStoredPasswords', async () => {
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
            const confirmClear = await vscode.window.showWarningMessage(`Are you sure you want to clear stored passwords for ${connectionsWithPasswords.length} connection(s)?`, { modal: true }, 'Yes, Clear All', 'Cancel');
            if (confirmClear === 'Yes, Clear All') {
                await profilerManager.clearAllStoredPasswords();
                vscode.window.showInformationMessage(`Cleared stored passwords for ${connectionsWithPasswords.length} connection profiles`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to clear stored passwords: ${error.message}`);
        }
    }));
    // Command to show connections with stored passwords
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.showStoredPasswords', async () => {
        if (!profilerManager) {
            vscode.window.showErrorMessage('SQL Profiler is not initialized');
            return;
        }
        try {
            const connectionsWithPasswords = await profilerManager.getConnectionsWithStoredPasswords();
            if (connectionsWithPasswords.length === 0) {
                vscode.window.showInformationMessage('No stored passwords found for any connection profiles');
            }
            else {
                const connectionsList = connectionsWithPasswords.join('\n• ');
                vscode.window.showInformationMessage(`Connections with stored passwords (${connectionsWithPasswords.length}):\n\n• ${connectionsList}`, { modal: true });
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to check stored passwords: ${error.message}`);
        }
    }));
}
exports.activate = activate;
function registerCommands(context) {
    // Open Profiler command
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.openProfiler', () => {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.One);
        }
        else {
            currentPanel = vscode.window.createWebviewPanel('sqlProfiler', 'SQL Server Profiler', vscode.ViewColumn.One, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'webview')
                ]
            });
            const webviewProvider = new ProfilerWebviewProvider_1.ProfilerWebviewProvider(context, currentPanel);
            currentPanel.webview.html = webviewProvider.getWebviewContent();
            // Handle webview messages
            currentPanel.webview.onDidReceiveMessage(message => handleWebviewMessage(message), undefined, context.subscriptions);
            // Reset when the panel is disposed
            currentPanel.onDidDispose(() => {
                currentPanel = undefined;
            }, null, context.subscriptions);
        }
    }));
    // Start profiling command
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.startProfiling', async () => {
        if (!profilerManager) {
            vscode.window.showErrorMessage('Profiler not initialized');
            return;
        }
        try {
            const config = vscode.workspace.getConfiguration('sqlProfiler');
            const connectionString = config.get('connectionString');
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to start profiling: ${error}`);
        }
    }));
    // Stop profiling command
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.stopProfiling', async () => {
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to stop profiling: ${error}`);
        }
    }));
    // Clear results command
    context.subscriptions.push(vscode.commands.registerCommand('sqlProfiler.clearResults', () => {
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
    }));
}
function handleWebviewMessage(message) {
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
async function setConnection(connectionName) {
    if (!profilerManager || !currentPanel) {
        return;
    }
    try {
        await profilerManager.setSelectedConnection(connectionName);
        currentPanel.webview.postMessage({
            command: 'connectionSelected',
            connectionName: connectionName
        });
    }
    catch (error) {
        currentPanel.webview.postMessage({
            command: 'connectionError',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
async function openSqlInNewTab(sqlContent, metadata) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
async function deactivate() {
    try {
        if (profilerManager) {
            // Dispose del profiler manager primero
            await profilerManager.dispose();
            // Cerrar todos los pools de conexiones
            const { ConnectionPoolManager } = await Promise.resolve().then(() => require('./database/ConnectionPoolManager'));
            const poolManager = ConnectionPoolManager.getInstance();
            await poolManager.closeAllPools();
            Logger_1.Logger.info('Extension deactivated successfully - all resources cleaned up');
        }
    }
    catch (error) {
        Logger_1.Logger.error('Error during extension deactivation:', error);
        // Asegurar que el error no impida la desactivación
        console.error('SQL Profiler Extension deactivation error:', error);
    }
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map