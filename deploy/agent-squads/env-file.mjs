// Fills empty secrets in .env text and keeps every value already set, so a
// PostgreSQL volume created with an earlier password keeps working.
export function fillSecrets(text, secrets) {
  const seen = new Set();
  const lines = text.split("\n").map((line) => {
    const match = /^(\s*)([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !(match[2] in secrets)) return line;
    seen.add(match[2]);
    return match[3].trim()
      ? line
      : `${match[1]}${match[2]}=${secrets[match[2]]}`;
  });
  for (const [name, value] of Object.entries(secrets)) {
    if (!seen.has(name)) lines.push(`${name}=${value}`);
  }
  return lines.join("\n");
}
