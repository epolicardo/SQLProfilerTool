import * as vscode from 'vscode';

export class Logger {
    private static outputChannel: vscode.OutputChannel;
    private static context: vscode.ExtensionContext;
    private static recentErrors: Map<string, number> = new Map(); // Track recent error messages
    private static readonly errorCooldownMs = 30000; // 30 seconds cooldown for duplicate errors

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

        // Check for duplicate error messages to prevent spam
        const errorKey = message + (error?.code || '');
        const now = Date.now();
        const lastShown = this.recentErrors.get(errorKey);

        if (!lastShown || (now - lastShown) > this.errorCooldownMs) {
            // Show error notification to user (with anti-spam protection)
            vscode.window.showErrorMessage(`SQL Profiler: ${message}`);
            this.recentErrors.set(errorKey, now);
        } else {
            // Log that we suppressed a duplicate notification
            this.outputChannel.appendLine(`[${timestamp}] NOTE: Suppressed duplicate error notification (cooldown active)`);
        }
    }

    /**
     * Log error without showing popup notification (silent error logging)
     * With throttling to prevent spam
     */
    static errorSilent(message: string, error?: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ERROR: ${message}`;

        // Check for duplicate error messages to prevent spam (same as error())
        const errorKey = message + (error?.code || '');
        const now = Date.now();
        const lastShown = this.recentErrors.get(errorKey);

        if (!lastShown || (now - lastShown) > this.errorCooldownMs) {
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

            this.recentErrors.set(errorKey, now);
        } else {
            // Silently suppress duplicate - don't even log it
            // This prevents log spam for repeated connection errors
        }

        // No popup notification - only logs to output channel and console
    }

    /**
     * Log error with conditional popup based on error criticality
     */
    static errorConditional(message: string, error?: any, showPopup: boolean = false) {
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

        // Show popup only if explicitly requested
        if (showPopup) {
            vscode.window.showErrorMessage(`SQL Profiler: ${message}`);
        }
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

    /**
     * Clean up old error entries from anti-spam cache
     */
    static cleanupErrorCache() {
        const now = Date.now();
        const cutoff = now - this.errorCooldownMs;

        for (const [key, timestamp] of this.recentErrors.entries()) {
            if (timestamp < cutoff) {
                this.recentErrors.delete(key);
            }
        }
    }

    /**
     * Force clear error cache (for testing or manual reset)
     */
    static resetErrorCache() {
        this.recentErrors.clear();
    }
}