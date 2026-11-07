const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

export function isVersion(value: string): boolean {
  return VERSION.test(value);
}

/** Negative, zero or positive like a comparator. A pre-release sorts before its release. Throws on a non-version. */
export function compareVersions(a: string, b: string): number {
  const left = VERSION.exec(a);
  const right = VERSION.exec(b);
  if (!left || !right) throw new Error(`not a version: "${left ? b : a}"`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff;
  }
  if (left[4] === right[4]) return 0;
  if (left[4] === undefined) return 1;
  if (right[4] === undefined) return -1;
  return left[4] < right[4] ? -1 : 1;
}
