export function over(a: string): string;
export function over(a: number): number;
export function over(a: any): any {
  return a;
}

export enum Color {
  Red,
  Green,
}

export namespace Util {
  export const one = 1;
}

setup();

function setup(): void {}
