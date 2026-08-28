-- Sample workload for the SQL Server Profiler Tool.
-- Start profiling, then run these statements to see events appear.

-- Simple query
SELECT GETDATE() AS CurrentTime;

-- Query with measurable duration
WAITFOR DELAY '00:00:01';
SELECT 'This query took about one second' AS Message;

-- Query against system views
SELECT
    name,
    database_id,
    create_date
FROM sys.databases
WHERE database_id > 4;
GO

-- Stored procedure (create and execute)
CREATE OR ALTER PROCEDURE dbo.TestProcedure
    @Parameter NVARCHAR(100) = 'Test'
AS
BEGIN
    SELECT @Parameter AS ParameterValue;
    SELECT COUNT(*) AS TableCount FROM sys.tables;
END;
GO

-- Execute the procedure
EXEC dbo.TestProcedure @Parameter = 'Profiler Test';
GO
