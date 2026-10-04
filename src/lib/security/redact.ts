export function redactSecret(value: string): string {
  if (!value) return "[redacted]";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/[redacted]`;
  } catch {
    if (value.length <= 4) return "[redacted]";
    return `${value.slice(0, 2)}…[redacted]`;
  }
}

export function redactError(value: unknown, secrets: string[] = []): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? "Unknown error");
  let out = raw;
  for (const secret of secrets.filter(Boolean)) out = out.split(secret).join("[redacted]");
  out = out.replace(/https?:\/\/[^\s)\]}>]+/gi, (url) => redactSecret(url));
  return out.slice(0, 500);
}
