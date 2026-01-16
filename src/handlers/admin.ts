import { ActionContext } from '../types';
import { Asset, UserAsset } from '../model';
import { checkAdmin, formatDateTime, getTargetUserId, parseFriendlyDate } from './utils';

export async function handleAdminListAssets(context: ActionContext) {
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

export async function handleAdminAddAsset(context: ActionContext, type: string, defId: number, name: string, desc: string) {
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

export async function handleAdminDelAsset(context: ActionContext, id: number) {
    await checkAdmin(context);
    if (!id) {
        await context.session.execute('help admin.asset.del');
        return "";
    }
    await context.prism.adminDeleteAsset(id);
    return `资产 ${id} 删除成功`;
}

export async function handleAdminValidAsset(context: ActionContext, id: number) {
    await checkAdmin(context);
    if (!id) {
        await context.session.execute('help admin.asset.valid');
        return "";
    }
    await context.prism.adminToggleAssetState(id, true);
    return `已启用 ${id}`;
}

export async function handleAdminInvalidAsset(context: ActionContext, id: number) {
    await checkAdmin(context);
    if (!id) {
        await context.session.execute('help admin.asset.invalid');
        return "";
    }
    await context.prism.adminToggleAssetState(id, false);
    return `已禁用 ${id}`;
}

export async function handleAdminDelCoupon(context: ActionContext, id: number) {
    await checkAdmin(context);
    if (!id) {
        await context.session.execute('help admin.coupon.del');
        return "";
    }
    await context.prism.adminDeleteAsset(id);
    return `优惠券 ${id} 删除成功`;
}

export async function handleAdminListCoupons(context: ActionContext) {
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

export async function handleAdminAddCoupon(context: ActionContext, name: string, defId: number, type: string, value: number) {
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

export async function handleAdminListGifts(context: ActionContext) {
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

export async function handleAdminAddGift(context: ActionContext, name: string, content: string) {
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

export async function handleAdminDelGift(context: ActionContext, id: number) {
    await checkAdmin(context);
    if (!id) {
        await context.session.execute('help admin.gift.del');
        return "";
    }
    await context.prism.adminDeleteGift(id);
    return `礼物 ${id} 删除成功`;
}

export async function handleAdminGiftCodes(context: ActionContext, id: number, count: number) {
    await checkAdmin(context);
    if (!id || !count) {
        await context.session.execute('help admin.gift.codes');
        return "";
    }
    const res = await context.prism.adminGenerateGiftCodes(id, count);
    return `成功生成 ${res.count} 个兑换码:\n${res.codes.join('\n')}`;
}

export async function handleAdminListRules(context: ActionContext) {
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

export async function handleAdminDelRule(context: ActionContext, id: number) {
    await checkAdmin(context);
    if (!id) {
        await context.session.execute('help admin.rule.del');
        return "";
    }
    await context.prism.adminDeleteRule(id);
    return `规则 ${id} 删除成功`;
}

export async function handleAdminRuleStatus(context: ActionContext, id: number, state: string) {
    await checkAdmin(context);
    if (!id || !state) {
        await context.session.execute('help admin.rule.set');
        return "";
    }
    const available = ['on', 'true', 'enable', '1', 'yes'].includes(state.toLowerCase());
    await context.prism.adminUpdateRuleStatus(id, available);
    return `规则 ${id} 已${available ? '启用' : '禁用'}`;
}

export async function handleAdminUserAssetAdd(context: ActionContext, user: string, assetId: number, count?: number) {
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

export async function handleAdminUserAssetDel(context: ActionContext, user: string, userAssetId: number, count?: number) {
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

export async function handleAdminUserAssetList(context: ActionContext, user: string) {
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
