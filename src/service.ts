import { Context } from "koishi";
import { Config } from "./index";
import { BillingResponse, ListResponse, LogoutResponse, UserAsset, Wallet } from "./model";

export class PrismService {
    private apiBase: string;

    constructor(private ctx: Context, private config: Config) {
        this.apiBase = `${config.url.trimEnd().replace(/\/+$/, "")}/api`;
    }

    private url(endpoint: string) {
        return `${this.apiBase}/${endpoint.trimStart().replace(/^\/+/, "")}`;
    }

    async register(userId: string): Promise<unknown> {
        return await this.ctx.http.post(
            this.url("/users"),
            [
                {
                    "binds": [
                        {
                            "type": "QQ",
                            "bid": userId
                        }
                    ]
                }
            ]
        )
    }

    async login(userId: string): Promise<unknown> {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/login`)
        )
    }

    async history(userId: string, limit: number) {
        return await this.ctx.http.get(
            this.url(`/users/QQ:${userId}/sortedsessions?limit=${limit}`)
        )
    }

    async logout(userId: string): Promise<BillingResponse> {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/logout`)
        )
    }

    async billing(userId: string): Promise<BillingResponse> {
        return await this.ctx.http.get(
            this.url(`/users/QQ:${userId}/billing`)
        )
    }

    async list(): Promise<ListResponse> {
        return await this.ctx.http.get(
            this.url(`/users/logined?binds=true&sessions=true`)
        )
    }

    async wallet(userId: string): Promise<Wallet> {
        return await this.ctx.http.get(
            this.url(`/users/QQ:${userId}/wallet?details=true`)
        )
    }

    async assets(userId: string): Promise<UserAsset[]> {
        return await this.ctx.http.get(
            this.url(`/users/QQ:${userId}/assets?details=true`)
        )
    }

    async upsertUserAssets(userId: string, assets: { id: number; count: number }[]) {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/assets`),
            assets
        )
    }

    async deleteUserAsset(userId: string, userAssetId: number) {
        return await this.ctx.http.delete(
            this.url(`/users/QQ:${userId}/assets/${userAssetId}`)
        )
    }

    async updateUserAsset(userId: string, userAssetId: number, amount: number) {
        return await this.ctx.http.patch(
            this.url(`/users/QQ:${userId}/assets/${userAssetId}`),
            { amount }
        )
    }

    async getLock(userId: string): Promise<{
        password: string;
        id: any;
    }> {
        return await this.ctx.http.get(
            this.url(`/users/QQ:${userId}/door-password`)
        )
    }

    async redeemById(userId: string, id: number) {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/redeem-by-id`),
            { id }
        )
    }

    async machinePowerOn(machineName: string, userId: string, needLogin: boolean = true) {
        return await this.ctx.http.post(
            this.url(`/machine/power`),
            {
                machineName,
                powerState: true,
                userId: `QQ:${userId}`,
                needLogin
            }
        )
    }

    async machinePowerOff(machineName: string, userId: string, needLogin: boolean = true) {
        return await this.ctx.http.post(
            this.url(`/machine/power`),
            {
                machineName,
                powerState: false,
                userId: `QQ:${userId}`,
                needLogin
            }
        )
    }

    async getAllMachinePower(): Promise<{ machine: string, state: { state: string } }[]> {
        return await this.ctx.http.get(
            this.url(`/machine/power`)
        )
    }

    async getMachinePower(machineName: string): Promise<{ machine: string, state: { state: string } }> {
        return await this.ctx.http.get(
            this.url(`/machine/power?name=${machineName}`)
        )
    }

    async walletAdd(amount: number, userId: string) {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/wallet`),
            {
                type: "free",
                action: amount,
                comment: "管理员添加"
            }
        )
    }

    async walletDel(amount: number, userId: string) {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/wallet`),
            {
                type: "free",
                action: -amount,
                comment: "管理员扣除"
            }
        )
    }

    async costOverwrite(amount: string, userId: string) {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/billing-overwrite`),
            {
                cost: parseInt(amount)
            }
        )
    }

    async redeem(code: string, userId: string) {
        return await this.ctx.http.post(
            this.url(`/users/QQ:${userId}/redeem`),
            {
                code
            }
        )
    }

    async insertCoin(alias: string, userId: string, force: boolean = false) {
        return await this.ctx.http.post(
            this.url(`/remote/${alias}/coin`),
            {
                userId: `QQ:${userId}`,
                force
            }
        )
    }

    // --- Admin API ---

    async adminListAssets() {
        return await this.ctx.http.get(this.url('/admin/assets'));
    }

    async adminCreateAsset(data: any) {
        return await this.ctx.http.post(this.url('/admin/assets'), data);
    }

    async adminDeleteAsset(id: number) {
        return await this.ctx.http.delete(this.url(`/admin/assets/${id}`));
    }

    async adminToggleAssetState(id: number, state: boolean) {
        return await this.ctx.http.patch(this.url(`/admin/assets/${id}`), { valid: state });
    }

    async adminListCoupons() {
        return await this.ctx.http.get(this.url('/admin/coupons'));
    }

    async adminCreateCoupon(data: any) {
        return await this.ctx.http.post(this.url('/admin/coupons'), data);
    }

    async adminListGifts() {
        return await this.ctx.http.get(this.url('/admin/gifts'));
    }

    async adminCreateGift(data: any) {
        return await this.ctx.http.post(this.url('/admin/gifts'), data);
    }

    async adminDeleteGift(id: number) {
        return await this.ctx.http.delete(this.url(`/admin/gifts/${id}`));
    }

    async adminGenerateGiftCodes(id: number, count: number) {
        return await this.ctx.http.post(this.url(`/admin/gifts/${id}/codes`), { count });
    }

    async adminListRules() {
        return await this.ctx.http.get(this.url('/admin/rules'));
    }

    async adminCreateRule(data: any) {
        return await this.ctx.http.post(this.url('/admin/rules'), data);
    }

    async adminDeleteRule(id: number) {
        return await this.ctx.http.delete(this.url(`/admin/rules/${id}`));
    }

    async adminUpdateRuleStatus(id: number, available: boolean) {
        return await this.ctx.http(this.url(`/admin/rules/${id}`), {
            method: 'PATCH',
            data: { available }
        });
    }
    async adminAddUserAsset(userId: string, id: number, count: number) {
        return await this.ctx.http.post(this.url(`/users/QQ:${userId}/assets`), [{
            id,
            count
        }])
    }
}
