/** Compact decimal for mesh files: up to 4 decimals, no trailing zeros. */
export function num(v: number): string {
  const s = (Math.round(v * 10000) / 10000).toString();
  return s === '-0' ? '0' : s;
}

export function hex6(c: number): string {
  return (c & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}
