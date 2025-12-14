import { Argv, Context, h, Schema } from 'koishi'
import * as service from './service'
import { ApiError, BillingResponse, LoggedInUser, UserAsset, Wallet } from './model'
import { ActionContext } from './types'

export const name = 'prism-neo'

let kv: Map<string, number> = new Map();

export interface Config {
  url: string;
  admin: string;
}

export const Config: Schema<Config> = Schema.object({
  url: Schema.string().required(),
  admin: Schema.string().default("authority:3"),
})

const handleAction = <A extends any[]>(action: (argv: Argv, ...args: A) => Promise<string>) => {
  return async (argv: Argv, ...args: A) => {
    let message: string;
    try {
      message = await action(argv, ...args);
    } catch (e) {
      console.error(e);
      // Safely extract error message from API response
      const apiMessage = (e as Partial<ApiError>)?.response?.data?.message;
      if (apiMessage) {
        message = apiMessage;
      } else {
        message = '操作失败，发生了未知错误。';
      }
    }
    if (argv.session?.messageId) {
      message = h('quote', { id: argv.session.messageId }) + message;
    }
    return message
  };
};

// --- Helpers ---

// Helper for consistent date formatting
const formatDateTime = (dateStr: string | Date | null) => {
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

const formatBilling = (res: BillingResponse): string => {
  const message: string[] = [];
  message.push('--- 账单详情 ---');

  // Session Times
  message.push(`入场: ${formatDateTime(res.session.createdAt)}`);
  message.push(`结算: ${formatDateTime(res.billing.endTime)}`);
  message.push('---');

  // Costs
  const originalCost = res.discount ? res.discount.originalCost : res.billing.totalCost;
  let finalCost = res.discount ? res.discount.finalCost : res.billing.totalCost;
  if (res.session.costOverwrite) {
    finalCost = res.session.costOverwrite;
  }

  message.push(`计费价: ${originalCost} 月饼`);

  if (res.discount && res.discount.appliedLogs.length > 0) {
    res.discount.appliedLogs.forEach(log => {
      message.push(`  -「${log.asset}」: -${log.saved} 月饼`);
    });
  }

  message.push(`结算价: ${finalCost} 月饼`);
  message.push('---');

  // Wallet
  const currentBalance = res.wallet.total.available;
  const finalBalance = currentBalance - finalCost;
  message.push(`当前余额: ${currentBalance} 月饼`);
  message.push(`扣款后: ${finalBalance} 月饼`);
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

        message.push(`- ${seg.ruleName}`);
        message.push(`  时段: ${timeString}`);
        message.push(`  费用: ${seg.cost} 月饼 ${seg.isCapped ? '(已封顶)' : ''}`);
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

// --- Command Handlers ---

async function getTargetUserId(context: ActionContext, user: string | undefined): Promise<{ error?: string; userId?: string }> {
  if (user) {
    if (!await context.ctx.permissions.check(context.config.admin, context.session)) {
      return { error: "权限不足" };
    }
    return { userId: user.split(':')[1] };
  }
  return { userId: context.session.userId };
}

async function handleRegisterCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  await service.register(context, userId);
  return user ? `为用户 ${userId} 注册成功` : "注册成功";
}

async function handleLoginCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  await service.login(context, userId);
  const pwd = await service.getLock(context, userId);

  if (user) {
    return `✅ 已为用户 ${userId} 入场，该用户的门锁密码是: ${pwd.password}\n注意! 门锁密码有效期为三分钟`;
  }
  return `✅ 入场成功，你的门锁密码是: ${pwd.password}\n注意! 门锁密码有效期为三分钟`;
}

async function handleLogoutCmd(context: ActionContext, user?: string) {
  const { error, userId: targetUserId } = await getTargetUserId(context, user);
  if (error) return error;

  const pendingLogout = kv.get(targetUserId);
  const now = Date.now();

  if (pendingLogout && (now - pendingLogout < 60 * 1000)) {
    // Confirmation step
    kv.delete(targetUserId);
    const res = await service.logout(context, targetUserId);
    const messagePrefix = user ? `✅ 已为用户 ${targetUserId} 退场` : '✅ 退场成功';
    return [
      messagePrefix,
      `入场时间: ${formatDateTime(res.session.createdAt)}`,
      `离场时间: ${formatDateTime(res.session.closedAt)}`,
      `消费: ${res.session.finalCost} 月饼`,
    ].join('\n');
  } else {
    // First request, show billing preview
    const billingRes = await service.billing(context, targetUserId);
    const billingMessage = formatBilling(billingRes);
    kv.set(targetUserId, now);
    if (user) {
      return `以下是用户 ${targetUserId} 的账单预览:\n\n${billingMessage}\n\n---\n⚠️ 请在60秒内再次输入 /logout ${user} 以确认登出。`;
    }
    return `${billingMessage}\n\n---\n⚠️ 这是您的账单预览。请在60秒内再次输入 /logout 以确认登出。`;
  }
}

async function handleListCmd(context: ActionContext, user?: string) {
  const users = await service.list(context);
  if (!users || users.length === 0) {
    return "窝里目前没有玩家呢";
  }

  const userReports = users.map((user: LoggedInUser) => {
    const qqBind = user.binds.find(bind => bind.type === "QQ");
    const name = qqBind ? qqBind.bid : "匿名玩家";
    const entryDate = formatDateTime(user.sessions[0].createdAt);
    return `玩家: ${name}\n入场时间: ${entryDate}`;
  });

  return `窝里目前共有 ${users.length} 人\n\n${userReports.join('\n\n')}`;
}

async function handleWalletCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  const res = await service.wallet(context, userId);
  const message: string[] = [];

  const targetUserId = user ? userId : undefined; // for message formatting
  message.push(targetUserId ? `--- 用户 ${targetUserId} 的钱包余额 ---` : '--- 钱包余额 ---');
  message.push(
    `可用: ${res.total.available} 月饼 (共 ${res.total.all})`,
    `  - 付费: ${res.paid.available}`,
    `  - 免费: ${res.free.available}`
  );

  const unavailable = res.total.all - res.total.available;
  if (unavailable > 0) {
    message.push(`\n您还有 ${unavailable} 月饼未到可用时间。`);
  }

  const expiringFreeAssets = res.free.details?.available?.filter(asset => asset.expireAt) || [];
  if (expiringFreeAssets.length > 0) {
    expiringFreeAssets.sort((a, b) => new Date(a.expireAt!).getTime() - new Date(b.expireAt!).getTime());
    const soonestToExpire = expiringFreeAssets[0];
    message.push(`\n注意：您有 ${soonestToExpire.count} 免费月饼将于 ${formatDateTime(soonestToExpire.expireAt)} 过期。`);
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

async function handleBillingCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  const res = await service.billing(context, userId);
  const billingMessage = formatBilling(res);
  if (user) {
    return `用户 ${userId} 的账单:\n\n${billingMessage}`;
  }
  return billingMessage;
}

async function handleLockCmd(context: ActionContext) {
  const res = await service.getLock(context, context.session.userId);
  return [
    '获取密码成功',
    `你的门锁密码是: ${res.password}`,
    '注意! 门锁密码有效期为三分钟'
  ].join('\n');
}

async function handleItemsCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  const userAssets = await service.assets(context, userId);
  if (!userAssets || userAssets.length === 0) {
    return user ? `用户 ${userId} 没有任何物品。` : "您当前没有任何物品。";
  }

  const header = user ? `--- 用户 ${userId} 拥有的物品 ---` : '--- 您拥有的物品 ---';
  const itemsList = userAssets.map((asset: UserAsset) => {
    let line = `- ${asset.asset.name} (x${asset.count})`;
    if (asset.expireAt) {
      line += `\n  到期: ${formatDateTime(asset.expireAt)}`;
    }
    return line;
  });
  return [
    header,
    ...itemsList
  ].join('\n');
}

async function handleMachineOn(context: ActionContext, alias: string) {
  if (!alias) return "请输入设备名";
  const res = await service.machinePowerOn(context, alias, context.session.userId);
  return `${res.machine} 启动成功`;
}

async function handleMachineOff(context: ActionContext, alias: string) {
  if (!alias) return "请输入设备名";
  const res = await service.machinePowerOff(context, alias, context.session.userId);
  return `${res.machine} 关闭成功`;
}

async function handleMachineShow(context: ActionContext, alias?: string) {
  if (alias) {
    const res = await service.getMachinePower(context, alias);
    return `${res.machine}: ${res.state.state}`
  } else {
    const res = await service.getAllMachinePower(context);
    return res.map(
      (e) => {
        return `${e.machine}: ${e.state.state}`
      }
    ).join('\n')
  }
}

async function handleWalletAdd(context: ActionContext, user: string, amount: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  if (!amount) return "请输入数量";
  const res = await service.walletAdd(context, parseInt(amount), userId);
  return [
    `为用户 ${userId} 增加月饼成功`,
    `增加前: ${res.originalBalance}`,
    `增加后: ${res.finalBalance}`,
  ].join('\n');
}

async function handleWalletDeduct(context: ActionContext, user: string, amount: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  if (!amount) return "请输入数量";
  const res = await service.walletDel(context, parseInt(amount), userId);
  return [
    `为用户 ${userId} 扣除月饼成功`,
    `扣款前: ${res.originalBalance}`,
    `扣款后: ${res.finalBalance}`,
  ].join('\n');
}

async function handleCostOverwrite(context: ActionContext, user: string, amount: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  if (!amount) return "请输入数量";
  await service.costOverwrite(context, amount, userId);
  return `为用户 ${userId} 调价成功`;
}

async function handleRedeem(context: ActionContext, code: string) {
  const { error, userId } = await getTargetUserId(context, null);
  if (error) return error;
  if (!code) return "请输入兑换码";

  const res = await service.redeem(context, code, userId);
  const items = res as { name: string, count: number, assetType: string, durationMs?: number }[];

  if (!items || items.length === 0) {
    return "兑换成功，但没有获得任何物品。";
  }

  const message: string[] = ["✅ 兑换成功！您获得了以下物品："];

  items.forEach(item => {
    let itemName = item.name;
    if (item.assetType === 'PASS' && item.durationMs) {
      const days = Math.floor(item.durationMs / (1000 * 60 * 60 * 24));
      if (days > 0) itemName += ` (${days}天)`;
    }
    message.push(`- ${itemName} x${item.count}`);
  });

  return message.join('\n');
}

export function apply(ctx: Context, config: Config) {
  // ctx.state.inject(name, {
  //   pendingLogout: {} as Record<string, number>
  // });
  const createAction = <A extends any[]>(
    handler: (context: ActionContext, ...args: A) => Promise<string>
  ) => {
    const actionFn = (argv: Argv, ...args: A) => {
      const context: ActionContext = {
        ctx,
        config,
        session: argv.session,
      };
      return handler(context, ...args);
    };
    return handleAction(actionFn);
  };
  ctx.command('register [user:user]').action(createAction(handleRegisterCmd));
  ctx.command('login [user:user]').action(createAction(handleLoginCmd));
  ctx.command('logout [user:user]').action(createAction(handleLogoutCmd));
  ctx.command('list').action(createAction(handleListCmd));
  ctx.command('wallet [user:user]').action(createAction(handleWalletCmd));
  ctx.command('billing [user:user]').action(createAction(handleBillingCmd));
  ctx.command('lock').action(createAction(handleLockCmd));
  ctx.command('items [user:user]').action(createAction(handleItemsCmd));
  ctx.command('show [alias]').action(createAction(handleMachineShow));
  ctx.command('on <alias>').action(createAction(handleMachineOn));
  ctx.command('off <alias>').action(createAction(handleMachineOff));
  ctx.command('redeem <code>').action(createAction(handleRedeem));

  ctx.command('add <user:user> <amount>').action(createAction(handleWalletAdd));
  ctx.command('del <user:user> <amount>').action(createAction(handleWalletDeduct));

  ctx.command('overwrite <user:user> <amount>').action(createAction(handleCostOverwrite))
}
