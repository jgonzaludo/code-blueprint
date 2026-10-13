export class Widget {
  constructor(private label: string) {}

  render(): string {
    return this.label;
  }
}
