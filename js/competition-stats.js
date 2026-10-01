// The numbers behind the competitions page: upcoming competitions, palmarès, opponents, rounds.
import { today } from "./format.js";
import { SPECIALTIES } from "./types.js";

export const hasResults = c => c.specialties.length > 0;

/** Competitions still to come, nearest first. */
export const upcoming = (comps, now = today()) =>
  comps.filter(c => !hasResults(c) && c.date >= now).sort((a, b) => a.date.localeCompare(b.date));

/** Past competitions whose results were never entered, latest first. */
export const awaitingResults = (comps, now = today()) =>
  comps.filter(c => !hasResults(c) && c.date < now).sort((a, b) => b.date.localeCompare(a.date));

/** Competitions with results, latest first. */
export const withResults = comps => comps.filter(hasResults).sort((a, b) => b.date.localeCompare(a.date));

const chronological = comps => comps.filter(hasResults).sort((a, b) => a.date.localeCompare(b.date));

function* matchesOf(comps) {
  for (const competition of comps)
    for (const specialty of competition.specialties)
      for (const match of specialty.matches) yield { competition, specialty, match };
}

const fold = s => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Same person whatever the case, accents or word order: "Teodori Demis" and "Demis Teodori". */
export const personKey = name => fold(name).split(" ").sort().join(" ");

const noMedals = () => ({ gold: 0, silver: 0, bronze: 0 });

function tally(target, specialty) {
  if (specialty.medal in target.medals) target.medals[specialty.medal]++;
  for (const m of specialty.matches) {
    if (m.result === "won") target.won++;
    else if (m.result === "lost") target.lost++;
  }
}

export function palmares(comps) {
  const done = comps.filter(hasResults);
  const total = { competitions: done.length, medals: noMedals(), won: 0, lost: 0 };
  for (const c of done) c.specialties.forEach(sp => tally(total, sp));
  total.medalCount = total.medals.gold + total.medals.silver + total.medals.bronze;
  return total;
}

const specialtyRank = name => {
  const i = SPECIALTIES.findIndex(s => fold(s) === fold(name));
  return i < 0 ? SPECIALTIES.length : i;
};

/** Medals and record for each specialty, in the order of the form. */
export function bySpecialty(comps) {
  const rows = new Map();
  for (const c of comps.filter(hasResults)) {
    for (const sp of c.specialties) {
      const key = fold(sp.name);
      if (!rows.has(key)) rows.set(key, { name: sp.name, competitions: 0, medals: noMedals(), won: 0, lost: 0 });
      const row = rows.get(key);
      row.competitions++;
      tally(row, sp);
    }
  }
  return [...rows.values()].sort((a, b) => specialtyRank(a.name) - specialtyRank(b.name) || a.name.localeCompare(b.name));
}

/** Everyone I have fought, with every meeting in time order; most met first, then most recent. */
export function opponents(comps) {
  const people = new Map();
  for (const meeting of matchesOf(chronological(comps))) {
    const name = meeting.match.opponent?.trim();
    if (!name) continue;
    const key = personKey(name);
    if (!people.has(key)) people.set(key, { key, name, won: 0, lost: 0, meetings: [] });
    const person = people.get(key);
    person.name = name;
    if (meeting.match.result === "won") person.won++;
    else if (meeting.match.result === "lost") person.lost++;
    person.meetings.push(meeting);
  }
  const lastMet = p => p.meetings.at(-1).competition.date;
  return [...people.values()].sort((a, b) => b.meetings.length - a.meetings.length || lastMet(b).localeCompare(lastMet(a)));
}

export const roundOutcome = r => (r.me > r.opponent ? "won" : r.me < r.opponent ? "lost" : "draw");

/** Every scored round grouped by its number: all the first rounds, all the second rounds... */
export function roundsByNumber(comps) {
  const rows = [];
  for (const meeting of matchesOf(chronological(comps))) {
    meeting.match.rounds.forEach((round, i) => {
      if (typeof round.me !== "number" || typeof round.opponent !== "number") return;
      (rows[i] ||= []).push({ ...meeting, round, outcome: roundOutcome(round) });
    });
  }
  return Array.from(rows, (items, i) => ({ number: i + 1, items: items || [] })).filter(row => row.items.length);
}
