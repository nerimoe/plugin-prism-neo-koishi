import { ActionContext } from '../types';
import { getTargetUserId, getUserName, formatDateTime, formatBilling } from './utils';
import { executeWithAutoRegister } from './user';

export async function handleWalletCmd(context: ActionContext, user?: string) {
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    const res = await context.prism.wallet(userId);
    const message: string[] = [];

    const targetUserId = user ? userId : undefined; // for message formatting
    message.push(targetUserId ? `💰 --- 用户 ${await getUserName(context.session, targetUserId)} 的钱包余额 ---` : '💰 --- 钱包余额 ---');
    message.push(
        `可用: ${res.total.available} ${context.config.currency} (共 ${res.total.all})`,
        `  - 付费: ${res.paid.available}`,
        `  - 免费: ${res.free.available}`
    );

    const unavailable = res.total.all - res.total.available;
    if (unavailable > 0) {
        message.push(`\n您还有 ${unavailable} ${context.config.currency}未到可用时间。`);
    }

    const expiringFreeAssets = res.free.details?.available?.filter(asset => asset.expireAt) || [];
    if (expiringFreeAssets.length > 0) {
        expiringFreeAssets.sort((a, b) => new Date(a.expireAt!).getTime() - new Date(b.expireAt!).getTime());
        const soonestToExpire = expiringFreeAssets[0];
        message.push(`\n注意：您有 ${soonestToExpire.count} 免费${context.config.currency}将于 ${formatDateTime(soonestToExpire.expireAt)} 过期。`);
    }

    // Passes
    const availablePasses = res.passes?.details?.available || [];
    if (availablePasses.length > 0) {
        message.push(`\n--- 可用月卡 (${availablePasses.length}) ---`);
        availablePasses.forEach(pass => {
            message.push(`- ${pass.asset.name}`);
            message.push(`  到期: ${formatDateTime(pass.expireAt)}`);
        });
    }

    // Tickets
    const availableTickets = res.tickets?.details?.available || [];
    if (availableTickets.length > 0) {
        message.push(`\n--- 可用优惠券 (${availableTickets.length}) ---`);
        availableTickets.forEach(ticket => {
            message.push(`- ${ticket.asset.name} (x${ticket.count})`);
            message.push(`  到期: ${formatDateTime(ticket.expireAt)}`);
        });
    }

    return message.join('\n');
}

export async function handleHistoriesCmd(context: ActionContext, user?: string, limit?: number) {
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;
    console.log(userId);

    const res = await context.prism.history(userId, limit ?? 10);
    if (!res || !res.sessions || res.sessions.length === 0) {
        return "暂无历史记录";
    }

    const message: string[] = [`📜 最近 ${res.sessions.length} 条记录:`];
    res.sessions.forEach((s: any) => {
        const start = formatDateTime(s.createdAt);
        const end = s.closedAt ? formatDateTime(s.closedAt) : '进行中';
        const cost = s.finalCost !== null ? `${s.finalCost} ${context.config.currency}` : '未结算';
        message.push(`- [${s.id}] ${start} -> ${end} (${cost})`);
    });
    return message.join('\n');
}

export async function handleBillingCmd(context: ActionContext, user?: string) {
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    const res = await context.prism.billing(userId);
    const billingMessage = formatBilling(res, context.config.currency);
    if (user) {
        return `用户 ${await getUserName(context.session, userId)} 的账单:\n\n${billingMessage}`;
    }
    return billingMessage;
}

export async function handleWalletAdd(context: ActionContext, user: string, amount: number) {
    if (!user || !amount) {
        await context.session.execute('help add');
        return "";
    }
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    return executeWithAutoRegister(
        context,
        user,
        () => context.prism.walletAdd(amount, userId),
        async (res: any) => {
            return [
                `为用户 ${await getUserName(context.session, userId)} 增加${context.config.currency}成功`,
                `增加前: ${res.originalBalance}`,
                `增加后: ${res.finalBalance}`,
            ].join('\n');
        }
    );
}

export async function handleWalletDeduct(context: ActionContext, user: string, amount: number) {
    if (!user || !amount) {
        await context.session.execute('help del');
        return "";
    }
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    return executeWithAutoRegister(
        context,
        user,
        () => context.prism.walletDel(amount, userId),
        (res: any) => {
            return [
                `为用户 ${userId} 扣除${context.config.currency}成功`,
                `扣款前: ${res.originalBalance}`,
                `扣款后: ${res.finalBalance}`,
            ].join('\n');
        }
    );
}

export async function handleCostOverwrite(context: ActionContext, user: string, amount: string) {
    if (!user || !amount) {
        await context.session.execute('help overwrite');
        return "";
    }
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    return executeWithAutoRegister(
        context,
        user,
        () => context.prism.costOverwrite(amount, userId),
        () => `为用户 ${userId} 调价成功`
    );
}
