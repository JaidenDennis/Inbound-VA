import { PluginRegistry } from '../plugins/index.js';
import type { ICrmAdapter } from './crm.interface.js';
import { goHighLevelPlugin } from './adapters/gohighlevel.adapter.js';
import { hubSpotPlugin } from './adapters/hubspot.adapter.js';
import { salesforcePlugin } from './adapters/salesforce.adapter.js';
import { zohoPlugin } from './adapters/zoho.adapter.js';
import { webhookPlugin } from './adapters/webhook.adapter.js';
import { noopPlugin } from './adapters/noop.adapter.js';

export const crmRegistry = new PluginRegistry<ICrmAdapter>('crm');

// Register built-in adapters
crmRegistry.register(goHighLevelPlugin);
crmRegistry.register(hubSpotPlugin);
crmRegistry.register(salesforcePlugin);
crmRegistry.register(zohoPlugin);
crmRegistry.register(webhookPlugin);
crmRegistry.register(noopPlugin);

export function getCrmAdapter(type: string, config: Record<string, unknown>): ICrmAdapter {
  return crmRegistry.resolve(type, config);
}
