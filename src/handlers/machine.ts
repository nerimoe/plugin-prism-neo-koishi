import { ActionContext } from '../types';

export async function handleLockCmd(context: ActionContext) {
    const res = await context.prism.getLock(context.session.userId);
    return [
        '🔑 获取密码成功',
        `你的门锁密码是: ${res.password}`,
        `输入完成后按 # 结束`,
        '注意! 门锁密码有效期为三分钟',
        '如果密码不对请尝试重新获取密码',
        '可通过 /lock 再次获取密码',
    ].join('\n');
}

export async function handleMachineOn(context: ActionContext, alias: string) {
    if (!alias) {
        await context.session.execute('help on');
        return "";
    }
    let isAdmin = await context.ctx.permissions.check(context.config.admin, context.session)
    const res = await context.prism.machinePowerOn(alias, context.session.userId, !isAdmin);
    return `✅ ${res.machine} 启动成功`;
}

export async function handleMachineOff(context: ActionContext, alias: string) {
    if (!alias) {
        await context.session.execute('help off');
        return "";
    }
    let isAdmin = await context.ctx.permissions.check(context.config.admin, context.session)
    const res = await context.prism.machinePowerOff(alias, context.session.userId, !isAdmin);
    if (alias === "all") return `🛑 全部机器关闭成功`;
    return `🛑 ${res.machine} 关闭成功`;
}

export async function handleMachineShow(context: ActionContext, alias?: string) {
    if (alias) {
        const res = await context.prism.getMachinePower(alias);
        return `${res.machine}: ${res.state.state}`
    } else {
        const res = await context.prism.getAllMachinePower();
        return res.map(
            (e) => {
                return `${e.machine}: ${e.state.state}`
            }
        ).join('\n')
    }
}

export async function handleCoin(context: ActionContext, alias: string) {
    if (!alias) {
        await context.session.execute('help coin');
        return "";
    }
    let isAdmin = await context.ctx.permissions.check(context.config.admin, context.session)
    const res = await context.prism.insertCoin(alias, context.session.userId, isAdmin);
    return `🪙 已为 ${res.machineName} 投入 ${res.count} 个币`;
}
