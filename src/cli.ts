#!/usr/bin/env node

import {
  getStatus,
  readDay,
  readRange,
  computeSummary,
  startSession,
  stopSession,
  startBreak,
  startMeeting,
} from "./lifeline.js";

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

async function cmdStatus() {
  const status = await getStatus();
  if (status.error) {
    console.error(status.error);
    process.exit(1);
  }

  console.log(`State: ${status.state}`);
  if (status.label) console.log(`Label: ${status.emoji || ""}${status.label}`);
  if (status.elapsedSeconds)
    console.log(`Elapsed: ${formatSeconds(status.elapsedSeconds)}`);
  console.log(`Break debt: ${formatSeconds(status.breakDebtSeconds || 0)}`);
  console.log(`Pomodoros: ${status.pomodoroCount || 0}`);
  console.log(`Session time: ${formatSeconds(status.sessionSeconds || 0)}`);
  console.log(`Meeting time: ${formatSeconds(status.meetingSeconds || 0)}`);
}

async function cmdSummary(from: string, to: string) {
  const days = await readRange(from, to);
  const summary = computeSummary(days);

  console.log(`Period: ${from} to ${to}`);
  console.log(`Days with data: ${summary.days}`);
  console.log(`Sessions: ${summary.sessionCount}`);
  console.log(`Session time: ${summary.formatted.sessionTime}`);
  console.log(`Meeting time: ${summary.formatted.meetingTime}`);
  console.log(`Pomodoros: ${summary.pomodoroCount}`);

  if (Object.keys(summary.labels).length > 0) {
    console.log(`\nLabels:`);
    const sorted = Object.entries(summary.labels).sort(
      ([, a], [, b]) => b - a
    );
    for (const [label, count] of sorted) {
      console.log(`  ${label}: ${count} session${count > 1 ? "s" : ""}`);
    }
  }
}

async function cmdDay(date: string) {
  const day = await readDay(date);
  if (!day) {
    console.log(`No activity data for ${date}.`);
    return;
  }

  console.log(`Date: ${day.date}`);
  console.log(`\nTimeline:`);
  for (let i = 0; i < day.nodes.length; i++) {
    const node = day.nodes[i];
    const hours = Math.floor(node.seconds / 3600);
    const mins = Math.floor((node.seconds % 3600) / 60);
    const time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    let line = `  ${time}  ${node.state}`;
    if (node.emoji) line += ` ${node.emoji}`;
    if (node.title) line += ` ${node.title}`;
    console.log(line);
  }

  if (day.milestones.length > 0) {
    console.log(`\nMilestones:`);
    for (const m of day.milestones) {
      const hours = Math.floor(m.seconds / 3600);
      const mins = Math.floor((m.seconds % 3600) / 60);
      const time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
      console.log(`  ${time}  ${m.type}`);
    }
  }
}

async function cmdSessions(from: string, to: string) {
  const days = await readRange(from, to);
  for (const day of days) {
    for (let i = 0; i < day.nodes.length; i++) {
      const node = day.nodes[i];
      if (
        node.state !== "inSession" &&
        node.state !== "editedSession" &&
        node.state !== "manualSession"
      )
        continue;

      const endSeconds =
        i + 1 < day.nodes.length
          ? day.nodes[i + 1].seconds
          : node.seconds;
      const duration = endSeconds - node.seconds;
      const label = [node.emoji, node.title].filter(Boolean).join(" ");

      const hours = Math.floor(node.seconds / 3600);
      const mins = Math.floor((node.seconds % 3600) / 60);
      const time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

      console.log(
        `${day.date}  ${time}  ${formatSeconds(duration).padStart(6)}  ${label || "(no label)"}`
      );
    }
  }
}

async function cmdStartSession(args: string[]) {
  const options: any = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--title": options.title = args[++i]; break;
      case "--emoji": options.emoji = args[++i]; break;
      case "--duration": options.duration = parseInt(args[++i]); break;
      case "--strict": options.strict = true; break;
      default:
        // Positional: treat as title
        if (!options.title) options.title = args[i];
    }
  }
  const result = await startSession(options);
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(
    `Session started${options.title ? `: ${options.emoji || ""}${options.title}` : ""}`
  );
}

async function cmdStopSession() {
  const result = await stopSession();
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`${result.type || "Session"} stopped (${formatSeconds(result.elapsedSeconds || 0)})`);
}

async function cmdStartBreak() {
  const result = await startBreak();
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`Break started (break debt: ${formatSeconds(result.breakDebtSeconds || 0)})`);
}

async function cmdStartMeeting(args: string[]) {
  const options: any = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--title": options.title = args[++i]; break;
      case "--emoji": options.emoji = args[++i]; break;
      case "--duration": options.duration = parseInt(args[++i]); break;
      default:
        if (!options.title) options.title = args[i];
    }
  }
  const result = await startMeeting(options);
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(
    `Meeting started${options.title ? `: ${options.emoji || ""}${options.title}` : ""}`
  );
}

function printUsage() {
  console.log(`lifeline-mcp - Lifeline productivity tracker CLI & MCP server

Usage:
  lifeline-mcp                     Start MCP server (stdio)
  lifeline-mcp status              Current status
  lifeline-mcp summary [--week|--month|--from DATE --to DATE]
  lifeline-mcp day [DATE]          Full day timeline
  lifeline-mcp sessions [--week|--month|--from DATE --to DATE]
  lifeline-mcp start [TITLE] [--emoji E] [--duration M] [--strict]
  lifeline-mcp stop                Stop current session/meeting
  lifeline-mcp break               Start a break
  lifeline-mcp meeting [TITLE] [--emoji E] [--duration M]

Date format: YYYY-MM-DD. Defaults to today.`);
}

function parseDateRange(args: string[]): { from: string; to: string } {
  let from = today();
  let to = today();

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--week":
        from = daysAgo(7);
        to = today();
        break;
      case "--month":
        from = daysAgo(30);
        to = today();
        break;
      case "--from":
        from = args[++i];
        break;
      case "--to":
        to = args[++i];
        break;
    }
  }

  return { from, to };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // No command = MCP server mode
  if (!command) {
    // Dynamic import to avoid loading MCP SDK for CLI usage
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { StdioServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/stdio.js"
    );
    // server.ts handles this, but for the bin entry point we re-export
    await import("./server.js");
    return;
  }

  switch (command) {
    case "status":
      await cmdStatus();
      break;
    case "summary": {
      const range = parseDateRange(args.slice(1));
      await cmdSummary(range.from, range.to);
      break;
    }
    case "day": {
      const date = args[1] || today();
      await cmdDay(date);
      break;
    }
    case "sessions": {
      const range = parseDateRange(args.slice(1));
      await cmdSessions(range.from, range.to);
      break;
    }
    case "start":
      await cmdStartSession(args.slice(1));
      break;
    case "stop":
      await cmdStopSession();
      break;
    case "break":
      await cmdStartBreak();
      break;
    case "meeting":
      await cmdStartMeeting(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
