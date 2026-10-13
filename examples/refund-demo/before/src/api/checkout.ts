import { Inventory, Order, processOrder } from "../orders";

declare function loadOrder(id: string): Promise<Order>;

export async function checkoutHandler(
  req: { orderId: string },
  inventory: Inventory
): Promise<Order> {
  const order = await loadOrder(req.orderId);
  return processOrder(order, inventory);
}
