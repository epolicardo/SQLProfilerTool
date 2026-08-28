# SQL Server Profiler Tool - VS Code Extension

## Project Overview
This is a Visual Studio Code extension that provides SQL Server profiling capabilities using Extended Events (XE). The extension captures and analyzes SQL query executions in real-time.

## Architecture
- **Language**: TypeScript
- **Framework**: VS Code Extension API
- **Database**: SQL Server with Extended Events
- **UI**: Webview panels for results display

## Key Components
- `src/extension.ts`: Main extension entry point
- `src/profiler/`: Profiler logic, XE session management, and SQL Server connection handling
- `src/webview/`: Webview HTML provider (`ProfilerWebviewProvider.ts`)
- `media/`: Webview client assets (`profiler.js`, `profiler.css`) shipped in the VSIX
- `src/utils/`: Local diagnostic logger

## Development Guidelines
- Follow VS Code extension best practices
- Use TypeScript strict mode
- Implement proper error handling for database connections
- Ensure secure handling of SQL credentials
- Use webview messaging for UI communication

## Features
- Start/Stop profiling sessions
- Real-time query capture using Extended Events
- Query analysis and performance metrics
- Export captured data
- Connection management for multiple SQL Server instances