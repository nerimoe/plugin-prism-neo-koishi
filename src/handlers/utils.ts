import { Session } from 'koishi';
import { ActionContext } from '../types';
import { BillingResponse } from '../model';

export async function getUserName(session: Session, userId?: string) {
    if (userId) {
        return (await session.bot.getUser(userId)).name + ` ( ${userId} )`;
    } else {
        return "匿名用户"
    }
}

export const formatDateTime = (dateStr: string | Date | null) => {
    if (!dateStr) return '永不过期';
    const date = new Date(dateStr);
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}:${s}`;
};

export const formatBilling = (res: BillingResponse, currency: string): string => {
    const message: string[] = [];
    message.push('--- 账单详情 ---');

    // Session Times
    message.push(`入场: ${formatDateTime(res.session.createdAt)}`);
    message.push(`结算: ${formatDateTime(res.billing.endTime)}`);

    const startTime = new Date(res.session.createdAt).getTime();
    const endTime = new Date(res.billing.endTime).getTime();
    const durationMs = endTime - startTime;
    const totalMinutes = Math.floor(durationMs / (1000 * 60));
    let durationStr = `${totalMinutes}分钟`;
    if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        durationStr = `${hours}小时${mins}分钟`;
    }
    message.push(`时长: ${durationStr}`);

    message.push('---');

    // Costs
    const originalCost = res.discount ? res.discount.originalCost : res.billing.totalCost;
    let finalCost = res.discount ? res.discount.finalCost : res.billing.totalCost;
    if (res.session.costOverwrite) {
        finalCost = res.session.costOverwrite;
    }

    message.push(`计费价: ${originalCost} ${currency}`);

    if (res.discount && res.discount.appliedLogs.length > 0) {
        res.discount.appliedLogs.forEach(log => {
            message.push(`  -「${log.asset}」: -${log.saved} ${currency}`);
        });
    }

    message.push(`结算价: ${finalCost} ${currency}`);
    message.push('---');

    // Wallet
    const currentBalance = res.wallet.total.available;
    const finalBalance = currentBalance - finalCost;
    message.push(`当前余额: ${currentBalance} ${currency}`);
    message.push(`扣款后: ${finalBalance} ${currency}`);
    message.push('---');

    // Segments
    message.push('计费区间:');
    if (res.billing.segments.length > 0) {
        res.billing.segments.forEach(seg => {
            if (seg.cost >= 0) {
                const start = new Date(seg.startTime);
                const end = new Date(seg.endTime);

                const timeOnlyOptions: Intl.DateTimeFormatOptions = {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                };
                const formatTime = (d: Date) => d.toLocaleTimeString('en-GB', timeOnlyOptions);
                const formatDate = (d: Date) => `${(d.getMonth() + 1)}/${d.getDate()}`;

                let timeString: string;
                if (start.toLocaleDateString() === end.toLocaleDateString()) {
                    timeString = `${formatTime(start)} - ${formatTime(end)}`;
                } else {
                    timeString = `${formatDate(start)} ${formatTime(start)} - ${formatDate(end)} ${formatTime(end)}`;
                }

                let segDurationStr = `${seg.durationMinutes}分钟`;
                if (seg.durationMinutes >= 60) {
                    const hours = Math.floor(seg.durationMinutes / 60);
                    const mins = seg.durationMinutes % 60;
                    segDurationStr = `${hours}小时${mins}分钟`;
                }

                message.push(`- ${seg.ruleName}`);
                message.push(`  时段: ${timeString}`);
                message.push(`  时长: ${segDurationStr}`);
                message.push(`  费用: ${seg.cost} ${currency} ${seg.isCapped ? '(已封顶)' : ''}`);
            }
        });
    } else {
        message.push('  (无)');
    }

    // Pass Expiry
    const monthlyPass = res.wallet.passes?.details?.available?.[0];
    if (monthlyPass && monthlyPass.expireAt) {
        message.push('---');
        message.push(`您的月卡将于 ${formatDateTime(monthlyPass.expireAt)} 到期。`);
    }

    return message.join('\n');
};

export async function checkAdmin(context: ActionContext) {
    if (!await context.ctx.permissions.check(context.config.admin, context.session)) {
        throw new Error("权限不足");
    }
}

export async function getTargetUserId(context: ActionContext, user: string | undefined): Promise<{ error?: string; userId?: string }> {
    if (user) {
        if (!await context.ctx.permissions.check(context.config.admin, context.session)) {
            return { error: "权限不足" };
        }
        return { userId: user.split(':')[1] ?? user };
    }
    return { userId: context.session.userId };
}

export function parseFriendlyDate(dateStr: string | undefined): Date | undefined {
    if (!dateStr) return undefined;
    // 支持人性化格式: YYYY-MM-DD-HH-mm-ss
    const customFormat = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/;
    const match = dateStr.match(customFormat);
    if (match) {
        const [_, y, m, d, h, min, s] = match;
        return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
    }
    // 尝试标准格式
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? undefined : d;
}
