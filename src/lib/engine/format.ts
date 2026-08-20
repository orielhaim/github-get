export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000)
    return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatRelativeDate(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = (Date.now() - then) / 1000;
  const table: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [86400 * 30, "day"],
    [86400 * 365, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  const divisors = [1, 60, 3600, 86400, 86400 * 30, 86400 * 365];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (let i = 0; i < table.length; i += 1) {
    if (seconds < table[i][0]) {
      return rtf.format(-Math.round(seconds / divisors[i]), table[i][1]);
    }
  }
  return "";
}
