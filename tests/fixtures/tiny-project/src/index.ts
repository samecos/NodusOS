export async function refundOrder(orderId: string, amount: number): Promise<{ status: string }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  const result = await submitRefund(orderId, amount);
  await logAudit('refund', orderId, amount);
  return result;
}

async function getOrder(orderId: string): Promise<{ id: string; total: number } | null> {
  return { id: orderId, total: 100 };
}

async function submitRefund(orderId: string, amount: number): Promise<{ status: string }> {
  return { status: 'ok' };
}

async function logAudit(action: string, orderId: string, amount: number): Promise<void> {
  // stub
}
