/**
 * dsh-minesweeper — 开发期类型垫片（仅参与 tsc，绝不进产物；esbuild 不打包 .d.ts）。
 *
 * 本插件按布局红线不携带 node_modules；host 侧用到的外部包类型在此最小化补齐：
 *   - `@deepseek-ai/schemastery`：只声明本插件实际用到的调用面
 *     （z.object / z.boolean / .default 等）；运行时真实实现由 profile 的 node_modules 提供。
 *   - node 内建（process / Buffer / node:fs）：由 tsconfig typeRoots 指向
 *     harness 仓的 @types/node 提供。
 */
declare module "@deepseek-ai/schemastery" {
  /** 一个可调用 schema：`schema(value)` → `[value, adapted?]`（schemastery 约定）。 */
  export interface SchemaInstance {
    (value: unknown, options?: Record<string, unknown>): [unknown, unknown?];
    toJSON(): unknown;
    default(value: unknown): SchemaInstance;
    min(value: number): SchemaInstance;
    max(value: number): SchemaInstance;
    step(value: number): SchemaInstance;
    required(value?: boolean): SchemaInstance;
    role(role: string, extra?: unknown): SchemaInstance;
    [key: string]: any;
  }

  interface SchemaRoot {
    object(dict: Record<string, unknown>): SchemaInstance;
    dict(inner: unknown, sKey?: unknown): SchemaInstance;
    boolean(): SchemaInstance;
    string(): SchemaInstance;
    number(): SchemaInstance;
    integer(): SchemaInstance;
    [key: string]: (...args: any[]) => SchemaInstance;
  }

  const z: SchemaRoot;
  export default z;
}