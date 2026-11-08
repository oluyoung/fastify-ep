export class {{Name}}Service {
  // Declare what this service needs in the constructor, for example
  // `constructor({ ordersRepository }: { ordersRepository: OrdersRepository })`, and register it
  // in {{module}}.module.ts.
  getStatus(): { name: string } {
    return { name: '{{name}}' };
  }
}
