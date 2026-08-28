# Changelog

All notable changes to the SQL Server Profiler Tool extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-08-28

Stabilization release on the road to 1.0.0. Focus: privacy, packaging, and
reducing load on the profiled server. No change to the capture feature set.

### 🔒 Security & Privacy
- **SECURITY**: Removed all remaining diagnostic `console` output that printed
  the server name, database name, user name and connection options. The
  0.5.1 notes claimed this was done; it is now actually complete. The
  extension no longer writes to the Developer Tools console at all.
- **SECURITY**: `Logger` now writes only to the "SQL Server Profiler" output
  channel, never logs raw error/connection objects, and reduces errors to a
  code. New `sqlProfiler.verboseLogging` setting (default off) gates detailed
  local diagnostics. Local logs never leave the machine.
- **SECURITY**: Connection error messages no longer embed example server names
  or user names, and no longer recommend disabling TLS certificate validation
  except as an explicit last resort with a stated risk.
- **SECURITY**: The webview now HTML-escapes every captured field (including
  quotes in attribute context) before rendering, and the Content-Security-Policy
  was tightened (`img-src`/`font-src`/`connect-src`/`frame-src`/`base-uri`, no
  inline styles).
- **SECURITY**: Webview messages received by the extension are now type- and
  length-validated.
- **SECURITY**: `Encrypt=true` is the default for raw connection strings unless
  explicitly disabled; connection-string parsing no longer breaks on values
  that contain `=` (e.g. passwords).
- **SECURITY**: Exporting results now shows a confirmation noting the file
  contains raw SQL and identifiers in clear text.
- **SECURITY**: Removed `profiler-results.json` (which contained real captured
  data) from the repository.

### 🚀 Performance
- **FIXED**: Database engine detection (`@@VERSION`) ran on every 2-second
  polling cycle and in every session lifecycle method — roughly 14,000 wasted
  round-trips per 8-hour session. It now runs once per connection and is cached.
- **IMPROVED**: Engine detection uses `SERVERPROPERTY('EngineEdition')`, which
  correctly distinguishes Azure SQL Database from Azure SQL Managed Instance
  and box SQL Server.
- **REMOVED**: The `testBasicEventCapture` debug probe that issued extra queries
  on every poll while no events had been captured yet.
- **IMPROVED**: Defence-in-depth against self-capture — the profiler's own
  queries are dropped client-side even if the server-side app-name filter misses.

### 📦 Packaging
- **FIXED**: Webview assets (`profiler.js`, `profiler.css`) moved to `media/` so
  they are reliably included in the packaged extension.
- **NEW**: The extension is now bundled with esbuild. VSIX size dropped from
  ~13.8 MB to ~0.5 MB (10 files instead of ~9,400).
- **FIXED**: Marketplace icon is now a 128×128 PNG.
- **CHANGED**: `categories` corrected (removed "Debuggers"); added `license`
  field; documented the deprecated `sqlProfiler.connectionString` setting.
- **CHORE**: Moved internal development notes out of the repository root;
  translated the sample query script to English.

### 🧰 Tech debt
- Split `compile` into `check-types` (`tsc --noEmit`) + `bundle` (esbuild).
- Simplified the 168-line connection-error handler to a small code-mapped table.
- Typed previously `any` webview-message and connection-mapping code.

## [0.5.1] - 2026-08-28

### 🔒 Security & Privacy Hardening
- **SECURITY**: Removed all diagnostic logging of captured SQL statements and XML payloads
- **SECURITY**: Removed connection string and credential logging from Logger output
- **SECURITY**: Enforces TLS validation by default; TrustServerCertificate requires explicit opt-in
- **SECURITY**: Filters out extension's own queries (WHERE ... client_app_name <> 'VS Code SQL Profiler')
- **SECURITY**: Session names now include UUID suffix to prevent cross-instance collisions
- **SECURITY**: Prevents accidental session data loss by only dropping owned sessions

### 🔧 Lifecycle & Concurrency Management
- **IMPROVED**: Webview close now properly stops profiling and releases all resources
- **IMPROVED**: Serialized start/stop operations to prevent race conditions
- **IMPROVED**: Graceful cleanup on extension deactivation (async await for disposal)
- **IMPROVED**: Unique Extended Events session names prevent multi-instance conflicts
- **IMPROVED**: Polling lock prevents overlapping collection cycles

### 📊 Event Deduplication & Retention
- **IMPROVED**: Independent 2,000-event deduplication window (unaffected by result clearing)
- **IMPROVED**: Configurable max event retention (1–10,000) via package.json settings
- **IMPROVED**: Ring buffer loss handling via ALLOW_SINGLE_EVENT_LOSS and capped 2,000 events

### 🚀 Connection & TLS Improvements
- **FIXED**: Connection string parsing correctly maps `Encrypt=true` and `TrustServerCertificate`
- **FIXED**: TLS/SSL option handling no longer conflicts with integrated authentication
- **IMPROVED**: Better error messages for connection failures

### 📖 Documentation & Packaging
- **NEW**: MIT LICENSE file for Marketplace compliance
- **NEW**: Support & Feedback sections with BuyMeACoffee and GitHub Sponsors links
- **NEW**: Enhanced README with security/privacy emphasis and real-world connection examples
- **NEW**: .vscodeignore to optimize VSIX size and exclude unnecessary files
- **IMPROVED**: package.json now includes repository, homepage, and bugs URLs for discoverability

### 🧪 Quality Assurance
- **IMPROVED**: TypeScript strict mode compliance with no-explicit-any policy
- **IMPROVED**: ESLint configuration (@typescript-eslint/recommended) with 0 violations
- **IMPROVED**: Comprehensive error handling for database operations

### ⚠️ Known Limitations
- Ring buffer may lose events under sustained load (planned durable target for 0.6.x)
- Manual integration testing required on live SQL Server/Azure SQL instances
- Automated test suite pending (0.6.x milestone)

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