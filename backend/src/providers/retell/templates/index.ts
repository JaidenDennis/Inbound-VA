import type { AgentTemplate } from './template.types.js';
import { medSpaTemplate } from './med-spa.template.js';

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

/** Map a client's industry to a default template vertical. */
export function resolveVertical(industry: string): string {
  switch (industry) {
    case 'beauty':
    case 'medical':
      return 'med_spa';
    default:
      return 'med_spa'; // sensible default until more verticals are added
  }
}

export * from './template.types.js';
