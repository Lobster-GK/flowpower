/**
 * 可选同步内置 commands 和 skills。
 */
export declare function syncBuiltinResources(directory: string): string[];
/**
 * 用户显式开启 syncBuiltinResources 时才同步内置资源。
 */
export declare function shouldSyncBuiltinResources(directory: string): boolean;
