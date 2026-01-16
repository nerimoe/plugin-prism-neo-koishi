import { ActionContext } from '../types';
import { UserAsset } from '../model';
import { getTargetUserId, getUserName, formatDateTime } from './utils';
import { executeWithAutoRegister } from './user';

export async function handleItemsCmd(context: ActionContext, user?: string) {
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

export async function handleRedeem(context: ActionContext, code: string) {
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
