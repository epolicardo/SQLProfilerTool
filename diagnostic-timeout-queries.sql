-- ========================================
-- DIAGNOSTIC QUERIES FOR TIMEOUT ISSUES
-- ========================================
-- Run these queries to diagnose connection and timeout issues

-- 1. Check current session lock timeout
SELECT @@LOCK_TIMEOUT as LockTimeoutMs;
-- Result: -1 means unlimited, otherwise timeout in milliseconds

-- 2. Check current session ID
SELECT @@SPID as SessionId,
    APP_NAME() as ApplicationName,
    SYSTEM_USER as SystemUser,
    HOST_NAME() as HostName;

-- 3. Check server-level timeout configurations (SQL Server only, not Azure SQL DB)
-- Note: This requires VIEW SERVER STATE permission
SELECT name, value, value_in_use, description
FROM sys.configurations
WHERE name LIKE '%timeout%' OR name LIKE '%connection%'
ORDER BY name;

-- 4. Check current session's request status
SELECT
    session_id,
    request_id,
    status,
    command,
    wait_type,
    wait_time,
    total_elapsed_time,
    cpu_time,
    reads,
    writes
FROM sys.dm_exec_requests
WHERE session_id = @@SPID;

-- 5. Check active Extended Events sessions
-- For Azure SQL Database:
SELECT
    s.name as SessionName,
    s.create_time,
    t.target_name,
    CAST(t.target_data AS XML) as TargetData
FROM sys.dm_xe_database_sessions s
    LEFT JOIN sys.dm_xe_database_session_targets t ON s.address = t.event_session_address
WHERE s.name LIKE '%VSCodeProfiler%' OR s.name LIKE '%Profiler%';

-- For SQL Server:
-- SELECT 
--     s.name as SessionName,
--     s.create_time,
--     t.target_name,
--     CAST(t.target_data AS XML) as TargetData
-- FROM sys.dm_xe_sessions s
-- LEFT JOIN sys.dm_xe_session_targets t ON s.address = t.event_session_address
-- WHERE s.name LIKE '%VSCodeProfiler%' OR s.name LIKE '%Profiler%';

-- 6. Check for blocking sessions
SELECT
    blocking_session_id,
    session_id,
    wait_type,
    wait_time,
    wait_resource,
    command,
    status
FROM sys.dm_exec_requests
WHERE blocking_session_id <> 0;

-- 7. Check database compatibility level (can affect features)
SELECT
    name,
    compatibility_level,
    state_desc
FROM sys.databases
WHERE database_id = DB_ID();

-- 8. Check if Extended Events are supported
SELECT
    SERVERPROPERTY('Edition') as Edition,
    SERVERPROPERTY('ProductVersion') as Version,
    SERVERPROPERTY('EngineEdition') as EngineEdition;
-- EngineEdition: 5 = Azure SQL Database

-- 9. Check current connection settings
SELECT
    @@OPTIONS as OptionsValue,
    CONNECTIONPROPERTY('net_transport') as NetTransport,
    CONNECTIONPROPERTY('protocol_type') as ProtocolType,
    CONNECTIONPROPERTY('auth_scheme') as AuthScheme,
    CONNECTIONPROPERTY('local_net_address') as LocalAddress,
    CONNECTIONPROPERTY('local_tcp_port') as LocalPort;

-- 10. Check ring buffer size for Extended Events session (Azure SQL DB)
SELECT
    s.name,
    COUNT(*) as EventCount,
    LEN(CAST(t.target_data AS nvarchar(max))) as BufferSizeBytes
FROM sys.dm_xe_database_session_targets t
    JOIN sys.dm_xe_database_sessions s ON s.address = t.event_session_address
WHERE t.target_name = 'ring_buffer'
    AND s.name LIKE '%VSCodeProfiler%'
GROUP BY s.name, t.target_data;
