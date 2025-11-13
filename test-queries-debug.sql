-- Test Queries for SQL Server Profiler Debugging
-- Run these queries while profiling is active to generate test events

-- Basic SELECT statements
SELECT GETDATE() AS CurrentTime;
SELECT @@VERSION AS SQLServerVersion;
SELECT DB_NAME() AS CurrentDatabase;
SELECT USER_NAME() AS CurrentUser;
SELECT HOST_NAME() AS HostName;

-- Simple calculation
SELECT 1 + 1 AS SimpleCalculation;

-- Query system tables (should generate events)
SELECT TOP 5 name, type_desc 
FROM sys.objects 
WHERE type = 'U';

-- Multiple statement batch
BEGIN
    DECLARE @TestVar INT = 42;
    SELECT @TestVar AS TestVariable;
    SELECT COUNT(*) AS ObjectCount FROM sys.objects;
END;

-- Stored procedure call (if available)
-- EXEC sp_helpdb;

-- Simple JOIN (if you have tables)
-- SELECT o.name, s.name as schema_name 
-- FROM sys.objects o 
-- JOIN sys.schemas s ON o.schema_id = s.schema_id 
-- WHERE o.type = 'U';

-- Wait statement to test duration capture
WAITFOR DELAY '00:00:01';
SELECT 'After 1 second wait' AS Message;

-- Multiple quick queries
SELECT 'Query 1' AS QueryNumber;
SELECT 'Query 2' AS QueryNumber;
SELECT 'Query 3' AS QueryNumber;
SELECT 'Query 4' AS QueryNumber;
SELECT 'Query 5' AS QueryNumber;