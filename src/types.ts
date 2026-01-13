import { Context, Session } from 'koishi';
import { Config } from './index';
import { PrismService } from './service';

export interface ActionContext {
    ctx: Context;
    config: Config;
    session?: Session;
    options?: any;
    prism: PrismService;
}
