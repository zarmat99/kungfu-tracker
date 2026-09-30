export const TYPES = {
  "taichi-yiquan": { label: "Taichi e Yiquan", sub: "Lunedì e giovedì sera", glyph: "太极", color: "var(--c-taichi)", duration: 90 },
  shaolin: { label: "Shaolin", sub: "Pranzo o lezione doppia", glyph: "少林", color: "var(--c-shaolin)", duration: 90 },
  xingyi: { label: "Xing Yi", sub: "Mercoledì a pranzo", glyph: "形意", color: "var(--c-xingyi)", duration: 105 },
  combat: { label: "Combattimento", sub: "Tuishou · Sanda", glyph: "散打", color: "var(--c-combat)", duration: 120 },
  event: { label: "Evento", sub: "Seminari · Stage · Camp", glyph: "会", color: "var(--c-event)", duration: 240 },
};

export const TYPE_KEYS = Object.keys(TYPES);

export const typeOf = key => TYPES[key] || { label: key, sub: "", glyph: "拳", color: "var(--c-other)", duration: 90 };

export const MEDALS = { gold: "Oro", silver: "Argento", bronze: "Bronzo" };
export const LEVELS = { international: "Gara internazionale", national: "Gara nazionale" };
