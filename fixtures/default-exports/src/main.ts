import greet from './greet';
import Thing from './Thing';

export function main(): string {
  const t = new Thing();
  t.run();
  return greet();
}
