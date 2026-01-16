import { Argv, Context, h, Schema, Session } from 'koishi'
import { PrismService } from './service'
import { ApiError } from './model'
import { ActionContext } from './types'
import { handleAdminAddAsset, handleAdminAddCoupon, handleAdminAddGift, handleAdminDelAsset, handleAdminDelCoupon, handleAdminDelGift, handleAdminDelRule, handleAdminGiftCodes, handleAdminInvalidAsset, handleAdminListAssets, handleAdminListCoupons, handleAdminListGifts, handleAdminListRules, handleAdminRuleStatus, handleAdminUserAssetAdd, handleAdminUserAssetDel, handleAdminUserAssetList, handleAdminValidAsset } from './handlers/admin'
import { handleItemsCmd, handleRedeem } from './handlers/item'
import { handleCoin, handleLockCmd, handleMachineOff, handleMachineOn, handleMachineShow } from './handlers/machine'
import { handleListCmd, handleLoginCmd, handleLogoutCmd, handleRegisterCmd } from './handlers/user'
import { handleBillingCmd, handleCostOverwrite, handleHistoriesCmd, handleWalletAdd, handleWalletCmd, handleWalletDeduct } from './handlers/wallet'

export const name = 'prism-neo'

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
