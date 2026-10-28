// Compares the Host header's name, without its port, to the allowed names.
export function isAllowedHost(
  hostHeader: string | undefined,
  allowed: string[],
): boolean {
  if (!hostHeader) return false;
  const name = hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : (hostHeader.split(":")[0] ?? "");
  return allowed.includes(name.toLowerCase());
}
