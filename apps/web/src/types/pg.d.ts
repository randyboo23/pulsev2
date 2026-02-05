declare module "pg" {
  export type QueryResult<T = any> = {
    rows: T[];
  };

  export class Pool {
    constructor(config?: { connectionString?: string; max?: number });
    query<T = any>(
      text: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<T>>;
  }
}
