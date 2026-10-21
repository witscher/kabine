export declare const ADMIN_LINK_HOURS: number;
export declare function adminLinkProblem(input: { firstName?: string; lastName?: string; email?: string }): string | null;
export declare function adminLinkSql(input: { firstName: string; lastName: string; email: string; nonce: string; tokenHash: string; now?: Date; owner?: boolean; revokeOthers?: boolean }): string;
export declare function adminsSql(email: string): string;
