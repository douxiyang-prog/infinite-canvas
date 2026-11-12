declare module "expr-eval" {
    export class Parser {
        constructor(options?: Record<string, unknown>);
        functions: Record<string, ((...args: unknown[]) => unknown) | undefined>;
        consts: Record<string, unknown>;
        parse(
            expression: string,
            options?: { allowMemberAccess?: boolean },
        ): {
            evaluate(variables?: Record<string, unknown>): unknown;
        };
        evaluate(expression: string, variables?: Record<string, unknown>): unknown;
    }
}
