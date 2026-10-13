import { real } from './barrel';
import { alias } from './barrel';

export function go(): number {
  return real() + alias();
}
