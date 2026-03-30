# lifeline-mcp

MCP server and CLI for [Lifeline](https://apps.apple.com/app/id1526186940), the macOS productivity tracker.

Read your session history, break patterns, and pomodoro stats from any AI tool (Claude, Claude Code, ChatGPT) or the command line. Control Lifeline remotely: start and stop sessions, take breaks, log meetings.

## Quick start

### Claude Code (one command)

```bash
claude mcp add lifeline -- npx lifeline-mcp
```

That's it. Claude Code can now read your Lifeline data and control sessions.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop after saving.

### Other AI tools

Any tool that supports the [Model Context Protocol](https://modelcontextprotocol.io) can use this server. Point it at `npx lifeline-mcp`.

### CLI only

```bash
npm install -g lifeline-mcp
```

## What you can do

### Ask your AI tool about your work patterns

- "How many pomodoros did I complete this week?"
- "Show me my session history for today"
- "What's my average session length this month?"
- "When did I last take a break? How much break debt do I have?"
- "Compare my Monday and Friday productivity"
- "Which session labels do I use most?"

### Control Lifeline from your AI tool

- "Start a 45-minute deep work session"
- "I'm going into a meeting with Nathan"
- "Stop my session"
- "Time for a break"

### Use the CLI for quick checks

```bash
lifeline status                    # What's happening right now
lifeline summary                   # Today's stats
lifeline summary --week            # Past 7 days
lifeline summary --month           # Past 30 days
lifeline day                       # Today's full timeline
lifeline day 2026-03-15            # Specific day
lifeline sessions --week           # All sessions this week
```

### Automate with the CLI

```bash
lifeline start "Deep work" --emoji 🧠 --duration 45
lifeline stop
lifeline break
lifeline meeting "Standup" --emoji 📞 --duration 30
```

## MCP tools reference

| Tool | Description |
|---|---|
| `get_status` | Current state, active session info, break debt, pomodoro count |
| `get_day` | Full day activity with timeline, milestones, active periods |
| `get_range` | Activity data for a date range |
| `get_summary` | Computed stats: work time, sessions, pomodoros, labels |
| `start_session` | Start a session (optional: title, emoji, duration, strict mode) |
| `stop_session` | Stop current session or meeting |
| `start_break` | Start a break |
| `start_meeting` | Start a meeting (optional: title, emoji, duration) |

## How it works

**Reading data:** Reads Lifeline's activity JSON files directly from the app's sandbox container (`~/Library/Containers/com.saent.lifeline/`). No network requests, no API keys — your data stays local.

**Controlling Lifeline:** Write commands (start, stop, break, meeting) use AppleScript to communicate with the running Lifeline app. Lifeline must be running for these commands to work.

## Requirements

- macOS
- [Lifeline](https://apps.apple.com/app/id1526186940) v1.8.0 or later (for AppleScript support)
- Node.js 18+ (for npx)

## License

MIT
