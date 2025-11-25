import * as vscode from 'vscode';

export class Logger {
    private static outputChannel: vscode.OutputChannel;
    private static context: vscode.ExtensionContext;

    static initialize(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('SQL Server Profiler');
        context.subscriptions.push(this.outputChannel);
    }

    static info(message: string, data?: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] INFO: ${message}`;

        // Log to VS Code Output Channel (visible in Output panel)
        this.outputChannel.appendLine(logMessage);

        // Also log to console (visible in Developer Tools)
        console.log(logMessage);

        if (data) {
            const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            this.outputChannel.appendLine(`Data: ${dataStr}`);
            console.log('Data:', data);
        }
    }

    static error(message: string, error?: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ERROR: ${message}`;

        // Log to VS Code Output Channel
        this.outputChannel.appendLine(logMessage);

        // Also log to console
        console.error(logMessage);

        if (error) {
            const errorDetails = {
                message: error.message,
                code: error.code,
                stack: error.stack
            };
            this.outputChannel.appendLine(`Error details: ${JSON.stringify(errorDetails, null, 2)}`);
            console.error('Error details:', error);
        }

        // Show error notification to user
        vscode.window.showErrorMessage(`SQL Profiler: ${message}`);
    }

    static warn(message: string, data?: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] WARN: ${message}`;

        this.outputChannel.appendLine(logMessage);
        console.warn(logMessage);

        if (data) {
            const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            this.outputChannel.appendLine(`Data: ${dataStr}`);
            console.warn('Data:', data);
        }
    }

    static debug(message: string, data?: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] DEBUG: ${message}`;

        this.outputChannel.appendLine(logMessage);
        console.log(logMessage);

        if (data) {
            const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            this.outputChannel.appendLine(`Data: ${dataStr}`);
            console.log('Data:', data);
        }
    }

    static show() {
        this.outputChannel.show();
    }

    static clear() {
        this.outputChannel.clear();
    }
}