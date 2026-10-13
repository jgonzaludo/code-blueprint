// Rounds to whole cents so floating point sums don't leak into totals.
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
