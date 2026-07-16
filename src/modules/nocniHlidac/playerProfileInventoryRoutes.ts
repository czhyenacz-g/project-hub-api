import { FastifyInstance, FastifyReply } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { parseObject13PlayerProfileInventoryOperation } from './playerProfileValidation.js';
import {
  addObject13PlayerProfileInventoryItem,
  consumeObject13PlayerProfileInventoryItem,
  Object13PlayerProfileInventoryOperationResult,
} from './playerProfileInventoryService.js';
import { OBJECT13_INVENTORY_ITEM_IDS } from './playerProfileInventory.js';

// Domain-specific inventory endpoints — ordinary gameplay (getting/consuming
// a spare bulb) must never go through the general PUT /nocni-hlidac/player-profile
// (whole-profile overwrite race, see playerProfileRoutes.ts). One `/add` and
// one `/consume` route per registered item id (see playerProfileInventory.ts)
// — adding a second item later is a new registry entry, this loop then
// registers its routes automatically, no new route-wiring code.
export async function nocniHlidacPlayerProfileInventoryRoutes(app: FastifyInstance): Promise<void> {
  function sendOperationResult(reply: FastifyReply, result: Object13PlayerProfileInventoryOperationResult) {
    switch (result.outcome) {
      case 'updated':
        return reply.status(200).send(result.profile);
      case 'not_found':
        return sendError(reply, 404, 'profile_not_found');
      case 'revision_conflict':
        return reply.status(409).send({
          error: 'revision_conflict',
          currentRevision: result.currentRevision,
          profile: result.profile,
        });
      case 'exceeds_maximum':
        return sendError(reply, 409, 'exceeds_maximum');
      case 'insufficient_inventory':
        return sendError(reply, 409, 'insufficient_inventory');
    }
  }

  for (const itemId of OBJECT13_INVENTORY_ITEM_IDS) {
    app.post(
      `/nocni-hlidac/player-profile/inventory/${itemId}/add`,
      { preHandler: nocniHlidacAuth },
      async (request, reply) => {
        const parsed = parseObject13PlayerProfileInventoryOperation(request.body);
        if (!parsed.success) return sendError(reply, 400, 'invalid_request');

        try {
          const result = await addObject13PlayerProfileInventoryItem(
            parsed.data.discordUserId,
            itemId,
            parsed.data.amount,
            parsed.data.expectedRevision,
          );
          return sendOperationResult(reply, result);
        } catch (err) {
          request.log.error({ err }, `object13 player-profile inventory ${itemId} add failed`);
          return sendError(reply, 500, 'internal_error');
        }
      },
    );

    app.post(
      `/nocni-hlidac/player-profile/inventory/${itemId}/consume`,
      { preHandler: nocniHlidacAuth },
      async (request, reply) => {
        const parsed = parseObject13PlayerProfileInventoryOperation(request.body);
        if (!parsed.success) return sendError(reply, 400, 'invalid_request');

        try {
          const result = await consumeObject13PlayerProfileInventoryItem(
            parsed.data.discordUserId,
            itemId,
            parsed.data.amount,
            parsed.data.expectedRevision,
          );
          return sendOperationResult(reply, result);
        } catch (err) {
          request.log.error({ err }, `object13 player-profile inventory ${itemId} consume failed`);
          return sendError(reply, 500, 'internal_error');
        }
      },
    );
  }
}
