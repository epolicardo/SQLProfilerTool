import * as sql from 'mssql';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ConnectionPoolManager, PoolConfig, PoolStats } from '../database/ConnectionPoolManager';

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
    private currentPoolKey: string | undefined;
    private isProfilering = false;
    private sessionName = 'VSCodeProfilerSession';
    private results: ProfilerEvent[] = [];
    private pollingInterval: any | undefined;
    private context: vscode.ExtensionContext | undefined;

    constructor(context?: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        this.sessionName = config.get<string>('sessionName') || 'VSCodeProfilerSession';
        this.context = context;
        this.poolManager = ConnectionPoolManager.getInstance();
    }

    async startProfiling(): Promise<void> {
        if (this.isProfilering) {
            throw new Error('Profiling is already running');
        }

        try {
            Logger.info('Starting profiling...');

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

            // Create Extended Events session
            console.log('Creating Extended Events session...');
            await this.createXESession();

            // Start the session
            console.log('Starting Extended Events session...');
            await this.startXESession();

            this.isProfilering = true;

            // Start polling for results
            console.log('Starting polling for results...');
            this.startPolling();

            Logger.info('Profiling started successfully!');

        } catch (error) {
            this.isProfilering = false;
            Logger.error('Failed to start profiling', error);
            throw error;
        }
    }

    async stopProfiling(): Promise<void> {
        if (!this.isProfilering) {
            return;
        }

        this.isProfilering = false;

        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        if (this.pool) {
            try {
                // Stop and drop the XE session
                await this.stopXESession();
                await this.dropXESession();
            } catch (error) {
                console.error('Error stopping XE session:', error);
            }

            // Note: We don't close the pool here as it's managed by the pool manager
            // and may be reused by other operations
            this.pool = undefined;
            this.currentPoolKey = undefined;
        }
    }

    private async isAzureSqlDatabase(): Promise<boolean> {
        if (!this.pool) {
            return false;
        }

        try {
            // Multiple checks to determine if this is Azure SQL Database
            const versionResult = await this.pool.request().query('SELECT @@VERSION as version');
            const version = versionResult.recordset[0]?.version || '';

            // Check 1: Look for Azure in version string
            if (version.toLowerCase().includes('azure')) {
                Logger.info('Detected Azure SQL Database from version string');
                return true;
            }

            // Check 2: Try to query a server-scoped view (will fail on Azure SQL DB)
            try {
                await this.pool.request().query('SELECT TOP 1 1 FROM sys.server_event_sessions');
                Logger.info('Detected SQL Server (on-premise/managed instance) - server views accessible');
                return false;
            } catch (serverViewError) {
                Logger.info('Server views not accessible - likely Azure SQL Database');
                return true;
            }

        } catch (error) {
            Logger.error('Error detecting database type:', error);
            // Default to Azure SQL Database for safety (most restrictive)
            Logger.info('Defaulting to Azure SQL Database due to detection error');
            return true;
        }
    }

    private async diagnoseSystemViews(): Promise<void> {
        if (!this.pool) {
            return;
        }

        Logger.info('=== DIAGNOSING SYSTEM VIEWS AVAILABILITY ===');

        const viewsToTest = [
            'sys.server_event_sessions',
            'sys.dm_xe_sessions',
            'sys.dm_xe_session_targets',
            'sys.database_event_sessions',
            'sys.dm_xe_database_sessions',
            'sys.dm_xe_database_session_targets'
        ];

        for (const view of viewsToTest) {
            try {
                await this.pool.request().query(`SELECT TOP 1 1 FROM ${view}`);
                Logger.info(`✓ View accessible: ${view}`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                Logger.info(`✗ View NOT accessible: ${view} - ${errorMsg}`);
            }
        }
        Logger.info('=== END SYSTEM VIEWS DIAGNOSIS ===');
    } private async createXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        // Detect if we're on Azure SQL Database vs SQL Server
        const isAzure = await this.isAzureSqlDatabase();

        let createSessionQuery: string;

        if (isAzure) {
            // Azure SQL Database uses database-scoped Extended Events
            createSessionQuery = `
                -- Drop existing session if it exists (database-scoped)
                IF EXISTS (SELECT * FROM sys.database_event_sessions WHERE name = '${this.sessionName}')
                    DROP EVENT SESSION [${this.sessionName}] ON DATABASE;

                -- Create new session (database-scoped for Azure SQL)
                CREATE EVENT SESSION [${this.sessionName}] ON DATABASE
                ADD EVENT sqlserver.rpc_completed(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
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
                ),
                ADD EVENT sqlserver.sp_statement_starting(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE ([duration] > 0)
                ),
                ADD EVENT sqlserver.sp_statement_completed(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE ([duration] > 0)
                )
                ADD TARGET package0.ring_buffer(SET max_events_limit=(2000))
                WITH (STARTUP_STATE=OFF, EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS);
            `;
        } else {
            // SQL Server uses server-scoped Extended Events
            createSessionQuery = `
                -- Drop existing session if it exists (server-scoped)
                IF EXISTS (SELECT * FROM sys.server_event_sessions WHERE name = '${this.sessionName}')
                    DROP EVENT SESSION [${this.sessionName}] ON SERVER;

                -- Create new session (server-scoped for SQL Server)
                CREATE EVENT SESSION [${this.sessionName}] ON SERVER
                ADD EVENT sqlserver.rpc_completed(
                    SET collect_statement=(1)
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
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
                ),
                ADD EVENT sqlserver.sp_statement_starting(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE ([duration] > 0)
                ),
                ADD EVENT sqlserver.sp_statement_completed(
                    ACTION(
                        sqlserver.client_app_name,
                        sqlserver.database_name,
                        sqlserver.username,
                        sqlserver.session_id,
                        sqlserver.sql_text
                    )
                    WHERE ([duration] > 0)
                )
                ADD TARGET package0.ring_buffer(SET max_events_limit=(2000))
                WITH (STARTUP_STATE=OFF, EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS);
            `;
        }

        const request = this.pool.request();
        await request.query(createSessionQuery);
    }

    private async startXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        const isAzure = await this.isAzureSqlDatabase();
        const scope = isAzure ? 'DATABASE' : 'SERVER';
        const startQuery = `ALTER EVENT SESSION [${this.sessionName}] ON ${scope} STATE = START;`;

        const request = this.pool.request();
        await request.query(startQuery);
    }

    private async stopXESession(): Promise<void> {
        if (!this.pool) {
            return;
        }

        const isAzure = await this.isAzureSqlDatabase();
        const scope = isAzure ? 'DATABASE' : 'SERVER';
        const sessionView = isAzure ? 'sys.database_event_sessions' : 'sys.server_event_sessions';

        const stopQuery = `
            IF EXISTS (SELECT * FROM ${sessionView} WHERE name = '${this.sessionName}')
                ALTER EVENT SESSION [${this.sessionName}] ON ${scope} STATE = STOP;
        `;

        const request = this.pool.request();
        await request.query(stopQuery);
    }

    private async dropXESession(): Promise<void> {
        if (!this.pool) {
            return;
        }

        const isAzure = await this.isAzureSqlDatabase();
        const scope = isAzure ? 'DATABASE' : 'SERVER';
        const sessionView = isAzure ? 'sys.database_event_sessions' : 'sys.server_event_sessions';

        const dropQuery = `
            IF EXISTS (SELECT * FROM ${sessionView} WHERE name = '${this.sessionName}')
                DROP EVENT SESSION [${this.sessionName}] ON ${scope};
        `;

        const request = this.pool.request();
        await request.query(dropQuery);
    }

    private startPolling(): void {
        this.pollingInterval = setInterval(async () => {
            await this.collectResults();
        }, 2000); // Poll every 2 seconds
    }

    private async testBasicEventCapture(): Promise<void> {
        if (!this.pool) {
            return;
        }

        try {
            // First, let's diagnose what views are available
            await this.diagnoseSystemViews();

            const isAzure = await this.isAzureSqlDatabase();
            const sessionView = isAzure ? 'sys.dm_xe_database_sessions' : 'sys.dm_xe_sessions';
            const sessionTargetView = isAzure ? 'sys.dm_xe_database_session_targets' : 'sys.dm_xe_session_targets';

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
            const result = await this.pool.request().query(testQuery);

            if (result.recordset.length > 0) {
                const record = result.recordset[0];
                console.log('Target data length:', record.data_length);

                if (record.raw_target_data && record.data_length > 0) {
                    const xml = record.raw_target_data.toString();
                    console.log('XML preview (first 1000 chars):', xml.substring(0, 1000));

                    // Count events in XML
                    const eventMatches = xml.match(/<event[^>]*>/g);
                    console.log('Number of events found in XML:', eventMatches ? eventMatches.length : 0);
                } else {
                    console.log('No XML data in target');
                }
            } else {
                console.log('No target data found - Extended Events session may not be capturing data');

                // Check if session exists and is running
                const sessionCheckQuery = `
                    SELECT name, create_time, 
                           CASE WHEN s.address IS NOT NULL THEN 'Running' ELSE 'Stopped' END as status
                    FROM ${sessionView} s
                    WHERE name = '${this.sessionName}'
                `;
                const sessionResult = await this.pool.request().query(sessionCheckQuery);
                console.log('Session status:', sessionResult.recordset);
            }

        } catch (error) {
            console.error('Basic event capture test failed:', error);
        }
    }

    private async collectResults(): Promise<void> {
        if (!this.pool || !this.isProfilering) {
            return;
        }

        try {
            // Run basic test first time to help with debugging
            if (this.results.length === 0) {
                await this.testBasicEventCapture();
            }

            // Use appropriate views based on database type
            const isAzure = await this.isAzureSqlDatabase();
            const sessionView = isAzure ? 'sys.dm_xe_database_sessions' : 'sys.dm_xe_sessions';
            const sessionTargetView = isAzure ? 'sys.dm_xe_database_session_targets' : 'sys.dm_xe_session_targets';

            const query = `
                SELECT TOP 100
                    event_data.value('(@timestamp)[1]', 'datetime2') AS event_timestamp,
                    event_data.value('(@name)[1]', 'varchar(50)') AS event_name,
                    
                    -- Get statement text - corrected XPath for Extended Events XML structure
                    COALESCE(
                        event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                        event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                        event_data.value('(data[@name="sql_text"]/value)[1]', 'nvarchar(max)'),
                        'No SQL Text Available'
                    ) AS statement_text,
                    
                    -- Duration 
                    ISNULL(event_data.value('(data[@name="duration"]/value)[1]', 'bigint'), 0) AS duration_microseconds,
                    
                    -- Database name from action
                    COALESCE(
                        event_data.value('(action[@name="database_name"]/value)[1]', 'nvarchar(128)'),
                        DB_NAME()
                    ) AS database_name,
                    
                    -- Username from action
                    COALESCE(
                        event_data.value('(action[@name="username"]/value)[1]', 'nvarchar(128)'),
                        event_data.value('(action[@name="server_principal_name"]/value)[1]', 'nvarchar(128)'),
                        SYSTEM_USER
                    ) AS username,
                    
                    -- Application name from action
                    COALESCE(
                        event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
                        'Unknown Application'
                    ) AS application_name
                    
                FROM (
                    SELECT CAST(target_data AS XML) AS target_data
                    FROM ${sessionTargetView} AS t 
                    JOIN ${sessionView} AS s ON s.address = t.event_session_address
                    WHERE s.name = '${this.sessionName}' 
                      AND t.target_name = 'ring_buffer'
                ) AS data
                CROSS APPLY target_data.nodes('RingBufferTarget/event') AS events(event_data)
                WHERE event_data.value('(@timestamp)[1]', 'datetime2') IS NOT NULL
                  ${this.getAntiRecursionFilters()}
                ORDER BY event_timestamp DESC;
            `;

            // 🔧 Create request with extended timeout for Extended Events queries
            const request = this.pool.request();
            (request as any).timeout = 60000; // 60 seconds timeout for XE queries
            let result;

            try {
                console.log('=== EXECUTING MAIN XE QUERY ===');
                console.log('Query timeout set to: 60000ms for Extended Events');
                result = await request.query(query);
                console.log('Main query succeeded with', result.recordset.length, 'records');
            } catch (queryError: any) {
                console.error('=== MAIN XE QUERY FAILED ===');
                console.error('Error message:', queryError.message);
                console.error('Error number:', queryError.number);
                console.error('Error details:', queryError);

                // Try to get raw XML first to diagnose the structure
                try {
                    const xmlQuery = `
                        SELECT TOP 1
                            CAST(target_data AS nvarchar(max)) AS xml_text,
                            LEN(CAST(target_data AS nvarchar(max))) AS xml_length
                        FROM ${sessionTargetView} AS t 
                        JOIN ${sessionView} AS s ON s.address = t.event_session_address
                        WHERE s.name = '${this.sessionName}' AND t.target_name = 'ring_buffer'
                    `;

                    const xmlResult = await this.pool.request().query(xmlQuery);
                    if (xmlResult.recordset.length > 0) {
                        console.log('Raw XML length:', xmlResult.recordset[0].xml_length);
                        console.log('Raw XML sample (first 2000 chars):', xmlResult.recordset[0].xml_text.substring(0, 2000));
                    }
                } catch (xmlError) {
                    console.error('Could not retrieve XML:', xmlError);
                }

                // Fallback to simpler query 
                console.log('Trying simplified fallback query...');
                const simpleQuery = `
                    SELECT TOP 50
                        event_data.value('(@name)[1]', 'varchar(100)') AS event_name,
                        event_data.value('(@timestamp)[1]', 'datetime2') AS event_timestamp,
                        COALESCE(
                            event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                            event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                            'Fallback - No SQL Text'
                        ) AS statement_text,
                        ISNULL(event_data.value('(data[@name="duration"]/value)[1]', 'bigint'), 0) AS duration_microseconds,
                        DB_NAME() AS database_name,
                        SYSTEM_USER AS username,
                        'Extended Events Fallback' AS application_name
                    FROM (
                        SELECT CAST(target_data AS XML) AS target_data
                        FROM ${sessionTargetView} AS t 
                        JOIN ${sessionView} AS s ON s.address = t.event_session_address
                        WHERE s.name = '${this.sessionName}' AND t.target_name = 'ring_buffer'
                    ) AS data
                    CROSS APPLY target_data.nodes('RingBufferTarget/event') AS events(event_data)
                    WHERE event_data.value('(@timestamp)[1]', 'datetime2') IS NOT NULL
                      ${this.getAntiRecursionFilters()}
                    ORDER BY event_timestamp DESC
                `;

                // 🔧 Create fallback request with extended timeout
                const fallbackRequest = this.pool.request();
                (fallbackRequest as any).timeout = 60000; // 60 seconds timeout for fallback XE query
                result = await fallbackRequest.query(simpleQuery);
                console.log('Fallback query succeeded with', result.recordset.length, 'records');
            }

            // Debug logging
            console.log(`=== XE RESULTS DEBUG ===`);
            console.log(`Query returned ${result.recordset.length} records`);

            if (result.recordset.length > 0) {
                const sample = result.recordset[0];
                console.log('Sample record structure:', Object.keys(sample));
                console.log('Sample record values:', {
                    event_timestamp: sample.event_timestamp,
                    event_name: sample.event_name,
                    statement_text: sample.statement_text?.substring(0, 100) + '...',
                    database_name: sample.database_name,
                    username: sample.username,
                    application_name: sample.application_name
                });

                if (sample.raw_xml) {
                    console.log('Raw XML sample (first 500 chars):', sample.raw_xml.substring(0, 500));
                }
            }

            // Convert results to our format
            const newEvents: ProfilerEvent[] = result.recordset.map((record: any, index: number) => {
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
                        raw_event_name: record.event_name,
                        raw_statement: record.statement_text?.substring(0, 100),
                        raw_database: record.database_name,
                        raw_username: record.username,
                        raw_app_name: record.application_name,
                        mapped_event: event
                    });
                }

                return event;
            });

            // Add only new events (simple deduplication based on timestamp and statement)
            const existingKeys = new Set(this.results.map(e => `${e.timestamp}_${e.statement}`));
            const filteredNewEvents = newEvents.filter(e =>
                !existingKeys.has(`${e.timestamp}_${e.statement}`)
            );

            this.results.unshift(...filteredNewEvents);

            // Limit results to avoid memory issues
            const config = vscode.workspace.getConfiguration('sqlProfiler');
            const maxEvents = config.get<number>('maxEvents') || 1000;
            if (this.results.length > maxEvents) {
                this.results = this.results.slice(0, maxEvents);
            }

        } catch (error) {
            console.error('Error collecting results:', error);
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
            if (!part.trim()) continue;

            const [key, value] = part.split('=');
            if (!key || !value) continue;

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
        return [...this.results];
    }

    clearResults(): void {
        this.results = [];
    }

    isRunning(): boolean {
        return this.isProfilering;
    }

    /**
     * Generates a unique ID for an event
     */
    private generateEventId(event: Partial<ProfilerEvent>): string {
        const timestamp = new Date(event.timestamp || Date.now()).getTime();
        const content = `${event.statement || ''}_${event.userName || ''}_${event.databaseName || ''}`;
        const hash = this.simpleHash(content);
        return `evt_${timestamp}_${hash}`;
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
     * 🛡️ Generates SQL filter conditions to exclude profiler's own queries
     * This prevents recursive capture of our extension's internal queries
     * 
     * Filters out:
     * - Extension's own queries (application name + session name)
     * - Connection validation queries (SELECT 1, SELECT @@VERSION)
     * - Extended Events maintenance queries
     * - Common health check patterns
     */
    private getAntiRecursionFilters(): string {
        const appNameFilter = `
            COALESCE(
                event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
                'Unknown Application'
            ) NOT LIKE '%SQL Profiler Tool%'`;

        const sessionNameFilter = `
            COALESCE(
                event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
                event_data.value('(data[@name="sql_text"]/value)[1]', 'nvarchar(max)'),
                ''
            ) NOT LIKE '%VSCodeProfilerSession%'`;

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
            ) NOT LIKE '%RingBufferTarget%'`;

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

        return `AND ${appNameFilter} AND ${sessionNameFilter} ${additionalFilters} ${connectionTestFilters}`;
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
                    Logger.error('Connection failed even with corrected Azure SQL server format', retryError);
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
                    Logger.error('Connection failed even with trustServerCertificate: true', retryError);
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

        try {
            // Test basic SELECT permissions
            const request = this.pool.request();
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

        try {
            const request = this.pool.request();
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
            this.pool = await this.poolManager.getPool(sqlConfig);
            this.currentPoolKey = this.poolManager.getActivePoolKeys().find(key =>
                key.includes(selectedProfile.replace(/[^a-zA-Z0-9_]/g, '_'))
            );

            Logger.info('Successfully connected using connection pool', {
                poolKey: this.currentPoolKey,
                connected: this.pool.connected
            });
        } catch (error) {
            Logger.error('Failed to get connection pool:', error);
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
            this.pool = await this.poolManager.getPool(poolConfigWithDefaults);
            this.currentPoolKey = 'profiler_connectionString_' + (poolConfigWithDefaults.server || 'localhost');

            Logger.info('Successfully connected using connection string pool', {
                poolKey: this.currentPoolKey,
                connected: this.pool.connected
            });
        } catch (error) {
            Logger.error('Failed to get connection string pool:', error);
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
     * Closes all connection pools (useful for cleanup)
     */
    async closeAllPools(): Promise<void> {
        await this.poolManager.closeAllPools();
        this.pool = undefined;
        this.currentPoolKey = undefined;
    }

    dispose(): void {
        if (this.isProfilering) {
            this.stopProfiling();
        }
        // Note: We don't close pools here as they might be used by other instances
        // Pools will be cleaned up when the extension is deactivated
    }
}