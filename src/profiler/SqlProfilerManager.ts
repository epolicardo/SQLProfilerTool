import * as sql from 'mssql';
import * as vscode from 'vscode';

export interface MssqlConnection {
    profileName: string;
    server: string;
    database?: string;
    user?: string;
    password?: string;
    authenticationType: 'SqlLogin' | 'Integrated';
    port?: number;
    encrypt?: boolean;
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
    private sessionName = 'VSCodeProfilerSession';
    private results: ProfilerEvent[] = [];
    private pollingInterval: any | undefined;

    constructor() {
        const config = vscode.workspace.getConfiguration('sqlProfiler');
        this.sessionName = config.get<string>('sessionName') || 'VSCodeProfilerSession';
    }

    async startProfiling(): Promise<void> {
        if (this.isProfilering) {
            throw new Error('Profiling is already running');
        }

        try {
            // Try to connect using selected mssql profile first
            const selectedProfile = this.getSelectedConnectionName();
            if (selectedProfile) {
                await this.connectUsingSelectedProfile();
            } else {
                // Fallback to connection string method
                const config = vscode.workspace.getConfiguration('sqlProfiler');
                const connectionString = config.get<string>('connectionString');

                if (!connectionString) {
                    throw new Error('No connection configured. Please select an mssql connection or configure a connection string.');
                }

                // Parse connection string and create config
                const sqlConfig = this.parseConnectionString(connectionString);

                this.pool = new sql.ConnectionPool(sqlConfig);
                await this.pool.connect();
            }

            // Create Extended Events session
            await this.createXESession();

            // Start the session
            await this.startXESession();

            this.isProfilering = true;

            // Start polling for results
            this.startPolling();

        } catch (error) {
            this.isProfilering = false;
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

            await this.pool.close();
            this.pool = undefined;
        }
    }

    private async createXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        const createSessionQuery = `
            -- Drop existing session if it exists
            IF EXISTS (SELECT * FROM sys.server_event_sessions WHERE name = '${this.sessionName}')
                DROP EVENT SESSION [${this.sessionName}] ON SERVER;

            -- Create new session
            CREATE EVENT SESSION [${this.sessionName}] ON SERVER
            ADD EVENT sqlserver.rpc_completed(
                ACTION(sqlserver.client_app_name, sqlserver.database_name, sqlserver.username)
                WHERE ([package0].[greater_than_uint64]([duration],(0)))
            ),
            ADD EVENT sqlserver.sql_batch_completed(
                ACTION(sqlserver.client_app_name, sqlserver.database_name, sqlserver.username)
                WHERE ([package0].[greater_than_uint64]([duration],(0)))
            )
            ADD TARGET package0.ring_buffer(SET max_events_limit=(1000))
            WITH (STARTUP_STATE=OFF, EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS);
        `;

        const request = this.pool.request();
        await request.query(createSessionQuery);
    }

    private async startXESession(): Promise<void> {
        if (!this.pool) {
            throw new Error('No database connection');
        }

        const startQuery = `ALTER EVENT SESSION [${this.sessionName}] ON SERVER STATE = START;`;
        const request = this.pool.request();
        await request.query(startQuery);
    }

    private async stopXESession(): Promise<void> {
        if (!this.pool) {
            return;
        }

        const stopQuery = `
            IF EXISTS (SELECT * FROM sys.server_event_sessions WHERE name = '${this.sessionName}')
                ALTER EVENT SESSION [${this.sessionName}] ON SERVER STATE = STOP;
        `;

        const request = this.pool.request();
        await request.query(stopQuery);
    }

    private async dropXESession(): Promise<void> {
        if (!this.pool) {
            return;
        }

        const dropQuery = `
            IF EXISTS (SELECT * FROM sys.server_event_sessions WHERE name = '${this.sessionName}')
                DROP EVENT SESSION [${this.sessionName}] ON SERVER;
        `;

        const request = this.pool.request();
        await request.query(dropQuery);
    }

    private startPolling(): void {
        this.pollingInterval = setInterval(async () => {
            await this.collectResults();
        }, 2000); // Poll every 2 seconds
    }

    private async collectResults(): Promise<void> {
        if (!this.pool || !this.isProfilering) {
            return;
        }

        try {
            const query = `
                SELECT 
                    event_data.value('(event/@timestamp)[1]', 'datetime2') AS event_timestamp,
                    event_data.value('(event/@name)[1]', 'varchar(50)') AS event_name,
                    event_data.value('(event/data[@name="statement"]/value)[1]', 'nvarchar(max)') AS statement_text,
                    event_data.value('(event/data[@name="duration"]/value)[1]', 'bigint') AS duration_microseconds,
                    event_data.value('(event/action[@name="database_name"]/value)[1]', 'nvarchar(128)') AS database_name,
                    event_data.value('(event/action[@name="username"]/value)[1]', 'nvarchar(128)') AS username,
                    event_data.value('(event/action[@name="client_app_name"]/value)[1]', 'nvarchar(128)') AS application_name
                FROM (
                    SELECT CAST(target_data AS XML) AS target_data
                    FROM sys.dm_xe_sessions AS s
                    JOIN sys.dm_xe_session_targets AS t 
                      ON s.address = t.event_session_address
                    WHERE s.name = '${this.sessionName}'
                      AND t.target_name = 'ring_buffer'
                ) AS data
                CROSS APPLY target_data.nodes('RingBufferTarget/event') AS events(event_data)
                ORDER BY event_timestamp DESC;
            `;

            const request = this.pool.request();
            const result = await request.query(query);

            // Convert results to our format
            const newEvents: ProfilerEvent[] = result.recordset.map((record: any) => ({
                timestamp: record.event_timestamp?.toISOString() || new Date().toISOString(),
                eventName: record.event_name || 'Unknown',
                statement: record.statement_text || '',
                duration: record.duration_microseconds ? Math.round(record.duration_microseconds / 1000) : undefined,
                databaseName: record.database_name || '',
                userName: record.username || '',
                applicationName: record.application_name || ''
            }));

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

    private parseConnectionString(connectionString: string): sql.config {
        const config: sql.config = {
            server: 'localhost'
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
            encrypt: conn.encrypt || false
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

        // Convert mssql connection to sql.config format
        const sqlConfig: sql.config = {
            server: connection.server,
            database: connection.database || '',
            port: connection.port || 1433,
            options: {}
        };

        if (connection.authenticationType === 'Integrated') {
            sqlConfig.options = {
                trustedConnection: true
            };
        } else {
            sqlConfig.user = connection.user;
            sqlConfig.password = connection.password;
        }

        this.pool = new sql.ConnectionPool(sqlConfig);
        await this.pool.connect();
    }

    dispose(): void {
        if (this.isProfilering) {
            this.stopProfiling();
        }
    }
}