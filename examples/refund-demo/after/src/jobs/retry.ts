import { Inventory, Order, processOrder } from "../orders";

export function retryFailed(orders: Order[], inventory: Inventory): void {
  for (const order of orders) {
    processOrder(order, inventory);
  }
}
