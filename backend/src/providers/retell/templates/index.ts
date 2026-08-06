import type { AgentTemplate } from './template.types.js';
import { medSpaTemplate } from './med-spa.template.js';
import { inboundRoutingTemplate } from './inbound-routing.template.js';
import { medSpaRoutingTemplate } from './med-spa-routing.template.js';
import { dentalRoutingTemplate } from './dental-routing.template.js';
import { orthodonticRoutingTemplate } from './orthodontic-routing.template.js';
import { lawFirmRoutingTemplate } from './law-firm-routing.template.js';
import { restaurantRoutingTemplate } from './restaurant-routing.template.js';

// Vertical → template registry. New verticals register here without touching
// the provisioning service (open for extension, closed for modification).
const templates = new Map<string, AgentTemplate>();

export function registerTemplate(template: AgentTemplate): void {
  templates.set(template.vertical, template);
}
export function getTemplate(vertical: string): AgentTemplate | null {
  return templates.get(vertical) ?? null;
}
export function listVerticals(): string[] {
  return [...templates.keys()];
}

registerTemplate(medSpaTemplate);
registerTemplate(inboundRoutingTemplate);
registerTemplate(medSpaRoutingTemplate);
registerTemplate(dentalRoutingTemplate);
registerTemplate(orthodonticRoutingTemplate);
registerTemplate(lawFirmRoutingTemplate);
registerTemplate(restaurantRoutingTemplate);

/**
 * Map a client's industry to a default template vertical. Only a default —
 * provisioning always accepts an explicit template override, which is how a
 * client runs a vertical that doesn't match its industry label.
 *
 * The new vertical playbooks are additive: existing industries keep resolving
 * exactly as they did before, so no already-provisioned client changes template
 * on its next re-provision.
 */
export function resolveVertical(industry: string): string {
  switch (industry) {
    case 'dental':
      return 'dental_routing';
    case 'orthodontic':
      return 'orthodontic_routing';
    case 'legal':
      return 'law_firm_routing';
    case 'restaurant':
      return 'restaurant_routing';
    case 'beauty':
    case 'medical':
      return 'med_spa';
    default:
      return 'med_spa'; // unchanged legacy default; see resolveVertical tests
  }
}

export * from './template.types.js';
