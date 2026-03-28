#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

const server = new Server(
  { name: "lifeline-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_status",
      description:
        "Get Lifeline's current status: whether you're in a session, meeting, break, or idle. Includes current session label/emoji, elapsed time, break debt, and today's pomodoro count.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "get_day",
      description:
        "Get full activity data for a specific day: all sessions, breaks, meetings, milestones, and active periods with timestamps, labels, and emojis.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format. Defaults to today.",
          },
        },
      },
    },
    {
      name: "get_range",
      description:
        "Get activity data for a date range. Returns all days with data in the range.",
      inputSchema: {
        type: "object" as const,
        properties: {
          from: { type: "string", description: "Start date (YYYY-MM-DD)." },
          to: { type: "string", description: "End date (YYYY-MM-DD)." },
        },
        required: ["from", "to"],
      },
    },
    {
      name: "get_summary",
      description:
        "Get computed productivity stats for a date or range: total session time, meeting time, pomodoro count, session count, and label breakdown.",
      inputSchema: {
        type: "object" as const,
        properties: {
          from: {
            type: "string",
            description:
              "Start date (YYYY-MM-DD). Defaults to today.",
          },
          to: {
            type: "string",
            description:
              "End date (YYYY-MM-DD). Defaults to from date.",
          },
        },
      },
    },
    {
      name: "start_session",
      description:
        "Start a timed work session in Lifeline. Optionally set a label, emoji, duration, and strict/committed mode.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Session label." },
          emoji: { type: "string", description: "Session emoji." },
          duration: {
            type: "number",
            description: "Duration in minutes (default: user's configured length).",
          },
          strict: {
            type: "boolean",
            description: "Enable committed/strict mode.",
          },
        },
      },
    },
    {
      name: "stop_session",
      description: "Stop the current session or meeting in Lifeline.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "start_break",
      description: "Start a break in Lifeline.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "start_meeting",
      description:
        "Start a meeting in Lifeline. Optionally set a label, emoji, and duration.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Meeting label." },
          emoji: { type: "string", description: "Meeting emoji." },
          duration: {
            type: "number",
            description: "Duration in minutes (default: 60).",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_status": {
      const status = await getStatus();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }

    case "get_day": {
      const date = (args?.date as string) || new Date().toISOString().split("T")[0];
      const day = await readDay(date);
      if (!day) {
        return { content: [{ type: "text", text: `No activity data for ${date}.` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(day, null, 2) }] };
    }

    case "get_range": {
      const from = args?.from as string;
      const to = args?.to as string;
      const days = await readRange(from, to);
      return { content: [{ type: "text", text: JSON.stringify({ days, count: days.length }, null, 2) }] };
    }

    case "get_summary": {
      const from = (args?.from as string) || new Date().toISOString().split("T")[0];
      const to = (args?.to as string) || from;
      const days = await readRange(from, to);
      const summary = computeSummary(days);
      return { content: [{ type: "text", text: JSON.stringify({ from, to, ...summary }, null, 2) }] };
    }

    case "start_session": {
      const result = await startSession({
        title: args?.title as string | undefined,
        emoji: args?.emoji as string | undefined,
        duration: args?.duration as number | undefined,
        strict: args?.strict as boolean | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "stop_session": {
      const result = await stopSession();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "start_break": {
      const result = await startBreak();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "start_meeting": {
      const result = await startMeeting({
        title: args?.title as string | undefined,
        emoji: args?.emoji as string | undefined,
        duration: args?.duration as number | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
