import { Context, Session } from 'koishi';
import { Config } from './index';

export interface ActionContext {
    ctx: Context;
    config: Config;
    session: Session;
}