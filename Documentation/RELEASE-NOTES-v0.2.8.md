# Release Notes - Version 0.2.8

## 🔧 Critical Bug Fix

### Extended Events Duration Attribute Error Fix

**Issue Fixed**: "The event attribute or predicate source, 'duration', could not be found"

**Problem Description**:
- Version 0.2.7 introduced an error when starting profiling sessions
- The Extended Events configuration used `WHERE ([duration] > X)` clauses
- Azure SQL Database doesn't support the `duration` attribute in WHERE clauses for all event types
- This prevented profiling sessions from starting

**Solution Implemented**:
- Removed all `WHERE ([duration] > X)` clauses from Extended Events configuration
- Simplified event filters to capture all events without duration filtering
- Maintained compatibility between Azure SQL Database and SQL Server on-premise
- Events are now captured based on application filtering rather than duration thresholds

## 🚀 Changes Made

### Extended Events Configuration
- **Azure SQL Database**: Removed duration-based WHERE clauses from all events
- **SQL Server**: Removed duration-based WHERE clauses from all events
- **Event Types**: Maintained rpc_completed, sql_batch_completed, sql_statement_completed, and sp_statement events
- **Anti-Recursion**: Preserved existing 6-layer anti-recursion filtering system

### Technical Details
- Modified `createSessionQuery` for both Azure SQL Database (database-scoped) and SQL Server (server-scoped)
- Simplified event configuration to focus on capturing relevant queries
- Duration information is still available in the event data itself when supported
- Filtering now relies primarily on application name and query pattern detection

## 🛠 Compatibility

### Supported Platforms
- ✅ Azure SQL Database (database-scoped Extended Events)
- ✅ SQL Server 2016+ (server-scoped Extended Events)
- ✅ SQL Server on Azure VM
- ✅ Azure SQL Managed Instance

### System Requirements
- VS Code 1.85.0 or higher
- SQL Server permissions for Extended Events
- Network connectivity to SQL Server instance

## 📊 Performance Impact

### Removed Limitations
- No duration-based filtering means more events captured initially
- Anti-recursion filters still prevent infinite loops
- Performance monitoring relies on application-level filtering

### Resource Usage
- Slightly increased event volume due to removal of duration filters
- Ring buffer limit maintained at 2000 events
- Memory usage remains controlled through event retention policies

## 🔄 Migration from v0.2.7

### Automatic Changes
- Existing profiling sessions will be recreated with new configuration
- No manual intervention required
- Previous session data remains accessible

### User Actions Required
- **None**: Update is backward compatible
- **Recommended**: Test profiling session startup to verify fix

## 🐛 Bug Fixes

### Primary Fix
- **Fixed**: Extended Events session creation failure with duration attribute error
- **Impact**: Profiling sessions can now start successfully on all supported platforms

### Secondary Improvements
- **Enhanced**: Error messaging for Extended Events compatibility issues
- **Maintained**: Existing anti-recursion and timeout configurations
- **Preserved**: Security measures and logging improvements from previous versions

## 📋 Testing Recommendations

### Validation Steps
1. Install version 0.2.8
2. Connect to SQL Server or Azure SQL Database
3. Start profiling session
4. Verify events are captured without duration errors
5. Confirm anti-recursion filters are working

### Expected Behavior
- Profiling session starts without "duration" attribute errors
- Events captured include rpc_completed, sql_batch_completed, and sql_statement_completed
- Anti-recursion system prevents capturing profiler's own queries
- Connection timeouts remain extended for Azure SQL compatibility

## 🔮 Next Steps

### Planned Improvements
- Consider implementing client-side duration filtering if needed
- Evaluate event volume and performance impact
- Add configuration options for event capture thresholds
- Enhance stored procedure capture capabilities

### Feedback Requested
- Report any issues with event capture volume
- Notify of any remaining compatibility problems
- Suggest improvements for duration-based filtering alternatives

---

**Package**: `sql-server-profiler-tool-0.2.8.vsix`  
**Build Date**: December 19, 2024  
**Compatibility**: Azure SQL Database, SQL Server 2016+  
**Critical Fix**: Duration attribute error resolution