import { z } from 'zod';

/**
 * Declarative description of everything the GHL provisioning service sets up
 * on a sub-account (Location): pipeline + stages, custom fields, tags, and
 * optional demo leads with opportunities. Stored per client in
 * client_settings.ghl_blueprint (NULL → shipped default), shipped defaults in
 * backend/src/crm/blueprints/.
 */

const customFieldSchema = z.object({
  name: z.string().min(1),
  dataType: z.enum(['TEXT', 'LARGE_TEXT', 'NUMERICAL', 'DATE', 'SINGLE_OPTIONS']),
  options: z.array(z.string().min(1)).optional(),
});

const demoLeadSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  tags: z.array(z.string().min(1)).optional(),
  customFields: z.record(z.string()).optional(),
  opportunity: z
    .object({
      name: z.string().min(1),
      stage: z.string().min(1),
      monetaryValue: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const ghlBlueprintSchema = z
  .object({
    name: z.string().min(1),
    pipeline: z.object({
      name: z.string().min(1),
      stages: z.array(z.string().min(1)).min(1),
    }),
    customFields: z.array(customFieldSchema),
    tags: z.array(z.string().min(1)),
    demoLeads: z.array(demoLeadSchema).optional(),
  })
  .superRefine((bp, ctx) => {
    const stages = new Set(bp.pipeline.stages.map((s) => s.toLowerCase()));
    const fieldNames = new Set(bp.customFields.map((f) => f.name.toLowerCase()));

    bp.customFields.forEach((field, i) => {
      if (field.dataType === 'SINGLE_OPTIONS' && !field.options?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customFields', i, 'options'],
          message: 'SINGLE_OPTIONS fields require a non-empty options list',
        });
      }
      if (field.dataType !== 'SINGLE_OPTIONS' && field.options !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customFields', i, 'options'],
          message: `options are only valid on SINGLE_OPTIONS fields (got ${field.dataType})`,
        });
      }
    });

    // GHL's contact upsert dedupes on email OR phone — a duplicate in either
    // silently merges two demo leads into one contact.
    const seenEmails = new Map<string, number>();
    const seenPhones = new Map<string, number>();
    (bp.demoLeads ?? []).forEach((lead, i) => {
      const email = lead.email.toLowerCase();
      if (seenEmails.has(email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['demoLeads', i, 'email'],
          message: `duplicate email also used by demoLeads[${seenEmails.get(email)}]`,
        });
      }
      seenEmails.set(email, i);
      if (seenPhones.has(lead.phone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['demoLeads', i, 'phone'],
          message: `duplicate phone also used by demoLeads[${seenPhones.get(lead.phone)}]`,
        });
      }
      seenPhones.set(lead.phone, i);

      if (lead.opportunity && !stages.has(lead.opportunity.stage.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['demoLeads', i, 'opportunity', 'stage'],
          message: `stage "${lead.opportunity.stage}" is not in pipeline.stages`,
        });
      }
      for (const key of Object.keys(lead.customFields ?? {})) {
        if (!fieldNames.has(key.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['demoLeads', i, 'customFields', key],
            message: `"${key}" is not a declared custom field`,
          });
        }
      }
    });
  });

export type GhlBlueprint = z.infer<typeof ghlBlueprintSchema>;
export type GhlBlueprintCustomField = z.infer<typeof customFieldSchema>;
export type GhlBlueprintDemoLead = z.infer<typeof demoLeadSchema>;
