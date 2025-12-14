export interface Bind {
    type: string;
    bid: string;
}

export interface SessionInfo {
    createdAt: string; // ISO date string
}

export interface LoggedInUser {
    binds: Bind[];
    sessions: SessionInfo[];
}

export type ListResponse = LoggedInUser[];

export interface LogoutSession {
    createdAt: string; // ISO date string
    closedAt: string; // ISO date string
    costOverwrite?: number;
    finalCost: number;
}

export interface LogoutBilling {
    totalCost: number;
}

export interface BillingSegment {
    ruleId: number;
    ruleName: string;
    startTime: string; // ISO date string
    endTime: string; // ISO date string;
    durationMinutes: number;
    cost: number;
    isCapped: boolean;
}

export interface DiscountLog {
    asset: string;
    saved: number;
}

export interface DiscountInfo {
    finalCost: number;
    originalCost: number;
    appliedLogs: DiscountLog[];
}

export interface Wallet {
    total: {
        available: number; // 当前总可用
        all: number;       // 全部（包括未激活）
    };
    paid: {
        available: number;
        all: number;
        details?: {
            available: UserAsset[];
            unavailable: UserAsset[];
        };
    };
    free: {
        available: number;
        all: number;
        details?: {
            available: UserAsset[];
            unavailable: UserAsset[];
        };
    };
    tickets: {
        available: number;
        all: number;
        details?: {
            available: UserAssetWithDef[];
            unavailable: UserAssetWithDef[];
        };
    };
    passes: {
        available: number;
        all: number;
        details?: {
            available: UserAssetWithDef[];
            unavailable: UserAssetWithDef[];
        }
    }
}

export interface UserAsset {
    id: number;
    userId: number;
    assetDefId: number;
    assetType: string;
    assetId: number;
    asset: Asset | null;
    addAt: Date;
    activeAt: Date | null;
    expireAt: Date | null;
    comment: string;
    count: number;
}

export interface Asset {
    type: string;
    id: number;
    assetId: number;
    name: string;
    expireAt: Date | null;
    activeAt: Date | null;
    description: string | null;
    valid: boolean;
}

export type UserAssetWithDef = UserAsset & { asset: Asset };

export interface LogoutResponse {
    session: LogoutSession;
    billing: LogoutBilling;
}

export interface BillingInfo {
    startTime: string; // ISO date string
    endTime: string; // ISO date string
    totalCost: number;
    segments: BillingSegment[];
}

export interface BillingResponse {
    session: LogoutSession;
    billing: BillingInfo;
    discount?: DiscountInfo;
    wallet: Wallet;
}

export interface ApiErrorData {
    message: string;
}

export interface ApiError {
    response: {
        data: ApiErrorData;
    };
}