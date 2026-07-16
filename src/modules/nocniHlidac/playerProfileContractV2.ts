// Object13PlayerProfileDataV2 — profile contract v2 (see task spec
// "profilový kontrakt V2"). Adds `equipment` (durable weapon ownership)
// alongside the existing `inventory` (bulb count, see step "profilový
// kontrakt V1"). Deliberately a thin composition of the two independent
// registries (playerProfileInventory.ts, playerProfileEquipment.ts) — this
// module owns nothing except the combined shape and its default factory, so
// neither leaf module needs to know about the other (no import cycle).

import { createDefaultObject13PlayerProfileDataV1, Object13InventoryItems } from './playerProfileInventory.js';
import { createDefaultEquipmentState, Object13EquipmentState } from './playerProfileEquipment.js';

export interface Object13PlayerProfileDataV2 {
  inventory: {
    items: Object13InventoryItems;
  };
  equipment: Object13EquipmentState;
}

/**
 * Single factory for "what a brand new V2 profile looks like" — reuses the
 * V1 inventory default (same bulb starting count, single source) plus an
 * empty equipment state (no weapons owned/equipped). Never partially
 * empty — see task spec's exact expected shape.
 */
export function createDefaultObject13PlayerProfileDataV2(): Object13PlayerProfileDataV2 {
  return {
    inventory: createDefaultObject13PlayerProfileDataV1().inventory,
    equipment: createDefaultEquipmentState(),
  };
}
