import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Sandboxed App Store path
const ACTIVITY_PATH = join(
  homedir(),
  "Library/Containers/com.saent.lifeline/Data/Library/Application Support/com.saent.lifeline/activity"
);

// Development build path (fallback)
const DEV_ACTIVITY_PATH = join(
  homedir(),
  "Library/Application Support/com.saent.lifeline/activity"
);

export interface ActivityNode {
  seconds: number;
  state: string;
  emoji?: string;
  title?: string;
}

export interface Milestone {
  seconds: number;
  type: string;
}

export interface ActivePeriod {
  start: number;
  end: number;
}

export interface DayActivity {
  date: string;
  nodes: ActivityNode[];
  milestones: Milestone[];
  activePeriods: ActivePeriod[];
  achievements?: Record<string, number>;
}

// State integer to string mapping (matches ActivityNode.State in Swift)
const STATE_MAP: Record<number, string> = {
  0: "idle",
  1: "active",
  11: "inSession",
  12: "inMeeting",
  13: "editedSession",
  14: "manualSession",
  15: "sports",
  16: "meditation",
  17: "sleep",
  18: "editedMeeting",
  19: "manualMeeting",
};

// Milestone type mapping
const MILESTONE_MAP: Record<number, string> = {
  1500: "pomodoro",
  600: "deprecated_carrot",
  3000: "deprecated_banana",
  5400: "deprecated_pineapple",
  86401: "palmtree",
  86402: "perfectPomodoro",
  86403: "halfwayPomodoro",
  86404: "customCycle",
};

/** Format a Date as YYYY-MM-DD in the user's local timezone */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getActivityPath(): Promise<string> {
  try {
    await readdir(ACTIVITY_PATH);
    return ACTIVITY_PATH;
  } catch {
    return DEV_ACTIVITY_PATH;
  }
}

function parseRawDay(raw: any): DayActivity {
  const nodes: ActivityNode[] = (raw.nodes || []).map((n: any) => ({
    seconds: n.seconds,
    state: STATE_MAP[n.state] || `unknown(${n.state})`,
    ...(n.emoji && { emoji: n.emoji }),
    ...(n.title && { title: n.title }),
  }));

  const milestones: Milestone[] = (raw.milestones || []).map((m: any) => ({
    seconds: m.seconds,
    type: MILESTONE_MAP[m.type] || `unknown(${m.type})`,
  }));

  const activePeriods: ActivePeriod[] = (raw.activePeriods || []).map(
    (p: any) => ({
      start: p.start,
      end: p.end,
    })
  );

  // Date is stored as Core Foundation absolute time (seconds since 2001-01-01)
  let dateStr = "unknown";
  if (raw.date != null) {
    const CF_EPOCH = new Date("2001-01-01T00:00:00Z").getTime();
    const d = new Date(CF_EPOCH + raw.date * 1000);
    dateStr = localDateStr(d);
  }

  return { date: dateStr, nodes, milestones, activePeriods, achievements: raw.achievements };
}

export async function readDay(dateStr: string): Promise<DayActivity | null> {
  const basePath = await getActivityPath();
  const [year, month, day] = dateStr.split("-");
  const filePath = join(basePath, year, month, day);

  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    const result = parseRawDay(raw);
    // Use file path date (always correct) over stored CF timestamp (timezone issues)
    result.date = dateStr;
    return result;
  } catch {
    return null;
  }
}

export async function readRange(
  from: string,
  to: string
): Promise<DayActivity[]> {
  const days: DayActivity[] = [];
  // Parse as local dates (noon avoids DST edge cases)
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd, 12);
  const end = new Date(ty, tm - 1, td, 12);
  const current = new Date(start);

  while (current <= end) {
    const dateStr = localDateStr(current);
    const day = await readDay(dateStr);
    if (day) days.push(day);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function computeSummary(days: DayActivity[]) {
  let sessionSeconds = 0;
  let meetingSeconds = 0;
  let idleSeconds = 0;
  let pomodoroCount = 0;
  let sessionCount = 0;
  const labels: Record<string, number> = {};

  for (const day of days) {
    // Count milestones
    for (const m of day.milestones) {
      if (m.type === "pomodoro") pomodoroCount++;
    }

    // Calculate durations from nodes
    for (let i = 0; i < day.nodes.length; i++) {
      const node = day.nodes[i];
      const nextSeconds =
        i + 1 < day.nodes.length
          ? day.nodes[i + 1].seconds
          : node.seconds; // last node: no duration

      const duration = nextSeconds - node.seconds;

      if (
        node.state === "inSession" ||
        node.state === "editedSession" ||
        node.state === "manualSession"
      ) {
        sessionSeconds += duration;
        sessionCount++;
        if (node.title || node.emoji) {
          const label = [node.emoji, node.title].filter(Boolean).join("");
          labels[label] = (labels[label] || 0) + 1;
        }
      } else if (
        node.state === "inMeeting" ||
        node.state === "editedMeeting" ||
        node.state === "manualMeeting"
      ) {
        meetingSeconds += duration;
      } else if (node.state === "idle") {
        idleSeconds += duration;
      }
    }
  }

  return {
    days: days.length,
    sessionSeconds,
    meetingSeconds,
    idleSeconds,
    pomodoroCount,
    sessionCount,
    labels,
    formatted: {
      sessionTime: formatSeconds(sessionSeconds),
      meetingTime: formatSeconds(meetingSeconds),
      idleTime: formatSeconds(idleSeconds),
    },
  };
}

// AppleScript bridge for real-time commands
async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await exec("osascript", ["-e", script]);
  return stdout.trim();
}

export async function getStatus(): Promise<Record<string, any>> {
  const script = 'tell application "Lifeline" to fetch status';
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    // Lifeline not running or no AppleScript support
    return { error: `Could not connect to Lifeline: ${e.message}` };
  }
}

export async function startSession(options: {
  title?: string;
  emoji?: string;
  duration?: number;
  strict?: boolean;
}): Promise<Record<string, any>> {
  let params = "";
  if (options.title) params += ` title "${options.title}"`;
  if (options.emoji) params += ` emoji "${options.emoji}"`;
  if (options.duration) params += ` duration ${options.duration}`;
  if (options.strict) params += ` strict true`;
  const script = `tell application "Lifeline" to start session${params}`;
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function stopSession(): Promise<Record<string, any>> {
  const script = 'tell application "Lifeline" to stop session';
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function startBreak(): Promise<Record<string, any>> {
  const script = 'tell application "Lifeline" to start break';
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function startMeeting(options: {
  title?: string;
  emoji?: string;
  duration?: number;
}): Promise<Record<string, any>> {
  let params = "";
  if (options.title) params += ` title "${options.title}"`;
  if (options.emoji) params += ` emoji "${options.emoji}"`;
  if (options.duration) params += ` duration ${options.duration}`;
  const script = `tell application "Lifeline" to start meeting${params}`;
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function editActivity(args: {
  seconds: number;
  on?: string;
  title?: string;
  emoji?: string;
  starting?: string;
  ending?: string;
}): Promise<Record<string, any>> {
  let script = `tell application "Lifeline" to edit activity seconds ${args.seconds}`;
  if (args.on) script += ` on "${args.on}"`;
  if (args.title) script += ` title "${args.title}"`;
  if (args.emoji) script += ` emoji "${args.emoji}"`;
  if (args.starting) script += ` starting "${args.starting}"`;
  if (args.ending) script += ` ending "${args.ending}"`;
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function addActivity(args: {
  type: string;
  starting: string;
  ending: string;
  on?: string;
  title?: string;
  emoji?: string;
}): Promise<Record<string, any>> {
  let script = `tell application "Lifeline" to add activity type "${args.type}" starting "${args.starting}" ending "${args.ending}"`;
  if (args.on) script += ` on "${args.on}"`;
  if (args.title) script += ` title "${args.title}"`;
  if (args.emoji) script += ` emoji "${args.emoji}"`;
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function deleteActivity(args: {
  seconds: number;
  on?: string;
}): Promise<Record<string, any>> {
  let script = `tell application "Lifeline" to delete activity seconds ${args.seconds}`;
  if (args.on) script += ` on "${args.on}"`;
  try {
    const result = await runAppleScript(script);
    return parseAppleScriptRecord(result);
  } catch (e: any) {
    return { error: e.message };
  }
}

export interface LabelInfo {
  emoji: string;
  title: string;
  fullLabel: string;
  count: number;
  firstSeen: string;  // YYYY-MM-DD
  lastSeen: string;   // YYYY-MM-DD
}

const SESSION_STATES = new Set([
  "inSession", "editedSession", "manualSession",
  "inMeeting", "editedMeeting", "manualMeeting",
]);

export async function getLabels(
  from?: string,
  to?: string
): Promise<LabelInfo[]> {
  const toDate = to || localDateStr();
  let fromDate = from;
  if (!fromDate) {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    fromDate = localDateStr(d);
  }

  const days = await readRange(fromDate, toDate);
  const map = new Map<string, { emoji: string; title: string; count: number; firstSeen: string; lastSeen: string }>();

  for (const day of days) {
    for (const node of day.nodes) {
      if (!SESSION_STATES.has(node.state)) continue;
      if (!node.title && !node.emoji) continue;

      const emoji = node.emoji || "";
      const title = node.title || "";
      const fullLabel = [emoji, title].filter(Boolean).join("");

      const existing = map.get(fullLabel);
      if (existing) {
        existing.count++;
        if (day.date < existing.firstSeen) existing.firstSeen = day.date;
        if (day.date > existing.lastSeen) existing.lastSeen = day.date;
      } else {
        map.set(fullLabel, { emoji, title, count: 1, firstSeen: day.date, lastSeen: day.date });
      }
    }
  }

  return Array.from(map.entries())
    .map(([fullLabel, info]) => ({ fullLabel, ...info }))
    .sort((a, b) => b.count - a.count);
}

// Basic AppleScript record parser (handles {key:value, key:value} format)
function parseAppleScriptRecord(str: string): Record<string, any> {
  // AppleScript returns records like: {state:"session", label:"Deep work", elapsedSeconds:1500}
  const result: Record<string, any> = {};
  // Remove outer braces
  const inner = str.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!inner) return result;

  // Split on commas (but not within quotes)
  const pairs = inner.split(/,\s*(?=\w+:)/);
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx === -1) continue;
    const key = pair.substring(0, colonIdx).trim();
    let value: any = pair.substring(colonIdx + 1).trim();
    // Parse value types
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    else if (!isNaN(Number(value))) value = Number(value);
    result[key] = value;
  }
  return result;
}
