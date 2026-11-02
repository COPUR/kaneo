// Which Slack thread belongs to which Kaneo card, kept in a JSON file so
// replies still reach the card after a restart. Losing the file only means
// old threads stop syncing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function threadStore(file, log = console.log) {
  let map = {};
  try {
    if (existsSync(file)) map = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    log(`cannot read ${file}: ${error.message}`);
  }
  const key = (channel, ts) => `${channel}:${ts}`;
  return {
    get: (channel, ts) => map[key(channel, ts)] ?? null,
    set(channel, ts, card) {
      map[key(channel, ts)] = card;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`);
      } catch (error) {
        log(`cannot save ${file}: ${error.message}`);
      }
    },
  };
}
