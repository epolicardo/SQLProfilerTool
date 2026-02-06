import * as vscode from 'vscode';
import * as os from 'os';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { 
    trace, 
    Span, 
    SpanStatusCode, 
    context, 
    Context, 
    Tracer,
    metrics,
    Meter,
    Counter,
    Histogram,
    ObservableGauge
} from '@opentelemetry/api';
import { Logger } from './Logger';

/**
 * OpenTelemetry Service for SQL Profiler Tool Extension
 * Provides distributed tracing, metrics, and logging capabilities
 */
export class OpenTelemetryService {
    private static instance: OpenTelemetryService | undefined;
    private sdk: NodeSDK | undefined;
    private tracer: Tracer;
    private meter: Meter;
    private isEnabled: boolean = false;
    private extensionContext: vscode.ExtensionContext;
    private appInsightsConnectionString: string | undefined;

    // Metrics
    private eventsCapturedCounter!: Counter;
    private queryDurationHistogram!: Histogram;
    private connectionPoolGauge!: ObservableGauge;
    private errorCounter!: Counter;
    private reconnectionCounter!: Counter;
    
    // Connection pool stats for gauge
    private poolStats = {
        active: 0,
        idle: 0,
        total: 0
    };

    private constructor(context: vscode.ExtensionContext, appInsightsConnectionString?: string) {
        this.extensionContext = context;
        this.appInsightsConnectionString = appInsightsConnectionString;
        
        // Check if telemetry is enabled
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const userOptIn = config.get<boolean>('telemetryEnabled', true);
        const globalOptIn = typeof vscode.env.isTelemetryEnabled === 'boolean' 
            ? vscode.env.isTelemetryEnabled 
            : true;
        this.isEnabled = userOptIn && globalOptIn;

        if (!this.isEnabled) {
            Logger.info('OpenTelemetry is disabled by user preference');
            // Create no-op tracer and meter
            this.tracer = trace.getTracer('sql-profiler-noop');
            this.meter = metrics.getMeter('sql-profiler-noop');
            this.eventsCapturedCounter = this.meter.createCounter('events.captured');
            this.queryDurationHistogram = this.meter.createHistogram('query.duration');
            this.connectionPoolGauge = this.meter.createObservableGauge('connection.pool.size');
            this.errorCounter = this.meter.createCounter('errors.total');
            this.reconnectionCounter = this.meter.createCounter('reconnections.total');
            return;
        }

        // Get configuration
        const otelConfig = config.get<any>('openTelemetry', {});
        const endpoint = otelConfig.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'https://brazilsouth-1.in.applicationinsights.azure.com';
        const serviceName = 'sql-server-profiler-tool';
        const serviceVersion = context.extension.packageJSON.version;

        const headers = { ...(otelConfig.headers || {}) } as Record<string, string>;
        const instrumentationKey = this.extractInstrumentationKey(this.appInsightsConnectionString);
        if (endpoint.includes('applicationinsights.azure.com') && !headers['x-api-key'] && instrumentationKey) {
            headers['x-api-key'] = instrumentationKey;
        }

        try {
            // Create resource with service information
            const resource = resourceFromAttributes({
                [SEMRESATTRS_SERVICE_NAME]: serviceName,
                [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
                osPlatform: os.platform(),
                osType: os.type(),
                osArch: os.arch(),
                vscodeVersion: vscode.version,
                vscodeLanguage: vscode.env.language,
                vscodeRemoteName: vscode.env.remoteName || 'local',
                vscodeUiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web',
                nodeVersion: process.version,
            });

            // Create OTLP exporters
            const traceExporter = new OTLPTraceExporter({
                url: `${endpoint}/v1/traces`,
                headers,
            });

            const metricExporter = new OTLPMetricExporter({
                url: `${endpoint}/v1/metrics`,
                headers,
            });

            const metricReader = new PeriodicExportingMetricReader({
                exporter: metricExporter,
                exportIntervalMillis: 60000, // Export every 60 seconds
            });

            // Initialize the SDK
            this.sdk = new NodeSDK({
                resource,
                traceExporter,
                metricReader,
                instrumentations: [
                    getNodeAutoInstrumentations({
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        '@opentelemetry/instrumentation-fs': {
                            enabled: false, // Disable fs instrumentation to reduce noise
                        },
                    }),
                ],
            });

            this.sdk.start();
            Logger.info(`OpenTelemetry initialized with endpoint: ${endpoint}`);

            // Get tracer and meter
            this.tracer = trace.getTracer(serviceName, serviceVersion);
            this.meter = metrics.getMeter(serviceName, serviceVersion);

            // Create metrics
            this.initializeMetrics();

            // Register shutdown hook
            context.subscriptions.push({
                dispose: () => this.shutdown()
            });

        } catch (error) {
            Logger.error('Failed to initialize OpenTelemetry: ' + (error instanceof Error ? error.message : String(error)));
            // Fallback to no-op implementations
            this.tracer = trace.getTracer('sql-profiler-noop');
            this.meter = metrics.getMeter('sql-profiler-noop');
            this.eventsCapturedCounter = this.meter.createCounter('events.captured');
            this.queryDurationHistogram = this.meter.createHistogram('query.duration');
            this.connectionPoolGauge = this.meter.createObservableGauge('connection.pool.size');
            this.errorCounter = this.meter.createCounter('errors.total');
            this.reconnectionCounter = this.meter.createCounter('reconnections.total');
        }
    }

    /**
     * Initialize all metrics
     */
    private initializeMetrics(): void {
        // Counter: Total events captured
        this.eventsCapturedCounter = this.meter.createCounter('events.captured', {
            description: 'Total number of SQL events captured',
            unit: '1',
        });

        // Histogram: Query execution duration
        this.queryDurationHistogram = this.meter.createHistogram('query.duration', {
            description: 'SQL query execution duration',
            unit: 'ms',
        });

        // Observable Gauge: Connection pool size
        this.connectionPoolGauge = this.meter.createObservableGauge('connection.pool.size', {
            description: 'Current connection pool size',
            unit: '1',
        });

        this.connectionPoolGauge.addCallback((observableResult) => {
            observableResult.observe(this.poolStats.active, { state: 'active' });
            observableResult.observe(this.poolStats.idle, { state: 'idle' });
            observableResult.observe(this.poolStats.total, { state: 'total' });
        });

        // Counter: Total errors
        this.errorCounter = this.meter.createCounter('errors.total', {
            description: 'Total number of errors',
            unit: '1',
        });

        // Counter: Reconnection attempts
        this.reconnectionCounter = this.meter.createCounter('reconnections.total', {
            description: 'Total number of reconnection attempts',
            unit: '1',
        });
    }

    /**
     * Initialize the singleton instance
     */
    public static initialize(context: vscode.ExtensionContext, appInsightsConnectionString?: string): OpenTelemetryService {
        if (!OpenTelemetryService.instance) {
            OpenTelemetryService.instance = new OpenTelemetryService(context, appInsightsConnectionString);
        }
        return OpenTelemetryService.instance;
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): OpenTelemetryService | undefined {
        return OpenTelemetryService.instance;
    }

    /**
     * Start a new trace span
     */
    public startSpan(name: string, attributes?: Record<string, any>): Span {
        return this.tracer.startSpan(name, {
            attributes: this.sanitizeAttributes(attributes),
        });
    }

    /**
     * Start a span as active (sets it as the current span in context)
     */
    public startActiveSpan<T>(
        name: string,
        attributes: Record<string, any> | undefined,
        fn: (span: Span) => T
    ): T {
        return this.tracer.startActiveSpan(name, { attributes: this.sanitizeAttributes(attributes) }, fn);
    }

    /**
     * Record an exception in the current span
     */
    public recordException(span: Span, error: Error): void {
        if (!this.isEnabled) {
            return;
        }
        
        const sanitizedError = new Error(this.sanitizeString(error.message));
        sanitizedError.stack = error.stack;
        
        span.recordException(sanitizedError);
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: sanitizedError.message,
        });
    }

    /**
     * End a span successfully
     */
    public endSpan(span: Span, attributes?: Record<string, any>): void {
        if (attributes) {
            span.setAttributes(this.sanitizeAttributes(attributes));
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
    }

    /**
     * Record an event captured
     */
    public recordEventCaptured(eventType: string, count: number = 1): void {
        if (!this.isEnabled) {
            return;
        }
        this.eventsCapturedCounter.add(count, { eventType });
    }

    /**
     * Record query duration
     */
    public recordQueryDuration(duration: number, attributes?: Record<string, string>): void {
        if (!this.isEnabled) {
            return;
        }
        this.queryDurationHistogram.record(duration, attributes);
    }

    /**
     * Update connection pool stats
     */
    public updateConnectionPoolStats(active: number, idle: number, total: number): void {
        if (!this.isEnabled) {
            return;
        }
        this.poolStats.active = active;
        this.poolStats.idle = idle;
        this.poolStats.total = total;
    }

    /**
     * Record an error
     */
    public recordError(errorType: string, attributes?: Record<string, string>): void {
        if (!this.isEnabled) {
            return;
        }
        const sanitizedAttrs = attributes ? this.sanitizeAttributes(attributes) : {};
        this.errorCounter.add(1, { errorType, ...sanitizedAttrs });
    }

    /**
     * Record a reconnection attempt
     */
    public recordReconnection(success: boolean, attributes?: Record<string, string>): void {
        if (!this.isEnabled) {
            return;
        }
        const sanitizedAttrs = attributes ? this.sanitizeAttributes(attributes) : {};
        this.reconnectionCounter.add(1, { success: success.toString(), ...sanitizedAttrs });
    }

    /**
     * Sanitize attributes to remove sensitive information
     */
    private sanitizeAttributes(attributes?: Record<string, any>): Record<string, any> {
        if (!attributes) {
            return {};
        }
        
        const sanitized: Record<string, any> = {};
        for (const [key, value] of Object.entries(attributes)) {
            if (typeof value === 'string') {
                sanitized[key] = this.sanitizeString(value);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    /**
     * Sanitize string to remove sensitive information (passwords, connection strings, etc.)
     */
    private sanitizeString(str: string): string {
        return str
            .replace(/(Server=.*?;)/gi, 'Server=***;')
            .replace(/(User Id=.*?;)/gi, 'User Id=***;')
            .replace(/(Password=.*?;)/gi, 'Password=***;')
            .replace(/(Uid=.*?;)/gi, 'Uid=***;')
            .replace(/(Pwd=.*?;)/gi, 'Pwd=***;')
            .replace(/(Data Source=.*?;)/gi, 'Data Source=***;');
    }

    /**
     * Extract instrumentation key from an Application Insights connection string
     */
    private extractInstrumentationKey(connectionString?: string): string | undefined {
        if (!connectionString) {
            return undefined;
        }

        const match = connectionString.match(/InstrumentationKey=([^;]+)/i);
        return match?.[1];
    }

    /**
     * Shutdown the OpenTelemetry SDK
     */
    public async shutdown(): Promise<void> {
        if (this.sdk) {
            try {
                await this.sdk.shutdown();
                Logger.info('OpenTelemetry SDK shut down successfully');
            } catch (error) {
                Logger.error('Error shutting down OpenTelemetry SDK: ' + (error instanceof Error ? error.message : String(error)));
            }
        }
    }

    /**
     * Check if OpenTelemetry is enabled
     */
    public isActive(): boolean {
        return this.isEnabled;
    }

    /**
     * Get the tracer for custom instrumentation
     */
    public getTracer(): Tracer {
        return this.tracer;
    }

    /**
     * Get the meter for custom metrics
     */
    public getMeter(): Meter {
        return this.meter;
    }
}
