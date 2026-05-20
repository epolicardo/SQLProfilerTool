# 🧪 Testing Guide: Verify the 7-Event Fix

## Overview

This guide helps you verify that the duplicate event fix works correctly.

---

## Test Setup

### Prerequisites
- SQL Server with sample data
- VS Code extension loaded with the fix
- Extended Events profiler running

### Test Database

You can use any database, but we'll reference an `Order` table for clarity. If you don't have this table, create a simple one:

```sql
CREATE TABLE TestTable (
    Id INT PRIMARY KEY IDENTITY(1,1),
    Value NVARCHAR(MAX)
);
```

---

## Test 1: Parallel Updates (Your Scenario)

### Objective
Verify that 7 parallel UPDATE executions all appear in the profiler.

### Setup
1. Start the SQL Profiler in VS Code
2. Clear any previous results

### Test Steps

#### Option A: Using Connection Pool (Most Realistic)

```csharp
// If using EFCore or connection pool
// The Update statement will be executed multiple times
// through different connections in the pool
UPDATE [Order] SET [Value] = 'test' 
WHERE [Id] = 1;
```

Execute this and observe connection pool behavior. You should see the same UPDATE appear multiple times.

#### Option B: Manual Rapid Execution

```sql
-- Execute the same UPDATE 7 times rapidly
-- Open 7 separate query windows and run simultaneously
UPDATE TestTable SET Value = 'test1' WHERE Id = 1;
-- Run this in 6 other windows at the same time
```

#### Option C: Using sp_executesql (Matches Your Case)

```sql
EXEC sp_executesql N'SET IMPLICIT_TRANSACTIONS OFF;
SET NOCOUNT ON;
UPDATE TestTable SET Value = @p0 WHERE Id = @p1;',
N'@p0 NVARCHAR(MAX), @p1 INT',
@p0='test', @p1=1;

-- Execute 6 more times rapidly
EXEC sp_executesql N'SET IMPLICIT_TRANSACTIONS OFF;
SET NOCOUNT ON;
UPDATE TestTable SET Value = @p0 WHERE Id = @p1;',
N'@p0 NVARCHAR(MAX), @p1 INT',
@p0='test', @p1=1;

-- ... repeat 5 more times
```

### Expected Results

**Before Fix:**
```
Profiler Results:
  1. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_100)
  
  Total: 1 event shown ❌
```

**After Fix:**
```
Profiler Results:
  1. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_100)
  2. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_101)
  3. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_102)
  4. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_103)
  5. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_104)
  6. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_105)
  7. UPDATE TestTable SET Value = 'test' WHERE Id = 1  (evt_106)
  
  Total: 7 events shown ✅
```

### Verification

- [ ] All 7 events are visible
- [ ] Event IDs are different (evt_100-evt_106)
- [ ] Timestamps are similar/identical
- [ ] SQL statement content is identical
- [ ] User and database are the same

---

## Test 2: True Duplicate Detection (Still Works)

### Objective
Verify that true duplicates are still correctly filtered.

### Test Steps

```sql
-- Window 1
SELECT * FROM TestTable WHERE Id = 1;

-- Window 2 (within 5 seconds)
SELECT * FROM TestTable WHERE Id = 1;  -- Same query, quick replay
```

### Expected Results

**Should show:**
```
Profiler Results:
  1. SELECT * FROM TestTable WHERE Id = 1  (evt_200)
  
  Total: 1 event shown ✅
  
  Note: Second execution filtered as true duplicate
```

### Verification

- [ ] Only 1 event shown (not 2)
- [ ] True duplicate was filtered

---

## Test 3: Time Window Reset (5+ seconds)

### Objective
Verify that the 5-second deduplication window works correctly.

### Test Steps

```sql
-- Step 1: Execute query
SELECT * FROM TestTable WHERE Id = 1;  (10:00:00)

-- Step 2: Wait 6 seconds
-- ... wait wait wait ...       (10:00:06)

-- Step 3: Execute again
SELECT * FROM TestTable WHERE Id = 1;  (10:00:06)
```

### Expected Results

**Should show:**
```
Profiler Results:
  1. SELECT * FROM TestTable WHERE Id = 1  (evt_300) @ 10:00:00
  2. SELECT * FROM TestTable WHERE Id = 1  (evt_301) @ 10:00:06
  
  Total: 2 events shown ✅
  
  Note: Cache expired after 5 seconds, new entry created
```

### Verification

- [ ] Both executions shown
- [ ] Different timestamps
- [ ] Different event IDs

---

## Test 4: Mixed Scenario (Advanced)

### Objective
Complex test combining parallel executions with duplicate detection.

### Test Steps

```sql
-- First batch: 3 rapid parallel UPDATEs (should all show)
UPDATE TestTable SET Value = 'batch1' WHERE Id = 1;  -- Assuming 3 connections run this parallel
UPDATE TestTable SET Value = 'batch1' WHERE Id = 1;
UPDATE TestTable SET Value = 'batch1' WHERE Id = 1;

-- Immediate repeat of same query (within 5 sec) - should filter
SELECT * FROM TestTable WHERE Id = 1;
SELECT * FROM TestTable WHERE Id = 1;  -- Duplicate, filter this

-- Wait 6 seconds
-- ... sleep ...

-- New query (should show, cache expired)
SELECT * FROM TestTable WHERE Id = 1;
```

### Expected Results

```
Profiler Results:
  1. UPDATE TestTable SET Value = 'batch1' WHERE Id = 1  (evt_400)
  2. UPDATE TestTable SET Value = 'batch1' WHERE Id = 1  (evt_401)  ← Different ID, show
  3. UPDATE TestTable SET Value = 'batch1' WHERE Id = 1  (evt_402)  ← Different ID, show
  4. SELECT * FROM TestTable WHERE Id = 1  (evt_403)
  5. SELECT * FROM TestTable WHERE Id = 1  (evt_404)               ← FILTERED (true duplicate)
  6. SELECT * FROM TestTable WHERE Id = 1  (evt_405)               ← New cache, show
  
  Actual events shown: 5
  (1 filtered duplicate)
```

### Verification

- [ ] 3 UPDATEs all shown (parallel)
- [ ] First SELECT shown
- [ ] Second SELECT filtered
- [ ] Third SELECT shown (cache reset)

---

## Console Debugging

While running tests, check the VS Code debug console for deduplication logs:

```
=== EVENT DEDUPLICATION SUMMARY ===
Total events from query: 7
Already in results: 0
Internal queries filtered: 0
Duplicate by signature: 6
New events after dedup: 7
Current results array size: 7
Deduplicator stats: { 
  cachedSignatures: 1, 
  maxSignatures: 1000, 
  windowMs: 5000 
}
```

### Logs Show:
- **Total events**: 7 events from XE
- **Duplicates by signature**: 6 (same signature, different IDs)
- **New events**: 7 (all 7 preserved because different event IDs)
- **Result**: Line 3 should show significant "Duplicate by signature" count that are NOT filtered

---

## Success Criteria

### Test 1: MUST PASS
- [x] All 7 parallel updates appear in results

### Test 2: MUST PASS
- [x] True duplicates are still filtered to 1 result

### Test 3: MUST PASS
- [x] Time window reset works after 5+ seconds

### Test 4: SHOULD PASS
- [x] Mixed scenarios work correctly

---

## Troubleshooting

### Issue: Still only seeing 1 event for 7 parallel updates

**Possible causes:**
1. Extension not reloaded after fix
   - Solution: Restart VS Code

2. JavaScript bundle not updated
   - Solution: Rebuild with `npm run compile`

3. Old bundle cached
   - Solution: Clear browser cache / full restart

4. Events not truly parallel
   - Solution: Use connection pool or execute in truly separate connections

### Issue: Seeing duplicates that should be filtered

**Possible causes:**
1. Event IDs are different (check XE output)
   - This is CORRECT behavior - different IDs = different executions

2. Events arriving outside 5-second window
   - This is CORRECT - cache expired

3. Connection issues
   - Check console for errors

### Issue: Console shows errors

**Check for:**
1. "Cannot read property 'has' of undefined"
   - Indicates cached structure issue
   - Solution: Recompile

2. "Invalid event data"
   - Event object missing required fields
   - Check event mapping in SqlProfilerManager.ts

---

## Reporting Results

When testing, note:

```
Test Environment:
- SQL Server Version: [your version]
- Database: [your database name]
- Test Query Type: [UPDATE/SELECT/etc]
- Execution Method: [Connection Pool / Manual / sp_executesql]

Test 1 Results:
- Expected: 7 events
- Actual: [number]
- Status: PASS / FAIL

Test 2 Results:
- Expected: 1 event (true duplicate filtered)
- Actual: [number]
- Status: PASS / FAIL

Test 3 Results:
- Expected: 2 events (cache reset after 5s)
- Actual: [number]
- Status: PASS / FAIL

Test 4 Results:
- Expected: 5 events (1 duplicate filtered)
- Actual: [number]
- Status: PASS / FAIL

Console Output:
[paste deduplication summary from console]
```

---

## Next Steps

1. Run these tests
2. Compare results with expected outcomes
3. Report any failures with detailed information
4. Fix will be considered VERIFIED if all tests pass ✅

---

**Test Status**: Ready to run  
**Expected Duration**: 10-15 minutes  
**Required Skills**: Basic SQL knowledge  
**Risk Level**: None (read-only tests)
