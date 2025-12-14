import { ActionContext } from "./types";
import { BillingResponse, ListResponse, LogoutResponse, UserAsset, Wallet } from "./model";

function makeUrl(baseUrl: string, endpoint: string) {
    return `${baseUrl.trimEnd().replace(/\/+$/, "")}/api/${endpoint.trimStart().replace(/^\/+/, "")}`
}

export async function register({ ctx, config }: ActionContext, userId: string): Promise<unknown> {
    return await ctx.http.post(
        makeUrl(config.url, "/users"),
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

export async function login({ ctx, config }: ActionContext, userId: string): Promise<unknown> {
    return await ctx.http.post(
        makeUrl(config.url, `/users/QQ:${userId}/login`)
    )
}

export async function logout({ ctx, config }: ActionContext, userId: string): Promise<LogoutResponse> {
    return await ctx.http.post(
        makeUrl(config.url, `/users/QQ:${userId}/logout`)
    )
}

export async function billing({ ctx, config }: ActionContext, userId: string): Promise<BillingResponse> {
    return await ctx.http.get(
        makeUrl(config.url, `/users/QQ:${userId}/billing`)
    )
}

export async function list({ ctx, config }: ActionContext): Promise<ListResponse> {
    return await ctx.http.get(
        makeUrl(config.url, `/users/logined?binds=true&sessions=true`)
    )
}

export async function wallet({ ctx, config }: ActionContext, userId: string): Promise<Wallet> {
    return await ctx.http.get(
        makeUrl(config.url, `/users/QQ:${userId}/wallet?details=true`)
    )
}

export async function assets({ ctx, config }: ActionContext, userId: string): Promise<UserAsset[]> {
    return await ctx.http.get(
        makeUrl(config.url, `/users/QQ:${userId}/assets?details=true`)
    )
}

export async function getLock({ ctx, config }: ActionContext, userId: string): Promise<{
    password: string;
    id: any;
}> {
    return await ctx.http.get(
        makeUrl(config.url, `/users/QQ:${userId}/door-password`)
    )
}

export async function machinePowerOn({ ctx, config }: ActionContext, machineName: string, userId: string) {
    return await ctx.http.post(
        makeUrl(config.url, `/machine/power`),
        {
            machineName,
            "powerState": true,
            userId: `QQ:${userId}`
        }
    )
}

export async function machinePowerOff({ ctx, config }: ActionContext, machineName: string, userId: string) {
    return await ctx.http.post(
        makeUrl(config.url, `/machine/power`),
        {
            machineName,
            "powerState": false,
            userId: `QQ:${userId}`
        }
    )
}

export async function getAllMachinePower({ ctx, config, session }: ActionContext): Promise<{ machine: string, state: { state: boolean } }[]> {
    return await ctx.http.get(
        makeUrl(config.url, `/machine/power`)
    )
}

export async function getMachinePower({ ctx, config, session }: ActionContext, machineName: string): Promise<{ machine: string, state: { state: boolean } }> {
    return await ctx.http.get(
        makeUrl(config.url, `/machine/power?name=${machineName}`)
    )
}

export async function walletAdd({ ctx, config }: ActionContext, amount: number, userId: string) {
    return await ctx.http.post(
        makeUrl(config.url, `/users/QQ:${userId}/wallet`),
        {
            type: "free",
            action: amount,
            comment: "管理员添加"
        }
    )
}

export async function walletDel({ ctx, config }: ActionContext, amount: number, userId: string) {
    return await ctx.http.post(
        makeUrl(config.url, `/users/QQ:${userId}/wallet`),
        {
            type: "free",
            action: -amount,
            comment: "管理员扣除"
        }
    )

}

export async function costOverwrite({ ctx, config }: ActionContext, amount: string, userId: string) {
    return await ctx.http.post(
        makeUrl(config.url, `/users/QQ:${userId}/billing-overwrite`),
        {
            cost: parseInt(amount)
        }
    )
}

export async function redeem({ ctx, config }: ActionContext, code: string, userId: string) {
    return await ctx.http.post(
        makeUrl(config.url, `/users/QQ:${userId}/redeem`),
        {
            code
        }
    )


}