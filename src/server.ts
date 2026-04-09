#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
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
  getLabels,
  editActivity,
  addActivity,
  deleteActivity,
  localDateStr,
} from "./lifeline.js";

const server = new Server(
  { name: "lifeline-mcp", version: "0.1.0" },
  { capabilities: { tools: {}, prompts: {} } }
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
      name: "get_labels",
      description:
        "Get all unique session and meeting labels from history, with frequency counts and date ranges. Useful for suggesting labels when starting sessions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          from: {
            type: "string",
            description: "Start date (YYYY-MM-DD). Defaults to 90 days ago.",
          },
          to: {
            type: "string",
            description: "End date (YYYY-MM-DD). Defaults to today.",
          },
        },
      },
    },
    {
      name: "start_session",
      description:
        "Start a timed work session in Lifeline. Before starting, consider using get_labels to check the user's recent labels and suggest an appropriate one. Optionally set a label, emoji, duration, and strict/committed mode.",
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
    {
      name: "edit_activity",
      description:
        "Edit an existing activity's properties (title, emoji, start/end time). Identify the activity by its seconds-since-midnight value.",
      inputSchema: {
        type: "object" as const,
        properties: {
          seconds: {
            type: "integer",
            description: "Seconds since midnight, identifies the activity.",
          },
          on: {
            type: "string",
            description: "Date in YYYY-MM-DD format. Defaults to today.",
          },
          title: { type: "string", description: "New title." },
          emoji: { type: "string", description: "New emoji." },
          starting: {
            type: "string",
            description: "New start time in HH:mm format.",
          },
          ending: {
            type: "string",
            description: "New end time in HH:mm format.",
          },
        },
        required: ["seconds"],
      },
    },
    {
      name: "add_activity",
      description:
        "Add a new activity to a day. Specify type, start time, end time, and optionally a title and emoji.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["session", "meeting", "sports", "meditation", "sleep"],
            description: "Activity type.",
          },
          starting: {
            type: "string",
            description: "Start time in HH:mm format.",
          },
          ending: {
            type: "string",
            description: "End time in HH:mm format.",
          },
          on: {
            type: "string",
            description: "Date in YYYY-MM-DD format. Defaults to today.",
          },
          title: { type: "string", description: "Activity title." },
          emoji: { type: "string", description: "Activity emoji." },
        },
        required: ["type", "starting", "ending"],
      },
    },
    {
      name: "delete_activity",
      description:
        "Delete an activity from a day. Identify the activity by its seconds-since-midnight value.",
      inputSchema: {
        type: "object" as const,
        properties: {
          seconds: {
            type: "integer",
            description: "Seconds since midnight, identifies the activity.",
          },
          on: {
            type: "string",
            description: "Date in YYYY-MM-DD format. Defaults to today.",
          },
        },
        required: ["seconds"],
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
      const date = (args?.date as string) || localDateStr();
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
      const from = (args?.from as string) || localDateStr();
      const to = (args?.to as string) || from;
      const days = await readRange(from, to);
      const summary = computeSummary(days);
      return { content: [{ type: "text", text: JSON.stringify({ from, to, ...summary }, null, 2) }] };
    }

    case "get_labels": {
      const labels = await getLabels(
        args?.from as string | undefined,
        args?.to as string | undefined
      );
      return { content: [{ type: "text", text: JSON.stringify(labels, null, 2) }] };
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

    case "edit_activity": {
      const result = await editActivity({
        seconds: args?.seconds as number,
        on: args?.on as string | undefined,
        title: args?.title as string | undefined,
        emoji: args?.emoji as string | undefined,
        starting: args?.starting as string | undefined,
        ending: args?.ending as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "add_activity": {
      const result = await addActivity({
        type: args?.type as string,
        starting: args?.starting as string,
        ending: args?.ending as string,
        on: args?.on as string | undefined,
        title: args?.title as string | undefined,
        emoji: args?.emoji as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "delete_activity": {
      const result = await deleteActivity({
        seconds: args?.seconds as number,
        on: args?.on as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "weekly-review",
      description: "Analyze my past week of productivity",
    },
    {
      name: "productivity-patterns",
      description: "When am I most productive?",
    },
    {
      name: "label-audit",
      description: "Review my labels and suggest cleanup",
    },
    {
      name: "break-health",
      description: "Am I taking enough breaks?",
    },
    {
      name: "meeting-load",
      description: "Analyze my meeting patterns",
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;

  switch (name) {
    case "weekly-review":
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Use get_range to fetch my last 7 days of activity data, then use get_summary for the same period. Analyze my week: how much focused work did I do? How does session time compare to meeting time? Which labels did I use most? Were there any days I didn't work at all? Give me a concise weekly review with highlights and areas for improvement.",
            },
          },
        ],
      };

    case "productivity-patterns":
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Use get_range to fetch my last 30 days of activity data. Analyze the raw node timestamps to determine: what time of day do I typically start working? When are my longest sessions? Do I have consistent patterns or is my schedule erratic? When do most meetings happen? Identify my peak productivity windows and suggest how to protect them.",
            },
          },
        ],
      };

    case "label-audit":
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Use get_labels to fetch all my session and meeting labels. Review them for: duplicate or near-duplicate labels (e.g. same task with different emoji or slight spelling variations), labels used only once or twice that could be consolidated, missing emoji on frequently used labels, and overly generic labels that could be more specific. Suggest a cleaned-up label set.",
            },
          },
        ],
      };

    case "break-health":
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Use get_range to fetch my last 14 days of activity data and get_status for current break debt. Analyze my break patterns: am I taking breaks between sessions? How long are my breaks relative to session time? Do I have long stretches without any breaks? Am I accumulating break debt? Give me an honest assessment of my break habits and specific suggestions.",
            },
          },
        ],
      };

    case "meeting-load":
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Use get_range to fetch my last 30 days of activity data and use get_labels to see meeting labels. Analyze: what percentage of my active time is meetings vs focused sessions? Which meetings recur most? Are meetings clustered on certain days? How much time do I lose to context switching around meetings? Suggest ways to optimize my meeting schedule for more focused work time.",
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
