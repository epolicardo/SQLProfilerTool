# Debugging: No Events Showing in Grid

## Problem
The SQL Server Profiler extension starts successfully but no events appear in the results grid, even though profiling appears to be running.

## Debugging Steps

### 1. Check Console Output
1. Open VS Code Developer Tools: `Help > Toggle Developer Tools`
2. Go to Console tab
3. Start profiling and look for these debug messages:
   - `=== TESTING BASIC EVENT CAPTURE ===`
   - `Target data length: [number]`
   - `Number of events found in XML: [number]`
   - `=== EXECUTING MAIN XE QUERY ===`
   - `Main query succeeded with [number] records`

### 2. Check Output Channel
1. Open VS Code Output panel: `View > Output`
2. Select "SQL Server Profiler" from dropdown
3. Look for logging information about:
   - Connection status
   - Extended Events session creation
   - Query execution results

### 3. Generate Test Activity
While profiling is running, execute some SQL queries to generate events:

```sql
-- Simple queries that should be captured
SELECT GETDATE() AS CurrentTime;
SELECT @@VERSION AS SQLVersion;
SELECT DB_NAME() AS DatabaseName;

-- If using stored procedures
EXEC sp_helpdb;
```

### 4. Verify Extended Events Session
In SQL Server Management Studio or Azure Data Studio, run this query to check if the session exists and has data:

```sql
-- Check if session exists (Azure SQL Database)
SELECT 
    s.name,
    s.create_time,
    CASE WHEN s.address IS NOT NULL THEN 'Running' ELSE 'Stopped' END as status
FROM sys.dm_xe_database_sessions s
WHERE name LIKE 'VSCodeProfiler%';

-- Check ring buffer data (Azure SQL Database)
SELECT 
    s.name,
    CAST(t.target_data AS nvarchar(max)) AS xml_data,
    LEN(CAST(t.target_data AS nvarchar(max))) AS xml_length
FROM sys.dm_xe_database_session_targets t
JOIN sys.dm_xe_database_sessions s ON s.address = t.event_session_address
WHERE s.name LIKE 'VSCodeProfiler%' AND t.target_name = 'ring_buffer';
```

### 5. Test Ring Buffer Content
If the session exists but has no data, the issue might be:
- Events are not being captured (session configuration)
- Anti-recursion filters are too restrictive
- Connection issues preventing event collection

### 6. Check Webview Communication
1. Look for `updateResults` messages in console
2. Check if `currentResults` array has data
3. Verify `applyFilters()` is not filtering out all events

## Expected Debug Output

When working correctly, you should see:
```
=== TESTING BASIC EVENT CAPTURE ===
Target data length: 5432
XML preview (first 1000 chars): <RingBufferTarget>...
Number of events found in XML: 15
=== EXECUTING MAIN XE QUERY ===
Main query succeeded with 15 records
=== XE RESULTS DEBUG ===
Query returned 15 records
Event 1: {eventName: "sql_batch_completed", ...}
```

## Common Issues

### Issue 1: Empty Ring Buffer
**Symptoms**: Target data length is 0 or very small
**Cause**: Extended Events session not capturing events
**Solution**: Check session configuration and ensure SQL activity is occurring

### Issue 2: Query Timeout
**Symptoms**: "MAIN XE QUERY FAILED" with timeout error
**Cause**: Complex XML parsing on large datasets
**Solution**: Already implemented with fallback query

### Issue 3: Azure SQL Database Permissions
**Symptoms**: Permission denied errors in console
**Cause**: Insufficient permissions for Extended Events
**Solution**: Ensure user has appropriate database permissions

### Issue 4: Anti-Recursion Filters Too Restrictive
**Symptoms**: Events captured but all filtered out
**Cause**: `getAntiRecursionFilters()` excluding all events
**Solution**: Check filter logic in code

## Next Steps
1. Run through debugging steps above
2. Share console output and any error messages
3. Confirm database type (Azure SQL Database vs SQL Server)
4. Test with simple queries to generate activity