# SQL Server Profiler Tool

A Visual Studio Code extension that uses SQL Server Extended Events (XE) to capture and inspect completed SQL activity in real time.

## Features

- Real-time capture of RPC, batch, and statement completion events.
- Filtering, sorting, and search in a VS Code webview.
- JSON export of the currently retained results.
- SQL Server and Azure SQL Database support.
- Automatic cleanup of profiler-owned XE sessions and database connections when profiling stops or the profiler panel closes.

## Requirements

- Visual Studio Code 1.74 or later.
- A SQL Server instance or Azure SQL Database with Extended Events support.
- The Microsoft SQL Server (`mssql`) VS Code extension for connection-profile selection.

### Required permissions

The login used for profiling must be able to manage Extended Events sessions:

- **SQL Server / Azure SQL Managed Instance:** `ALTER ANY EVENT SESSION` and `VIEW SERVER STATE`.
- **Azure SQL Database:** `ALTER ANY DATABASE EVENT SESSION` and `VIEW DATABASE STATE` on the target database (members of `db_owner` have these). Database-scoped Extended Events only capture activity in the connected database, so connect to the database you want to observe rather than `master`.

## Security and Privacy

- Passwords and direct connection strings are stored in VS Code SecretStorage, not in workspace settings.
- Do not add passwords or connection strings to `settings.json`, source control, issue reports, or screenshots.
- Certificate validation remains enabled by default. Only use `trustServerCertificate` when you explicitly understand and accept its risk for a trusted local environment.
- Captured SQL, database names, usernames, and application names remain local to the extension unless you explicitly export or copy them.
- The extension does not send telemetry or captured profiling data to external services.

## Quick Start

1. Install the extension and the Microsoft SQL Server (`mssql`) extension.
2. Configure a connection profile using the `mssql` extension. Do not include passwords in settings; SQL authentication passwords are requested securely when needed.
3. Run **SQL Profiler: Open SQL Server Profiler**.
4. Select a connection and choose **Start**.
5. Choose **Stop** when finished, or close the profiler panel to stop capture and release its resources.

## Connection Profiles

The profiler reads non-secret connection details from `mssql.connections`. For example:

```json
{
  "mssql.connections": [
    {
      "profileName": "Local SQL Server",
      "server": "localhost",
      "database": "master",
      "authenticationType": "Integrated",
      "port": 1433,
      "encrypt": false
    },
    {
      "profileName": "Azure SQL",
      "server": "example.database.windows.net",
      "database": "ExampleDatabase",
      "authenticationType": "SqlLogin",
      "user": "your-user-name",
      "port": 1433,
      "encrypt": true,
      "trustServerCertificate": false
    }
  ],
  "sqlProfiler.selectedConnection": "Local SQL Server"
}
```

When no profile is selected, the extension prompts for a direct connection string using a protected input and stores it in SecretStorage. Existing legacy `sqlProfiler.connectionString` values are migrated out of settings when used.

## Configuration

- `sqlProfiler.sessionName`: Prefix for profiler-owned XE session names. Each running profiler adds a unique suffix so it does not overwrite another profiler session.
- `sqlProfiler.maxEvents`: Maximum number of events retained in memory. The default is `1000`.
- `sqlProfiler.selectedConnection`: Name of the selected `mssql` connection profile.
- `sqlProfiler.autoStart`: Reserved for future use; automatic profiling is not currently enabled.

## Data Retention and Limits

Captured events are held in memory only and are discarded when the extension host stops. The XE ring buffer is capped at 2,000 events and may discard events under sustained load. The profiler prevents overlapping polls and filters its own database queries, but loss detection and a durable target are planned before version 1.0.0.

## Development

```text
npm install
npm run check-types
npm run lint
npm run bundle
```

Run `F5` in VS Code to launch an Extension Development Host.

## Release Status

The current baseline is `0.6.0`, a stabilization release (privacy, packaging, and reduced load on the profiled server). The `0.7.0` milestone adds a durable capture cursor, mid-session reconnection, event-loss reporting, opt-in anonymous telemetry, and an automated test suite. Version `1.0.0` follows once `0.7.x` has been validated on SQL Server, Azure SQL Database, and Azure SQL Managed Instance.

## Support & Feedback

This extension is **free** and always will be. But if you find it useful and want to support continued development, please consider:

### ☕ Buy Me a Coffee

Your caffeine-fueled donations keep the bugs at bay and the features flowing:  
[BuyMeACoffee](https://www.buymeacoffee.com/epolicardo)

### 💖 GitHub Sponsors

Become a sponsor on GitHub to get early access to features and my eternal gratitude:  
[GitHub Sponsors](https://github.com/sponsors/epolicardo)

### 📝 Feedback & Feature Requests

**Your input drives the roadmap.** Please share:

- Bug reports and error logs (without credentials!)
- Feature requests and improvement ideas
- Real-world usage stories and pain points
- Tested scenarios on SQL Server versions you use
- Performance observations and optimization ideas

Open an issue on [GitHub Issues](https://github.com/epolicardo/SQLProfilerTool/issues) or get in touch.

---

**No pressure**—use the tool freely, and if it saves you time or solves a mystery query, that's thanks enough. But if you want to fuel development with coffee money or sponsor feedback, I'm here for it. 😄

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.