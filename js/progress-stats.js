// The numbers behind the progress page: seasons, weeks, streaks and the milestones ahead.
import { addDays, addYears, daysBetween, today, weekStart } from "./format.js";
import { hasResults } from "./competition-stats.js";

/** A season runs from September to August and is named after the year it starts in: 2025 is 2025/26. */
export function seasonOf(date) {
  const [y, m] = date.split("-").map(Number);
  return m >= 9 ? y : y - 1;
}
export const seasonLabel = year => `${year}/${String(year + 1).slice(2)}`;
export const seasonStart = year => `${year}-09-01`;
export const seasonEnd = year => `${year + 1}-08-31`;

/** Months in season order, as indexes into MONTHS: September first. */
export const SEASON_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Every season from the first session to this one, latest first: hours by type and the weeks trained.
 * `weeks` maps the Monday of each week with a session to its minutes and sessions.
 */
export function seasons(sessions, now = today()) {
  if (!sessions.length) return [];
  const first = sessions.reduce((min, s) => (s.date < min ? s.date : min), sessions[0].date);
  const current = seasonOf(now);
  const list = [];
  for (let year = current; year >= seasonOf(first); year--) {
    const own = sessions.filter(s => seasonOf(s.date) === year && s.date <= now);
    const byType = {};
    const weeks = new Map();
    let minutes = 0;
    for (const s of own) {
      minutes += s.duration;
      byType[s.type] = (byType[s.type] || 0) + s.duration;
      const monday = weekStart(s.date);
      const week = weeks.get(monday) || { minutes: 0, count: 0 };
      week.minutes += s.duration;
      week.count++;
      weeks.set(monday, week);
    }
    list.push({
      year,
      label: seasonLabel(year),
      from: seasonStart(year),
      to: seasonEnd(year),
      current: year === current,
      // a first season that began well after 1 September: it is not compared with full ones
      lateStart: year === seasonOf(first) && daysBetween(seasonStart(year), first) > 31 ? first : null,
      sessions: own,
      count: own.length,
      minutes,
      byType,
      weeks,
    });
  }
  return list;
}

/** Every week of a season with its hours, Monday first; the first one can start in August. */
export function seasonWeeks(season, now = today()) {
  const thisWeek = weekStart(now);
  const slots = [];
  for (let monday = weekStart(season.from); monday <= season.to; monday = addDays(monday, 7)) {
    const week = season.weeks.get(monday);
    slots.push({
      monday,
      offset: daysBetween(season.from, monday),
      minutes: week?.minutes || 0,
      count: week?.count || 0,
      current: monday === thisWeek,
      future: monday > thisWeek,
    });
  }
  return slots;
}

/** Minutes in each month of a season, September first. */
export function monthMinutes(season) {
  const months = Array(12).fill(0);
  for (const s of season.sessions) months[(Number(s.date.slice(5, 7)) + 3) % 12] += s.duration;
  return months;
}

/** Runs of consecutive weeks with at least one session, oldest first, with their first and last session. */
export function streakRuns(sessions) {
  const runs = [];
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const week = weekStart(s.date);
    const last = runs.at(-1);
    if (last && (last.to === week || addDays(last.to, 7) === week)) {
      if (last.to !== week) last.weeks++;
      last.to = week;
      last.end = s.date;
    } else {
      runs.push({ from: week, to: week, weeks: 1, start: s.date, end: s.date });
    }
  }
  return runs;
}

/** The longest run; the latest one when two are as long. */
export const longestRun = runs => runs.reduce((best, run) => (best && best.weeks > run.weeks ? best : run), null);

/** The run still going: it reaches this week, or last week while this one has no session yet. */
export function currentRun(runs, now = today()) {
  const last = runs.at(-1);
  const week = weekStart(now);
  return last && (last.to === week || last.to === addDays(week, -7)) ? last : null;
}

/** What the previous season had done by this same day; null when there was no previous season. */
export function lastSeasonSoFar(sessions, now = today()) {
  const year = seasonOf(now) - 1;
  const previous = sessions.filter(s => seasonOf(s.date) === year);
  if (!previous.length) return null;
  const until = addYears(now, -1);
  const own = previous.filter(s => s.date <= until);
  return { label: seasonLabel(year), count: own.length, minutes: own.reduce((sum, s) => sum + s.duration, 0) };
}

/** The last two seasons that are over and complete, older first: null until there are two. */
export function lastTwoFull(list) {
  const full = list.filter(s => !s.current && !s.lateStart && s.minutes);
  return full.length >= 2 ? [full[1], full[0]] : null;
}

/** The type that moved the most between two seasons, in the same direction as the total (`sign` 1 or -1). */
export function biggestChange(older, newer, sign) {
  let best = null;
  for (const type of new Set([...Object.keys(older.byType), ...Object.keys(newer.byType)])) {
    const from = older.byType[type] || 0, to = newer.byType[type] || 0;
    const delta = (to - from) * sign;
    if (delta > 0 && (!best || delta > best.delta)) best = { type, from, to, delta };
  }
  return best;
}

/** Competitions still to come and goals ahead, nearest first. */
export function milestones(data, now = today()) {
  return [
    ...data.competitions.filter(c => !hasResults(c) && c.date >= now).map(item => ({ kind: "competition", item })),
    ...data.goals.filter(g => g.date >= now).map(item => ({ kind: "goal", item })),
  ].sort((a, b) => a.item.date.localeCompare(b.item.date) || (a.kind === b.kind ? 0 : a.kind === "competition" ? -1 : 1));
}

/** Goals whose day has passed, latest first. */
export const pastGoals = (goals, now = today()) => goals.filter(g => g.date < now).sort((a, b) => b.date.localeCompare(a.date));
