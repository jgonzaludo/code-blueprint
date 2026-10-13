export class Counter {
  private n = 0;

  inc(): void {
    this.bump();
  }

  private bump(): void {
    this.n++;
  }
}
