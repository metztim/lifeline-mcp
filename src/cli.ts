#!/usr/bin/env node

import {
  getStatus,
  getSignOff,
  readDay,
  readRange,
  computeSummary,
  getLabels,
  startSession,
  stopSession,
  startBreak,
  startMeeting,
  addActivity,
  localDateStr,
} from "./lifeline.js";

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function today(): string {
  return localDateStr();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
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

async function cmdSignOff() {
  const signOff = await getSignOff();
  if (signOff.error) {
    console.error(signOff.error);
    process.exit(1);
  }

  if (!signOff.enabled) {
    console.log("Sign off: disabled");
    return;
  }
  if (signOff.committedToday) {
    console.log(`Sign off: committed for today`);
    console.log(`Stop time: ${signOff.stopTime}`);
    console.log(`Lock at: ${signOff.lockTime} (grace ${signOff.graceMin} min)`);
    // Duration-mode releases can land the same evening; only the classic
    // next-morning mode gets the "tomorrow" wording.
    const releaseSuffix = signOff.releaseMode === "afterDuration" ? "" : " tomorrow";
    console.log(`Releases: ${signOff.releaseTime}${releaseSuffix}`);
    if (signOff.lockEngaged) {
      console.log(`Lock engaged at: ${signOff.lockEngagedAt}`);
    }
  } else {
    console.log("Sign off: enabled, no commitment yet today");
    console.log(`Default stop: ${signOff.stopTime}`);
  }
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

async function cmdLabels(from?: string, to?: string) {
  const labels = await getLabels(from, to);
  if (labels.length === 0) {
    console.log("No labels found in the date range.");
    return;
  }

  // Column widths
  const maxLabel = Math.max(5, ...labels.map((l) => l.fullLabel.length));
  const header = `${"Label".padEnd(maxLabel)}  ${"Count".padStart(5)}  ${"First seen"}  ${"Last seen"}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const l of labels) {
    console.log(
      `${l.fullLabel.padEnd(maxLabel)}  ${String(l.count).padStart(5)}  ${l.firstSeen}  ${l.lastSeen}`
    );
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
        // Unknown flags (incl. --help) must never become a session title —
        // that silently starts a session named "--help".
        rejectUnknownFlag("start", args[i]);
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
        rejectUnknownFlag("meeting", args[i]);
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

async function cmdAddActivity(args: string[]) {
  const options: any = { type: "session" };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--type": options.type = args[++i]; break;
      case "--date": options.on = args[++i]; break;
      case "--from": options.starting = args[++i]; break;
      case "--to": options.ending = args[++i]; break;
      case "--title": options.title = args[++i]; break;
      case "--emoji": options.emoji = args[++i]; break;
      default:
        rejectUnknownFlag("add", args[i]);
        if (!options.title) options.title = args[i];
    }
  }
  if (!options.starting || !options.ending) {
    console.error("add requires --from HH:mm and --to HH:mm");
    process.exit(1);
  }
  const result = await addActivity(options);
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(
    `Added ${options.type} ${options.starting}-${options.ending}` +
      `${options.on ? ` on ${options.on}` : ""}` +
      `${options.title ? `: ${options.emoji || ""}${options.title}` : ""}`
  );
}

// Exit with usage when a subcommand receives an unrecognized flag. Bare
// words are allowed (they become the title); dash-prefixed ones are not.
function rejectUnknownFlag(command: string, arg: string) {
  if (!arg.startsWith("-")) return;
  console.error(`Unknown flag for ${command}: ${arg}\n`);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`lifeline-mcp - Lifeline productivity tracker CLI & MCP server

Usage:
  lifeline-mcp                     Start MCP server (stdio)
  lifeline-mcp status              Current status
  lifeline-mcp sign-off            Today's sign-off commitment
  lifeline-mcp summary [--week|--month|--from DATE --to DATE]
  lifeline-mcp day [DATE]          Full day timeline
  lifeline-mcp sessions [--week|--month|--from DATE --to DATE]
  lifeline-mcp labels [--week|--month|--from DATE --to DATE]
  lifeline-mcp start [TITLE] [--emoji E] [--duration M] [--strict]
  lifeline-mcp stop                Stop current session/meeting
  lifeline-mcp break               Start a break
  lifeline-mcp meeting [TITLE] [--emoji E] [--duration M]
  lifeline-mcp add [TITLE] --from HH:mm --to HH:mm [--date DATE] [--type session|meeting] [--emoji E]

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
    case "sign-off":
    case "signoff":
      await cmdSignOff();
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
    case "labels": {
      const range = parseDateRange(args.slice(1));
      // Default to 90 days if no range flags given
      const hasRangeFlag = args.slice(1).some((a) =>
        ["--week", "--month", "--from", "--to"].includes(a)
      );
      await cmdLabels(
        hasRangeFlag ? range.from : undefined,
        hasRangeFlag ? range.to : undefined
      );
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
    case "add":
      await cmdAddActivity(args.slice(1));
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
