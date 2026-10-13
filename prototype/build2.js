const fs = require('fs');
const dir = __dirname;
const g = JSON.parse(fs.readFileSync(dir + '/graph2.json', 'utf8'));
const O = 'src/orders.ts::';
g.sums = {
  [O + 'processOrder']: "Entry point of the file. Rejects any order that isn't pending, totals it with calculateOrderTotal, reserves stock with reserveOrderStock, marks the order paid, writes an audit line with recordAudit (defined in src/audit/log.ts), and returns the order. Nothing else in this file calls it.",
  [O + 'calculateOrderTotal']: "Adds up price * quantity for each item, looking each product up through Inventory.getProduct, then rounds the result with roundMoney (from src/utils/money.ts). Called once, from processOrder.",
  [O + 'reserveOrderStock']: "Loops over the order's items and calls Inventory.reserve for each one. Called from processOrder. If a later item throws, earlier items stay reserved, since nothing rolls back.",
  [O + 'Inventory']: "The product catalog, backed by a Map of Product. getProduct looks one up and throws if it's missing. reserve checks stock and subtracts from it in place.",
  [O + 'Inventory.constructor']: "Stores the products Map as a private field. getProduct is the only method that reads it.",
  [O + 'Inventory.getProduct']: "Looks a product up by id and throws 'Unknown product' if it isn't there. Used by Inventory.reserve and by calculateOrderTotal.",
  [O + 'Inventory.reserve']: "Fetches the product with getProduct, throws if stock is too low, otherwise subtracts the quantity from stock in place. Called from reserveOrderStock.",
  [O + 'Product']: "Shape of a catalog entry: id, name, price, stock. Referenced by Inventory (constructor and getProduct).",
  [O + 'OrderItem']: "One line on an order: a productId and a quantity. Used by Order, calculateOrderTotal.",
  [O + 'Order']: "An order: id, items, status, total. Used by reserveOrderStock and processOrder.",
  [O + 'OrderStatus']: "The allowed order states: pending, paid, shipped, cancelled. Used by Order. processOrder only accepts pending and sets paid.",
  'src/utils/money.ts::roundMoney': "Defined in src/utils/money.ts. Rounds an amount to whole cents. Used once, by calculateOrderTotal.",
  'src/audit/log.ts::recordAudit': "Defined in src/audit/log.ts. Writes a JSON log line with the action, order id and a timestamp. Called by processOrder right after the order is marked paid. Also uses AuditEntry (not expanded).",
};
for (const k of Object.keys(g.sums)) if (!g.blocks.find(b => b.id === k)) throw new Error('bad sum key ' + k);
for (const b of g.blocks) if (!g.sums[b.id]) throw new Error('missing sum ' + b.id);
const json = JSON.stringify(g).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
const t = fs.readFileSync(dir + '/template2.html', 'utf8');
if (!t.includes('__DATA__')) throw new Error('no placeholder');
fs.writeFileSync(dir + '/storyline2.html', t.replace('__DATA__', () => json));
console.log('ok', json.length);
