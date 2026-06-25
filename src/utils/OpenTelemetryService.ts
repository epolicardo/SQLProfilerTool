import * as vscode from 'vscode';
import { TelemetryService } from './TelemetryService';
import { Logger } from './Logger';

/**
 * Facade that preserves the OpenTelemetryService public API.
 * All actual telemetry is routed through TelemetryService (direct HTTPS to App Insights).
 * The previous useAzureMonitor() call has been removed — it patched Node.js's https module
 * and interfered with the telemetry HTTP calls, causing no data to reach App Insights.
 */

// Minimal no-op Span so callers that hold a Span reference don't break
class NoOpSpan {
    setAttribute(_key: string, _value: unknown): this { return this; }
    setAttributes(_attrs: Record<string, unknown>): this { return this; }
    setStatus(_status: { code: number; message?: string }): this { return this; }
    recordException(_exception: Error): void {}
    end(): void {}
}

export class OpenTelemetryService {
    private static instance: OpenTelemetryService | undefined;

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly connectionString?: string
    ) {
        Logger.info('OpenTelemetryService initialized (routes to TelemetryService)');
    }

    public static initialize(context: vscode.ExtensionContext, appInsightsConnectionString?: string): OpenTelemetryService {
        if (!OpenTelemetryService.instance) {
            OpenTelemetryService.instance = new OpenTelemetryService(context, appInsightsConnectionString);
        }
        return OpenTelemetryService.instance;
    }

    public static getInstance(): OpenTelemetryService | undefined {
        return OpenTelemetryService.instance;
    }

    public isActive(): boolean {
        const telemetry = TelemetryService.getInstance();
        return telemetry !== undefined;
    }

    // ── Span API (no-op — span data is not critical for usage tracking) ──────

    public startSpan(_name: string, _attributes?: Record<string, unknown>): NoOpSpan {
        return new NoOpSpan();
    }

    public startActiveSpan<T>(
        name: string,
        attributes: Record<string, unknown> | undefined,
        fn: (span: NoOpSpan) => T
    ): T {
        return fn(new NoOpSpan());
    }

    public recordException(_span: NoOpSpan, _error: Error): void {}

    public endSpan(_span: NoOpSpan, _attributes?: Record<string, unknown>): void {}

    // ── Metric API — delegate to TelemetryService ────────────────────────────

    public recordEventCaptured(eventType: string, count: number = 1): void {
        TelemetryService.getInstance()?.sendMetric('sql.events.captured', count, { eventType });
    }

    public recordQueryDuration(duration: number, attributes?: Record<string, string>): void {
        TelemetryService.getInstance()?.sendMetric('sql.query.duration', duration, attributes);
    }

    public updateConnectionPoolStats(active: number, idle: number, total: number): void {
        TelemetryService.getInstance()?.sendEvent('connection.pool.stats', {
            poolActive: active.toString(),
            poolIdle: idle.toString(),
            poolTotal: total.toString(),
        });
    }

    public recordError(errorType: string, attributes?: Record<string, string>): void {
        TelemetryService.getInstance()?.sendEvent('error', { errorType, ...attributes });
    }

    public recordReconnection(success: boolean, attributes?: Record<string, string>): void {
        TelemetryService.getInstance()?.sendEvent('connection.reconnect', {
            success: success.toString(),
            ...attributes,
        });
    }

    // ── Tracer / Meter accessors (no-op objects) ─────────────────────────────

    public getTracer(): unknown { return {}; }
    public getMeter(): unknown { return {}; }
}
