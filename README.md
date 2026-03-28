# lifeline-mcp

MCP server and CLI for [Lifeline](https://apps.apple.com/app/id1526186940), the macOS productivity tracker.

Read your session history, break patterns, and pomodoro stats from any AI tool (Claude, Claude Code, ChatGPT) or the command line. Control Lifeline remotely: start/stop sessions with labels and emojis.

## Install

```bash
npm install -g lifeline-mcp
```

## MCP server setup

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lifeline": {
      "command": "npx",
      "args": ["lifeline-mcp"]
    }
  }
}
```

For Claude Code, add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "lifeline": {
      "command": "npx",
      "args": ["lifeline-mcp"]
    }
  }
}
```

## CLI usage

```bash
lifeline-mcp status                    # Current status
lifeline-mcp summary                   # Today's summary
lifeline-mcp summary --week            # Past 7 days
lifeline-mcp summary --month           # Past 30 days
lifeline-mcp day                       # Today's full timeline
lifeline-mcp day 2026-03-15            # Specific day
lifeline-mcp sessions --week           # All sessions this week

lifeline-mcp start "Deep work" --emoji 🧠 --duration 45
lifeline-mcp stop
lifeline-mcp break
lifeline-mcp meeting "Standup" --emoji 📞 --duration 30
```

## MCP tools

| Tool | Description |
|---|---|
| `get_status` | Current state, session info, break debt, pomodoro count |
| `get_day` | Full day activity with timeline, milestones, active periods |
| `get_range` | Activity data for a date range |
| `get_summary` | Computed stats: work time, sessions, pomodoros, labels |
| `start_session` | Start a session (optional: title, emoji, duration, strict) |
| `stop_session` | Stop current session or meeting |
| `start_break` | Start a break |
| `start_meeting` | Start a meeting (optional: title, emoji, duration) |

## How it works

**Reading data:** The tool reads Lifeline's activity JSON files directly from disk. These are stored in the app's sandbox container and contain your full session history.

**Controlling Lifeline:** Write commands (start/stop/break) use AppleScript to communicate with the running Lifeline app. Lifeline must be running for these commands to work.

## Requirements

- macOS
- [Lifeline](https://apps.apple.com/app/id1526186940) v1.8.0 or later (for AppleScript support)
- Node.js 18+ (for npx)

## License

MIT
