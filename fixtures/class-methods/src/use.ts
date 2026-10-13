import { Counter } from './counter';

export function use(c: Counter): void {
  c.inc();
}
