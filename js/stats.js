import { addDays, today, weekStart } from "./format.js";

export function groupByDate(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
  }
  return map;
}

export function summarize(sessions) {
  const byType = {};
  const days = new Set();
  let minutes = 0;
  for (const s of sessions) {
    minutes += s.duration;
    byType[s.type] = (byType[s.type] || 0) + s.duration;
    days.add(s.date);
  }
  return { count: sessions.length, minutes, days: days.size, byType };
}

/** Consecutive weeks with at least one session, up to this week (or last week, if this one is still empty). */
export function weekStreak(sessions) {
  const weeks = new Set(sessions.map(s => weekStart(s.date)));
  let week = weekStart(today());
  if (!weeks.has(week)) week = addDays(week, -7);
  let n = 0;
  while (weeks.has(week)) {
    n++;
    week = addDays(week, -7);
  }
  return n;
}
