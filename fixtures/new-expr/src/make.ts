import { Widget } from './widget';

export function make(): string {
  const w = new Widget('x');
  return w.render();
}
