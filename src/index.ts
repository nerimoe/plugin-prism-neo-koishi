import { Argv, Context, h, Schema, Session } from 'koishi'
import { PrismService } from './service'
import { ApiError, BillingResponse, LoggedInUser, UserAsset, Wallet, Asset } from './model'
import { ActionContext } from './types'
import { log } from 'console'

export const name = 'prism-neo'

let kv: Map<string, number> = new Map();

export interface Config {
  // botId: string;
  url: string;
  admin: string;
  broadcasts: string[];
  pmOnLogout: string[];
  currency: string;
  autoLockOnLogin: boolean;
  logoutConfirmation: boolean;
  powerOffInterval: number;
  redeemOnRegister: number;
}

export const Config: Schema<Config> = Schema.object({
  // botId: Schema.string().required().description("e.g: onebot:114514"),
  url: Schema.string().required(),
  admin: Schema.string().default("authority:3"),
  broadcasts: Schema.array(
    Schema.string()
  ),
  pmOnLogout: Schema.array(
    Schema.string()
  ),
  currency: Schema.string().default("月饼").description("货币名称"),
  autoLockOnLogin: Schema.boolean().default(true).description("登录时自动获取门锁密码"),
  logoutConfirmation: Schema.boolean().default(true).description("登出时需要二次确认"),
  powerOffInterval: Schema.number().default(600000).description("多长时间没人时自动关闭所有机器"),
  redeemOnRegister: Schema.number().default(0)
})

async function getUserName(session: Session, userId?: string) {
  if (userId) {
    return (await session.bot.getUser(userId)).name + ` ( ${userId} )`;
    // return "dummy"
  } else {
    return "匿名用户"
  }
}

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
        message = e.message;
      }
    }
    if (!message) return;
    if (argv.session?.messageId) {
      message = h('quote', { id: argv.session.messageId }) + message;
    }
    return message
  };
};

async function checkAdmin(context: ActionContext) {
  if (!await context.ctx.permissions.check(context.config.admin, context.session)) {
    throw new Error("权限不足");
  }
}

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

const formatBilling = (res: BillingResponse, currency: string): string => {
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

// --- Command Handlers ---

async function executeWithAutoRegister<T>(
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

async function getTargetUserId(context: ActionContext, user: string | undefined): Promise<{ error?: string; userId?: string }> {
  if (user) {
    if (!await context.ctx.permissions.check(context.config.admin, context.session)) {
      return { error: "权限不足" };
    }
    return { userId: user.split(':')[1] ?? user };
  }
  return { userId: context.session.userId };
}

async function handleRegisterCmd(context: ActionContext, user?: string) {
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

async function handleLoginCmd(context: ActionContext, user?: string) {
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

async function handleLogoutCmd(context: ActionContext, user?: string) {
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

async function handleListCmd(context: ActionContext, user?: string) {
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

async function handleWalletCmd(context: ActionContext, user?: string) {
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

async function handleHistoriesCmd(context: ActionContext, user?: string, limit?: number) {
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

async function handleBillingCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  const res = await context.prism.billing(userId);
  const billingMessage = formatBilling(res, context.config.currency);
  if (user) {
    return `用户 ${await getUserName(context.session, userId)} 的账单:\n\n${billingMessage}`;
  }
  return billingMessage;
}

async function handleLockCmd(context: ActionContext) {
  const res = await context.prism.getLock(context.session.userId);
  return [
    '🔑 获取密码成功',
    `你的门锁密码是: ${res.password}`,
    `输入完成后按 # 结束`,
    '注意! 门锁密码有效期为三分钟'
  ].join('\n');
}

async function handleItemsCmd(context: ActionContext, user?: string) {
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  const userAssets = await context.prism.assets(userId);
  if (!userAssets || userAssets.length === 0) {
    return user ? `用户 ${await getUserName(context.session, userId)} 没有任何物品。` : "您当前没有任何物品。";
  }

  const header = user ? `🎒 --- 用户 ${await getUserName(context.session, userId)} 拥有的物品 ---` : '🎒 --- 您拥有的物品 ---';
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
  if (!alias) {
    await context.session.execute('help on');
    return "";
  }
  let isAdmin = await context.ctx.permissions.check(context.config.admin, context.session)
  const res = await context.prism.machinePowerOn(alias, context.session.userId, !isAdmin);
  return `✅ ${res.machine} 启动成功`;
}

async function handleMachineOff(context: ActionContext, alias: string) {
  if (!alias) {
    await context.session.execute('help off');
    return "";
  }
  let isAdmin = await context.ctx.permissions.check(context.config.admin, context.session)
  const res = await context.prism.machinePowerOff(alias, context.session.userId, !isAdmin);
  if (alias === "all") return `🛑 全部机器关闭成功`;
  return `🛑 ${res.machine} 关闭成功`;
}

async function handleMachineShow(context: ActionContext, alias?: string) {
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

async function handleWalletAdd(context: ActionContext, user: string, amount: number) {
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

async function handleWalletDeduct(context: ActionContext, user: string, amount: number) {
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

async function handleCostOverwrite(context: ActionContext, user: string, amount: string) {
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

async function handleRedeem(context: ActionContext, code: string) {
  if (!code) {
    await context.session.execute('help redeem');
    return "";
  }
  const { error, userId } = await getTargetUserId(context, null);
  if (error) return error;

  return executeWithAutoRegister(
    context,
    undefined,
    () => context.prism.redeem(code, userId),
    (res) => {
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
  );
}

async function handleCoin(context: ActionContext, alias: string) {
  if (!alias) {
    await context.session.execute('help coin');
    return "";
  }
  let isAdmin = await context.ctx.permissions.check(context.config.admin, context.session)
  const res = await context.prism.insertCoin(alias, context.session.userId, isAdmin);
  return `🪙 已为 ${res.machineName} 投入 ${res.count} 个币`;
}

// --- Admin Handlers ---

async function handleAdminListAssets(context: ActionContext) {
  await checkAdmin(context);
  const res = await context.prism.adminListAssets();
  if (!res || res.length === 0) return "暂无资产";
  return res.map((a: any) => {
    const status = a.valid ? '[有效]' : '[无效]';
    const typeInfo = `${a.type} (ID:${a.assetId})`;
    let timeInfo = '';
    if (a.activeAt || a.expireAt) {
      const start = a.activeAt ? formatDateTime(a.activeAt) : '不限';
      const end = a.expireAt ? formatDateTime(a.expireAt) : '不限';
      timeInfo = `\n    有效期: ${start} -> ${end}`;
    }
    const desc = a.description ? `\n    描述: ${a.description}` : '';
    return `${status} [${a.id}] ${a.name}\n    类型: ${typeInfo}${timeInfo}${desc}`;
  }).join('\n\n');
}

async function handleAdminAddAsset(context: ActionContext, type: string, defId: number, name: string, desc: string) {
  await checkAdmin(context);
  const opts = context.options || {};
  if (!type || defId === undefined || !name) {
    await context.session.execute('help admin.asset.add');
    return "";
  }
  await context.prism.adminCreateAsset({
    type,
    assetId: defId,
    name,
    description: desc,
    valid: opts.valid,
    activeAt: opts.active,
    expireAt: opts.expire
  });
  return `资产 ${name} [${type}-${defId}] 创建成功`;
}

async function handleAdminDelAsset(context: ActionContext, id: number) {
  await checkAdmin(context);
  if (!id) {
    await context.session.execute('help admin.asset.del');
    return "";
  }
  await context.prism.adminDeleteAsset(id);
  return `资产 ${id} 删除成功`;
}

async function handleAdminValidAsset(context: ActionContext, id: number) {
  await checkAdmin(context);
  if (!id) {
    await context.session.execute('help admin.asset.valid');
    return "";
  }
  await context.prism.adminToggleAssetState(id, true);
  return `已启用 ${id}`;
}

async function handleAdminInvalidAsset(context: ActionContext, id: number) {
  await checkAdmin(context);
  if (!id) {
    await context.session.execute('help admin.asset.invalid');
    return "";
  }
  await context.prism.adminToggleAssetState(id, false);
  return `已禁用 ${id}`;
}

async function handleAdminDelCoupon(context: ActionContext, id: number) {
  await checkAdmin(context);
  if (!id) {
    await context.session.execute('help admin.coupon.del');
    return "";
  }
  await context.prism.adminDeleteAsset(id);
  return `优惠券 ${id} 删除成功`;
}

async function handleAdminListCoupons(context: ActionContext) {
  await checkAdmin(context);
  const res = await context.prism.adminListCoupons();
  if (!res || res.length === 0) return "暂无优惠券";
  return res.map((c: any) => {
    const ef = c.billingEffect;
    if (!ef) return `[${c.id}] ${c.name} (无特效)`;

    const typeStr = ef.type === 'RATE' ? `折扣 ${(ef.value * 10).toFixed(1)}折` : `减免 ${ef.value}元`;
    const p = `P${ef.priority}`;

    const flags = [];
    if (ef.consume) flags.push('一次性');
    if (ef.stackable) flags.push('可叠加');

    const limits = [];
    if (ef.maxDiscountAmount) limits.push(`封顶${ef.maxDiscountAmount}元`);
    if (ef.condition?.minCost) limits.push(`满${ef.condition.minCost}元`);
    if (ef.condition?.matchRuleIds?.length) limits.push(`限规则[${ef.condition.matchRuleIds.join(',')}]`);

    return `🎫 [${c.id}] ${c.name}\n    效果: ${typeStr}\n    属性: ${p} | ${flags.join(', ') || '无特殊属性'}\n    限制: ${limits.join(', ') || '无限制'}`;
  }).join('\n\n');
}

async function handleAdminAddCoupon(context: ActionContext, name: string, defId: number, type: string, value: number) {
  await checkAdmin(context);
  const opts = context.options || {};

  if (!name || defId === undefined || !type || value === undefined) {
    await context.session.execute('help admin.coupon.add');
    return "";
  }

  let t = type.toUpperCase();
  if (t === 'FIXED') t = 'FIXED_OFF';

  if (t !== 'RATE' && t !== 'FIXED_OFF') {
    return "类型错误: type 必须是 RATE (折扣) 或 FIXED (减免)";
  }

  await context.prism.adminCreateCoupon({
    name,
    assetDefId: defId,
    billingEffect: {
      type: t,
      value: value,
      priority: opts.priority || 0,
      consume: !!opts.consume,
      stackable: !!opts.stackable,
      maxDiscountAmount: opts.max,
      condition: {
        minCost: opts.min,
        matchRuleIds: opts.rules ? String(opts.rules).split(',').map(Number) : undefined
      }
    }
  });
  return `优惠券 ${name} 创建成功`;
}

async function handleAdminListGifts(context: ActionContext) {
  await checkAdmin(context);
  const res = await context.prism.adminListGifts();
  if (!res || res.length === 0) return "暂无礼物";
  return res.map((g: any) => {
    const limit = g.oncePerUser ? '🔴 每人限领一次' : '🟢 可重复领取';
    const items = (g.body || []).map((i: any) => {
      let detail = `${i.name} x${i.count}`;
      if (i.durationMs) {
        const days = (i.durationMs / (1000 * 60 * 60 * 24)).toFixed(1);
        detail += ` (${days}天)`;
      }
      if (i.mergeStrategy === 'EXTEND_TIME') detail += ' [续期]';
      if (i.mergeStrategy === 'REPLACE') detail += ' [覆盖]';
      return detail;
    }).join('\n    - ');

    return `[${g.id}] ${g.name}\n    限制: ${limit}\n    内容:\n    - ${items}`;
  }).join('\n\n');
}

function parseFriendlyDate(dateStr: string | undefined): Date | undefined {
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

async function handleAdminAddGift(context: ActionContext, name: string, content: string) {
  await checkAdmin(context);
  const options = context.options || {};

  // 1. 基础参数校验
  if (!name || !content) {
    await context.session.execute('help admin.gift.add');
    return "";
  }

  try {
    // 2. 获取现有资产列表用于校验 ID
    const allAssets = await context.prism.adminListAssets() as Asset[];
    const assetMap = new Map(allAssets.map(a => [a.id, a]));

    // 3. 解析输入内容
    // 格式定义: id:count:strategy:duration/expire:active:comment
    // 分隔符: 逗号分隔多个物品，冒号分隔字段
    const items = content.split(/[,，]/).map((itemStr, index) => {
      const parts = itemStr.trim().split(/[:：]/);
      if (parts.length < 1 || !parts[0]) {
        throw new Error(`第 ${index + 1} 项格式错误，必须包含资产ID`);
      }

      const [
        idStr,          // 0: 资产ID
        countStr,       // 1: 数量
        strategyStr,    // 2: 合并策略
        valueStr,       // 3: 时长(秒) 或 过期时间
        activeStr,      // 4: 生效时间
        commentStr      // 5: 备注
      ] = parts;

      // ID 校验
      const id = parseInt(idStr);
      if (isNaN(id)) throw new Error(`第 ${index + 1} 项资产ID "${idStr}" 无效`);
      if (!assetMap.has(id)) throw new Error(`第 ${index + 1} 项资产ID ${id} 不存在`);
      const asset = assetMap.get(id)!;

      // 数量校验 (默认 1)
      const count = countStr ? parseInt(countStr) : 1;
      if (isNaN(count) || count <= 0) throw new Error(`第 ${index + 1} 项数量 "${countStr}" 无效`);

      // 合并策略校验 (默认 STACK)
      let mergeStrategy: "STACK" | "EXTEND_TIME" | "REPLACE" = "STACK";
      if (strategyStr && strategyStr.trim()) {
        const s = strategyStr.trim().toUpperCase();
        if (["STACK", "EXTEND_TIME", "REPLACE"].includes(s)) {
          mergeStrategy = s as any;
        }
      }

      // 时间/时长校验
      let durationMs: number | undefined;
      let expireAt: string | undefined;

      if (mergeStrategy === 'EXTEND_TIME') {
        // 如果是 EXTEND_TIME，valueStr 解析为时长(秒)
        if (valueStr) {
          const seconds = parseFloat(valueStr);
          if (!isNaN(seconds) && seconds > 0) {
            durationMs = seconds * 1000;
          }
        }
      } else {
        // 否则解析为过期时间
        const date = parseFriendlyDate(valueStr);
        if (date) expireAt = date.toISOString();
      }

      // 生效时间
      const activeAtDate = parseFriendlyDate(activeStr);
      const activeAt = activeAtDate ? activeAtDate.toISOString() : undefined;

      return {
        id: asset.id,
        name: asset.name,
        count,
        expireAt,
        activeAt,
        durationMs,
        mergeStrategy,
        comment: commentStr || undefined,
        oncePerUser: false // 默认 false，由礼包整体控制
      };
    });

    // 4. 发送请求
    await context.prism.adminCreateGift({
      name,
      oncePerUser: !!options.once,
      body: items
    });

    return `🎁 礼物 [${name}] 创建成功！包含 ${items.length} 种物品。`;
  } catch (e: any) {
    return `❌ 创建失败: ${e.message}`;
  }
}

async function handleAdminDelGift(context: ActionContext, id: number) {
  await checkAdmin(context);
  if (!id) {
    await context.session.execute('help admin.gift.del');
    return "";
  }
  await context.prism.adminDeleteGift(id);
  return `礼物 ${id} 删除成功`;
}

async function handleAdminGiftCodes(context: ActionContext, id: number, count: number) {
  await checkAdmin(context);
  if (!id || !count) {
    await context.session.execute('help admin.gift.codes');
    return "";
  }
  const res = await context.prism.adminGenerateGiftCodes(id, count);
  return `成功生成 ${res.count} 个兑换码:\n${res.codes.join('\n')}`;
}

async function handleAdminListRules(context: ActionContext) {
  await checkAdmin(context);
  const res = await context.prism.adminListRules();
  if (!res || res.length === 0) return "暂无规则";
  return res.map((r: any) => {
    const tr = r.timeRange;
    const pr = r.pricing;
    const md = r.matchDate || {};

    let dateStr = '每天';
    if (md.specificDates?.length) dateStr = `指定日期(${md.specificDates.length}天)`;
    if (md.weekdays?.length) {
      const days = md.weekdays.map((d: number) => ['日', '一', '二', '三', '四', '五', '六'][d]).join('');
      dateStr = `每周[${days}]`;
    }

    const status = r.available ? '[✅]' : '[❌]';

    return `${status} [${r.id}] ${r.name} (P${r.priority})\n    时间: ${dateStr} ${tr.start}-${tr.end}\n    价格: ${pr.unitPrice}元 / ${pr.unitMinutes}分钟\n    封顶: ${pr.priceCap}元 (宽限${pr.roundGraceMinutes}分)`;
  }).join('\n\n');
}

async function handleAdminDelRule(context: ActionContext, id: number) {
  await checkAdmin(context);
  if (!id) {
    await context.session.execute('help admin.rule.del');
    return "";
  }
  await context.prism.adminDeleteRule(id);
  return `规则 ${id} 删除成功`;
}

async function handleAdminRuleStatus(context: ActionContext, id: number, state: string) {
  await checkAdmin(context);
  if (!id || !state) {
    await context.session.execute('help admin.rule.set');
    return "";
  }
  const available = ['on', 'true', 'enable', '1', 'yes'].includes(state.toLowerCase());
  await context.prism.adminUpdateRuleStatus(id, available);
  return `规则 ${id} 已${available ? '启用' : '禁用'}`;
}

async function handleAdminUserAssetAdd(context: ActionContext, user: string, assetId: number, count?: number) {
  await checkAdmin(context);
  if (!user || !assetId) {
    await context.session.execute('help admin.user.asset.add');
    return "";
  }
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  let res = await context.prism.upsertUserAssets(userId, [{
    id: assetId,
    count: count
  }]);
  return `已为用户 ${userId} 添加资产 ${JSON.stringify(res)}`;
}

async function handleAdminUserAssetDel(context: ActionContext, user: string, userAssetId: number, count?: number) {
  await checkAdmin(context);
  if (!user || !userAssetId) {
    await context.session.execute('help admin.user.asset.del');
    return "";
  }
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  if (count) {
    await context.prism.updateUserAsset(userId, userAssetId, -count);
    return `已为用户 ${userId} 扣除资产(ID:${userAssetId}) 数量 ${count}`;
  } else {
    await context.prism.deleteUserAsset(userId, userAssetId);
    return `已为用户 ${userId} 删除资产(ID:${userAssetId})`;
  }
}

async function handleAdminUserAssetList(context: ActionContext, user: string) {
  await checkAdmin(context);
  if (!user) {
    await context.session.execute('help admin.user.asset.list');
    return "";
  }
  const { error, userId } = await getTargetUserId(context, user);
  if (error) return error;

  const res = await context.prism.assets(userId);
  if (!res || res.length === 0) return `用户 ${userId} 没有任何资产`;
  return res.map((a: UserAsset) => {
    const expire = a.expireAt ? `(到期: ${formatDateTime(a.expireAt)})` : '';
    return `[${a.id}]-[${a.assetId}] ${a.asset.name} x${a.count} ${expire}`;
  }).join('\n');
}

export function apply(ctx: Context, config: Config) {
  // ctx.state.inject(name, {
  //   pendingLogout: {} as Record<string, number>
  // });
  const prism = new PrismService(ctx, config);
  const createAction = <A extends any[]>(
    handler: (context: ActionContext, ...args: A) => Promise<string>
  ) => {
    const actionFn = (argv: Argv, ...args: A) => {
      const context: ActionContext = {
        ctx,
        config,
        session: argv.session,
        options: argv.options,
        prism,
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
  ctx.command('history [amount:number]').action(createAction((context, amount) => handleHistoriesCmd(context, undefined, amount)));
  ctx.command('ahistory <user:user> [amount:number]').action(createAction((context, user, amount) => handleHistoriesCmd(context, user, amount)));
  ctx.command('billing [user:user]').action(createAction(handleBillingCmd));
  ctx.command('lock').action(createAction(handleLockCmd));
  ctx.command('items [user:user]').action(createAction(handleItemsCmd));
  ctx.command('show [alias]').action(createAction(handleMachineShow));
  ctx.command('on <alias>').action(createAction(handleMachineOn));
  ctx.command('off <alias>').action(createAction(handleMachineOff));
  ctx.command('redeem <code>').action(createAction(handleRedeem));
  ctx.command('coin <alias>').action(createAction(handleCoin));

  ctx.command('add <user:user> <amount:number>').action(createAction(handleWalletAdd));
  ctx.command('del <user:user> <amount:number>').action(createAction(handleWalletDeduct));

  ctx.command('overwrite <user:user> <amount>').action(createAction(handleCostOverwrite));

  // Admin Commands
  ctx.command('admin.asset.list', '列出资产').action(createAction(handleAdminListAssets));
  ctx.command('admin.asset.add <type> <defId:number> <name> [desc]', '添加资产')
    .option('valid', '-v [val:boolean]', { fallback: true })
    .option('active', '--active <date:string>')
    .option('expire', '--expire <date:string>')
    .action(createAction(handleAdminAddAsset));
  ctx.command('admin.asset.del <id:number>', '删除资产').action(createAction(handleAdminDelAsset));
  ctx.command('admin.asset.valid <id:number>', '让资产生效').action(createAction(handleAdminValidAsset));
  ctx.command('admin.asset.invalid <id:number>', '让资产无效').action(createAction(handleAdminInvalidAsset));

  ctx.command('admin.coupon.list', '列出优惠券').action(createAction(handleAdminListCoupons));
  ctx.command('admin.user.asset.add <user:user> <assetId:number> [count:number]', '发放资产').action(createAction(handleAdminUserAssetAdd));
  ctx.command('admin.user.asset.del <user:user> <userAssetId:number> [count:number]', '删除资产(指定数量则扣除)').action(createAction(handleAdminUserAssetDel));
  ctx.command('admin.user.asset.list <user:user>', '列出用户资产').action(createAction(handleItemsCmd))

  ctx.command('admin.coupon.add <name> <defId:number> <type> <value:number>', '添加优惠券')
    .option('priority', '-p <val:number>', { fallback: 0 })
    .option('consume', '-c', { fallback: false })
    .option('stackable', '-s', { fallback: false })
    .option('min', '--min <val:number>')
    .option('max', '--max <val:number>')
    .option('rules', '--rules <ids:string>')
    .action(createAction(handleAdminAddCoupon));
  ctx.command('admin.coupon.del <id:number>', '删除优惠券').action(createAction(handleAdminDelCoupon));

  ctx.command('admin.gift.list', '列出礼物').action(createAction(handleAdminListGifts));
  ctx.command('admin.gift.add <name> <content:text>', '添加礼物')
    .usage('格式: id:count:strategy:duration/expire:active:comment (逗号分隔多个)\n示例: 1001:1:EXTEND_TIME:2592000::备注 (30天1001物品)\n示例: 1002:10:::2025-01-01:: (10个1002物品，有效期至2025-01-01)')
    .option('once', '-o [val:boolean]', { fallback: false })
    .action(createAction(handleAdminAddGift));
  ctx.command('admin.gift.del <id:number>', '删除礼物').action(createAction(handleAdminDelGift));
  ctx.command('admin.gift.codes <id:number> <count:number>', '生成礼物兑换码').action(createAction(handleAdminGiftCodes));

  ctx.command('admin.rule.list', '列出规则').action(createAction(handleAdminListRules));
  ctx.command('admin.rule.del <id:number>', '删除规则').action(createAction(handleAdminDelRule));
  ctx.command('admin.rule.set <id:number> <state>', '设置规则状态').action(createAction(handleAdminRuleStatus));
  ctx.command('echo <message>')
    .action((_, message) => message)

  ctx.setInterval(
    async () => {
      let list = await prism.list();
      if (list.length < 1) {
        let machines = await prism.getAllMachinePower();
        let turnOff = false;
        machines.forEach((m) => {
          if (m.state.state !== 'off') {
            turnOff = true;
          }
        })
        if (turnOff) {
          let res = await prism.machinePowerOff("all", "system", false);
          ctx.broadcast(config.broadcasts, "窝里目前有 0 人，自动关闭所有机器")
        }
        return;
      }
    }, config.powerOffInterval
  )
}
