import { ActionContext } from '../types';
import { ApiError, LoggedInUser } from '../model';
import { getTargetUserId, getUserName, formatDateTime, formatBilling } from './utils';
import { handleLockCmd } from './machine';

let kv: Map<string, number> = new Map();

export async function handleRegisterCmd(context: ActionContext, user?: string) {
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    await context.prism.register(userId);
    let message = [];
    message.push(user ? `为用户 ${userId} 注册成功` : "注册成功");
    if (context.config.redeemOnRegister) {
        let res = await context.prism.redeemById(userId, context.config.redeemOnRegister)
        let items = res.finalAssets;
        message.push("获得新玩家特典");
        items.forEach(item => {
            let itemName = item.name;
            if (item.assetType === 'PASS' && item.durationMs) {
                const days = Math.floor(item.durationMs / (1000 * 60 * 60 * 24));
                if (days > 0) itemName += ` (${days}天)`;
            }
            message.push(`- ${itemName} x${item.count} `);
        });
    }
    message.push("\n");
    return message.join('\n');
}

export async function executeWithAutoRegister<T>(
    context: ActionContext,
    userArg: string | undefined,
    action: () => Promise<T>,
    formatter: (res: T) => Promise<string> | string
): Promise<string> {
    try {
        const res = await action();
        return await formatter(res);
    } catch (e) {
        const code = (e as Partial<ApiError>)?.response?.data?.errcode;
        if (code === "USER_NOT_FOUND") {
            let message = "用户不存在，尝试注册\n";
            message += await handleRegisterCmd(context, userArg);
            message += "\n";

            try {
                const res = await action();
                message += await formatter(res);
                return message;
            } catch (retryError) {
                const apiMessage = (retryError as Partial<ApiError>)?.response?.data?.message;
                if (apiMessage) {
                    message += apiMessage;
                } else {
                    message += '操作失败。';
                }
                return message;
            }
        }
        throw e;
    }
}

export async function handleLoginCmd(context: ActionContext, user?: string) {
    const { error, userId } = await getTargetUserId(context, user);
    if (error) return error;

    return executeWithAutoRegister(
        context,
        user,
        () => context.prism.login(userId),
        async (res) => {
            let message = "✅ 入场成功";
            if (context.config.autoLockOnLogin) {
                let lockMessage = await handleLockCmd(context);
                message += "\n\n" + lockMessage;
            }
            return message;
        }
    )
}

export async function handleLogoutCmd(context: ActionContext, user?: string) {
    const { error, userId: targetUserId } = await getTargetUserId(context, user);
    if (error) return error;

    if (!context.config.logoutConfirmation) {
        // Bypass confirmation
        const res = await context.prism.logout(targetUserId);
        let name = await getUserName(context.session, targetUserId);
        let message = user ? `✅ 已为用户 ${name} 退场` : '✅ 退场成功';

        message += "\n";
        message += formatBilling(res, context.config.currency);
        await context.session.bot.broadcast(context.config.pmOnLogout, `${name}\n${message}`)
        return message;
    }

    const pendingLogout = kv.get(targetUserId);
    const now = Date.now();

    if (pendingLogout && (now - pendingLogout < 60 * 1000)) {
        // Confirmation step for when logoutConfirmation is true
        kv.delete(targetUserId);
        const res = await context.prism.logout(targetUserId);
        const messagePrefix = user ? `✅ 已为用户 ${await getUserName(context.session, targetUserId)} 退场` : '✅ 退场成功';
        return [
            messagePrefix,
            `入场时间: ${formatDateTime(res.session.createdAt)}`,
            `离场时间: ${formatDateTime(res.session.closedAt)}`,
            `消费: ${res.session.finalCost} ${context.config.currency}`,
        ].join('\n');
    } else {
        const billingRes = await context.prism.billing(targetUserId);
        const billingMessage = formatBilling(billingRes, context.config.currency);
        kv.set(targetUserId, now);
        if (user) {
            return `以下是用户 ${await getUserName(context.session, targetUserId)} 的账单预览:\n\n${billingMessage}\n\n---\n⚠️ 请在60秒内再次输入 /logout ${user} 以确认登出。`;
        }
        return `${billingMessage}\n\n---\n⚠️ 这是您的账单预览。请在60秒内再次输入 /logout 以确认登出。`;
    }
}

export async function handleListCmd(context: ActionContext, user?: string) {
    const users = await context.prism.list();
    if (!users || users.length === 0) {
        return "🫥 窝里目前没有玩家呢";
    }

    const tasks = users.map((user: LoggedInUser) => {
        const entryDate = formatDateTime(user.sessions[0].createdAt);
        const qqBind = user.binds.find(bind => bind.type === "QQ");

        let id = qqBind ? qqBind.bid : null;

        return { entryDate, task: getUserName(context.session, id) };
    });

    const platformUsers = await Promise.all(tasks.map(t => t.task));

    const userReports = platformUsers.map((u, idx) => {
        return `玩家: ${u}\n入场时间: ${tasks[idx].entryDate}`;
    });

    return `👥 窝里目前共有 ${users.length} 人\n\n${userReports.join('\n\n')}`;
}
