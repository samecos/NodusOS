export class PaymentService {
  async processPayment(orderId: string): Promise<boolean> {
    const valid = this.validateOrder(orderId);
    if (!valid) return false;
    return this.charge(orderId);
  }

  private validateOrder(orderId: string): boolean {
    return orderId.length > 0;
  }

  private async charge(orderId: string): Promise<boolean> {
    return true;
  }
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
