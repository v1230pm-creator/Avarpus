/** Human-readable byte count ("1.5 MB"); whole numbers once a value passes 100 units. */
export function formatBytes(bytes: number): string {
  const magnitude = Math.abs(bytes);
  if (magnitude < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = magnitude / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${bytes < 0 ? "-" : ""}${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
