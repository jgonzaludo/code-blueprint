import { roundMoney } from "./utils/money";
import { recordAudit } from "./audit/log";

type OrderStatus = "pending" | "paid" | "shipped" | "cancelled" | "refunded";

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface OrderItem {
  productId: string;
  quantity: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  status: OrderStatus;
  total: number;
}

export class Inventory {
  constructor(private products: Map<string, Product>) {}

  getProduct(id: string): Product {
    const product = this.products.get(id);

    if (!product) {
      throw new Error(`Unknown product: ${id}`);
    }

    return product;
  }

  reserve(productId: string, quantity: number): void {
    const product = this.getProduct(productId);

    if (product.stock < quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }

    product.stock -= quantity;
  }

  restock(productId: string, quantity: number): void {
    const product = this.getProduct(productId);

    product.stock += quantity;
  }
}

function calculateOrderTotal(
  items: OrderItem[],
  inventory: Inventory
): number {
  return roundMoney(items.reduce((total, item) => {
    const product = inventory.getProduct(item.productId);
    return total + product.price * item.quantity;
  }, 0));
}

function reserveOrderStock(
  order: Order,
  inventory: Inventory
): void {
  for (const item of order.items) {
    inventory.reserve(item.productId, item.quantity);
  }
}

export function processOrder(
  order: Order,
  inventory: Inventory
): Order {
  if (order.status !== "pending") {
    throw new Error("Only pending orders can be processed");
  }

  order.total = calculateOrderTotal(order.items, inventory);

  reserveOrderStock(order, inventory);

  order.status = "paid";
  recordAudit("order.paid", order.id);

  return order;
}
