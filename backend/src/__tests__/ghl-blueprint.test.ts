import { describe, it, expect } from 'vitest';
import { ghlBlueprintSchema } from '../types/ghl-blueprint.types.js';
import { defaultBlueprints, gravviaSalesBlueprint } from '../crm/blueprints/index.js';
import type { GhlBlueprint } from '../types/index.js';

function baseBlueprint(): GhlBlueprint {
  return {
    name: 'test',
    pipeline: { name: 'Test Pipeline', stages: ['New', 'Won'] },
    customFields: [
      { name: 'Interest Level', dataType: 'SINGLE_OPTIONS', options: ['Hot', 'Cold'] },
      { name: 'Notes', dataType: 'LARGE_TEXT' },
    ],
    tags: ['inbound'],
    demoLeads: [
      {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@acme.example.com',
        phone: '+15550100001',
        customFields: { 'Interest Level': 'Hot' },
        opportunity: { name: 'Acme', stage: 'New', monetaryValue: 100 },
      },
    ],
  };
}

describe('ghlBlueprintSchema', () => {
  it('parses a valid blueprint', () => {
    expect(ghlBlueprintSchema.safeParse(baseBlueprint()).success).toBe(true);
  });

  it('rejects an opportunity stage that is not in the pipeline', () => {
    const bp = baseBlueprint();
    bp.demoLeads![0].opportunity!.stage = 'Nonexistent';
    const result = ghlBlueprintSchema.safeParse(bp);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not in pipeline.stages');
  });

  it('requires options on SINGLE_OPTIONS fields and forbids them elsewhere', () => {
    const noOptions = baseBlueprint();
    noOptions.customFields[0].options = undefined;
    expect(ghlBlueprintSchema.safeParse(noOptions).success).toBe(false);

    const extraOptions = baseBlueprint();
    extraOptions.customFields[1].options = ['a'];
    expect(ghlBlueprintSchema.safeParse(extraOptions).success).toBe(false);
  });

  it('rejects demo-lead custom fields that are not declared', () => {
    const bp = baseBlueprint();
    bp.demoLeads![0].customFields = { Undeclared: 'x' };
    const result = ghlBlueprintSchema.safeParse(bp);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not a declared custom field');
  });

  it('rejects duplicate demo-lead emails and phones (GHL upsert merges on either)', () => {
    const dupEmail = baseBlueprint();
    dupEmail.demoLeads!.push({ ...dupEmail.demoLeads![0], phone: '+15550100002' });
    expect(ghlBlueprintSchema.safeParse(dupEmail).success).toBe(false);

    const dupPhone = baseBlueprint();
    dupPhone.demoLeads!.push({ ...dupPhone.demoLeads![0], email: 'other@acme.example.com' });
    expect(ghlBlueprintSchema.safeParse(dupPhone).success).toBe(false);
  });
});

describe('shipped blueprints', () => {
  it('all shipped blueprints pass schema validation', () => {
    for (const [name, blueprint] of Object.entries(defaultBlueprints)) {
      const result = ghlBlueprintSchema.safeParse(blueprint);
      expect(result.success, `${name}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('gravvia-sales has ~20 demo leads with opportunities covering every stage', () => {
    const leads = gravviaSalesBlueprint.demoLeads;
    expect(leads.length).toBeGreaterThanOrEqual(15);
    const usedStages = new Set(leads.map((l) => l.opportunity?.stage));
    for (const stage of gravviaSalesBlueprint.pipeline.stages) {
      expect(usedStages, `no opportunity in stage "${stage}"`).toContain(stage);
    }
  });

  it('client-inbound ships without demo leads', () => {
    expect(defaultBlueprints['client-inbound'].demoLeads).toBeUndefined();
  });
});
