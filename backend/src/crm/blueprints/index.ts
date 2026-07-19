import type { GhlBlueprint } from '../../types/index.js';
import { gravviaSalesBlueprint } from './gravvia-sales.blueprint.js';
import { clientInboundBlueprint } from './client-inbound.blueprint.js';

/**
 * Shipped blueprints, addressable by name from the provision route and
 * client_settings. Both are schema-validated in the blueprint test suite so a
 * malformed default fails CI rather than server boot.
 */
export const defaultBlueprints: Record<string, GhlBlueprint> = {
  'gravvia-sales': gravviaSalesBlueprint,
  'client-inbound': clientInboundBlueprint,
};

export { gravviaSalesBlueprint, clientInboundBlueprint };
