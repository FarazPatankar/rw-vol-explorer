# Redis Explorer Implementation

This document describes the Redis explorer feature added to the rw-vol-explorer application.

## Overview

The Redis explorer provides a UI to connect to and interact with Redis instances, similar to the existing Postgres explorer. It allows users to verify Redis connectivity, view instance information, and execute Redis commands.

## Features Implemented

### 1. Backend Redis Support (`src/index.ts`)

- **Redis Client**: Custom lightweight Redis client implementation using Bun's TCP socket API
- **RESP Protocol**: Basic implementation of Redis Serialization Protocol (RESP) for command/response handling
- **Connection Management**: Automatic connection based on `REDIS_URL` environment variable

#### API Endpoints

- **`GET /api/redis/status`**: Returns connection status and instance information
  - Response includes: version, mode, uptime, dbsize, host, port
  - Returns error if REDIS_URL is not configured

- **`GET /api/redis/info`**: Retrieves Redis INFO command output
  - Optional `section` query parameter to get specific info sections

- **`POST /api/redis/command`**: Executes arbitrary Redis commands
  - Request body: `{ command: ["COMMAND", "arg1", "arg2", ...] }`
  - Response includes: result and execution duration

### 2. Frontend Redis Explorer Component (`src/App.tsx`)

#### RedisExplorer Component

A new React component that provides:

1. **Connection Status Display**
   - Visual indicator (green/red dot) for connection state
   - Shows host, port, Redis version, mode, key count, and uptime
   - Error message display when not connected

2. **Quick Commands**
   - Pre-configured buttons for common commands:
     - PING - Test connectivity
     - INFO - Get server information
     - DBSIZE - Get number of keys
     - KEYS * - List all keys

3. **Command Input**
   - Text input for custom Redis commands
   - Enter key to execute
   - Command history support through browser

4. **Result Display**
   - Formatted output for different Redis response types
   - Execution time display
   - Error handling with clear error messages
   - Support for nil, strings, integers, and arrays

### 3. UI Layout

The Redis explorer is positioned below the Postgres explorer in the main application layout, separated by a border for clear visual distinction.

## Configuration

To use the Redis explorer, set the `REDIS_URL` environment variable:

```bash
REDIS_URL=redis://[password@]host:port
```

Example:
```bash
REDIS_URL=redis://localhost:6379
REDIS_URL=redis://password@redis.example.com:6379
```

If `REDIS_URL` is not set, the explorer will display a "Not Connected" message indicating that Redis is not configured.

## Technical Details

### Redis Client Implementation

The custom Redis client uses:
- Bun's `Bun.connect()` for TCP socket connections
- RESP (Redis Serialization Protocol) for communication
- Promise-based async API
- Automatic connection cleanup with timeouts

### Supported Response Types

- Simple strings (e.g., "OK", "PONG")
- Errors (displayed with error styling)
- Integers (e.g., DBSIZE response)
- Bulk strings (e.g., GET response)
- Arrays (e.g., KEYS response)

### Error Handling

- Connection errors are caught and displayed
- Command errors show Redis error messages
- Timeout protection (5 seconds per command)
- Graceful degradation when Redis is unavailable

## Usage Examples

1. **Test Connection**
   - Click "PING" button
   - Expected result: "PONG"

2. **View Server Info**
   - Click "INFO" button
   - Shows detailed server information

3. **Count Keys**
   - Click "DBSIZE" button
   - Returns number of keys in current database

4. **Custom Commands**
   - Type: `SET mykey myvalue`
   - Type: `GET mykey`
   - Type: `DEL mykey`

## Future Enhancements

Potential improvements for future iterations:

- Key browser with pagination
- Value editor for different data types (strings, lists, sets, hashes)
- TTL management
- Database selection (SELECT command)
- Command history with up/down arrows
- Syntax highlighting for commands
- Auto-complete for Redis commands
- Pub/Sub monitoring
- Cluster support
