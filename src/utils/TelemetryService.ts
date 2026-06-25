
import * as vscode from 'vscode';
import * as https from 'https';
import * as os from 'os';
import { Logger } from './Logger';

interface AppInsightsItem {
    name: string;
    time: string;
    iKey: string;
    tags: { [key: string]: string };
    data: {
        baseType: string;
        baseData: {
            ver: number;
            name: string;
            properties?: { [key: string]: string };
        };
    };
}

export class TelemetryService {
    private static instance: TelemetryService | undefined;
    private isEnabled: boolean = false;
    private instrumentationKey: string = '';
    private queue: AppInsightsItem[] = [];
    private flushTimer: NodeJS.Timeout | undefined;
    private commonProperties: { [key: string]: string } = {};
    private retryCount: number = 0;
    private maxRetries: number = 3;

    private constructor(context: vscode.ExtensionContext, connectionString: string) {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const userOptIn = config.get<boolean>('telemetryEnabled', true);
        const globalOptIn = typeof vscode.env.isTelemetryEnabled === 'boolean' ? vscode.env.isTelemetryEnabled : true;
        this.isEnabled = userOptIn && globalOptIn;

        if (!this.isEnabled) {
            Logger.info('TelemetryService: disabled (userOptIn=' + userOptIn + ', globalOptIn=' + globalOptIn + ')');
            return;
        }

        // Parse instrumentation key from connection string
        const keyMatch = connectionString.match(/InstrumentationKey=([^;]+)/i);
        if (keyMatch) {
            this.instrumentationKey = keyMatch[1].trim();
        }

        if (!this.instrumentationKey) {
            Logger.info('TelemetryService: no iKey found in connection string');
            this.isEnabled = false;
            return;
        }

        Logger.info(`TelemetryService: enabled. iKey=${this.instrumentationKey.substring(0, 8)}...`);

        this.commonProperties = {
            osPlatform: os.platform(),
            osArch: os.arch(),
            vscodeVersion: vscode.version,
            vscodeLanguage: vscode.env.language,
            vscodeRemoteName: vscode.env.remoteName || 'local',
            vscodeUiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web',
            extensionVersion: context.extension.packageJSON.version,
            nodeVersion: process.version,
            nodeArch: process.arch,
        };

        // Flush the queue every 30 seconds
        this.flushTimer = setInterval(() => this.flush(), 30000);
        context.subscriptions.push({ dispose: () => this.dispose() });
    }

    public static initialize(context: vscode.ExtensionContext, connectionString: string) {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService(context, connectionString);
        }
        return TelemetryService.instance;
    }

    public static getInstance(): TelemetryService | undefined {
        return TelemetryService.instance;
    }

    public sendEvent(eventName: string, properties?: { [key: string]: string }) {
        if (!this.isEnabled || !this.instrumentationKey) {
            Logger.info(`TelemetryService: sendEvent skipped (enabled=${this.isEnabled}, hasKey=${!!this.instrumentationKey})`);
            return;
        }
        Logger.info(`TelemetryService: queuing event "${eventName}"`);
        const item: AppInsightsItem = {
            name: 'Microsoft.ApplicationInsights.Event',
            time: new Date().toISOString(),
            iKey: this.instrumentationKey,
            tags: {
                'ai.session.id': vscode.env.sessionId,
                'ai.user.id': vscode.env.machineId,
            },
            data: {
                baseType: 'EventData',
                baseData: {
                    ver: 2,
                    name: eventName,
                    properties: { ...this.commonProperties, ...properties },
                },
            },
        };
        this.queue.push(item);
        // Flush immediately for important events
        this.flush();
    }

    public sendError(eventName: string, error: Error) {
        const sanitized = error.message.replace(/(Server=.*?;)|(User Id=.*?;)|(Password=.*?;)/gi, '[redacted]');
        this.sendEvent(eventName, { errorMessage: sanitized });
    }

    public sendMetric(eventName: string, value: number, properties?: { [key: string]: string }) {
        this.sendEvent(eventName, { ...properties, value: value.toString() });
    }

    private flush(): void {
        if (this.queue.length === 0 || !this.instrumentationKey) {
            return;
        }
        const batch = this.queue.splice(0);
        this.sendBatch(batch, 0);
    }

    private sendBatch(batch: AppInsightsItem[], attemptNumber: number): void {
        const body = JSON.stringify(batch);
        // Use global REST API endpoint (not regional) for reliable delivery
        const endpoint = 'https://dc.services.visualstudio.com/v2/track';
        
        Logger.info(`TelemetryService: attempt ${attemptNumber + 1}/${this.maxRetries + 1}: sending ${batch.length} item(s) to ${endpoint}`);

        const req = https.request(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => {
                const statusCode = res.statusCode ?? 0;
                Logger.info(`TelemetryService: HTTP ${statusCode} — ${responseBody.substring(0, 300)}`);
                
                // 200 = success, 206 = partial success, 400 = bad request
                if (statusCode === 200 || statusCode === 206) {
                    this.retryCount = 0; // Reset on success
                } else if (attemptNumber < this.maxRetries && (statusCode === 408 || statusCode === 429 || statusCode >= 500)) {
                    // Retry on timeout, rate limit, or server error
                    const delay = Math.pow(2, attemptNumber) * 1000; // 1s, 2s, 4s, 8s
                    Logger.info(`TelemetryService: retrying in ${delay}ms`);
                    setTimeout(() => this.sendBatch(batch, attemptNumber + 1), delay);
                }
            });
        });
        
        req.on('error', (err) => {
            Logger.info(`TelemetryService: HTTP error on attempt ${attemptNumber + 1} — ${err.message}`);
            if (attemptNumber < this.maxRetries) {
                const delay = Math.pow(2, attemptNumber) * 1000;
                Logger.info(`TelemetryService: retrying in ${delay}ms`);
                setTimeout(() => this.sendBatch(batch, attemptNumber + 1), delay);
            } else {
                Logger.info(`TelemetryService: max retries exhausted, dropping batch`);
            }
        });
        
        req.setTimeout(10000, () => {
            Logger.info(`TelemetryService: request timeout on attempt ${attemptNumber + 1}`);
            req.destroy();
            if (attemptNumber < this.maxRetries) {
                const delay = Math.pow(2, attemptNumber) * 1000;
                setTimeout(() => this.sendBatch(batch, attemptNumber + 1), delay);
            }
        });
        
        req.write(body);
        req.end();
    }

    public async dispose(): Promise<void> {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (this.queue.length > 0) {
            // Flush remaining events before shutdown
            await new Promise<void>((resolve) => {
                if (this.queue.length === 0 || !this.instrumentationKey) {
                    resolve();
                    return;
                }
                const batch = this.queue.splice(0);
                const body = JSON.stringify(batch);
                const endpoint = 'https://dc.services.visualstudio.com/v2/track';
                
                const req = https.request(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                }, (res) => {
                    res.resume();
                    Logger.info(`TelemetryService: final flush HTTP ${res.statusCode}`);
                    resolve();
                });
                req.on('error', (err) => {
                    Logger.info(`TelemetryService: final flush error — ${err.message}`);
                    resolve();
                });
                req.setTimeout(3000, () => { req.destroy(); resolve(); });
                req.write(body);
                req.end();
            });
        }
        TelemetryService.instance = undefined;
    }
}
