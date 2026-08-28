import * as vscode from 'vscode';

/**
 * Local diagnostic logger. Writes only to the "SQL Server Profiler" output
 * channel — never to the Developer Tools console, and never to any remote
 * service. `debug` output is suppressed unless `sqlProfiler.verboseLogging`
 * is enabled so that day-to-day use produces no diagnostic noise.
 *
 * Callers must never pass secrets (passwords, connection strings) or raw
 * error objects that may embed server names / credentials. Only an
 * allow-listed, stringified shape is written.
 */
export class Logger {
    private static outputChannel: vscode.OutputChannel | undefined;
    private static context: vscode.ExtensionContext | undefined;
    private static verbose = false;

    static initialize(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('SQL Server Profiler');
        context.subscriptions.push(this.outputChannel);

        this.refreshVerbose();
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('sqlProfiler.verboseLogging')) {
                    this.refreshVerbose();
                }
            })
        );
    }

    private static refreshVerbose() {
        this.verbose = vscode.workspace
            .getConfiguration('sqlProfiler')
            .get<boolean>('verboseLogging', false);
    }

    private static write(level: string, message: string, data?: unknown) {
        const line = `[${new Date().toISOString()}] ${level}: ${message}`;
        this.outputChannel?.appendLine(line);
        if (data !== undefined) {
            this.outputChannel?.appendLine(`Data: ${this.safeStringify(data)}`);
        }
    }

    /**
     * Reduces an arbitrary value to a string that cannot carry a full error
     * object / connection details. Error-like values are collapsed to their
     * `code` (and numeric `number` for SQL Server errors) only.
     */
    private static safeStringify(data: unknown): string {
        if (data === null || data === undefined) {
            return String(data);
        }
        if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
            return String(data);
        }
        const err = data as { code?: unknown; number?: unknown };
        if (err.code !== undefined || err.number !== undefined) {
            const code = typeof err.code === 'string' || typeof err.code === 'number' ? err.code : 'UNKNOWN';
            const number = typeof err.number === 'number' ? `, number: ${err.number}` : '';
            return `{ code: ${code}${number} }`;
        }
        try {
            return JSON.stringify(data);
        } catch {
            return '[unserializable]';
        }
    }

    static info(message: string, data?: unknown) {
        this.write('INFO', message, data);
    }

    static warn(message: string, data?: unknown) {
        this.write('WARN', message, data);
    }

    static error(message: string, error?: unknown) {
        this.write('ERROR', message, error);
        vscode.window.showErrorMessage(`SQL Profiler: ${message}`);
    }

    static debug(message: string, data?: unknown) {
        if (!this.verbose) {
            return;
        }
        this.write('DEBUG', message, data);
    }

    static show() {
        this.outputChannel?.show();
    }

    static clear() {
        this.outputChannel?.clear();
    }
}
