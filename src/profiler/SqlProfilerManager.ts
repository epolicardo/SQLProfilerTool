import * as sql from 'mssql';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ConnectionPoolManager, PoolConfig, PoolStats } from '../database/ConnectionPoolManager';
import { AutoReconnectManager, ConnectionErrorType } from '../database/AutoReconnectManager';

export interface MssqlConnection {
    profileName: string;
    server: string;
    database?: string;
    user?: string;
    password?: string;
    authenticationType: 'SqlLogin' | 'Integrated';
    port?: number;
    encrypt?: boolean;
    trustServerCertificate?: boolean;
}

export interface ProfilerEvent {
    id: string;  // Identificador único para mantener estado expandido
    timestamp: string;
    eventName: string;
    statement: string;
    duration?: number;
    databaseName?: string;
    userName?: string;
    applicationName?: string;
}

export interface VSCodePoolConfig {
    maxConnections?: number;
    minConnections?: number;
    idleTimeout?: number;
    acquireTimeout?: number;
    createTimeout?: number;
    healthCheckEnabled?: boolean;
    healthCheckInterval?: number;
}

export class SqlProfilerManager {
    private pool: sql.ConnectionPool | undefined;
    private poolManager: ConnectionPoolManager;
    private autoReconnectManager: AutoReconnectManager;
    private currentPoolKey: string | undefined;
    private currentConnection: MssqlConnection | undefined;
    private isProfilering = false;
    private sessionName = 'VSCodeProfilerSession';
    private results: ProfilerEvent[] = [];
    private pollingInterval: any | undefined;
    private pollingIntervalMs = 500; // Default polling interval, adjusted based on platform
    private context: vscode.ExtensionContext | undefined;
    private hasRunInitialDiagnostics = false; // Flag to run diagnostics only once
    private isCollectingResults = false; // Semaphore to prevent concurrent collectResults calls

    // 🎯 Streaming configuration
    private lastReadTimestamp: Date | null = null; // Track last event read for incremental streaming
    private lastAzureTimestamp: Date | null = null; // Track last timestamp for Azure ring_buffer sliding window
    private readonly xelFilePath = 'VSCodeProfiler'; // Base filename without extension
    private lastEventReceivedTime: number = 0; // Track when last event was received
    private eventIdCounter = 0; // Incremental counter for guaranteed unique IDs
    private detectedDatabaseType: 'azure' | 'sqlserver' | null = null; // Cached DB type for session
    private profilerStartTime: number = 0; // ⏱️ Track when profiler started for latency measurement

    // Cache for database type detection to avoid repeated queries
    private databaseTypeCache: Map<string, { isAzure: boolean; timestamp: number }> = new Map();
    private readonly cacheTimeoutMs = 300000; // 5 minutes cache

    // Log throttling to prevent spam
    private lastLogTime: Map<string, number> = new Map();
    private readonly logThrottleMs = 10000; // Only log same message once per 10 seconds

    constructor(context?: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        this.sessionName = config.get<string>('sessionName') || 'VSCodeProfilerSession';
        this.context = context;
        this.poolManager = ConnectionPoolManager.getInstance();
        this.autoReconnectManager = AutoReconnectManager.getInstance();
        this.setupReconnectEventHandlers();
    }

    /**
     * Configura los event handlers para el sistema de reconexión automática
     */
    private setupReconnectEventHandlers(): void {
        this.autoReconnectManager.onReconnectEvent((event) => {
            switch (event.type) {
                case 'attempt':
                    Logger.info(`🔄 Reconnection attempt ${event.attempt?.attempt} for ${event.poolKey}`, {
                        errorType: event.attempt?.errorType,
                        delay: event.attempt?.delay
                    });

                    // Mostrar notificación de progreso en VS Code
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `SQL Profiler: Reconnecting...`,
                        cancellable: false
                    }, (progress) => {
                        progress.report({
                            message: `Attempt ${event.attempt?.attempt}/${event.totalAttempts}`
                        });
                        return new Promise(resolve => setTimeout(resolve, event.attempt?.delay || 1000));
                    });
                    break;

                case 'success':
                    Logger.info(`✅ Reconnection successful for ${event.poolKey}`);
                    vscode.window.showInformationMessage(
                        `SQL Profiler: Successfully reconnected after ${event.totalAttempts} attempts`
                    );
                    break;

                case 'failure':
                    Logger.error(`❌ Reconnection failed for ${event.poolKey} after ${event.totalAttempts} attempts`);
                    vscode.window.showErrorMessage(
                        `SQL Profiler: Failed to reconnect after ${event.totalAttempts} attempts. Check your connection settings.`,
                        'Retry', 'Settings'
                    ).then(selection => {
                        if (selection === 'Retry') {
                            // Reintentar profiling
                            this.startProfiling().catch(error => {
                                Logger.errorSilent('Manual retry failed:', error);
                            });
                        } else if (selection === 'Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler');
                        }
                    });
                    break;

                case 'circuit-breaker-open':
                    Logger.warn(`⚡ Circuit breaker opened for ${event.poolKey}`);
                    vscode.window.showWarningMessage(
                        `SQL Profiler: Circuit breaker activated. Connection attempts temporarily blocked.`
                    );
                    break;

                case 'circuit-breaker-closed':
                    Logger.info(`🔓 Circuit breaker closed for ${event.poolKey}`);
                    vscode.window.showInformationMessage(
                        `SQL Profiler: Circuit breaker closed. Connection restored.`
                    );
                    break;
            }
        });
    }

    async startProfiling(): Promise<void> {
        if (this.isProfilering) {
            throw new Error('Profiling is already running');
        }

        try {
            Logger.info('Starting profiling...');
            this.hasRunInitialDiagnostics = false; // Reset for new session

            // Try to connect using selected mssql profile first
            const selectedProfile = this.getSelectedConnectionName();
            Logger.info('Selected profile for profiling', { profile: selectedProfile });

            if (selectedProfile) {
                console.log('Attempting to connect using selected profile...');
                await this.connectUsingPool();
                console.log('Connected successfully using profile with pool');
            } else {
                // Fallback to connection string method
                console.log('No profile selected, trying connection string...');
                const config = vscode.workspace.getConfiguration('sqlProfiler');
                const connectionString = config.get<string>('connectionString');

                if (!connectionString) {
                    throw new Error('No connection configured. Please select an mssql connection or configure a connection string.');
                }

                // Parse connection string and create config with pool
                const sqlConfig = this.parseConnectionString(connectionString);
                await this.connectUsingConnectionStringPool(sqlConfig);
                console.log('Connected successfully using connection string with pool');
            }

            // Diagnose timeout settings (helpful for debugging connection issues)
            if (this.pool) {
                await this.diagnoseTimeoutSettings(this.pool);
            }

            // Create Extended Events session
            console.log('Creating Extended Events session...');
            await this.createXESession();

            // Start the session
            console.log('Starting Extended Events session...');
            await this.startXESession();

            this.isProfilering = true;
            this.profilerStartTime = Date.now(); // ⏱️ Start timing for first event latency

            // ⏱️ Configure polling interval based on platform
            const isAzure = await this.isAzureSqlDatabase(this.pool!);
            this.pollingIntervalMs = isAzure ? 250 : 500; // Faster for Azure ring_buffer
            console.log(`⏱️ Polling configured: ${this.pollingIntervalMs}ms for ${isAzure ? 'Azure SQL' : 'SQL Server'}`);
            console.log(`⏱️ Profiler started at: ${new Date(this.profilerStartTime).toISOString()}`);

            // Telemetry: profiling started with server type
            const { TelemetryService } = await import('../utils/TelemetryService');
            const telemetry = TelemetryService.getInstance();
            const sessionStartTime = Date.now();
            telemetry?.sendEvent('profilingSessionStarted', {
                serverType: isAzure ? 'azure' : 'sqlserver',
                pollingInterval: this.pollingIntervalMs.toString(),
                profilerMode: vscode.workspace.getConfiguration('sqlProfiler').get<string>('profilerMode', 'default')
            });

            // Start polling for results
            console.log('Starting polling for results...');
            this.startPolling();

            // Debug: Log initial state
            console.log('=== PROFILING START DEBUG ===');
            console.log('Session name:', this.sessionName);
            console.log('Results array length:', this.results.length);
            console.log('isProfilering:', this.isProfilering);
            console.log('Pool status:', this.pool ? 'Connected' : 'Not connected');

            Logger.info('Profiling started successfully!');

        } catch (error) {
            this.isProfilering = false;
            Logger.error('Failed to start profiling', error);
            throw error;
        }
    }

    async stopProfiling(): Promise<void> {
        Logger.info('Stopping profiling...');

        if (!this.isProfilering) {
            Logger.info('Profiling is not running, nothing to stop');
            return;
        }

        // Calculate session metrics before cleanup
        const sessionDuration = this.profilerStartTime ? Date.now() - this.profilerStartTime : 0;
        const totalEvents = this.results.length;

        // Telemetry: profiling session ended
        const { TelemetryService } = await import('../utils/TelemetryService');
        const telemetry = TelemetryService.getInstance();
        telemetry?.sendMetric('profilingSessionDuration', Math.round(sessionDuration / 1000), {
            serverType: this.detectedDatabaseType || 'unknown'
        });
        telemetry?.sendMetric('profilingSessionEventCount', totalEvents, {
            serverType: this.detectedDatabaseType || 'unknown'
        });

        // Set flags first to prevent new polling attempts
        this.isProfilering = false;
        this.hasRunInitialDiagnostics = false; // Reset for next profiling session
        this.isCollectingResults = false; // Reset semaphore
        this.lastReadTimestamp = null; // Reset streaming timestamp
        this.eventIdCounter = 0; // Reset ID counter for fresh session
        this.profilerStartTime = 0; // Reset start time

        // Stop polling interval first
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = undefined;
            Logger.info('Polling interval cleared');
        }

        // Try to stop XE session gracefully
        if (this.pool) {
            try {
                Logger.info('Attempting to stop Extended Events session');
                await this.stopXESession();
                Logger.info('Extended Events session stopped successfully');
            } catch (error) {
                Logger.warn('Error stopping XE session (non-critical):', error);
            }

            try {
                Logger.info('Attempting to drop Extended Events session');
                await this.dropXESession();
                Logger.info('Extended Events session dropped successfully');
            } catch (error) {
                Logger.warn('Error dropping XE session (non-critical):', error);
            }

            // Note: We don't close the pool here as it's managed by the pool manager
            // and may be reused by other operations
            this.pool = undefined;
            this.currentPoolKey = undefined;
            Logger.info('Pool references cleared');
        }

        // Clear database type cache to avoid stale data on reconnection
        this.databaseTypeCache.clear();
        this.detectedDatabaseType = null; // Reset for next session
        this.lastAzureTimestamp = null; // Reset Azure sliding window
        this.lastReadTimestamp = null; // Reset SQL Server streaming
        this.profilerStartTime = 0; // Reset profiler start time
        Logger.info('Profiling stopped successfully - database type cache and timestamps cleared');
    }

    private async isAzureSqlDatabase(pool?: any): Promise<boolean> {
        const poolToUse = pool || this.pool;

        if (!poolToUse || !this.currentPoolKey) {
            return false;
        }

        // 🚀 Check session cache first (valid for entire profiling session)
        if (this.detectedDatabaseType !== null) {
            const isAzure = this.detectedDatabaseType === 'azure';
            console.log(`⚡ Using cached database type: ${isAzure ? 'Azure SQL' : 'SQL Server'} (no query needed)`);
            return isAzure;
        }

        // Check memory cache (for backwards compatibility)
        const cached = this.databaseTypeCache.get(this.currentPoolKey);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < this.cacheTimeoutMs) {
            // Use console.log instead of Logger.info to reduce spam
            console.log(`Using cached database type detection: ${cached.isAzure ? 'Azure SQL Database' : 'SQL Server'}`);
            return cached.isAzure;
        }

        try {
            let isAzure = false;

            // Check 1: Look at server name first (fastest and most reliable check)
            const serverCorrection = this.correctAzureSqlServerFormat(this.currentPoolKey);
            const serverName = serverCorrection.corrected.toLowerCase();

            if (serverName.includes('.database.windows.net') || serverName.includes('.sql.azuresynapse.net')) {
                Logger.info('Detected Azure SQL Database from server name pattern (.database.windows.net)');
                isAzure = true;

                // Fast path: If server name confirms Azure, skip database queries
                // Cache immediately and return
                this.databaseTypeCache.set(this.currentPoolKey, {
                    isAzure: true,
                    timestamp: now
                });
                this.detectedDatabaseType = 'azure';
                return true;
            } else {
                // Check 2: Try a lightweight query to determine database type
                try {
                    // Use shorter timeout for detection query
                    const detectionRequest = poolToUse.request();
                    detectionRequest.timeout = 15000; // 15 seconds timeout for detection

                    const versionResult = await detectionRequest.query('SELECT @@VERSION as version');
                    const version = versionResult.recordset[0]?.version || '';

                    if (version.toLowerCase().includes('azure')) {
                        Logger.info('Detected Azure SQL Database from version string');
                        isAzure = true;
                    } else {
                        // Check 3: Try to query a server-scoped view (will fail on Azure SQL DB)
                        try {
                            const serverRequest = poolToUse.request();
                            serverRequest.timeout = 10000; // 10 seconds timeout for view check
                            await serverRequest.query('SELECT TOP 1 1 FROM sys.server_event_sessions');
                            Logger.info('Detected SQL Server (on-premise/managed instance) - server views accessible');
                            isAzure = false;
                        } catch (serverViewError) {
                            // Silently handle expected error on Azure SQL
                            Logger.info('Server views not accessible - likely Azure SQL Database');
                            isAzure = true;
                        }
                    }
                } catch (queryError) {
                    // Only log as warning, don't spam with errors
                    Logger.warn('Database type detection query timeout or error, using server name pattern');
                    // Fallback to server name pattern
                    isAzure = serverName.includes('database.windows.net') ||
                        serverName.includes('sql.azuresynapse.net');
                }
            }

            // Cache the result in both memory cache and session cache
            this.databaseTypeCache.set(this.currentPoolKey, {
                isAzure: isAzure,
                timestamp: now
            });

            // 🚀 Cache for entire session (no expiration until disconnect)
            this.detectedDatabaseType = isAzure ? 'azure' : 'sqlserver';

            Logger.info(`Database type detection completed: ${isAzure ? 'Azure SQL Database' : 'SQL Server'} (cached for session)`);
            return isAzure;

        } catch (error) {
            Logger.error('Critical error in database type detection:', error);

            // Fallback: try to determine from server name if available
            if (this.currentPoolKey) {
                const serverCorrection = this.correctAzureSqlServerFormat(this.currentPoolKey);
                const serverName = serverCorrection.corrected.toLowerCase();
                const isAzureByName = serverName.includes('.database.windows.net') ||
                    serverName.includes('.sql.azuresynapse.net');

                // Cache the fallback result with shorter timeout
                this.databaseTypeCache.set(this.currentPoolKey, {
                    isAzure: isAzureByName,
                    timestamp: now - (this.cacheTimeoutMs - 60000) // Cache for 1 minute only
                });

                Logger.warn(`Using fallback database type detection from server name: ${isAzureByName ? 'Azure SQL Database' : 'SQL Server'}`);
                return isAzureByName;
            }

            // Last resort: default to Azure SQL Database for safety (most restrictive)
            Logger.warn('Defaulting to Azure SQL Database due to detection failure');
            return true;
        }
    }

    private async diagnoseSystemViews(pool?: any): Promise<void> {
        const poolToUse = pool || this.pool;
        if (!poolToUse || !this.isProfilering) {
            return;
        }

        Logger.info('=== DIAGNOSING SYSTEM VIEWS AVAILABILITY ===');

        try {
            // Detect database type first to test only relevant views
            const isAzure = await this.isAzureSqlDatabase(poolToUse);
            Logger.info(`Database type: ${isAzure ? 'Azure SQL Database' : 'SQL Server'}`);

            let viewsToTest: string[];

            if (isAzure) {
                // Azure SQL Database - only test database-scoped views
                viewsToTest = [
                    'sys.database_event_sessions',
                    'sys.dm_xe_database_sessions',
                    'sys.dm_xe_database_session_targets'
                ];
            } else {
                // SQL Server - test server-scoped views
                viewsToTest = [
                    'sys.server_event_sessions',
                    'sys.dm_xe_sessions',
                    'sys.dm_xe_session_targets'
                ];
            }

            // Test all views in parallel with timeout to avoid blocking
            const viewTests = viewsToTest.map(async (view) => {
                // Exit early if profiling stopped
                if (!this.isProfilering) {
                    return { view, accessible: false, message: 'Profiling stopped' };
                }

                try {
                    const request = poolToUse.request();
                    request.timeout = 10000; // 10 second timeout per view
                    await request.query(`SELECT TOP 1 1 FROM ${view}`);
                    return { view, accessible: true };
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    // Don't log timeout errors as they're expected in some scenarios
                    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
                        return { view, accessible: false, message: 'timeout' };
                    }
                    return { view, accessible: false, message: errorMsg };
                }
            });

            // Wait for all tests with a global timeout
            const results = await Promise.race([
                Promise.all(viewTests),
                new Promise<any[]>((resolve) =>
                    setTimeout(() => resolve(viewsToTest.map(v => ({
                        view: v,
                        accessible: false,
                        message: 'global timeout'
                    }))), 30000) // 30 second global timeout
                )
            ]);

            // Log results (only log accessible views and non-timeout errors)
            for (const result of results) {
                if (result.accessible) {
                    Logger.info(`✓ View accessible: ${result.view}`);
                } else if (result.message !== 'timeout' && result.message !== 'global timeout') {
                    // Only log non-timeout errors as info (not error)
                    Logger.info(`✗ View NOT accessible: ${result.view} - ${result.message}`);
                } else {
                    // Silently skip timeout errors - they're expected in constrained environments
                    console.log(`⏱️ View check timed out: ${result.view}`);
                }
            }
        } catch (error) {
            // Handle any unexpected errors silently
            Logger.errorSilent('System views diagnosis failed:', error);
        } finally {
            Logger.info('=== END SYSTEM VIEWS DIAGNOSIS ===');
        }
    }

    private async createXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        // Capture pool reference to avoid race condition
        const currentPool = this.pool;

        // Detect if we're on Azure SQL Database vs SQL Server
        const isAzure = await this.isAzureSqlDatabase(currentPool);

        let createSessionQuery: string;

        if (isAzure) {
            // Azure SQL Database uses database-scoped Extended Events
            createSessionQuery = `
                -- Stop and drop existing session if it exists (database-scoped)
                IF EXISTS (SELECT * FROM sys.database_event_sessions WHERE name = '${this.sessionName}')
                BEGIN
                    -- Try to stop if running
                    IF EXISTS (SELECT * FROM sys.dm_xe_database_sessions WHERE name = '${this.sessionName}')
                        ALTER EVENT SESSION [${this.sessionName}] ON DATABASE STATE = STOP;
                    
                    -- Drop the session
                    DROP EVENT SESSION [${this.sessionName}] ON DATABASE;
                END;

                -- Create new session (database-scoped for Azure SQL)
                -- Filter to exclude profiler's own queries (appName configured in ConnectionPoolManager)
                CREATE EVENT SESSION [${this.sessionName}] ON DATABASE
                ADD EVENT sqlserver.rpc_starting(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.rpc_completed(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_batch_starting(
                    SET collect_batch_text=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_batch_completed(
                    SET collect_batch_text=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_statement_starting(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_statement_completed(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sp_statement_starting(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sp_statement_completed(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                )
                ADD TARGET package0.ring_buffer(
                    SET max_events_limit = 500,  -- Reduced from 2000 for faster consumption
                    max_memory = 2048  -- 2 MB memory limit
                )
                WITH (STARTUP_STATE=OFF, EVENT_RETENTION_MODE=ALLOW_MULTIPLE_EVENT_LOSS);
            `;
        } else {
            // SQL Server uses server-scoped Extended Events
            createSessionQuery = `
                -- Stop and drop existing session if it exists (server-scoped)
                IF EXISTS (SELECT * FROM sys.server_event_sessions WHERE name = '${this.sessionName}')
                BEGIN
                    -- Try to stop if running
                    IF EXISTS (SELECT * FROM sys.dm_xe_sessions WHERE name = '${this.sessionName}')
                        ALTER EVENT SESSION [${this.sessionName}] ON SERVER STATE = STOP;
                    
                    -- Drop the session
                    DROP EVENT SESSION [${this.sessionName}] ON SERVER;
                END;

                -- Create new session (server-scoped for SQL Server)
                CREATE EVENT SESSION [${this.sessionName}] ON SERVER
                ADD EVENT sqlserver.rpc_starting(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.rpc_completed(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_batch_starting(
                    SET collect_batch_text=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_batch_completed(
                    SET collect_batch_text=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.username,
                        sqlserver.database_name,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_statement_starting(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sql_statement_completed(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sp_statement_starting(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                ),
                ADD EVENT sqlserver.sp_statement_completed(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE sqlserver.client_app_name <> N'SQL Profiler Tool for VS Code'
                )
                ADD TARGET package0.event_file(
                    SET filename = N'${this.xelFilePath}.xel',
                    max_file_size = 10,  -- 10 MB per file for faster rollover
                    max_rollover_files = 5  -- Keep last 5 files (50 MB total)
                )
                WITH (STARTUP_STATE=OFF, EVENT_RETENTION_MODE=ALLOW_MULTIPLE_EVENT_LOSS);
            `;
        }

        console.log('=== CREATING XE SESSION ===');
        console.log('Database type:', isAzure ? 'Azure SQL Database' : 'SQL Server');
        console.log('Session name:', this.sessionName);
        console.log('Events to capture: rpc_starting, rpc_completed, sql_batch_starting, sql_batch_completed, sql_statement_starting, sql_statement_completed, sp_statement_starting, sp_statement_completed');
        console.log('=== XE SESSION QUERY ===');
        console.log(createSessionQuery);
        console.log('=== END XE SESSION QUERY ===');

        const sessionCreateStart = Date.now();
        const request = currentPool.request();
        await request.query(createSessionQuery);
        const sessionCreateDuration = Date.now() - sessionCreateStart;

        // Telemetry: XE session creation time
        const { TelemetryService } = await import('../utils/TelemetryService');
        const telemetry = TelemetryService.getInstance();
        telemetry?.sendMetric('xeSessionCreateDuration', sessionCreateDuration, {
            serverType: isAzure ? 'azure' : 'sqlserver'
        });

        console.log('Extended Events session created successfully!');
    }

    private async startXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        // Capture pool reference to avoid race condition
        const currentPool = this.pool;

        const isAzure = await this.isAzureSqlDatabase(currentPool);
        const scope = isAzure ? 'DATABASE' : 'SERVER';
        const startQuery = `ALTER EVENT SESSION [${this.sessionName}] ON ${scope} STATE = START;`;

        console.log('=== STARTING XE SESSION ===');
        console.log('Session name:', this.sessionName);
        console.log('Scope:', scope);
        console.log('Start query:', startQuery);

        const request = currentPool.request();
        await request.query(startQuery);

        console.log('Extended Events session started successfully!');
    }

    private async stopXESession(): Promise<void> {
        if (!this.pool) {
            Logger.info('No pool available for stopping XE session');
            return;
        }

        // Capture pool reference to avoid race condition
        const currentPool = this.pool;

        try {
            const isAzure = await this.isAzureSqlDatabase(currentPool);
            const scope = isAzure ? 'DATABASE' : 'SERVER';
            const sessionView = isAzure ? 'sys.database_event_sessions' : 'sys.server_event_sessions';

            // First check if session exists and is running
            const checkQuery = `SELECT name FROM ${sessionView} WHERE name = '${this.sessionName}'`;
            const checkRequest = currentPool.request();
            const result = await checkRequest.query(checkQuery);

            if (result.recordset.length === 0) {
                Logger.info(`XE session '${this.sessionName}' does not exist, nothing to stop`);
                return;
            }

            const stopQuery = `ALTER EVENT SESSION [${this.sessionName}] ON ${scope} STATE = STOP`;
            const request = currentPool.request();
            await request.query(stopQuery);
            Logger.info(`XE session '${this.sessionName}' stopped successfully`);

        } catch (error: any) {
            // Log but don't throw - stopping should be best effort
            Logger.warn(`Failed to stop XE session '${this.sessionName}': ${error.message}`);
        }
    }

    private async dropXESession(): Promise<void> {
        if (!this.pool) {
            Logger.info('No pool available for dropping XE session');
            return;
        }

        // Capture pool reference to avoid race condition
        const currentPool = this.pool;

        try {
            const isAzure = await this.isAzureSqlDatabase(currentPool);
            const scope = isAzure ? 'DATABASE' : 'SERVER';
            const sessionView = isAzure ? 'sys.database_event_sessions' : 'sys.server_event_sessions';

            // Use IF EXISTS to avoid errors if session doesn't exist
            const dropQuery = `
                IF EXISTS (SELECT * FROM ${sessionView} WHERE name = '${this.sessionName}')
                    DROP EVENT SESSION [${this.sessionName}] ON ${scope}
            `;

            const request = currentPool.request();
            await request.query(dropQuery);
            Logger.info(`XE session '${this.sessionName}' dropped successfully`);

            // 🧹 Cleanup: Delete .xel files after dropping session
            await this.cleanupXelFiles(currentPool);

        } catch (error: any) {
            // Log but don't throw - cleanup should be best effort
            Logger.warn(`Failed to drop XE session '${this.sessionName}': ${error.message}`);
        }
    }

    /**
     * 🧹 Clean up old .xel event files
     */
    private async cleanupXelFiles(pool: sql.ConnectionPool): Promise<void> {
        try {
            console.log('🧹 Cleaning up Extended Events .xel files...');

            // Use xp_delete_file to remove old .xel files
            // This is a best-effort operation - if it fails, we just log and continue
            const cleanupQuery = `
                -- Delete .xel files older than 1 minute
                EXEC sys.xp_delete_file 
                    0,  -- File type: 0 = xel files
                    N'${this.xelFilePath}',  -- Path/pattern
                    N'xel',  -- Extension
                    '${new Date(Date.now() - 60000).toISOString().replace('T', ' ').substring(0, 19)}';  -- Delete files older than 1 minute
            `;

            const request = pool.request();
            await request.query(cleanupQuery);
            console.log('✅ .xel files cleanup completed');

        } catch (error: any) {
            // Non-critical error - just log it
            console.log('⚠️ Could not cleanup .xel files (non-critical):', error.message);
            Logger.warn('XEL file cleanup failed (non-critical):', error);
        }
    }

    private startPolling(): void {
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5; // Aumentado para dar más oportunidades de recuperación
        let isRecovering = false;

        this.pollingInterval = setInterval(async () => {
            try {
                await this.collectResults();
                consecutiveErrors = 0; // Reset error count on success

                // Clean up old error cache entries periodically
                Logger.cleanupErrorCache();

                if (isRecovering) {
                    isRecovering = false;
                    Logger.info('Polling recovered successfully');
                    vscode.window.showInformationMessage('SQL Profiler: Connection recovered');
                }
            } catch (error) {
                consecutiveErrors++;
                Logger.errorSilent(`Error in polling interval (${consecutiveErrors}/${maxConsecutiveErrors}):`, error);

                // Intentar recuperar la conexión automáticamente
                if (consecutiveErrors >= 2 && !isRecovering) {
                    isRecovering = true;
                    Logger.info('Starting automatic connection recovery...');

                    try {
                        await this.attemptPollingRecovery();
                        consecutiveErrors = 0; // Reset si la recuperación fue exitosa
                        Logger.info('Polling recovery successful');
                    } catch (recoveryError) {
                        Logger.errorSilent('Polling recovery failed:', recoveryError);
                    }
                }

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    Logger.error('Too many consecutive polling errors, stopping profiling');
                    clearInterval(this.pollingInterval);
                    this.isProfilering = false;
                    isRecovering = false;

                    // Clear cache to force fresh detection on next start
                    this.databaseTypeCache.clear();

                    // Ofrecer opciones de recuperación al usuario
                    vscode.window.showErrorMessage(
                        'SQL Profiler stopped due to connection issues.',
                        'Auto Reconnect', 'Manual Retry', 'Settings'
                    ).then(selection => {
                        if (selection === 'Auto Reconnect') {
                            this.startProfilingWithAutoRecovery();
                        } else if (selection === 'Manual Retry') {
                            this.startProfiling().catch(err => {
                                Logger.errorSilent('Manual retry failed:', err);
                            });
                        } else if (selection === 'Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler');
                        }
                    });
                }
            }
        }, this.pollingIntervalMs); // Dynamic interval: 250ms (Azure) or 500ms (SQL Server)
    }

    /**
     * Intenta recuperar la conexión durante el polling
     */
    private async attemptPollingRecovery(): Promise<void> {
        if (!this.currentPoolKey) {
            throw new Error('No current pool key for recovery');
        }

        Logger.info('Attempting to recover polling connection...');

        // Verificar el health del pool actual
        const healthResult = await this.autoReconnectManager.getAllReconnectStats();
        const currentStats = healthResult[this.currentPoolKey];

        if (currentStats?.isReconnecting) {
            Logger.info('Auto-reconnection already in progress, waiting...');
            return; // Ya hay una reconexión en progreso
        }

        // Forzar reconexión si el circuit breaker está abierto
        if (currentStats?.circuitBreakerState === 'open') {
            Logger.info('Forcing circuit breaker close for polling recovery');
            this.autoReconnectManager.forceCloseCircuitBreaker(this.currentPoolKey);
        }

        // Intentar reconectar usando la configuración existente
        await this.reconnectCurrentPool();
    }

    /**
     * Reconecta el pool actual usando la configuración guardada
     */
    private async reconnectCurrentPool(): Promise<void> {
        if (!this.currentPoolKey) {
            throw new Error('No current pool key for reconnection');
        }

        // Determinar qué método de conexión usar
        const selectedProfile = this.getSelectedConnectionName();

        if (selectedProfile) {
            Logger.info(`Reconnecting using profile: ${selectedProfile}`);
            await this.connectUsingPool();
        } else {
            Logger.info('Reconnecting using connection string');
            const config = vscode.workspace.getConfiguration('sqlProfiler');
            const connectionString = config.get<string>('connectionString');

            if (connectionString) {
                const sqlConfig = this.parseConnectionString(connectionString);
                await this.connectUsingConnectionStringPool(sqlConfig);
            } else {
                throw new Error('No connection configuration available for reconnection');
            }
        }

        Logger.info('Pool reconnection completed successfully');
    }

    /**
     * Inicia profiling con recuperación automática mejorada
     */
    private async startProfilingWithAutoRecovery(): Promise<void> {
        try {
            Logger.info('Starting profiling with enhanced auto-recovery...');

            // Limpiar estado previo
            this.databaseTypeCache.clear();

            // Reiniciar profiling con configuración de reconexión más agresiva
            const originalConfig = this.autoReconnectManager.getAllReconnectStats();

            // Temporalmente aumentar la configuración de reconexión
            this.autoReconnectManager.updateConfig({
                maxRetries: 8,
                initialDelay: 500,
                enableCircuitBreaker: true,
                circuitBreakerThreshold: 5
            });

            await this.startProfiling();

            Logger.info('Profiling started successfully with auto-recovery');
            vscode.window.showInformationMessage('SQL Profiler: Restarted with enhanced auto-recovery');

        } catch (error) {
            Logger.error('Auto-recovery profiling failed:', error);
            vscode.window.showErrorMessage(
                `SQL Profiler: Auto-recovery failed. ${error instanceof Error ? error.message : 'Unknown error'}`,
                'Check Settings'
            ).then(selection => {
                if (selection === 'Check Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler');
                }
            });
        }
    }

    /**
     * Diagnoses timeout settings to identify potential connection issues
     */
    private async diagnoseTimeoutSettings(pool: sql.ConnectionPool): Promise<void> {
        console.log('=== DIAGNOSING TIMEOUT SETTINGS ===');

        try {
            // Check if we're on Azure (different system views)
            const isAzure = await this.isAzureSqlDatabase(pool);

            // Get current session timeout
            const lockTimeoutQuery = 'SELECT @@LOCK_TIMEOUT as LockTimeoutMs;';
            const lockResult = await pool.request().query(lockTimeoutQuery);
            console.log('Lock Timeout:', lockResult.recordset[0]?.LockTimeoutMs, 'ms');

            // Get current session ID
            const spidQuery = 'SELECT @@SPID as SessionId;';
            const spidResult = await pool.request().query(spidQuery);
            console.log('Current Session ID:', spidResult.recordset[0]?.SessionId);

            // For SQL Server (not Azure SQL Database), check server configurations
            if (!isAzure) {
                const configQuery = `
                    SELECT name, value, value_in_use, description 
                    FROM sys.configurations 
                    WHERE name LIKE '%timeout%' OR name LIKE '%connection%'
                    ORDER BY name;
                `;
                const configResult = await pool.request().query(configQuery);
                console.log('Server timeout configurations:');
                configResult.recordset.forEach((config: any) => {
                    console.log(`  ${config.name}: ${config.value_in_use} (${config.description})`);
                });
            } else {
                console.log('Azure SQL Database - skipping server-level configuration check');
            }

            // Check current request settings
            const requestQuery = `
                SELECT 
                    session_id,
                    request_id,
                    status,
                    command,
                    wait_type,
                    wait_time,
                    total_elapsed_time
                FROM sys.dm_exec_requests 
                WHERE session_id = @@SPID;
            `;
            const requestResult = await pool.request().query(requestQuery);
            if (requestResult.recordset.length > 0) {
                console.log('Current request info:', requestResult.recordset[0]);
            } else {
                console.log('No active request for current session');
            }

            console.log('=== TIMEOUT DIAGNOSTICS COMPLETE ===');

        } catch (error: any) {
            console.error('Failed to diagnose timeout settings:', error.message);
            // Don't throw - this is just diagnostic info
        }
    }

    private async testBasicEventCapture(pool?: sql.ConnectionPool): Promise<void> {
        const currentPool = pool || this.pool;
        if (!currentPool || !this.isProfilering) {
            return;
        }

        try {
            // Exit early if profiling stopped
            if (!this.isProfilering) {
                return;
            }

            // Diagnose system views only once per profiling session
            if (!this.hasRunInitialDiagnostics) {
                await this.diagnoseSystemViews(currentPool);
                this.hasRunInitialDiagnostics = true;
            }

            // Exit early if profiling stopped
            if (!this.isProfilering) {
                return;
            }

            const isAzure = await this.isAzureSqlDatabase(currentPool);
            const sessionView = isAzure ? 'sys.dm_xe_database_sessions' : 'sys.dm_xe_sessions';
            const sessionTargetView = isAzure ? 'sys.dm_xe_database_session_targets' : 'sys.dm_xe_session_targets';

            // Exit early if profiling stopped
            if (!this.isProfilering) {
                return;
            }

            // Simple test query to see if we can get any data at all
            const testQuery = `
                SELECT TOP 1
                    CAST(target_data AS XML) as raw_target_data,
                    LEN(CAST(target_data AS nvarchar(max))) as data_length
                FROM ${sessionTargetView} AS t 
                JOIN ${sessionView} AS s ON s.address = t.event_session_address
                WHERE s.name = '${this.sessionName}' AND t.target_name = 'ring_buffer'
            `;

            console.log('=== TESTING BASIC EVENT CAPTURE ===');
            console.log('Session name being tested:', this.sessionName);
            console.log('Using views:', sessionView, 'and', sessionTargetView);
            console.log('Test query:', testQuery);

            const result = await currentPool.request().query(testQuery);
            console.log('Test query returned', result.recordset.length, 'rows');

            if (result.recordset.length > 0) {
                const record = result.recordset[0];
                console.log('✅ Ring buffer found with data length:', record.data_length);

                if (record.raw_target_data && record.data_length > 0) {
                    const xml = record.raw_target_data.toString();
                    console.log('XML preview (first 1000 chars):', xml.substring(0, 1000));

                    // Count events in XML
                    const eventMatches = xml.match(/<event[^>]*>/g);
                    console.log('✅ Number of events found in XML:', eventMatches ? eventMatches.length : 0);

                    if (eventMatches && eventMatches.length > 0) {
                        console.log('Event types found:', xml.match(/name="[^"]*"/g)?.slice(0, 5));
                    }
                } else {
                    console.log('❌ No XML data in ring buffer target');
                }
            } else {
                console.log('❌ NO TARGET DATA FOUND - Extended Events session may not exist or not be capturing data');

                // Check if session exists and is running
                const sessionCheckQuery = `
                    SELECT name, create_time, 
                           CASE WHEN s.address IS NOT NULL THEN 'Running' ELSE 'Stopped' END as status
                    FROM ${sessionView} s
                    WHERE name = '${this.sessionName}'
                `;
                const sessionResult = await currentPool.request().query(sessionCheckQuery);
                console.log('Session status:', sessionResult.recordset);
            }

        } catch (error) {
            console.error('Basic event capture test failed:', error);
        }
    }

    private async collectResults(): Promise<void> {
        // Leer modo de profiler desde configuración
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const profilerMode = config.get<string>('profilerMode', 'default');

        // Si el modo es 'ads', usar la consulta y mapeo de Azure Data Studio
        if (profilerMode === 'ads') {
            await this.collectResultsADS();
            return;
        }

        // Semaphore check - prevent concurrent executions
        if (this.isCollectingResults) {
            console.log('⏭️ Skipping collectResults - already in progress');
            return;
        }

        // Double-check conditions at start
        if (!this.pool || !this.isProfilering) {
            return;
        }

        // Set semaphore
        this.isCollectingResults = true;

        // Store pool reference to avoid race condition
        const currentPool = this.pool;

        try {
            // Additional safety check - if profiling was stopped during execution
            if (!this.isProfilering || !currentPool) {
                return;
            }

            // Run basic test first time to help with debugging
            if (this.results.length === 0 && this.isProfilering) {
                await this.testBasicEventCapture(currentPool);
            }

            // Re-check state after async operation
            if (!this.isProfilering || !this.pool) {
                return;
            }

            // Use appropriate views based on database type
            const isAzure = await this.isAzureSqlDatabase(currentPool);

            // 🎯 Build timestamp filter (only for SQL Server with event_file)
            const timestampFilter = this.lastReadTimestamp && !isAzure
                ? `AND event_timestamp > '${this.lastReadTimestamp.toISOString()}'`
                : '';

            let query: string;

            if (isAzure) {
                // 🚀 Azure SQL: Ring buffer with sliding window (only read NEW events)
                const azureTimestampFilter = this.lastAzureTimestamp
                    ? `AND event_data.value('(@timestamp)[1]', 'datetime2') > '${this.lastAzureTimestamp.toISOString()}'`
                    : '';

                console.log('🔍 Azure sliding window:', this.lastAzureTimestamp
                    ? `Reading events after ${this.lastAzureTimestamp.toISOString()}`
                    : 'First read - no filter');

                query = `
                    SELECT TOP 50
                        event_data.value('(@timestamp)[1]', 'datetime2') AS event_timestamp,
                        event_data.value('(@name)[1]', 'varchar(50)') AS event_name,
                        
                        -- Get statement text
                        COALESCE(
                            event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                            event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                            'No SQL Text Available'
                        ) AS statement_text,
                        
                        -- Event fields
                        ISNULL(event_data.value('(data[@name="duration"]/value)[1]', 'bigint'), 0) AS duration_microseconds,
                        DB_NAME() AS database_name,
                        SYSTEM_USER AS username,
                        COALESCE(
                            event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
                            'Unknown Application'
                        ) AS application_name
                        
                    FROM (
                        SELECT CAST(target_data AS XML) AS target_data
                        FROM sys.dm_xe_database_session_targets AS t 
                        JOIN sys.dm_xe_database_sessions AS s ON s.address = t.event_session_address
                        WHERE s.name = '${this.sessionName}' 
                          AND t.target_name = 'ring_buffer'
                    ) AS data
                    CROSS APPLY target_data.nodes('RingBufferTarget/event') AS events(event_data)
                    WHERE event_data.value('(@timestamp)[1]', 'datetime2') IS NOT NULL
                      ${azureTimestampFilter}
                      ${this.getAntiRecursionFilters()}
                    ORDER BY event_timestamp DESC;
                `;
            } else {
                // 🚀 SQL Server: Streaming with event_file (real incremental reads)
                query = `
                    SELECT 
                        CAST(event_data AS XML).value('(@timestamp)[1]', 'datetime2') AS event_timestamp,
                        CAST(event_data AS XML).value('(@name)[1]', 'varchar(50)') AS event_name,
                        
                        -- Get statement text
                        COALESCE(
                            CAST(event_data AS XML).value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                            CAST(event_data AS XML).value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                            CAST(event_data AS XML).value('(data[@name="sql_text"]/value)[1]', 'nvarchar(max)'),
                            'No SQL Text Available'
                        ) AS statement_text,
                        
                        -- Event fields
                        ISNULL(CAST(event_data AS XML).value('(data[@name="duration"]/value)[1]', 'bigint'), 0) AS duration_microseconds,
                        COALESCE(
                            CAST(event_data AS XML).value('(action[@name="database_name"]/value)[1]', 'nvarchar(128)'),
                            DB_NAME()
                        ) AS database_name,
                        COALESCE(
                            CAST(event_data AS XML).value('(action[@name="username"]/value)[1]', 'nvarchar(128)'),
                            CAST(event_data AS XML).value('(action[@name="server_principal_name"]/value)[1]', 'nvarchar(128)'),
                            SYSTEM_USER
                        ) AS username,
                        COALESCE(
                            CAST(event_data AS XML).value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
                            'Unknown Application'
                        ) AS application_name
                        
                    FROM sys.fn_xe_file_target_read_file(
                        '${this.xelFilePath}*.xel',
                        NULL, NULL, NULL
                    )
                    WHERE CAST(event_data AS XML).value('(@timestamp)[1]', 'datetime2') IS NOT NULL
                      ${timestampFilter}
                      ${this.getAntiRecursionFilters()}
                    ORDER BY event_timestamp DESC;
                `;
            }

            // 🔧 Create request with extended timeout for Extended Events queries
            const request = currentPool.request();
            let result;

            try {
                console.log('=== EXECUTING MAIN XE QUERY ===');
                console.log('Query timeout set to: 60000ms for Extended Events');
                console.log('Session name:', this.sessionName);
                console.log('Is Azure:', isAzure);
                console.log('Filters applied:', this.getAntiRecursionFilters() ? 'YES' : 'NO (DISABLED)');
                console.log('=== FULL QUERY ===');
                console.log(query);
                console.log('=== END QUERY ===');
                result = await request.query(query);
                console.log('Main query succeeded with', result.recordset.length, 'records');

                // Log sample data for debugging
                if (result.recordset.length > 0) {
                    console.log('Sample records (first 3):');
                    result.recordset.slice(0, 3).forEach((record, i) => {
                        console.log(`Record ${i}:`, {
                            eventName: record.event_name,
                            timestamp: record.event_timestamp,
                            statement: record.statement_text?.substring(0, 100),
                            appName: record.application_name
                        });
                    });
                } else {
                    console.log('⚠️ NO RECORDS RETURNED - Query executed but returned empty result set');
                }
            } catch (queryError: any) {
                console.error('=== MAIN XE QUERY FAILED ===');
                console.error('Error message:', queryError.message);
                console.error('Error number:', queryError.number);
                console.error('Error details:', queryError);

                // Don't use fallback - it creates noise. Log error and rethrow
                Logger.errorSilent('Extended Events query failed:', queryError);
                throw queryError;
            }

            // Debug logging
            console.log(`=== XE RESULTS DEBUG ===`);
            console.log(`Query returned ${result.recordset.length} records`);

            // Log all events for debugging (first 5)
            result.recordset.slice(0, 5).forEach((record: any, i: number) => {
                console.log(`Event ${i + 1}:`, {
                    eventName: record.event_name,
                    timestamp: record.event_timestamp,
                    statement: record.statement_text?.substring(0, 150) + '...',
                    appName: record.application_name
                });
            });

            if (result.recordset.length > 0) {
                const sample = result.recordset[0];
                console.log('Sample record structure:', Object.keys(sample));
                console.log('Sample record values:', {
                    eventTimestamp: sample.event_timestamp,
                    eventName: sample.event_name,
                    statementText: sample.statement_text?.substring(0, 100) + '...',
                    databaseName: sample.database_name,
                    username: sample.username,
                    applicationName: sample.application_name
                });

                if (sample.raw_xml) {
                    console.log('Raw XML sample (first 500 chars):', sample.raw_xml.substring(0, 500));
                }
            }

            // Convert results to our format
            const newEvents: ProfilerEvent[] = result.recordset.map((record: any, index: number) => {
                // Log stored procedure events specifically
                if (record.event_name?.includes('rpc') && record.statement_text?.includes('sp_')) {
                    console.log('🔍 STORED PROCEDURE DETECTED:', {
                        eventName: record.event_name,
                        statement: record.statement_text?.substring(0, 200),
                        timestamp: record.event_timestamp,
                        appName: record.application_name
                    });
                }

                // 🔍 Log DEBUG/TEST queries specifically
                if (record.statement_text?.toUpperCase().includes('DEBUG') ||
                    record.statement_text?.toUpperCase().includes('TEST QUERY') ||
                    record.statement_text?.toUpperCase().includes('PROFILER TEST')) {
                    console.log('🎯 DEBUG/TEST QUERY DETECTED:', {
                        eventName: record.event_name,
                        statement: record.statement_text?.substring(0, 200),
                        timestamp: record.event_timestamp,
                        appName: record.application_name
                    });
                }

                const event = {
                    timestamp: record.event_timestamp?.toISOString() || new Date().toISOString(),
                    eventName: record.event_name || 'Unknown',
                    statement: record.statement_text || '',
                    duration: record.duration_microseconds ? Math.round(record.duration_microseconds / 1000) : undefined,
                    databaseName: record.database_name || 'Unknown',
                    userName: record.username || 'Unknown',
                    applicationName: record.application_name || 'Unknown',
                    id: '' // Será asignado después
                };

                // Generar ID único para el evento
                event.id = this.generateEventId(event);

                // Debug logging for first few events
                if (index < 3) {
                    console.log(`Event ${index}:`, {
                        rawEventName: record.event_name,
                        rawStatement: record.statement_text?.substring(0, 100),
                        rawDatabase: record.database_name,
                        rawUsername: record.username,
                        rawAppName: record.application_name,
                        mappedEvent: event
                    });
                }

                return event;
            });

            // Add only new events (deduplication based on unique event ID)
            const existingIds = new Set(this.results.map(e => e.id));
            const filteredNewEvents = newEvents.filter(e =>
                !existingIds.has(e.id)
            );

            console.log('=== EVENT DEDUPLICATION ===');
            console.log('Total events from query:', newEvents.length);
            console.log('Already in results:', newEvents.length - filteredNewEvents.length);
            console.log('New events to add:', filteredNewEvents.length);
            console.log('Current results array size:', this.results.length);

            this.results.unshift(...filteredNewEvents);

            console.log('Results array size after adding:', this.results.length);

            // 📊 UX: Log latency for new events (time from SQL execution to UI delivery)
            if (filteredNewEvents.length > 0) {
                const now = Date.now();
                const newestEvent = filteredNewEvents[0];
                const eventTime = new Date(newestEvent.timestamp).getTime();
                const latencyMs = now - eventTime;

                // ⏱️ Log time from profiler start to first events (only for first batch)
                if (this.lastEventReceivedTime === 0 && this.profilerStartTime > 0) {
                    const timeFromStart = now - this.profilerStartTime;
                    console.log(`⏱️ FIRST EVENTS RECEIVED | Time from profiler start: ${timeFromStart}ms (${(timeFromStart / 1000).toFixed(2)}s)`);
                }

                console.log(`✅ ${filteredNewEvents.length} new event(s) | Latency: ${latencyMs}ms | App: ${newestEvent.applicationName}`);
                this.lastEventReceivedTime = now;
            }

            // 🎯 Update timestamp for next incremental read
            if (newEvents.length > 0) {
                const latestTimestamp = new Date(Math.max(...newEvents.map(e => new Date(e.timestamp).getTime())));

                if (isAzure) {
                    // Azure: Update sliding window timestamp
                    this.lastAzureTimestamp = latestTimestamp;
                    console.log('📊 Azure: Updated sliding window timestamp to:', this.lastAzureTimestamp.toISOString());
                } else {
                    // SQL Server: Update event_file streaming timestamp
                    this.lastReadTimestamp = latestTimestamp;
                    console.log('📊 SQL Server: Updated lastReadTimestamp to:', this.lastReadTimestamp.toISOString());
                }
            }

            // Limit results to avoid memory issues
            const config = vscode.workspace.getConfiguration('sqlProfiler');
            const maxEvents = config.get<number>('maxEvents') || 2000; // Increased default from 1000
            if (this.results.length > maxEvents) {
                const discarded = this.results.length - maxEvents;
                this.results = this.results.slice(0, maxEvents);
                console.log(`⚠️ Discarded ${discarded} oldest event(s) to maintain ${maxEvents} event limit`);
            }

        } catch (error: any) {
            // Use silent logging for collection errors to avoid notification spam
            Logger.errorSilent('Error collecting results:', error);

            // Check if it's a connection-related error
            if (error.code === 'ECONNRESET' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'ETIMEDOUT' ||
                error.message?.includes('Connection is closed') ||
                error.message?.includes('Invalid object name')) {

                Logger.warn('Connection issue detected in collectResults, will be handled by polling error counter');

                // Telemetry: connection error during event collection
                const { TelemetryService } = await import('../utils/TelemetryService');
                const telemetry = TelemetryService.getInstance();
                telemetry?.sendEvent('profilingConnectionError', {
                    errorCode: error.code || 'unknown',
                    errorType: error.code === 'ETIMEDOUT' ? 'timeout' : 'connection',
                    serverType: this.detectedDatabaseType || 'unknown'
                });

                // Clear cache to force fresh detection next time
                this.databaseTypeCache.clear();

                // Rethrow to trigger polling error handling
                throw error;
            }

            // For other errors, just log and continue silently
            Logger.warn('Non-critical error in collectResults, continuing polling');
        } finally {
            // Always reset semaphore
            this.isCollectingResults = false;
        }
    }

    /**
     * Lógica de captura y mapeo de eventos compatible con Azure Data Studio Profiler
     */
    private async collectResultsADS(): Promise<void> {
        // Semaphore check
        if (this.isCollectingResults) {
            console.log('⏭️ Skipping collectResultsADS - already in progress');
            return;
        }

        if (!this.pool || !this.isProfilering) {
            return;
        }

        this.isCollectingResults = true;
        const currentPool = this.pool;

        try {
            const isAzure = await this.isAzureSqlDatabase(currentPool);
            let query: string;

            if (isAzure) {
                query = `
                    SELECT TOP 50
                        event_xml.value('(@timestamp)[1]', 'datetime2') AS timestamp,
                        event_xml.value('(@name)[1]', 'nvarchar(128)') AS eventName,
                        event_xml.value('(data[@name="database_name"]/value)[1]', 'nvarchar(128)') AS databaseName,
                        event_xml.value('(action[@name="username"]/value)[1]', 'nvarchar(128)') AS userName,
                        event_xml.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)') AS applicationName,
                        event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)') AS statement,
                        event_xml.value('(data[@name="duration"]/value)[1]', 'bigint') AS duration
                    FROM (
                        SELECT CAST(target_data AS XML) AS target_xml
                        FROM sys.dm_xe_database_session_targets AS t
                        JOIN sys.dm_xe_database_sessions AS s ON s.address = t.event_session_address
                        WHERE s.name = '${this.sessionName}'
                          AND t.target_name = 'ring_buffer'
                    ) AS src
                    CROSS APPLY target_xml.nodes('RingBufferTarget/event') AS events(event_xml)
                    WHERE event_xml.value('(@name)[1]', 'nvarchar(128)') IN ('rpc_completed', 'sql_batch_completed', 'sql_statement_completed')
                      ${this.getAntiRecursionFiltersADS()}
                    ORDER BY timestamp DESC;
                `;
            } else {
                // Para SQL Server con archivos .xel, usamos una subconsulta para aplicar filtros correctamente
                query = `
                    SELECT TOP 50 *
                    FROM (
                        SELECT 
                            CAST(event_data AS XML).value('(event/@timestamp)[1]', 'datetime2') AS timestamp,
                            CAST(event_data AS XML).value('(event/@name)[1]', 'nvarchar(128)') AS eventName,
                            CAST(event_data AS XML).value('(event/data[@name="database_name"]/value)[1]', 'nvarchar(128)') AS databaseName,
                            CAST(event_data AS XML).value('(event/action[@name="username"]/value)[1]', 'nvarchar(128)') AS userName,
                            CAST(event_data AS XML).value('(event/action[@name="client_app_name"]/value)[1]', 'nvarchar(128)') AS applicationName,
                            CAST(event_data AS XML).value('(event/data[@name="statement"]/value)[1]', 'nvarchar(max)') AS statement,
                            CAST(event_data AS XML).value('(event/data[@name="duration"]/value)[1]', 'bigint') AS duration,
                            CAST(event_data AS XML) AS event_xml
                        FROM sys.fn_xe_file_target_read_file('${this.xelFilePath}*.xel', null, null, null)
                        WHERE CAST(event_data AS XML).value('(event/@name)[1]', 'nvarchar(128)') IN ('rpc_completed', 'sql_batch_completed', 'sql_statement_completed')
                    ) AS events
                    WHERE 1=1
                      ${this.getAntiRecursionFiltersADS()}
                    ORDER BY timestamp DESC;
                `;
            }

            console.log('=== EXECUTING ADS MODE QUERY ===');
            console.log('Session name:', this.sessionName);
            console.log('Is Azure:', isAzure);

            const request = currentPool.request();
            const result = await request.query(query);

            console.log(`ADS mode: Query returned ${result.recordset.length} records`);

            const newEvents: ProfilerEvent[] = result.recordset.map((record: any) => {
                return {
                    id: this.generateEventId(record),
                    timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString(),
                    eventName: record.eventName || 'Unknown',
                    statement: record.statement || '',
                    duration: record.duration ? Number(record.duration) : undefined,
                    databaseName: record.databaseName || 'Unknown',
                    userName: record.userName || 'Unknown',
                    applicationName: record.applicationName || 'Unknown'
                };
            });

            // Deduplicar y agregar eventos nuevos
            const existingIds = new Set(this.results.map(e => e.id));
            const filteredNewEvents = newEvents.filter(e => !existingIds.has(e.id));

            console.log('=== ADS MODE EVENT DEDUPLICATION ===');
            console.log('Total events from query:', newEvents.length);
            console.log('New events to add:', filteredNewEvents.length);

            this.results.unshift(...filteredNewEvents);

            // Limitar resultados
            const maxEvents = vscode.workspace.getConfiguration('sqlProfiler').get<number>('maxEvents') || 2000;
            if (this.results.length > maxEvents) {
                this.results = this.results.slice(0, maxEvents);
            }

            if (filteredNewEvents.length > 0) {
                console.log(`✅ ADS mode: ${filteredNewEvents.length} new event(s) added`);
            }
        } catch (error: any) {
            Logger.errorSilent('Error in collectResultsADS:', error);
            console.error('ADS mode query failed:', error.message);
        } finally {
            this.isCollectingResults = false;
        }
    }

    private parseConnectionString(connectionString: string): any {
        const config: any = {
            server: 'localhost',
            // 🔧 Extended timeouts for Extended Events queries
            connectionTimeout: 30000, // 30 seconds for connection establishment  
            requestTimeout: 90000,    // 90 seconds for query execution
            options: {
                // 🛡️ Add unique application name to identify our extension's connections
                appName: 'SQL Profiler Tool for VS Code',
                connectTimeout: 30000,
                requestTimeout: 90000
            }
        };

        const parts = connectionString.split(';');
        for (const part of parts) {
            if (!part.trim()) {
                continue;
            }

            const [key, value] = part.split('=');
            if (!key || !value) {
                continue;
            }

            const normalizedKey = key.trim().toLowerCase();
            const normalizedValue = value.trim();

            switch (normalizedKey) {
                case 'server':
                case 'data source':
                    config.server = normalizedValue;
                    break;
                case 'database':
                case 'initial catalog':
                    config.database = normalizedValue;
                    break;
                case 'user id':
                case 'uid':
                    config.user = normalizedValue;
                    break;
                case 'password':
                case 'pwd':
                    config.password = normalizedValue;
                    break;
                case 'integrated security':
                    if (normalizedValue.toLowerCase() === 'true' || normalizedValue === 'SSPI') {
                        config.options = {
                            ...config.options,
                            trustedConnection: true
                        };
                    }
                    break;
                case 'encrypt':
                    config.options = {
                        ...config.options,
                        trustedConnection: normalizedValue.toLowerCase() === 'false'
                    };
                    break;
                case 'trust server certificate':
                    config.options = {
                        ...config.options,
                        trustedConnection: normalizedValue.toLowerCase() === 'true'
                    };
                    break;
            }
        }

        return config;
    }

    getResults(): ProfilerEvent[] {
        console.log('=== GET RESULTS CALLED ===');
        console.log('Results array length:', this.results.length);
        console.log('isProfilering:', this.isProfilering);
        console.log('First 3 results:', this.results.slice(0, 3).map(r => ({
            timestamp: r.timestamp,
            eventName: r.eventName,
            statement: r.statement?.substring(0, 50) + '...'
        })));
        return [...this.results];
    }

    clearResults(): void {
        this.results = [];
    }

    isRunning(): boolean {
        return this.isProfilering;
    }

    /**
     * Throttled logging - only logs if enough time has passed since last log of same type
     */
    private shouldLog(logKey: string): boolean {
        const now = Date.now();
        const lastLog = this.lastLogTime.get(logKey);

        if (!lastLog || (now - lastLog) >= this.logThrottleMs) {
            this.lastLogTime.set(logKey, now);
            return true;
        }

        return false;
    }

    /**
     * Generates a unique ID for an event using GUID
     */
    private generateEventId(event: Partial<ProfilerEvent>): string {
        // Increment counter for additional uniqueness guarantee
        this.eventIdCounter++;

        // Generate a GUID-like unique identifier
        const guid = this.generateGuid();

        // Format: evt_<counter>_<guid>
        // Counter prefix helps with sorting, GUID ensures absolute uniqueness
        return `evt_${this.eventIdCounter}_${guid}`;
    }

    /**
     * Generates a RFC4122 version 4 compliant GUID
     */
    private generateGuid(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Simple hash function for generating event IDs
     */
    private simpleHash(str: string): string {
        let hash = 0;
        if (str.length === 0) {
            return '0';
        }

        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16).substring(0, 8);
    }

    /**
     * 🛡️ Generates SQL filter conditions for ADS mode (simplified XML paths)
     * Adapted for event_xml structure used in collectResultsADS
     * Only filters the profiler's OWN queries, not queries from other applications
     */
    private getAntiRecursionFiltersADS(): string {
        // Solo filtrar queries que vienen específicamente de nuestra extensión
        const filters = `
            -- Solo excluir queries de la extensión SQL Profiler Tool
            AND NOT (
                COALESCE(event_xml.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'), '') = 'SQL Profiler Tool for VS Code'
                AND (
                    COALESCE(event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'), '') LIKE '%sys.dm_xe_%'
                    OR COALESCE(event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'), '') LIKE '%RingBufferTarget%'
                    OR COALESCE(event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'), '') LIKE '%sys.fn_xe_file_target_read_file%'
                    OR COALESCE(event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'), '') LIKE '%VSCodeProfilerSession%'
                    OR COALESCE(event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'), '') LIKE '%sys.database_event_sessions%'
                    OR COALESCE(event_xml.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'), '') LIKE '%sys.server_event_sessions%'
                )
            )`;

        return filters;
    }

    /**
     * 🛡️ Generates SQL filter conditions to exclude profiler's own queries
     * This prevents recursive capture of our extension's internal queries
     * 
     * Filters out:
     * - Extension's own queries (application name + session name)
     * - Connection validation queries (SELECT 1, SELECT @@VERSION)
     * - Extended Events maintenance queries
     * - Common health check patterns
     * - node-mssql driver internal operations (SET statements, sp_reset_connection, etc.)
     */
    private getAntiRecursionFilters(): string {
        // ✅ FILTERS NOW ENABLED - Exclude profiler's own queries

        // 🎯 Core filters to prevent recursion
        const appNameFilter = `
            COALESCE(
                event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
                'Unknown Application'
            ) NOT LIKE '%SQL Profiler Tool%'
            AND COALESCE(
                event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
                ''
            ) NOT LIKE '%Extended Events Fallback%'`;

        const sessionNameFilter = `
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="sql_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%VSCodeProfilerSession%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%''VSCodeProfilerSession''%'`;

        const additionalFilters = `
            -- Exclude common profiler maintenance queries
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%sys.dm_xe_%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%RingBufferTarget%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%sys.fn_xe_file_target_read_file%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%CAST(target_data AS XML)%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%event_data.value%'`;

        const connectionTestFilters = `
            -- 🛡️ Exclude common connection validation queries
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SELECT 1%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SELECT @@VERSION%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%sp_executesql @statement=N''SELECT 1%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%sp_executesql @statement=N''SELECT @@VERSION%'
            -- Database type detection queries (profiler internals)
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%sys.database_event_sessions%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%sys.server_event_sessions%'
            -- Additional common connection test patterns
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SELECT GETDATE()%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SELECT CURRENT_TIMESTAMP%'`;

        const nodeMssqlDriverFilters = `
            -- 🚫 Exclude node-mssql driver specific internal operations
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SET IMPLICIT_TRANSACTIONS%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SET CURSOR_CLOSE_ON_COMMIT%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SET ANSI_%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SET QUOTED_IDENTIFIER%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SET CONCAT_NULL_YIELDS_NULL%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%EXEC sp_reset_connection%'
            AND COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%SET NOCOUNT%'`;

        // ✅ Enable ALL comprehensive filters to keep UI clean
        const filters = `${appNameFilter} ${sessionNameFilter} ${additionalFilters} ${connectionTestFilters} ${nodeMssqlDriverFilters}`;

        console.log('=== ANTI-RECURSION FILTERS FULLY ENABLED ===');
        console.log('Filtering out:');
        console.log('  - Profiler queries (SELECT TOP 50 from ring_buffer)');
        console.log('  - Extended Events queries (sys.dm_xe_*)');
        console.log('  - Connection tests (SELECT 1, SELECT @@VERSION)');
        console.log('  - Driver SET statements (SET ANSI_*, SET QUOTED_IDENTIFIER, etc.)');
        console.log('  - Session validation (sys.database_event_sessions, sys.server_event_sessions)');

        return filters;
    }

    /**
     * Gets available mssql connections from VS Code settings
     */
    getMssqlConnections(): MssqlConnection[] {
        const config = vscode.workspace.getConfiguration('mssql');
        const connections = config.get<any[]>('connections') || [];

        return connections.map(conn => ({
            profileName: conn.profileName || '',
            server: conn.server || '',
            database: conn.database || '',
            user: conn.user || '',
            password: conn.password || '',
            authenticationType: conn.authenticationType || 'SqlLogin',
            port: conn.port || 1433,
            encrypt: conn.encrypt || false,
            trustServerCertificate: conn.trustServerCertificate
        }));
    }

    /**
     * Gets the currently selected connection name
     */
    getSelectedConnectionName(): string {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        return config.get<string>('selectedConnection') || '';
    }

    /**
     * Sets the selected connection
     */
    async setSelectedConnection(profileName: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        await config.update('selectedConnection', profileName, vscode.ConfigurationTarget.Global);
    }

    /**
     * Auto-corrects common Azure SQL server name format issues
     */
    private correctAzureSqlServerFormat(serverName: string): { corrected: string; wasChanged: boolean } {
        let corrected = serverName.trim();
        let wasChanged = false;

        // Remove tcp: prefix if present
        if (corrected.toLowerCase().startsWith('tcp:')) {
            corrected = corrected.substring(4);
            wasChanged = true;
        }

        // Remove any port suffix (,1433, :1433, or any other port)
        // First handle comma-separated port
        if (corrected.includes(',')) {
            const parts = corrected.split(',');
            if (parts.length === 2 && /^\d+$/.test(parts[1].trim())) {
                corrected = parts[0];
                wasChanged = true;
            }
        }

        // Then handle colon-separated port (but not for IPv6 addresses)
        if (corrected.includes(':') && !corrected.includes('[')) {
            const parts = corrected.split(':');
            if (parts.length === 2 && /^\d+$/.test(parts[1].trim())) {
                corrected = parts[0];
                wasChanged = true;
            }
        }

        // Remove any trailing spaces
        corrected = corrected.trim();

        return { corrected, wasChanged };
    }

    /**
     * Attempts connection with automatic retry for SSL handshake errors (10054) and Azure SQL format corrections
     */
    private async connectWithAutoRetry(sqlConfig: any, connection: any): Promise<void> {
        // Auto-correct Azure SQL server format if needed
        const serverCorrection = this.correctAzureSqlServerFormat(sqlConfig.server);
        if (serverCorrection.wasChanged) {
            Logger.warn(`Auto-correcting Azure SQL server format: "${sqlConfig.server}" → "${serverCorrection.corrected}"`);
            sqlConfig.server = serverCorrection.corrected;

            // Show user notification about the auto-correction
            const correctionMessage = `Server name auto-corrected to "${serverCorrection.corrected}". Consider updating your settings.json configuration.`;
            vscode.window.showWarningMessage(correctionMessage, 'Update Settings').then(selection => {
                if (selection === 'Update Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler.connections');
                }
            });
        }

        try {
            this.pool = new sql.ConnectionPool(sqlConfig);
            await this.pool.connect();
            console.log('Database connection established successfully');

            // Test basic database access with existing connection
            await this.testBasicAccess();
            console.log('Basic database access confirmed');

        } catch (error: any) {
            // Check for Azure SQL format issues first (ENOTFOUND/ESOCKET with incorrect server format)
            if ((error.code === 'ENOTFOUND' || error.code === 'ESOCKET') &&
                (connection.server.includes('tcp:') || connection.server.includes(',1433'))) {

                Logger.warn(`Azure SQL server format error detected. Attempting auto-correction...`);

                try {
                    // Close any existing pool
                    if (this.pool) {
                        await this.pool.close();
                    }

                    // Correct the server format and retry
                    const serverCorrection = this.correctAzureSqlServerFormat(connection.server);
                    const correctedConfig = { ...sqlConfig, server: serverCorrection.corrected };

                    console.log('=== AZURE SQL SERVER FORMAT CORRECTION ===');
                    console.log('Original server:', connection.server);
                    console.log('Corrected server:', serverCorrection.corrected);
                    console.log('=== END SERVER CORRECTION ===');

                    this.pool = new sql.ConnectionPool(correctedConfig);
                    await this.pool.connect();

                    // Test basic database access with corrected connection
                    await this.testBasicAccess();

                    Logger.info(`✅ Connection successful with corrected server format: "${serverCorrection.corrected}"`);

                    // Show success message with configuration guidance
                    const suggestionMessage = `Connection successful! Server name was auto-corrected to "${serverCorrection.corrected}". Update your settings.json to use this format permanently.`;
                    vscode.window.showInformationMessage(suggestionMessage, 'Update Settings').then(selection => {
                        if (selection === 'Update Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler.connections');
                        }
                    });

                    return; // Success - exit function

                } catch (retryError: any) {
                    Logger.errorSilent('Connection failed even with corrected Azure SQL server format', retryError);
                    // Fall through to SSL retry or original error handling
                    error = retryError; // Use the retry error for further processing
                }
            }

            // Check if this is the specific SSL handshake error 10054
            if ((error.code === 10054 || error.message?.includes('10054') || error.message?.includes('pre-login handshake'))
                && !sqlConfig.trustServerCertificate) {

                Logger.warn(`SSL handshake failed (Error 10054). Attempting retry with trustServerCertificate: true...`);

                try {
                    // Close any existing pool
                    if (this.pool) {
                        await this.pool.close();
                    }

                    // Retry with trustServerCertificate: true
                    const retryConfig = { ...sqlConfig, trustServerCertificate: true };

                    console.log('=== RETRY WITH TRUST SERVER CERTIFICATE ===');
                    console.log('Original trustServerCertificate:', sqlConfig.trustServerCertificate);
                    console.log('Retry trustServerCertificate:', retryConfig.trustServerCertificate);
                    console.log('=== END RETRY CONFIG ===');

                    this.pool = new sql.ConnectionPool(retryConfig);
                    await this.pool.connect();

                    // Test basic database access with retry connection
                    await this.testBasicAccess();

                    Logger.info(`✅ Connection successful with trustServerCertificate: true. Consider adding this setting to your connection configuration.`);

                    // Show success message with configuration guidance
                    const suggestionMessage = `Connection successful! For future connections, add "trustServerCertificate": true to your settings.json configuration for ${connection.server}`;
                    vscode.window.showInformationMessage(suggestionMessage, 'Open Settings').then(selection => {
                        if (selection === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'sqlProfiler.connections');
                        }
                    });

                    return; // Success - exit function

                } catch (retryError: any) {
                    Logger.errorSilent('Connection failed even with trustServerCertificate: true', retryError);
                    // Fall through to original error handling
                }
            }

            // Handle all other errors or if retries also failed
            this.handleConnectionError(error, connection, sqlConfig);
        }
    }

    /**
     * Handles connection errors with detailed guidance
     */
    private handleConnectionError(error: any, connection: any, sqlConfig: any): never {
        let errorMessage = 'Connection failed';

        if (error.code === 'ELOGIN') {
            if (connection.authenticationType === 'SqlLogin') {
                if (connection.server.includes('.database.windows.net')) {
                    // Azure SQL Database specific guidance - work with existing config
                    errorMessage = `Azure SQL Database login failed for user '${connection.user}'. 
                    
Possible issues:
• Incorrect password
• User doesn't exist in this specific database
• User lacks permissions for this database
• IP address not whitelisted in Azure SQL firewall
• Connection string format issue

Current connection settings:
• Server: ${connection.server}
• User: ${connection.user}
• Database: ${connection.database}
• Encrypt: ${sqlConfig.encrypt}

If this connection worked before, check:
• Azure SQL firewall settings for your current IP
• Database-specific user permissions`;
                } else {
                    errorMessage = `SQL Server login failed for user '${connection.user}'. 
                    
Possible issues:
• Incorrect password
• User doesn't exist in SQL Server
• User lacks login permissions
• SQL Server authentication not enabled

Current connection settings:
• Server: ${connection.server}
• User: ${connection.user}
• Database: ${connection.database}`;
                }
            } else {
                errorMessage = `Windows Authentication failed. 
                
Possible issues:
• Current Windows user lacks SQL Server login permissions
• SQL Server doesn't accept Windows Authentication
• Domain/network authentication issues

Current connection settings:
• Server: ${connection.server}
• Database: ${connection.database}`;
            }
        } else if (error.code === 'ETIMEOUT') {
            errorMessage = `Connection timeout to ${sqlConfig.server}:${sqlConfig.port}. Please check:
• Server name/address is correct
• Port number is correct (default: 1433)
• Server is running and accessible
• Firewall allows the connection`;
        } else if (error.code === 'ENETUNREACH' || error.code === 'ENOTFOUND' || error.code === 'ESOCKET') {
            // Check for common Azure SQL configuration mistakes
            if (sqlConfig.server.includes('tcp:') || sqlConfig.server.includes(',1433')) {
                errorMessage = `❌ AZURE SQL SERVER NAME FORMAT ERROR

Your server name has incorrect format: "${sqlConfig.server}"

🔧 QUICK FIX - Update your settings.json:

WRONG FORMAT (current):
"server": "tcp:ordernow.database.windows.net,1433"

CORRECT FORMAT (should be):
"server": "ordernow.database.windows.net"

Azure SQL Database connection format:
{
  "name": "Azure SQL",
  "server": "ordernow.database.windows.net",
  "database": "your-database-name",
  "authenticationType": "SqlLogin",
  "user": "epolicardo",
  "encrypt": true,
  "trustServerCertificate": false
}

REMOVE from server name:
• "tcp:" prefix
• ",1433" port suffix
• Any protocol prefixes

The port (1433) is handled automatically by the "port" property.`;
            } else if (sqlConfig.server.includes('.database.windows.net')) {
                errorMessage = `Cannot reach Azure SQL Database: ${sqlConfig.server}

Possible issues for Azure SQL:
• Server name format (should not include tcp: or port)
• Network connectivity to Azure
• Firewall rules on Azure SQL Server
• VPN or corporate proxy blocking connection

Current configuration:
• Server: ${sqlConfig.server}
• User: ${sqlConfig.user}
• Database: ${sqlConfig.database || 'master'}

Azure SQL Server firewall checklist:
• Add your client IP address to server firewall rules
• Enable "Allow Azure services" if connecting from Azure
• Check if corporate firewall blocks outbound 1433`;
            } else {
                errorMessage = `Cannot reach server ${sqlConfig.server}. Please check:
• Server name/address is correct
• Network connectivity  
• VPN connection if required
• Firewall allows the connection on port ${sqlConfig.port || 1433}`;
            }
        } else if (error.code === 10054 || error.message?.includes('10054') || error.message?.includes('pre-login handshake')) {
            errorMessage = `Error 10054: Connection forcibly closed during SSL handshake. 
            
This is usually an SSL/TLS configuration mismatch. Current setting: trustServerCertificate: ${sqlConfig.trustServerCertificate}

AUTOMATIC RETRY SOLUTIONS:
1. For LOCAL SQL Server instances (recommended):
   • Add "trustServerCertificate": true to your connection settings
   • This bypasses SSL certificate validation for local development

2. For REMOTE/PRODUCTION servers:
   • Ensure server has valid SSL certificate
   • Use "encrypt": true, "trustServerCertificate": false

MANUAL FIX in VS Code settings.json:
{
  "sqlProfiler.connections": [
    {
      "name": "Your Connection",
      "server": "${connection.server}",
      "trustServerCertificate": true  // Add this line
    }
  ]
}

Current connection settings:
• Server: ${connection.server}
• Encrypt: ${sqlConfig.encrypt}
• TrustServerCertificate: ${sqlConfig.trustServerCertificate}`;
        } else if (error.message?.includes('SSL') || error.message?.includes('TLS') || error.message?.includes('certificate')) {
            errorMessage = `SSL/TLS certificate error. Current setting: trustServerCertificate: ${sqlConfig.trustServerCertificate}

Try these solutions:
• If local/dev server: Add "trustServerCertificate": true to your connection in settings.json
• If Azure SQL: Ensure "encrypt": true and "trustServerCertificate": false
• If on-premise with self-signed cert: Add "trustServerCertificate": true to connection settings

Connection troubleshooting:
• Server: ${connection.server}
• Encrypt: ${sqlConfig.encrypt}
• TrustServerCertificate: ${sqlConfig.trustServerCertificate}`;
        }

        Logger.error('Database connection failed', {
            code: error.code,
            message: error.message,
            server: sqlConfig.server,
            user: sqlConfig.user || 'Windows Auth',
            authType: connection.authenticationType,
            encrypt: sqlConfig.encrypt
        });

        throw new Error(errorMessage);
    }

    /**
     * Connects using the selected mssql connection profile
     */
    private async connectUsingSelectedProfile(): Promise<void> {
        const selectedProfile = this.getSelectedConnectionName();
        console.log(`Getting connection for profile: ${selectedProfile}`);

        if (!selectedProfile) {
            throw new Error('No connection profile selected. Please select a connection first.');
        }

        const connections = this.getMssqlConnections();
        console.log(`Available connections: ${connections.map(c => c.profileName).join(', ')}`);

        const connection = connections.find(conn => conn.profileName === selectedProfile);

        if (!connection) {
            throw new Error(`Connection profile '${selectedProfile}' not found in mssql.connections`);
        }

        console.log(`Found connection: ${connection.server}, auth: ${connection.authenticationType}`);

        // TEMPORAL: Log original connection configuration from settings.json
        console.log('=== ORIGINAL CONNECTION CONFIG FROM SETTINGS.JSON ===');
        console.log('Profile Name:', connection.profileName);
        console.log('Server:', connection.server);
        console.log('Database:', connection.database);
        console.log('User:', connection.user);
        console.log('Password in config:', connection.password ? `[${connection.password.length} chars]` : 'NOT SET');
        console.log('Auth Type:', connection.authenticationType);
        console.log('Port:', connection.port);
        console.log('Encrypt:', connection.encrypt);
        console.log('TrustServerCertificate in config:', connection.trustServerCertificate);
        console.log('=== END ORIGINAL CONNECTION CONFIG ===');

        // Convert mssql connection to sql.config format - use existing connection settings as-is
        const sqlConfig: any = {
            server: connection.server,
            database: connection.database || '',
            port: connection.port || 1433,
            // Use encrypt setting exactly as configured, or default based on server type
            encrypt: connection.encrypt !== undefined ? connection.encrypt : connection.server.includes('.database.windows.net'),
            // Smart SSL certificate handling
            trustServerCertificate: this.getTrustServerCertificateSetting(connection),
            // 🔧 Extended timeouts for Azure SQL and Extended Events
            connectionTimeout: 30000, // 30 seconds for connection establishment
            requestTimeout: 90000,    // 90 seconds for query execution (especially XE queries)
            options: {
                // 🛡️ Add unique application name to identify our extension's connections
                appName: 'SQL Profiler Tool for VS Code',
                // Additional connection options for reliability
                connectTimeout: 30000,
                requestTimeout: 90000
            }
        };

        if (connection.authenticationType === 'Integrated') {
            sqlConfig.options = {
                trustedConnection: true
            };
        } else {
            // For SQL Authentication, handle password
            sqlConfig.user = connection.user;

            // If password is not in config, prompt for it
            if (!connection.password) {
                const password = await this.promptForPassword(connection.profileName, connection.user || '');
                if (!password) {
                    throw new Error('Password is required for SQL Server authentication');
                }
                sqlConfig.password = password;
            } else {
                sqlConfig.password = connection.password;
            }
        }

        console.log(`Connecting to: ${sqlConfig.server}:${sqlConfig.port} using existing connection configuration`);

        // 🔐 Log connection details (WITHOUT sensitive information)
        console.log('=== CONNECTION DETAILS ===');
        console.log('Server:', sqlConfig.server);
        console.log('Port:', sqlConfig.port);
        console.log('Database:', sqlConfig.database);
        console.log('User:', sqlConfig.user || '[Windows Auth]');
        console.log('Password:', sqlConfig.password ? '[PROTECTED - Length: ' + sqlConfig.password.length + ' chars]' : '[NOT SET]');
        console.log('Encrypt:', sqlConfig.encrypt);
        console.log('TrustServerCertificate:', sqlConfig.trustServerCertificate);
        console.log('Auth Type:', connection.authenticationType);
        console.log('=== END CONNECTION DETAILS ===');

        // Use auto-retry connection method for better error handling
        await this.connectWithAutoRetry(sqlConfig, connection);
    }

    /**
     * Prompts user for password when needed
     */
    private async promptForPassword(profileName: string, username: string): Promise<string | undefined> {
        // Try to get password from secure storage first
        const storageKey = `sqlProfiler.password.${profileName}`;

        if (this.context) {
            try {
                const storedPassword = await this.context.secrets.get(storageKey);
                if (storedPassword) {
                    console.log(`✅ Using securely stored password for ${profileName}`);
                    return storedPassword;
                }
            } catch (error) {
                console.log('No stored password found, prompting user...');
            }
        }

        // Prompt for password
        const password = await vscode.window.showInputBox({
            prompt: `Enter password for ${profileName} (${username})`,
            password: true,
            placeHolder: 'SQL Server password',
            ignoreFocusOut: true
        });

        if (password) {
            console.log(`✅ Password provided by user for ${profileName}`);
            // Ask if user wants to save the password
            const savePassword = await vscode.window.showQuickPick(
                ['Yes, save password securely', 'No, ask every time'],
                {
                    placeHolder: 'Do you want to save this password securely for future use?',
                    ignoreFocusOut: true
                }
            );

            if (savePassword && savePassword.startsWith('Yes') && this.context) {
                try {
                    await this.context.secrets.store(storageKey, password);
                    vscode.window.showInformationMessage(`Password saved securely for ${profileName}`);
                } catch (error) {
                    console.error('Failed to store password:', error);
                }
            }
        }

        return password;
    }

    /**
     * Tests basic database connectivity and permissions
     */
    private async testBasicAccess(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection available for testing');
        }

        // Capture pool reference to avoid race condition
        const currentPool = this.pool;

        try {
            // Test basic SELECT permissions
            const request = currentPool.request();
            await request.query('SELECT 1 as test');
            console.log('Basic SELECT access confirmed');

            // Detect database type and version
            const versionResult = await request.query('SELECT @@VERSION as version');
            const version = versionResult.recordset[0]?.version || '';
            const isAzureSQL = version.includes('Azure') || version.includes('Microsoft Azure');

            console.log('Database version:', version);
            console.log('Azure SQL Database detected:', isAzureSQL);

            // Test Extended Events permissions based on environment
            try {
                if (isAzureSQL) {
                    // For Azure SQL Database, test database-scoped events
                    await request.query('SELECT name FROM sys.database_event_sessions WHERE name = \'test\'');
                    console.log('Azure SQL Database: database-scoped Extended Events access confirmed');
                } else {
                    // For SQL Server, test server-level events
                    await request.query('SELECT name FROM sys.server_event_sessions WHERE name = \'test\'');
                    console.log('SQL Server: server-level Extended Events access confirmed');
                }
            } catch (xeError: any) {
                console.warn('Limited Extended Events permissions detected:', xeError.message);

                let errorMessage = '';
                if (isAzureSQL) {
                    errorMessage = `Azure SQL Database Extended Events permissions required.

SOLUTION OPTIONS:
1. Ask your Azure SQL admin to grant you one of these roles:
   • db_owner role in the database
   • ALTER ANY DATABASE EVENT SESSION permission

2. Alternative: Use Query Store instead (if available)
   • Query Store provides similar query monitoring
   • Usually available to db_datareader role

Current connection works but Extended Events requires elevated permissions in Azure SQL Database.`;
                } else {
                    errorMessage = `SQL Server Extended Events permissions required.

SOLUTION OPTIONS:
1. Ask your DBA to grant: GRANT VIEW SERVER STATE TO [${await this.getCurrentUser()}]
2. Or add your user to sysadmin role (less secure)
3. Alternative: Use SQL Server Profiler (deprecated) or Query Store

Current connection works but Extended Events requires VIEW SERVER STATE permission.`;
                }

                throw new Error(errorMessage);
            }
        } catch (error: any) {
            if (error.message.includes('Extended Events permissions') || error.message.includes('SOLUTION OPTIONS')) {
                throw error; // Re-throw our custom error message
            }
            console.error('Basic database access test failed:', error);
            throw new Error(`Database access test failed: ${error.message}`);
        }
    }

    /**
     * Gets the current database user
     */
    private async getCurrentUser(): Promise<string> {
        if (!this.pool) {
            return 'current_user';
        }

        // Capture pool reference to avoid race condition
        const currentPool = this.pool;

        try {
            const request = currentPool.request();
            const result = await request.query('SELECT CURRENT_USER as username');
            return result.recordset[0]?.username || 'current_user';
        } catch {
            return 'current_user';
        }
    }

    /**
     * Determines the appropriate trustServerCertificate setting for the connection
     */
    private getTrustServerCertificateSetting(connection: MssqlConnection): boolean {
        // If explicitly configured in connection settings, use that value
        if (connection.hasOwnProperty('trustServerCertificate')) {
            return (connection as any).trustServerCertificate;
        }

        // Smart defaults based on server type and environment
        const server = connection.server.toLowerCase();

        // Azure SQL Database - always validate certificates
        if (server.includes('.database.windows.net')) {
            console.log('Azure SQL detected - using trustServerCertificate: false');
            return false;
        }

        // Local development servers (localhost, 127.0.0.1, local machine names)
        if (server.includes('localhost') ||
            server.includes('127.0.0.1') ||
            server.includes('(local)') ||
            server.includes('.local') ||
            !server.includes('.')) {
            console.log('Local server detected - using trustServerCertificate: true');
            return true;
        }

        // For other servers, try both approaches
        // Start with validating certificates (more secure)
        console.log('Remote server detected - using trustServerCertificate: false (will retry with true if needed)');
        return false;
    }

    /**
     * Clears stored password for a specific connection profile
     */
    async clearStoredPassword(profileName: string): Promise<void> {
        if (!this.context) {
            throw new Error('Extension context not available for password management');
        }

        const storageKey = `sqlProfiler.password.${profileName}`;

        try {
            await this.context.secrets.delete(storageKey);
            console.log(`🔐 Securely cleared stored password for ${profileName}`);
            Logger.info(`Stored password cleared for connection profile: ${profileName}`);
        } catch (error) {
            console.error('Failed to clear stored password:', error);
            Logger.error(`Failed to clear stored password for ${profileName}`, error);
            throw new Error(`Failed to clear stored password for ${profileName}: ${error}`);
        }
    }

    /**
     * Lists all connection profiles that have stored passwords
     */
    async getConnectionsWithStoredPasswords(): Promise<string[]> {
        if (!this.context) {
            return [];
        }

        const connections = this.getMssqlConnections();
        const connectionsWithPasswords: string[] = [];

        for (const connection of connections) {
            if (connection.authenticationType === 'SqlLogin') {
                const storageKey = `sqlProfiler.password.${connection.profileName}`;
                try {
                    const storedPassword = await this.context.secrets.get(storageKey);
                    if (storedPassword) {
                        connectionsWithPasswords.push(connection.profileName);
                    }
                } catch (error) {
                    // Ignore errors when checking for stored passwords
                }
            }
        }

        return connectionsWithPasswords;
    }

    /**
     * Clears all stored passwords for all connections
     */
    async clearAllStoredPasswords(): Promise<void> {
        const connectionsWithPasswords = await this.getConnectionsWithStoredPasswords();

        for (const profileName of connectionsWithPasswords) {
            await this.clearStoredPassword(profileName);
        }

        Logger.info(`Cleared stored passwords for ${connectionsWithPasswords.length} connection profiles`);
    }

    /**
     * Connects using the selected mssql profile with connection pooling
     */
    private async connectUsingPool(): Promise<void> {
        const selectedProfile = this.getSelectedConnectionName();
        console.log(`Getting connection pool for profile: ${selectedProfile}`);

        if (!selectedProfile) {
            throw new Error('No connection profile selected. Please select a connection first.');
        }

        const connections = this.getMssqlConnections();
        console.log(`Available connections: ${connections.map(c => c.profileName).join(', ')}`);

        const connection = connections.find(conn => conn.profileName === selectedProfile);

        if (!connection) {
            throw new Error(`Connection profile '${selectedProfile}' not found in mssql.connections`);
        }

        console.log(`Found connection: ${connection.server}, auth: ${connection.authenticationType}`);

        // Auto-correct Azure SQL server format if needed
        const serverCorrection = this.correctAzureSqlServerFormat(connection.server);
        if (serverCorrection.wasChanged) {
            Logger.info(`Server name corrected: ${connection.server} → ${serverCorrection.corrected}`);
            console.log(`Server name auto-corrected: ${connection.server} → ${serverCorrection.corrected}`);
        }

        // Get pool configuration from VS Code settings
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const poolConfig = config.get<VSCodePoolConfig>('connectionPool') || {} as VSCodePoolConfig;

        // Convert mssql connection to PoolConfig format
        const sqlConfig: PoolConfig = {
            server: serverCorrection.corrected,
            database: connection.database || 'master',
            port: connection.port || 1433,
            encrypt: connection.encrypt !== undefined ? Boolean(connection.encrypt) : serverCorrection.corrected.includes('.database.windows.net'),
            trustServerCertificate: Boolean(this.getTrustServerCertificateSetting(connection)),
            poolName: `profiler_${selectedProfile}`,
            maxConnections: poolConfig.maxConnections || 5,
            minConnections: poolConfig.minConnections || 2,
            idleTimeout: poolConfig.idleTimeout || 60000,
            acquireTimeout: poolConfig.acquireTimeout || 30000,
            createTimeout: poolConfig.createTimeout || 30000
        };

        if (connection.authenticationType === 'Integrated') {
            sqlConfig.options = {
                trustedConnection: true
            };
        } else {
            // For SQL Authentication, handle password
            sqlConfig.user = connection.user;

            // If password is not in config, prompt for it
            if (!connection.password) {
                const password = await this.promptForPassword(connection.profileName, connection.user || '');
                if (!password) {
                    throw new Error('Password is required for SQL Server authentication');
                }
                sqlConfig.password = password;
            } else {
                sqlConfig.password = connection.password;
            }
        }

        console.log(`Creating/getting connection pool for: ${sqlConfig.server}:${sqlConfig.port}`);
        Logger.info('Pool configuration', {
            server: sqlConfig.server,
            database: sqlConfig.database,
            maxConnections: sqlConfig.maxConnections,
            minConnections: sqlConfig.minConnections,
            idleTimeout: sqlConfig.idleTimeout
        });

        try {
            // 🚀 Usar AutoReconnectManager para conexión con reconexión automática
            const result = await this.autoReconnectManager.getPoolWithReconnect(sqlConfig);
            this.pool = result.pool;
            this.currentPoolKey = this.poolManager.getActivePoolKeys().find(key =>
                key.includes(selectedProfile.replace(/[^a-zA-Z0-9_]/g, '_'))
            );

            // Store current connection for diagnostics
            this.currentConnection = connection;

            Logger.info('Successfully connected using connection pool with auto-reconnect', {
                poolKey: this.currentPoolKey,
                connected: this.pool?.connected || false,
                wasReconnected: result.wasReconnected
            });

            if (result.wasReconnected) {
                vscode.window.showInformationMessage(
                    `SQL Profiler: Connection recovered automatically for ${selectedProfile}`
                );
            }
        } catch (error) {
            Logger.errorSilent('Failed to get connection pool with auto-reconnect:', error);
            throw error;
        }
    }

    /**
     * Connects using connection string with pooling
     */
    private async connectUsingConnectionStringPool(sqlConfig: sql.config): Promise<void> {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const poolConfig = config.get<VSCodePoolConfig>('connectionPool') || {} as VSCodePoolConfig;

        const sqlConfigAny = sqlConfig as any;
        const poolConfigWithDefaults: PoolConfig = {
            server: sqlConfig.server,
            database: sqlConfig.database,
            user: sqlConfig.user,
            password: sqlConfig.password,
            port: sqlConfig.port,
            encrypt: sqlConfigAny.encrypt !== undefined ? Boolean(sqlConfigAny.encrypt) : false,
            trustServerCertificate: sqlConfigAny.trustServerCertificate !== undefined ? Boolean(sqlConfigAny.trustServerCertificate) : true,
            options: sqlConfig.options,
            poolName: 'profiler_connectionString',
            maxConnections: poolConfig.maxConnections || 5,
            minConnections: poolConfig.minConnections || 2,
            idleTimeout: poolConfig.idleTimeout || 60000,
            acquireTimeout: poolConfig.acquireTimeout || 30000,
            createTimeout: poolConfig.createTimeout || 30000
        };

        console.log(`Creating/getting connection pool for connection string: ${poolConfigWithDefaults.server}`);
        Logger.info('Pool configuration from connection string', {
            server: poolConfigWithDefaults.server,
            database: poolConfigWithDefaults.database,
            maxConnections: poolConfigWithDefaults.maxConnections,
            minConnections: poolConfigWithDefaults.minConnections
        });

        try {
            // 🚀 Usar AutoReconnectManager para conexión con reconexión automática
            const result = await this.autoReconnectManager.getPoolWithReconnect(poolConfigWithDefaults);
            this.pool = result.pool;
            this.currentPoolKey = 'profiler_connectionString_' + (poolConfigWithDefaults.server || 'localhost');

            Logger.info('Successfully connected using connection string pool with auto-reconnect', {
                poolKey: this.currentPoolKey,
                connected: this.pool?.connected || false,
                wasReconnected: result.wasReconnected
            });

            if (result.wasReconnected) {
                vscode.window.showInformationMessage(
                    `SQL Profiler: Connection recovered automatically for ${poolConfigWithDefaults.server}`
                );
            }
        } catch (error) {
            Logger.errorSilent('Failed to get connection string pool with auto-reconnect:', error);
            throw error;
        }
    }

    /**
     * Gets current pool statistics
     */
    getPoolStats(): PoolStats | null {
        if (!this.currentPoolKey) {
            return null;
        }
        return this.poolManager.getPoolStats(this.currentPoolKey);
    }

    /**
     * Gets statistics for all active pools
     */
    getAllPoolStats(): PoolStats[] {
        return this.poolManager.getAllPoolStats();
    }

    /**
     * Performs health check on the current pool
     */
    async performHealthCheck(): Promise<boolean> {
        if (!this.currentPoolKey) {
            return false;
        }

        const health = await this.poolManager.healthCheck();
        return health[this.currentPoolKey] || false;
    }

    /**
     * Obtiene estadísticas completas del sistema de reconexión
     */
    getReconnectStats(): any {
        if (!this.currentPoolKey) {
            return null;
        }
        return this.autoReconnectManager.getReconnectStats(this.currentPoolKey);
    }

    /**
     * Obtiene estadísticas de todos los pools de reconexión
     */
    getAllReconnectStats(): any {
        return this.autoReconnectManager.getAllReconnectStats();
    }

    /**
     * Fuerza el cierre del circuit breaker para el pool actual
     */
    forceResetCircuitBreaker(): void {
        if (this.currentPoolKey) {
            this.autoReconnectManager.forceCloseCircuitBreaker(this.currentPoolKey);
            Logger.info(`Circuit breaker manually reset for ${this.currentPoolKey}`);
        }
    }

    /**
     * Actualiza la configuración de reconexión automática
     */
    updateAutoReconnectConfig(config: any): void {
        this.autoReconnectManager.updateConfig(config);
        Logger.info('Auto-reconnect configuration updated', config);
    }

    /**
     * Obtiene información detallada del estado de la conexión
     */
    getConnectionStatus(): {
        isConnected: boolean;
        poolKey?: string;
        poolStats?: PoolStats | null;
        reconnectStats?: any;
        databaseType?: string;
        lastHealthCheck?: Date;
    } {
        const poolStats = this.getPoolStats();
        const reconnectStats = this.getReconnectStats();

        return {
            isConnected: this.pool?.connected || false,
            poolKey: this.currentPoolKey,
            poolStats,
            reconnectStats,
            databaseType: this.currentPoolKey ?
                (this.databaseTypeCache.get(this.currentPoolKey)?.isAzure ? 'Azure SQL Database' : 'SQL Server')
                : undefined,
            lastHealthCheck: new Date()
        };
    }

    /**
     * Closes all connection pools (useful for cleanup)
     */
    async closeAllPools(): Promise<void> {
        await this.poolManager.closeAllPools();
        this.pool = undefined;
        this.currentPoolKey = undefined;
    }

    /**
     * Diagnose Azure SQL Database connection issues
     */
    async diagnoseAzureSQLConnection(connection?: MssqlConnection): Promise<void> {
        try {
            Logger.info('🔍 Starting Azure SQL Database connection diagnosis...');

            const conn = connection || this.currentConnection;
            if (!conn) {
                vscode.window.showErrorMessage('No connection available for diagnosis. Please configure a connection first.');
                return;
            }

            vscode.window.showInformationMessage('Running Azure SQL diagnostics... This may take a few moments.');

            const diagnosticResults = {
                serverFormat: this.analyzeServerFormat(conn.server),
                portConfiguration: this.analyzePortConfiguration(conn),
                encryptionSettings: this.analyzeEncryptionSettings(conn),
                authenticationMethod: this.analyzeAuthentication(conn),
                networkConnectivity: await this.testNetworkConnectivity(conn),
                azureSQLSpecific: await this.testAzureSQLSpecific(conn)
            };

            // Show diagnosis results in a readable format
            const diagnosticReport = this.formatDiagnosticReport(diagnosticResults);

            // Create and show diagnostic results in a new document
            const doc = await vscode.workspace.openTextDocument({
                content: diagnosticReport,
                language: 'markdown'
            });

            await vscode.window.showTextDocument(doc);

            // Also show actionable recommendations
            if (diagnosticResults.serverFormat.hasIssues ||
                diagnosticResults.encryptionSettings.hasIssues ||
                diagnosticResults.networkConnectivity.hasIssues) {
                this.showDiagnosticRecommendations(diagnosticResults);
            } else {
                vscode.window.showInformationMessage('✅ Azure SQL diagnostics completed successfully - no critical issues found!');
            }

        } catch (error) {
            Logger.error('Error during Azure SQL diagnosis:', error);
            vscode.window.showErrorMessage(`Diagnosis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private analyzeServerFormat(server: string): { hasIssues: boolean; issues: string[]; recommendations: string[] } {
        const issues: string[] = [];
        const recommendations: string[] = [];

        // Check Azure SQL server format
        if (!server.includes('.database.windows.net')) {
            issues.push('Server does not appear to be Azure SQL Database format');
            recommendations.push('Ensure server name ends with .database.windows.net');
        }

        // Check for common format issues
        if (server.includes('tcp:')) {
            issues.push('Server name contains protocol prefix "tcp:"');
            recommendations.push('Remove "tcp:" prefix from server name');
        }

        if (server.includes(',1433') && server.includes('.database.windows.net')) {
            issues.push('Port specified in server name for Azure SQL (not recommended)');
            recommendations.push('Remove port from server name, use port property instead');
        }

        return { hasIssues: issues.length > 0, issues, recommendations };
    }

    private analyzePortConfiguration(conn: MssqlConnection): { hasIssues: boolean; issues: string[]; recommendations: string[] } {
        const issues: string[] = [];
        const recommendations: string[] = [];

        if (conn.port && conn.port !== 1433) {
            issues.push(`Non-standard port ${conn.port} specified for Azure SQL`);
            recommendations.push('Azure SQL Database typically uses port 1433');
        }

        return { hasIssues: issues.length > 0, issues, recommendations };
    }

    private analyzeEncryptionSettings(conn: MssqlConnection): { hasIssues: boolean; issues: string[]; recommendations: string[] } {
        const issues: string[] = [];
        const recommendations: string[] = [];

        if (conn.encrypt === false) {
            issues.push('Encryption is disabled - Azure SQL requires encrypted connections');
            recommendations.push('Set encrypt: true for Azure SQL connections');
        }

        if (!conn.trustServerCertificate && conn.server.includes('.database.windows.net')) {
            issues.push('SSL certificate trust not explicitly configured');
            recommendations.push('Consider setting trustServerCertificate: true for Azure SQL');
        }

        return { hasIssues: issues.length > 0, issues, recommendations };
    }

    private analyzeAuthentication(conn: MssqlConnection): { hasIssues: boolean; issues: string[]; recommendations: string[] } {
        const issues: string[] = [];
        const recommendations: string[] = [];

        if (conn.authenticationType === 'Integrated' && conn.server.includes('.database.windows.net')) {
            issues.push('Integrated authentication not supported for Azure SQL Database');
            recommendations.push('Use SQL Server authentication for Azure SQL Database');
        }

        if (conn.authenticationType === 'SqlLogin' && (!conn.user || !conn.password)) {
            issues.push('SQL Login authentication requires username and password');
            recommendations.push('Ensure both username and password are configured');
        }

        return { hasIssues: issues.length > 0, issues, recommendations };
    }

    private async testNetworkConnectivity(conn: MssqlConnection): Promise<{ hasIssues: boolean; issues: string[]; recommendations: string[] }> {
        const issues: string[] = [];
        const recommendations: string[] = [];

        try {
            const testConfig: any = {
                server: conn.server,
                database: conn.database || 'master',
                user: conn.user,
                password: conn.password,
                port: conn.port || 1433,
                encrypt: true,
                trustServerCertificate: conn.trustServerCertificate || true,
                requestTimeout: 15000,
                connectionTimeout: 15000
            };
            const testPool = new sql.ConnectionPool(testConfig);

            await testPool.connect();
            await testPool.close();
            Logger.info('✅ Network connectivity test passed');

        } catch (error: any) {
            if (error.code === 'ENOTFOUND') {
                issues.push('DNS resolution failed - cannot resolve server name');
                recommendations.push('Check server name spelling and network connectivity');
            } else if (error.code === 'ETIMEDOUT') {
                issues.push('Connection timeout - network or firewall issue');
                recommendations.push('Check firewall settings and Azure SQL firewall rules');
            } else if (error.code === 'ECONNREFUSED') {
                issues.push('Connection refused - server not accepting connections');
                recommendations.push('Verify server is running and port is correct');
            } else if (error.number === 18456) {
                issues.push('Authentication failed - invalid credentials');
                recommendations.push('Verify username and password are correct');
            } else if (error.number === 40615) {
                issues.push('Azure SQL firewall blocking connection');
                recommendations.push('Add your IP address to Azure SQL firewall rules');
            } else {
                issues.push(`Connection error: ${error.message}`);
                recommendations.push('Check Azure SQL configuration and network connectivity');
            }
        }

        return { hasIssues: issues.length > 0, issues, recommendations };
    }

    private async testAzureSQLSpecific(conn: MssqlConnection): Promise<{ hasIssues: boolean; issues: string[]; recommendations: string[] }> {
        const issues: string[] = [];
        const recommendations: string[] = [];

        try {
            const azureConfig: any = {
                server: conn.server,
                database: conn.database || 'master',
                user: conn.user,
                password: conn.password,
                port: conn.port || 1433,
                encrypt: true,
                trustServerCertificate: true,
                requestTimeout: 30000,
                connectionTimeout: 30000
            };
            const azurePool = new sql.ConnectionPool(azureConfig);

            await azurePool.connect();
            const result = await azurePool.request().query('SELECT @@VERSION as version, DB_NAME() as database_name');

            if (result.recordset.length > 0) {
                Logger.info('✅ Azure SQL specific test passed');
            }

            await azurePool.close();

        } catch (error: any) {
            issues.push(`Azure SQL test failed: ${error.message}`);
            if (error.number === 18456) {
                recommendations.push('Check credentials and user permissions');
            } else if (error.number === 40615) {
                recommendations.push('Configure Azure SQL firewall to allow your IP');
            } else {
                recommendations.push('Verify Azure SQL Database configuration');
            }
        }

        return { hasIssues: issues.length > 0, issues, recommendations };
    }

    private formatDiagnosticReport(results: any): string {
        const timestamp = new Date().toISOString();

        return `# Azure SQL Database Connection Diagnosis Report
Generated: ${timestamp}

## Summary
This report analyzes your Azure SQL Database connection and tests connectivity.

${this.formatDiagnosticSection('Server Configuration', results.serverFormat)}
${this.formatDiagnosticSection('Port Settings', results.portConfiguration)}
${this.formatDiagnosticSection('Encryption & SSL', results.encryptionSettings)}
${this.formatDiagnosticSection('Authentication', results.authenticationMethod)}
${this.formatDiagnosticSection('Network Connectivity', results.networkConnectivity)}
${this.formatDiagnosticSection('Azure SQL Tests', results.azureSQLSpecific)}

## Recommended Actions
${this.formatRecommendedActions(results)}

---
*Generated by SQL Server Profiler Tool - Azure SQL Diagnostics*
        `;
    }

    private formatDiagnosticSection(title: string, section: { hasIssues: boolean; issues: string[]; recommendations: string[] }): string {
        let result = `### ${title}\n`;

        if (!section.hasIssues) {
            result += `✅ **Status**: OK\n\n`;
        } else {
            result += `❌ **Status**: Issues found\n\n`;
            result += `**Issues:**\n`;
            section.issues.forEach(issue => result += `- ${issue}\n`);
            result += `\n**Recommendations:**\n`;
            section.recommendations.forEach(rec => result += `- ${rec}\n`);
            result += '\n';
        }

        return result;
    }

    private formatRecommendedActions(results: any): string {
        const allRecommendations: string[] = [];

        Object.values(results).forEach((section: any) => {
            if (section.hasIssues) {
                allRecommendations.push(...section.recommendations);
            }
        });

        if (allRecommendations.length === 0) {
            return '✅ No action required - All tests passed successfully.\n';
        }

        let actions = '';
        allRecommendations.forEach((action, index) => {
            actions += `${index + 1}. ${action}\n`;
        });

        return actions;
    }

    private showDiagnosticRecommendations(results: any): void {
        const criticalIssues: string[] = [];

        if (results.networkConnectivity.hasIssues) {
            criticalIssues.push('Network connectivity');
        }
        if (results.encryptionSettings.hasIssues) {
            criticalIssues.push('Encryption settings');
        }
        if (results.serverFormat.hasIssues) {
            criticalIssues.push('Server format');
        }

        if (criticalIssues.length > 0) {
            vscode.window.showWarningMessage(
                `Found ${criticalIssues.length} issue(s): ${criticalIssues.join(', ')}. Check the diagnostic report for details.`,
                'View Report'
            );
        }
    }

    dispose(): void {
        if (this.isProfilering) {
            this.stopProfiling();
        }
        // Note: We don't close pools here as they might be used by other instances
        // Pools will be cleaned up when the extension is deactivated
    }
}