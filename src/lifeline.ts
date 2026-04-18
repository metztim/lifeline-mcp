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

/** Parse HH:mm or HH:mm:ss to seconds since midnight. Throws on invalid input. */
export function parseTimeToSeconds(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid time "${hhmm}" — expected HH:mm or HH:mm:ss`);
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mm > 59 || ss > 59) throw new Error(`Invalid time "${hhmm}" — out of range`);
  return h * 3600 + mm * 60 + ss;
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
  try {
    if (args.starting) script += ` starting ${parseTimeToSeconds(args.starting)}`;
    if (args.ending) script += ` ending ${parseTimeToSeconds(args.ending)}`;
  } catch (e: any) {
    return { error: e.message };
  }
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
  let script: string;
  try {
    const startSec = parseTimeToSeconds(args.starting);
    const endSec = parseTimeToSeconds(args.ending);
    script = `tell application "Lifeline" to add activity type "${args.type}" starting ${startSec} ending ${endSec}`;
  } catch (e: any) {
    return { error: e.message };
  }
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

// Active states: any state where the user is doing something (not idle)
const ACTIVE_STATES = new Set([
  "inSession", "editedSession", "manualSession",
  "inMeeting", "editedMeeting", "manualMeeting",
  "sports", "meditation", "sleep",
]);

const SESSION_ONLY_STATES = new Set([
  "inSession", "editedSession", "manualSession",
]);

const MEETING_ONLY_STATES = new Set([
  "inMeeting", "editedMeeting", "manualMeeting",
]);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface AnalyticsResult {
  period: { from: string; to: string; totalDays: number; daysWithData: number };
  totals: {
    sessionMinutes: number;
    meetingMinutes: number;
    activeMinutes: number;
    pomodoroCount: number;
  };
  dailyAverages: {
    sessionMinutes: number;
    meetingMinutes: number;
    activeMinutes: number;
    pomodoros: number;
  };
  hourlyDistribution: Record<number, number>; // hour (0-23) -> total active minutes
  labelBreakdown: { label: string; minutes: number; percentage: number }[];
  dayOfWeekBreakdown: Record<string, number>; // day name -> avg active minutes
  streaks: { current: number; longest: number };
}

function computeNodeDurations(nodes: ActivityNode[]) {
  const results: { state: string; seconds: number; durationSeconds: number; emoji?: string; title?: string }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextSeconds = i + 1 < nodes.length ? nodes[i + 1].seconds : node.seconds;
    const duration = nextSeconds - node.seconds;
    if (duration > 0) {
      results.push({
        state: node.state,
        seconds: node.seconds,
        durationSeconds: duration,
        ...(node.emoji && { emoji: node.emoji }),
        ...(node.title && { title: node.title }),
      });
    }
  }
  return results;
}

export async function computeAnalytics(from: string, to: string): Promise<AnalyticsResult> {
  const days = await readRange(from, to);

  // Count total calendar days in range
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const startDate = new Date(fy, fm - 1, fd, 12);
  const endDate = new Date(ty, tm - 1, td, 12);
  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

  let sessionSeconds = 0;
  let meetingSeconds = 0;
  let activeSeconds = 0;
  let pomodoroCount = 0;

  const hourlyMinutes: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourlyMinutes[h] = 0;

  const labelMinutes: Record<string, number> = {};
  const dayOfWeekSeconds: Record<string, number[]> = {};
  for (const name of DAY_NAMES) dayOfWeekSeconds[name] = [];

  // Track which dates have sessions for streak calculation
  const datesWithSessions = new Set<string>();

  for (const day of days) {
    // Pomodoro count
    for (const m of day.milestones) {
      if (m.type === "pomodoro") pomodoroCount++;
    }

    const durations = computeNodeDurations(day.nodes);
    let dayActiveSeconds = 0;

    for (const d of durations) {
      const isSession = SESSION_ONLY_STATES.has(d.state);
      const isMeeting = MEETING_ONLY_STATES.has(d.state);
      const isActive = ACTIVE_STATES.has(d.state);

      if (isSession) sessionSeconds += d.durationSeconds;
      if (isMeeting) meetingSeconds += d.durationSeconds;
      if (isActive) {
        activeSeconds += d.durationSeconds;
        dayActiveSeconds += d.durationSeconds;

        // Track sessions for streaks
        if (isSession || isMeeting) datesWithSessions.add(day.date);

        // Hourly distribution: spread duration across hours
        let remaining = d.durationSeconds;
        let currentSecond = d.seconds;
        while (remaining > 0) {
          const hour = Math.floor(currentSecond / 3600) % 24;
          const secondsUntilNextHour = 3600 - (currentSecond % 3600);
          const chunk = Math.min(remaining, secondsUntilNextHour);
          hourlyMinutes[hour] += chunk / 60;
          currentSecond += chunk;
          remaining -= chunk;
        }

        // Label breakdown (sessions/meetings with labels)
        if ((isSession || isMeeting) && (d.title || d.emoji)) {
          const label = [d.emoji, d.title].filter(Boolean).join("");
          labelMinutes[label] = (labelMinutes[label] || 0) + d.durationSeconds / 60;
        }
      }
    }

    // Day-of-week breakdown
    const [dy, dm, dd] = day.date.split("-").map(Number);
    const dayDate = new Date(dy, dm - 1, dd);
    const dayName = DAY_NAMES[dayDate.getDay()];
    dayOfWeekSeconds[dayName].push(dayActiveSeconds);
  }

  // Compute streaks
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  // Walk all calendar days in range
  const cursor = new Date(startDate);
  const allDates: string[] = [];
  while (cursor <= endDate) {
    allDates.push(localDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const dateStr of allDates) {
    if (datesWithSessions.has(dateStr)) {
      tempStreak++;
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  }

  // Current streak: count backwards from end of range
  for (let i = allDates.length - 1; i >= 0; i--) {
    if (datesWithSessions.has(allDates[i])) {
      currentStreak++;
    } else {
      break;
    }
  }

  const daysWithData = days.length;
  const avgDivisor = daysWithData || 1;

  // Label breakdown with percentages
  const totalActiveMinutes = activeSeconds / 60;
  const labelBreakdown = Object.entries(labelMinutes)
    .map(([label, minutes]) => ({
      label,
      minutes: Math.round(minutes),
      percentage: totalActiveMinutes > 0 ? Math.round((minutes / totalActiveMinutes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // Day-of-week averages
  const dayOfWeekBreakdown: Record<string, number> = {};
  for (const name of DAY_NAMES) {
    const vals = dayOfWeekSeconds[name];
    dayOfWeekBreakdown[name] = vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length / 60)
      : 0;
  }

  // Round hourly distribution
  for (const h of Object.keys(hourlyMinutes)) {
    hourlyMinutes[Number(h)] = Math.round(hourlyMinutes[Number(h)]);
  }

  return {
    period: { from, to, totalDays, daysWithData },
    totals: {
      sessionMinutes: Math.round(sessionSeconds / 60),
      meetingMinutes: Math.round(meetingSeconds / 60),
      activeMinutes: Math.round(activeSeconds / 60),
      pomodoroCount,
    },
    dailyAverages: {
      sessionMinutes: Math.round(sessionSeconds / 60 / avgDivisor),
      meetingMinutes: Math.round(meetingSeconds / 60 / avgDivisor),
      activeMinutes: Math.round(activeSeconds / 60 / avgDivisor),
      pomodoros: Math.round((pomodoroCount / avgDivisor) * 10) / 10,
    },
    hourlyDistribution: hourlyMinutes,
    labelBreakdown,
    dayOfWeekBreakdown,
    streaks: { current: currentStreak, longest: longestStreak },
  };
}

export interface PeriodComparison {
  period1: { from: string; to: string; stats: AnalyticsResult };
  period2: { from: string; to: string; stats: AnalyticsResult };
  changes: {
    sessionMinutes: { value: number; percentage: number };
    meetingMinutes: { value: number; percentage: number };
    activeMinutes: { value: number; percentage: number };
    pomodoroCount: { value: number; percentage: number };
    dailyAvgSession: { value: number; percentage: number };
    dailyAvgMeeting: { value: number; percentage: number };
    dailyAvgActive: { value: number; percentage: number };
    dailyAvgPomodoros: { value: number; percentage: number };
  };
  labelComparison: {
    label: string;
    period1Minutes: number;
    period2Minutes: number;
    change: number;
  }[];
}

function pctChange(old: number, now: number): number {
  if (old === 0) return now === 0 ? 0 : 100;
  return Math.round(((now - old) / old) * 1000) / 10;
}

export async function comparePeriods(
  p1Start: string, p1End: string,
  p2Start: string, p2End: string,
): Promise<PeriodComparison> {
  const [stats1, stats2] = await Promise.all([
    computeAnalytics(p1Start, p1End),
    computeAnalytics(p2Start, p2End),
  ]);

  const t1 = stats1.totals;
  const t2 = stats2.totals;
  const a1 = stats1.dailyAverages;
  const a2 = stats2.dailyAverages;

  const changes = {
    sessionMinutes: { value: t2.sessionMinutes - t1.sessionMinutes, percentage: pctChange(t1.sessionMinutes, t2.sessionMinutes) },
    meetingMinutes: { value: t2.meetingMinutes - t1.meetingMinutes, percentage: pctChange(t1.meetingMinutes, t2.meetingMinutes) },
    activeMinutes: { value: t2.activeMinutes - t1.activeMinutes, percentage: pctChange(t1.activeMinutes, t2.activeMinutes) },
    pomodoroCount: { value: t2.pomodoroCount - t1.pomodoroCount, percentage: pctChange(t1.pomodoroCount, t2.pomodoroCount) },
    dailyAvgSession: { value: a2.sessionMinutes - a1.sessionMinutes, percentage: pctChange(a1.sessionMinutes, a2.sessionMinutes) },
    dailyAvgMeeting: { value: a2.meetingMinutes - a1.meetingMinutes, percentage: pctChange(a1.meetingMinutes, a2.meetingMinutes) },
    dailyAvgActive: { value: a2.activeMinutes - a1.activeMinutes, percentage: pctChange(a1.activeMinutes, a2.activeMinutes) },
    dailyAvgPomodoros: { value: a2.pomodoros - a1.pomodoros, percentage: pctChange(a1.pomodoros, a2.pomodoros) },
  };

  // Label comparison: union of all labels from both periods
  const allLabels = new Set<string>();
  for (const l of stats1.labelBreakdown) allLabels.add(l.label);
  for (const l of stats2.labelBreakdown) allLabels.add(l.label);

  const p1LabelMap = new Map(stats1.labelBreakdown.map(l => [l.label, l.minutes]));
  const p2LabelMap = new Map(stats2.labelBreakdown.map(l => [l.label, l.minutes]));

  const labelComparison = Array.from(allLabels).map(label => {
    const p1Min = p1LabelMap.get(label) || 0;
    const p2Min = p2LabelMap.get(label) || 0;
    return { label, period1Minutes: p1Min, period2Minutes: p2Min, change: p2Min - p1Min };
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    period1: { from: p1Start, to: p1End, stats: stats1 },
    period2: { from: p2Start, to: p2End, stats: stats2 },
    changes,
    labelComparison,
  };
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
