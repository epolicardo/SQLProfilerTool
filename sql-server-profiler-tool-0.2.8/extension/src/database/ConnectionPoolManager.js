"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionPoolManager = void 0;
/* The statement `import * as sql from 'mssql';` is importing the entire module named 'mssql' and
assigning it to the variable `sql`. This allows you to access all the functionalities provided by
the 'mssql' module using the `sql` variable in your TypeScript code. */
const sql = require("mssql");
const Logger_1 = require("../utils/Logger");
class ConnectionPoolManager {
    constructor() {
        this.pools = new Map();
        this.poolConfigs = new Map();
    }
    static getInstance() {
        if (!ConnectionPoolManager.instance) {
            ConnectionPoolManager.instance = new ConnectionPoolManager();
        }
        return ConnectionPoolManager.instance;
    }
    /**
     * Gets or creates a connection pool for the given configuration
     */
    async getPool(config) {
        const poolKey = this.generatePoolKey(config);
        // Return existing pool if it exists and is connected
        if (this.pools.has(poolKey)) {
            const existingPool = this.pools.get(poolKey);
            if (existingPool.connected) {
                Logger_1.Logger.info(`Reusing existing pool: ${poolKey}`);
                return existingPool;
            }
            else {
                // Pool exists but is not connected, remove it
                Logger_1.Logger.warn(`Removing disconnected pool: ${poolKey}`);
                this.pools.delete(poolKey);
                this.poolConfigs.delete(poolKey);
            }
        }
        // Create new pool
        Logger_1.Logger.info(`Creating new connection pool: ${poolKey}`);
        const pool = await this.createNewPool(config, poolKey);
        return pool;
    }
    /**
     * Creates a new connection pool with the specified configuration
     */
    async createNewPool(config, poolKey) {
        // Create base pool configuration
        const poolConfig = {
            server: config.server,
            database: config.database,
            user: config.user,
            password: config.password,
            port: config.port,
            // Ensure encrypt and trustServerCertificate are boolean values
            encrypt: config.encrypt !== undefined ? Boolean(config.encrypt) : false,
            trustServerCertificate: config.trustServerCertificate !== undefined ? Boolean(config.trustServerCertificate) : true,
            requestTimeout: 30000,
            connectionTimeout: 30000,
            pool: {
                max: config.maxConnections || 5,
                min: config.minConnections || 1,
                idleTimeoutMillis: config.idleTimeout || 30000,
                acquireTimeoutMillis: config.acquireTimeout || 60000,
                createTimeoutMillis: config.createTimeout || 30000,
                destroyTimeoutMillis: 5000,
                reapIntervalMillis: 1000,
                createRetryIntervalMillis: 200
            }
        };
        // Add options if they exist
        if (config.options) {
            poolConfig.options = { ...config.options };
        }
        const pool = new sql.ConnectionPool(poolConfig);
        // Set up event handlers
        this.setupPoolEventHandlers(pool, poolKey);
        try {
            await pool.connect();
            this.pools.set(poolKey, pool);
            this.poolConfigs.set(poolKey, config);
            Logger_1.Logger.info(`Pool ${poolKey} created successfully`, {
                server: config.server,
                database: config.database,
                maxConnections: config.maxConnections || 5,
                minConnections: config.minConnections || 1
            });
            return pool;
        }
        catch (error) {
            Logger_1.Logger.error(`Failed to create pool ${poolKey}:`, error);
            throw error;
        }
    }
    /**
     * Sets up event handlers for pool monitoring
     */
    setupPoolEventHandlers(pool, poolKey) {
        pool.on('connect', () => {
            Logger_1.Logger.info(`Pool ${poolKey}: Connection established`);
        });
        pool.on('close', () => {
            Logger_1.Logger.info(`Pool ${poolKey}: Connection closed`);
        });
        pool.on('error', (err) => {
            Logger_1.Logger.error(`Pool ${poolKey}: Connection error`, err);
            // Remove failed pool from our maps
            this.pools.delete(poolKey);
            this.poolConfigs.delete(poolKey);
        });
    }
    /**
     * Generates a unique key for the pool based on connection parameters
     */
    generatePoolKey(config) {
        const server = config.server || 'localhost';
        const database = config.database || 'master';
        const user = config.user || 'integrated';
        const poolName = config.poolName || 'default';
        return `${poolName}_${server}_${database}_${user}`.replace(/[^a-zA-Z0-9_]/g, '_');
    }
    /**
     * Gets statistics for a specific pool
     */
    getPoolStats(poolKey) {
        const pool = this.pools.get(poolKey);
        const config = this.poolConfigs.get(poolKey);
        if (!pool || !config) {
            return null;
        }
        try {
            // Access internal pool statistics (these are private properties in mssql)
            const poolInternal = pool.pool;
            return {
                poolName: poolKey,
                connected: pool.connected,
                connecting: pool.connecting,
                size: poolInternal?.size || 0,
                available: poolInternal?.available || 0,
                borrowed: poolInternal?.borrowed || 0,
                pending: poolInternal?.pending || 0,
                min: config.minConnections || 1,
                max: config.maxConnections || 5,
                idleTimeout: config.idleTimeout || 30000
            };
        }
        catch (error) {
            Logger_1.Logger.error(`Error getting pool stats for ${poolKey}:`, error);
            return {
                poolName: poolKey,
                connected: pool.connected,
                connecting: pool.connecting,
                size: 0,
                available: 0,
                borrowed: 0,
                pending: 0,
                min: config.minConnections || 1,
                max: config.maxConnections || 5,
                idleTimeout: config.idleTimeout || 30000
            };
        }
    }
    /**
     * Gets statistics for all pools
     */
    getAllPoolStats() {
        const stats = [];
        for (const poolKey of this.pools.keys()) {
            const poolStats = this.getPoolStats(poolKey);
            if (poolStats) {
                stats.push(poolStats);
            }
        }
        return stats;
    }
    /**
     * Closes a specific pool
     */
    async closePool(poolKey) {
        const pool = this.pools.get(poolKey);
        if (pool) {
            try {
                Logger_1.Logger.info(`Closing pool: ${poolKey}`);
                await pool.close();
            }
            catch (error) {
                Logger_1.Logger.error(`Error closing pool ${poolKey}:`, error);
            }
            finally {
                this.pools.delete(poolKey);
                this.poolConfigs.delete(poolKey);
            }
        }
    }
    /**
     * Closes all pools
     */
    async closeAllPools() {
        Logger_1.Logger.info('Closing all connection pools...');
        const closePromises = Array.from(this.pools.entries()).map(async ([poolKey, pool]) => {
            try {
                await pool.close();
                Logger_1.Logger.info(`Pool ${poolKey} closed successfully`);
            }
            catch (error) {
                Logger_1.Logger.error(`Error closing pool ${poolKey}:`, error);
            }
        });
        await Promise.all(closePromises);
        this.pools.clear();
        this.poolConfigs.clear();
        Logger_1.Logger.info('All pools closed');
    }
    /**
     * Gets the list of active pool keys
     */
    getActivePoolKeys() {
        return Array.from(this.pools.keys());
    }
    /**
     * Checks if a pool exists and is connected
     */
    isPoolConnected(poolKey) {
        const pool = this.pools.get(poolKey);
        return pool ? pool.connected : false;
    }
    /**
     * Health check for all pools
     */
    async healthCheck() {
        const health = {};
        for (const [poolKey, pool] of this.pools.entries()) {
            try {
                if (pool.connected) {
                    // Simple health check query
                    const result = await pool.request().query('SELECT 1 as test');
                    health[poolKey] = result.recordset.length > 0;
                }
                else {
                    health[poolKey] = false;
                }
            }
            catch (error) {
                Logger_1.Logger.error(`Health check failed for pool ${poolKey}:`, error);
                health[poolKey] = false;
            }
        }
        return health;
    }
    /**
     * Disposes of the singleton instance (for testing)
     */
    static dispose() {
        if (ConnectionPoolManager.instance) {
            ConnectionPoolManager.instance.closeAllPools();
            ConnectionPoolManager.instance = undefined;
        }
    }
}
exports.ConnectionPoolManager = ConnectionPoolManager;
//# sourceMappingURL=ConnectionPoolManager.js.map