import { Inventory, Order } from "../orders";
import { refundOrder } from "../refunds";

declare function loadOrder(id: string): Promise<Order>;

export async function refundHandler(
  req: { orderId: string },
  inventory: Inventory
): Promise<Order> {
  const order = await loadOrder(req.orderId);
  return refundOrder(order, inventory);
}
