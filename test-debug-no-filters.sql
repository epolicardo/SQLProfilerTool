-- DEBUGGING: Queries to test with ALL FILTERS DISABLED
-- These should definitely appear in the profiler if Extended Events are working

-- 1. Simple queries that should be captured
SELECT 'DEBUG TEST 1 - Simple SELECT' AS TestMessage;

SELECT GETDATE() AS CurrentTime, 'TEST QUERY' AS Source;

-- 2. Multiple statements
SELECT 1 AS Number;
SELECT 2 AS Number;
SELECT 3 AS Number;

-- 3. Calculation
SELECT 10 + 20 AS Calculation, 'Math Test' AS Type;

-- 4. System function calls
SELECT DB_NAME() AS DatabaseName;
SELECT USER_NAME() AS UserName;
SELECT HOST_NAME() AS HostName;

-- 5. Table query (should exist)
SELECT TOP 3
    name, object_id, type_desc
FROM sys.objects
WHERE type = 'S'
-- System tables
ORDER BY name;

-- 6. Wait to test duration
WAITFOR DELAY '00:00:02';
SELECT 'After 2 second wait' AS Message;

-- 7. Batch with variable
DECLARE @TestVar VARCHAR(50) = 'PROFILER DEBUG TEST';
SELECT @TestVar AS VariableValue;

-- 8. Multiple quick selects
SELECT 'Query A' AS QueryLetter;
SELECT 'Query B' AS QueryLetter;
SELECT 'Query C' AS QueryLetter;

-- 9. Current session info
SELECT
    @@SPID AS SessionID,
    APP_NAME() AS ApplicationName,
    SYSTEM_USER AS SystemUser,
    'DEBUG PROFILER TEST' AS TestMarker;

-- 10. Final test
SELECT 'FINAL TEST - If you see this in profiler, events are working!' AS FinalMessage;