import { Inventory, Order } from "./orders";
import { roundMoney } from "./utils/money";
import { recordAudit } from "./audit/log";

function calculateRefundTotal(order: Order, inventory: Inventory): number {
  return roundMoney(order.items.reduce((total, item) => {
    const product = inventory.getProduct(item.productId);
    return total + product.price * item.quantity;
  }, 0));
}

function restockOrderItems(order: Order, inventory: Inventory): void {
  for (const item of order.items) {
    inventory.restock(item.productId, item.quantity);
  }
}

export function refundOrder(order: Order, inventory: Inventory): Order {
  if (order.status !== "paid") {
    throw new Error("Only paid orders can be refunded");
  }

  const amount = calculateRefundTotal(order, inventory);
  order.total = roundMoney(order.total - amount);

  restockOrderItems(order, inventory);

  order.status = "refunded";
  recordAudit("order.refunded", order.id);

  return order;
}
