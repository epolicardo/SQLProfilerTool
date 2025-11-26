# [0.3.0] - 2025-11-25

### 🚀 Telemetry & Privacy
- **NEW**: Anonymous usage and error telemetry is now collected to help improve the extension.
- **NEW**: Telemetry can be disabled via the `sqlProfiler.telemetryEnabled` setting or VS Code's global privacy settings.
- **PRIVACY**: No personal data, SQL queries, connection strings, usernames, or sensitive information is ever collected.
- **DOCS**: README and implementation guide updated with privacy and opt-out details.

### 🛠️ Other Improvements
- Internal refactoring and code quality enhancements for maintainability.

# Changelog

All notable changes to the SQL Server Profiler Tool extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-11-04

### 🚀 Major Usability Improvements
- **NEW**: **Persistent Expanded State** - Events remain expanded during real-time capture
- **NEW**: **Unique Event IDs** - Each event has a stable identifier for state tracking
- **NEW**: **Scroll Position Preservation** - View position maintained when new events arrive
- **NEW**: **Connection Pool Management** - Intelligent connection pooling for better performance
- **NEW**: **🛡️ Anti-Recursion System** - Intelligent filtering prevents profiler from capturing its own queries

### ✨ Enhanced Real-Time Analysis
- **IMPROVED**: Users can now analyze event details without stopping capture
- **IMPROVED**: Multiple events can remain expanded simultaneously
- **IMPROVED**: Smooth experience during high-traffic database monitoring
- **IMPROVED**: Context preservation during long troubleshooting sessions
- **IMPROVED**: **Clean Results** - Internal profiler queries no longer appear in capture results
- **IMPROVED**: **Reduced Noise** - System maintenance queries automatically filtered out

### 🔧 Connection & Performance Enhancements
- **NEW**: **ConnectionPoolManager** - Singleton pattern for efficient connection reuse
- **NEW**: **Configurable Pool Settings** - Customizable pool size, timeouts, and health checks
- **IMPROVED**: **Auto-format Correction** - Automatic Azure SQL server name format fixes
- **IMPROVED**: **Boolean Type Safety** - Fixed encrypt/trustServerCertificate configuration issues

### 🐛 Critical Bug Fixes
- **FIXED**: `config.options.encrypt must be of type boolean` error
- **FIXED**: `ENOTFOUND` errors with malformed server names (e.g., `server.database.windows.net,1433`)
- **FIXED**: Event details collapsing when new events arrive during capture
- **FIXED**: Loss of scroll position during real-time updates
- **FIXED**: **Recursive Query Capture** - Profiler no longer captures its own internal queries
- **FIXED**: **Query Result Pollution** - Eliminated irrelevant system queries from user results

### 📊 Technical Architecture
- **NEW**: Event ID generation using timestamp + content hash
- **NEW**: In-memory state management for expanded events (Set-based)
- **NEW**: Automatic scroll position capture and restoration
- **NEW**: Smart state cleanup on results clear/connection change
- **NEW**: **Multi-layer Query Filtering** - Application name, session name, and system query filters
- **NEW**: **Connection Tagging** - All connections identified as "SQL Profiler Tool for VS Code"
- **NEW**: **Anti-recursion Algorithm** - Dynamic filter generation with multiple protection levels

### 🎯 User Experience Impact
- **Before**: Users had to stop profiling to analyze event details
- **After**: Users can analyze events in real-time without interruption
- **Result**: 100% improvement in troubleshooting workflow efficiency

---

## [0.1.0] - 2024-10-31

### 🎨 Major UI/UX Improvements
- **NEW**: Ultra-compact toolbar design that maximizes space for event display
- **NEW**: Single-line header consolidates all controls (saves ~140px vertical space)
- **NEW**: Smart 3-section layout: Connection + Status | Controls | Filters
- **NEW**: Toast-style notifications that auto-disappear after 3 seconds
- **NEW**: Responsive design with mobile/small screen support

### ✨ Enhanced User Experience  
- **NEW**: Expandable row details with click-to-expand functionality
- **NEW**: Copy SQL to clipboard feature for easy query reuse
- **NEW**: Open SQL in new VS Code tab with metadata comments
- **NEW**: CSP-compliant event handling for better security
- **NEW**: Sticky header that stays visible during scrolling

### 🔧 Connection & Reliability Improvements
- **IMPROVED**: Auto-retry mechanism for SSL handshake errors (Error 10054)
- **IMPROVED**: Automatic Azure SQL Database connection string format correction
- **IMPROVED**: Enhanced Extended Events configuration with multiple data sources
- **IMPROVED**: Comprehensive XML parsing with fallback mechanisms
- **IMPROVED**: Better error handling and debugging capabilities

### 🐛 Bug Fixes
- **FIXED**: "Unknown" values in profiler results through enhanced XML parsing
- **FIXED**: "Simplified Capture" fallback mode with proper query extraction
- **FIXED**: Content Security Policy violations with inline event handlers
- **FIXED**: Connection status persistence and visual feedback
- **FIXED**: Event count accuracy and real-time updates

### 📊 Performance & Data Capture
- **IMPROVED**: More reliable Extended Events session management
- **IMPROVED**: Better SQL statement extraction from various XE field sources
- **IMPROVED**: Enhanced error logging and troubleshooting capabilities
- **IMPROVED**: Optimized webview rendering and memory usage

### 🛠️ Technical Improvements
- **IMPROVED**: TypeScript strict mode compliance
- **IMPROVED**: Better separation of concerns in codebase architecture
- **IMPROVED**: Enhanced VS Code extension API integration
- **IMPROVED**: Improved mssql extension compatibility and connection reuse

---

## [0.0.5] - 2024-10-30

### Initial Features
- Basic SQL Server profiling using Extended Events
- Connection management through VS Code mssql extension
- Real-time query capture and display
- Basic filtering and search capabilities
- Export functionality for captured events

---

## Installation & Usage

### Prerequisites
- VS Code 1.74.0 or higher
- SQL Server mssql extension installed
- Access to SQL Server instance (on-premises or Azure SQL Database)

### Quick Start
1. Install the extension from VS Code marketplace
2. Open Command Palette (`Ctrl+Shift+P`)
3. Run "SQL Server Profiler Tool"
4. Select your SQL Server connection
5. Click "Start Profiling" to begin capturing events

### New in v0.1.0
- **Compact Interface**: Much more space for viewing captured events
- **Expandable Details**: Click any row to see detailed information
- **Quick Actions**: Copy SQL or open in new tab with right-click menu
- **Better Reliability**: Improved connection handling and error recovery

For detailed documentation and troubleshooting, see the README.md file.