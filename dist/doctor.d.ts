type DoctorStatus = "pass" | "info" | "warning" | "error";
type DoctorCheck = {
    id: string;
    status: DoctorStatus;
    message: string;
    details?: unknown;
    suggestion?: string;
};
type DoctorResult = {
    status: "pass" | "warning" | "error";
    directory: string;
    checks: DoctorCheck[];
    summary: {
        pass: number;
        info: number;
        warning: number;
        error: number;
    };
    config: {
        file: string;
        created: boolean;
        migrated: boolean;
        migrations: string[];
        assetCount: number;
        missingAssetCount: number;
        subagentCount: number;
        configuredSubagentModelCount: number;
    };
    scenes: {
        directory: string;
        sceneCount: number;
        createdTemplates: string[];
        errorCount: number;
    };
};
/**
 * 运行 Apollo Flowpower 项目自检。
 */
export declare function runDoctor(directory: string): DoctorResult;
export {};
