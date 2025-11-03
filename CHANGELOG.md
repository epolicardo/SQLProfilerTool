# Changelog

All notable changes to the SQL Server Profiler Tool extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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