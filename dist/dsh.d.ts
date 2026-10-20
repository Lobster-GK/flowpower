import type { Context } from "@deepseek-ai/cordis";
import { type DshConfig } from "./dsh-agents.js";
export type Config = DshConfig;
export declare const name = "apollo-flowpower";
export declare const inject: string[];
/** Harness host plugin. Load alongside filesystem, skill-tool and spawn providers. */
export declare function apply(ctx: Context, config?: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
