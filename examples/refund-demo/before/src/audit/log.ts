interface AuditEntry {
  action: string;
  orderId: string;
  at: string;
}

export function recordAudit(action: string, orderId: string): void {
  const entry: AuditEntry = {
    action,
    orderId,
    at: new Date().toISOString(),
  };

  console.log(JSON.stringify(entry));
}
