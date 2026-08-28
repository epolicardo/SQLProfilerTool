import * as sql from 'mssql';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { Logger } from '../utils/Logger';

export interface MssqlConnection {
    profileName: string;
    server: string;
    database?: string;
    user?: string;
    authenticationType: 'SqlLogin' | 'Integrated';
    port?: number;
    encrypt?: boolean;
    trustServerCertificate?: boolean;
}

export interface ProfilerEvent {
    timestamp: string;
    eventName: string;
    statement: string;
    duration?: number;
    databaseName?: string;
    userName?: string;
    applicationName?: string;
}

export class SqlProfilerManager {
    private pool: sql.ConnectionPool | undefined;
    private isProfilering = false;
    private hasOwnedSession = false;
    private sessionName: string;
    private readonly profilerApplicationName = 'VS Code SQL Profiler';
    private results: ProfilerEvent[] = [];
    private readonly seenEventKeys = new Set<string>();
    private pollingInterval: any | undefined;
    private isCollectingResults = false;
    private startOperation: Promise<void> | undefined;
    private stopOperation: Promise<void> | undefined;
    private context: vscode.ExtensionContext | undefined;
    // Cached per-connection engine detection. The database engine type cannot
    // change during the lifetime of a connection, so `@@VERSION` is queried
    // exactly once and reused by every Extended Events lifecycle/polling method.
    private isAzureCache: boolean | undefined;

    constructor(context?: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const sessionNamePrefix = config.get<string>('sessionName') || 'VSCodeProfilerSession';
        this.sessionName = this.createSessionName(sessionNamePrefix);
        this.context = context;
    }

    private createSessionName(prefix: string): string {
        const suffix = randomUUID().replace(/-/g, '');
        return `${prefix.substring(0, 95)}_${suffix}`;
    }

    async startProfiling(): Promise<void> {
        if (this.isProfilering || this.startOperation) {
            throw new Error('Profiling is already running or starting');
        }

        const operation = this.startProfilingInternal();
        this.startOperation = operation;

        try {
            await operation;
        } finally {
            if (this.startOperation === operation) {
                this.startOperation = undefined;
            }
        }
    }

    private async startProfilingInternal(): Promise<void> {
        this.validateSessionName();
        this.seenEventKeys.clear();

        try {
            Logger.info('Starting profiling...');

            // Try to connect using selected mssql profile first
            const selectedProfile = this.getSelectedConnectionName();
            Logger.debug('Resolving connection', { hasSelectedProfile: !!selectedProfile });

            if (selectedProfile) {
                await this.connectUsingSelectedProfile();
                Logger.debug('Connected using mssql profile');
            } else {
                const connectionString = await this.getConnectionString();

                if (!connectionString) {
                    throw new Error('No connection configured. Please select an mssql connection or provide a connection string.');
                }

                // Parse connection string and create config
                const sqlConfig = this.parseConnectionString(connectionString);
                sqlConfig.options = {
                    ...sqlConfig.options,
                    appName: this.profilerApplicationName
                };

                this.pool = new sql.ConnectionPool(sqlConfig);
                await this.pool.connect();
                Logger.debug('Connected using connection string');
            }

            // Create Extended Events session
            await this.createXESession();
            this.hasOwnedSession = true;

            // Start the session
            await this.startXESession();

            this.isProfilering = true;

            // Start polling for results
            this.startPolling();

            Logger.info('Profiling started successfully!');

        } catch (error) {
            await this.cleanupProfilerResources();
            Logger.error('Failed to start profiling', error);
            throw error;
        }
    }

    private async getConnectionString(): Promise<string | undefined> {
        const storageKey = 'sqlProfiler.connectionString';
        const storedConnectionString = await this.context?.secrets.get(storageKey);
        if (storedConnectionString) {
            return storedConnectionString;
        }

        const config = vscode.workspace.getConfiguration('sqlProfiler');
        const legacyConnectionString = config.get<string>('connectionString');
        if (legacyConnectionString) {
            if (this.context) {
                await this.context.secrets.store(storageKey, legacyConnectionString);
                const connectionStringConfig = config.inspect<string>('connectionString');
                if (connectionStringConfig?.workspaceFolderValue !== undefined) {
                    await config.update('connectionString', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
                }
                if (connectionStringConfig?.workspaceValue !== undefined) {
                    await config.update('connectionString', undefined, vscode.ConfigurationTarget.Workspace);
                }
                if (connectionStringConfig?.globalValue !== undefined) {
                    await config.update('connectionString', undefined, vscode.ConfigurationTarget.Global);
                }
                vscode.window.showInformationMessage('The connection string was moved to VS Code SecretStorage.');
            }
            return legacyConnectionString;
        }

        const connectionString = await vscode.window.showInputBox({
            prompt: 'Enter SQL Server connection string',
            placeHolder: 'Server=localhost;Database=master;Integrated Security=true;',
            password: true,
            ignoreFocusOut: true
        });

        if (!connectionString) {
            return undefined;
        }

        if (this.context) {
            await this.context.secrets.store(storageKey, connectionString);
        }

        return connectionString;
    }

    private validateSessionName(): void {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(this.sessionName)) {
            throw new Error('The Extended Events session name must start with a letter or underscore and contain only letters, numbers, or underscores (maximum 128 characters).');
        }
    }

    async stopProfiling(): Promise<void> {
        if (this.stopOperation) {
            await this.stopOperation;
            return;
        }

        const operation = this.stopProfilingInternal();
        this.stopOperation = operation;

        try {
            await operation;
        } finally {
            if (this.stopOperation === operation) {
                this.stopOperation = undefined;
            }
        }
    }

    private async stopProfilingInternal(): Promise<void> {
        const startOperation = this.startOperation;
        if (startOperation) {
            await startOperation.catch(() => undefined);
        }

        await this.cleanupProfilerResources();
    }

    private async cleanupProfilerResources(): Promise<void> {
        this.isProfilering = false;
        this.isAzureCache = undefined;

        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = undefined;
        }

        if (this.pool) {
            try {
                if (this.hasOwnedSession) {
                    await this.stopXESession();
                    await this.dropXESession();
                    this.hasOwnedSession = false;
                }
            } catch (error) {
                Logger.debug('Error stopping XE session', error);
            } finally {
                await this.pool.close();
                this.pool = undefined;
            }
        }
    }

    private async isAzureSqlDatabase(): Promise<boolean> {
        if (this.isAzureCache !== undefined) {
            return this.isAzureCache;
        }

        if (!this.pool) {
            return false;
        }

        try {
            // EngineEdition is the reliable discriminator:
            //   5 = Azure SQL Database (database-scoped Extended Events)
            //   8 = Azure SQL Managed Instance (server-scoped, like box SQL Server)
            //   others = box SQL Server / Azure SQL Edge (server-scoped)
            const result = await this.pool.request().query(
                'SELECT CAST(SERVERPROPERTY(\'EngineEdition\') AS int) AS engineEdition'
            );
            const engineEdition = Number(result.recordset[0]?.engineEdition) || 0;
            this.isAzureCache = engineEdition === 5;
        } catch (error) {
            Logger.error('Error detecting database type', error);
            this.isAzureCache = false; // Assume box SQL Server if detection fails
        }

        return this.isAzureCache;
    }

    private async createXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        // Detect if we're on Azure SQL Database vs SQL Server
        const isAzure = await this.isAzureSqlDatabase();

        let createSessionQuery: string;

        if (isAzure) {
            // Azure SQL Database uses database-scoped Extended Events
            createSessionQuery = `
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
                    WHERE ([duration] > 0 AND [sqlserver].[client_app_name] <> N'VS Code SQL Profiler')
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
                    WHERE ([duration] > 0 AND [sqlserver].[client_app_name] <> N'VS Code SQL Profiler')
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
                    WHERE ([duration] > 1000 AND [sqlserver].[client_app_name] <> N'VS Code SQL Profiler')
                )
                ADD TARGET package0.ring_buffer(SET max_events_limit=(2000))
                WITH (STARTUP_STATE=OFF, EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS);
            `;
        } else {
            // SQL Server uses server-scoped Extended Events
            createSessionQuery = `
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
                    WHERE ([duration] > 0 AND [sqlserver].[client_app_name] <> N'VS Code SQL Profiler')
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
                    WHERE ([duration] > 0 AND [sqlserver].[client_app_name] <> N'VS Code SQL Profiler')
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
                    WHERE ([duration] > 1000 AND [sqlserver].[client_app_name] <> N'VS Code SQL Profiler')
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
        this.pollingInterval = setInterval(() => {
            void this.collectResultsSafely();
        }, 2000); // Poll every 2 seconds
    }

    private async collectResultsSafely(): Promise<void> {
        if (this.isCollectingResults) {
            return;
        }

        this.isCollectingResults = true;
        try {
            await this.collectResults();
        } finally {
            this.isCollectingResults = false;
        }
    }

    private async collectResults(): Promise<void> {
        if (!this.pool || !this.isProfilering) {
            return;
        }

        try {
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
                ORDER BY event_timestamp DESC;
            `;

            const request = this.pool.request();
            let result;

            try {
                result = await request.query(query);
                Logger.debug('XE ring-buffer query returned rows', { rows: result.recordset.length });
            } catch (queryError: any) {
                Logger.debug('XE ring-buffer query failed; trying fallback', queryError);

                // Fallback to simpler query
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
                    ORDER BY event_timestamp DESC
                `;

                result = await this.pool.request().query(simpleQuery);
                Logger.debug('XE fallback query returned rows', { rows: result.recordset.length });
            }

            // Convert results to our format
            const newEvents: ProfilerEvent[] = result.recordset.map((record: any) => ({
                timestamp: record.event_timestamp?.toISOString() || new Date().toISOString(),
                eventName: record.event_name || 'Unknown',
                statement: record.statement_text || '',
                duration: record.duration_microseconds ? Math.round(record.duration_microseconds / 1000) : undefined,
                databaseName: record.database_name || 'Unknown',
                userName: record.username || 'Unknown',
                applicationName: record.application_name || 'Unknown'
            }));

            // Defence in depth against self-capture: never surface the profiler's
            // own queries even if the server-side app-name predicate misses.
            const filteredNewEvents = newEvents
                .filter(event => event.applicationName !== this.profilerApplicationName)
                .filter(event => this.rememberEvent(event));

            if (!this.isProfilering) {
                return;
            }

            this.results.unshift(...filteredNewEvents);

            const config = vscode.workspace.getConfiguration('sqlProfiler');
            const configuredMaxEvents = config.get<number>('maxEvents') ?? 1000;
            const maxEvents = Math.min(Math.max(Math.floor(configuredMaxEvents), 1), 10000);
            if (this.results.length > maxEvents) {
                this.results = this.results.slice(0, maxEvents);
            }

        } catch (error) {
            Logger.debug('Error collecting results', error);
        }
    }

    private rememberEvent(event: ProfilerEvent): boolean {
        const eventKey = `${event.timestamp}_${event.eventName}_${event.statement}`;
        if (this.seenEventKeys.has(eventKey)) {
            return false;
        }

        this.seenEventKeys.add(eventKey);
        while (this.seenEventKeys.size > 2000) {
            const oldestKey = this.seenEventKeys.values().next().value;
            if (oldestKey === undefined) {
                break;
            }
            this.seenEventKeys.delete(oldestKey);
        }

        return true;
    }

    private parseConnectionString(connectionString: string): sql.config {
        const config: sql.config = {
            server: 'localhost',
            // Secure defaults: encrypt unless the connection string explicitly
            // opts out, and never trust an unverified server certificate.
            options: {
                encrypt: true,
                trustServerCertificate: false
            }
        };

        const parts = connectionString.split(';');
        for (const part of parts) {
            if (!part.trim()) continue;

            const eq = part.indexOf('=');
            if (eq === -1) continue;
            const key = part.slice(0, eq);
            const value = part.slice(eq + 1);
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
                        encrypt: normalizedValue.toLowerCase() === 'true'
                    };
                    break;
                case 'trust server certificate':
                    config.options = {
                        ...config.options,
                        trustServerCertificate: normalizedValue.toLowerCase() === 'true'
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
     * Gets available mssql connections from VS Code settings
     */
    getMssqlConnections(): MssqlConnection[] {
        const config = vscode.workspace.getConfiguration('mssql');
        const connections = config.get<Record<string, unknown>[]>('connections') || [];

        return connections.map(conn => {
            const mapped: MssqlConnection = {
                profileName: String(conn.profileName || ''),
                server: String(conn.server || ''),
                database: conn.database ? String(conn.database) : '',
                user: conn.user ? String(conn.user) : '',
                authenticationType: conn.authenticationType === 'Integrated' ? 'Integrated' : 'SqlLogin',
                port: typeof conn.port === 'number' ? conn.port : 1433,
                encrypt: conn.encrypt !== false
            };
            // Only carry through an explicit opt-out of certificate validation.
            if (conn.trustServerCertificate === true) {
                mapped.trustServerCertificate = true;
            }
            return mapped;
        });
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
        let corrected = serverName;
        let wasChanged = false;

        // Remove tcp: prefix if present
        if (corrected.toLowerCase().startsWith('tcp:')) {
            corrected = corrected.substring(4);
            wasChanged = true;
        }

        // Remove port suffix if present (e.g., ",1433" or ":1433")
        if (corrected.includes(',1433')) {
            corrected = corrected.replace(',1433', '');
            wasChanged = true;
        }
        if (corrected.includes(':1433')) {
            corrected = corrected.replace(':1433', '');
            wasChanged = true;
        }

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

            // Test basic database access with existing connection
            await this.testBasicAccess();
            Logger.debug('Database connection established');

        } catch (initialError: any) {
            let error = initialError;
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

                    Logger.debug('Retrying with normalized Azure SQL server name');

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

            // Handle all other errors or if retries also failed
            this.handleConnectionError(error, connection, sqlConfig);
        }
    }

    /**
     * Handles connection errors with detailed guidance
     */
    private handleConnectionError(error: any, connection: any, sqlConfig: any): never {
        const server: string = sqlConfig.server || connection.server || 'the configured server';
        const isAzureName = /\.database\.windows\.net/i.test(server);
        let errorMessage: string;

        if (error.code === 'ELOGIN' || error.number === 18456) {
            errorMessage = connection.authenticationType === 'SqlLogin'
                ? `Login failed for "${server}". Check the password, that the login exists and has permission on the target database` +
                  (isAzureName ? ', and that your client IP is allowed by the Azure SQL firewall.' : '.')
                : `Windows Authentication failed for "${server}". Your Windows account may lack a SQL Server login or permission on the target database.`;
        } else if (error.code === 'ETIMEOUT' || error.code === 'ETIMEDOUT') {
            errorMessage = `Connection to "${server}" timed out. Check the server name, port, that the server is reachable, and firewall rules.`;
        } else if (error.code === 'ENETUNREACH' || error.code === 'ENOTFOUND' || error.code === 'ESOCKET') {
            errorMessage = /tcp:|,1433|:1433/i.test(server)
                ? `Cannot reach "${server}". The server name should not include a "tcp:" prefix or a port suffix — use just the host name and set the port separately.`
                : `Cannot reach "${server}". Check the server name, network connectivity (VPN if required), and that the port is open.` +
                  (isAzureName ? ' For Azure SQL, add your client IP to the server firewall rules.' : '');
        } else if (error.number === 10054 || /10054|pre-login handshake|SSL|TLS|certificate/i.test(error.message || '')) {
            errorMessage = `TLS handshake with "${server}" failed. Ensure the server presents a certificate your machine trusts. ` +
                `Only as a last resort for a development server with a self-signed certificate, set "trustServerCertificate": true on that connection — this disables protection against man-in-the-middle attacks.`;
        } else if (error.number === 297 || error.number === 300 || /VIEW SERVER STATE|ALTER ANY/i.test(error.message || '')) {
            errorMessage = `Connected to "${server}", but your login lacks the permissions required for Extended Events. ` +
                `See the "Required permissions" section of the extension README.`;
        } else {
            errorMessage = `Could not connect to "${server}".`;
        }

        Logger.error('Database connection failed', error);
        throw new Error(errorMessage);
    }

    /**
     * Connects using the selected mssql connection profile
     */
    private async connectUsingSelectedProfile(): Promise<void> {
        const selectedProfile = this.getSelectedConnectionName();

        if (!selectedProfile) {
            throw new Error('No connection profile selected. Please select a connection first.');
        }

        const connections = this.getMssqlConnections();
        const connection = connections.find(conn => conn.profileName === selectedProfile);

        if (!connection) {
            throw new Error(`Connection profile '${selectedProfile}' not found in mssql.connections`);
        }

        Logger.debug('Resolved mssql connection profile', {
            authenticationType: connection.authenticationType
        });

        // Convert mssql connection to sql.config format - use existing connection settings as-is
        const sqlConfig: any = {
            server: connection.server,
            database: connection.database || '',
            port: connection.port || 1433,
            // Use encrypt setting exactly as configured, or default based on server type
            encrypt: connection.encrypt !== undefined ? connection.encrypt : connection.server.includes('.database.windows.net'),
            // Smart SSL certificate handling
            trustServerCertificate: this.getTrustServerCertificateSetting(connection),
            options: {}
        };

        sqlConfig.options.appName = this.profilerApplicationName;

        if (connection.authenticationType === 'Integrated') {
            sqlConfig.options = {
                ...sqlConfig.options,
                trustedConnection: true
            };
        } else {
            // SQL Authentication credentials are only read from SecretStorage or a protected prompt.
            sqlConfig.user = connection.user;

            const password = await this.promptForPassword(connection.profileName, connection.user || '');
            if (!password) {
                throw new Error('Password is required for SQL Server authentication');
            }
            sqlConfig.password = password;
        }

        Logger.debug('Opening SQL connection', {
            encrypt: sqlConfig.encrypt,
            trustServerCertificate: sqlConfig.trustServerCertificate,
            authenticationType: connection.authenticationType
        });

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
                    return storedPassword;
                }
            } catch {
                // No stored password (or SecretStorage unavailable) — fall through to prompt.
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
                    Logger.debug('Failed to store password in SecretStorage', error);
                    vscode.window.showWarningMessage('Could not save the password securely. You will be asked again next time.');
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

            // Prime the cached engine detection (EngineEdition-based).
            const isAzure = await this.isAzureSqlDatabase();

            // Test Extended Events catalog visibility for the detected environment.
            try {
                const catalogView = isAzure ? 'sys.database_event_sessions' : 'sys.server_event_sessions';
                await request.query(`SELECT TOP 0 name FROM ${catalogView}`);
            } catch (xeError: any) {
                Logger.debug('Extended Events catalog not visible to this login', xeError);
                const grant = isAzure
                    ? 'ALTER ANY DATABASE EVENT SESSION and VIEW DATABASE STATE on the target database'
                    : 'ALTER ANY EVENT SESSION and VIEW SERVER STATE';
                throw new Error(
                    `Connected successfully, but this login lacks the permissions required for Extended Events. ` +
                    `Ask your administrator to grant ${grant}. See the "Required permissions" section of the extension README.`
                );
            }
        } catch (error: any) {
            if (typeof error?.message === 'string' && error.message.includes('Extended Events')) {
                throw error; // Re-throw our actionable permission message
            }
            Logger.debug('Basic database access test failed', error);
            throw new Error('Could not verify database access after connecting.');
        }
    }

    /**
     * Determines the appropriate trustServerCertificate setting for the connection.
     * Certificate validation stays ON unless the user has explicitly opted out
     * (`trustServerCertificate: true`) on that specific connection profile.
     */
    private getTrustServerCertificateSetting(connection: MssqlConnection): boolean {
        return connection.trustServerCertificate === true;
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
            Logger.info(`Stored password cleared for connection profile: ${profileName}`);
        } catch (error) {
            Logger.error(`Failed to clear stored password for ${profileName}`, error);
            throw new Error(`Failed to clear stored password for ${profileName}.`);
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

    async dispose(): Promise<void> {
        await this.stopProfiling();
    }
}