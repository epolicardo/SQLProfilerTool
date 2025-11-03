-- Script de prueba para el SQL Server Profiler Tool
-- Ejecuta estas consultas después de iniciar el profiler para ver los resultados

-- Consulta simple
SELECT GETDATE() AS CurrentTime;

-- Consulta con duración
WAITFOR DELAY '00:00:01';
SELECT 'Esta consulta tardó 1 segundo' AS Message;

-- Consulta sobre sys views
SELECT 
    name, 
    database_id,
    create_date
FROM sys.databases
WHERE database_id > 4;

-- Procedimiento almacenado (crear y ejecutar)
CREATE OR ALTER PROCEDURE dbo.TestProcedure
    @Parameter NVARCHAR(100) = 'Test'
AS
BEGIN
    SELECT @Parameter AS ParameterValue;
    SELECT COUNT(*) AS TableCount FROM sys.tables;
END;

-- Ejecutar el procedimiento
EXEC dbo.TestProcedure @Parameter = 'Profiler Test';