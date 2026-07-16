import { FastifyInstance, FastifyReply } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { parseObject13PlayerProfileWeaponOperation } from './playerProfileValidation.js';
import { isWeaponId } from './playerProfileEquipment.js';
import { unlockObject13PlayerProfileWeapon, Object13PlayerProfileWeaponUnlockResult } from './playerProfileEquipmentService.js';

// Domain-specific equipment endpoint — ordinary gameplay (unlocking the
// single or double-barrel shotgun) must never go through the general PUT
// /nocni-hlidac/player-profile (whole-profile overwrite race, see
// playerProfileRoutes.ts), same principle as the inventory endpoints.
//
// `/equipment/weapon/equip` is deliberately NOT registered here — the task
// spec makes it optional ("Protože nemáme výběrové UI, není povinný") and
// there is no production UI that would call it yet (no weapon-switching
// feature exists). `equipWeapon` (playerProfileEquipment.ts) is still
// implemented and unit-tested as a pure function, ready for a future route
// once a switch-weapon UI actually needs it — adding that route later is a
// few lines here, not a redesign.
export async function nocniHlidacPlayerProfileEquipmentRoutes(app: FastifyInstance): Promise<void> {
  function sendUnlockResult(reply: FastifyReply, result: Object13PlayerProfileWeaponUnlockResult) {
    switch (result.outcome) {
      case 'updated':
      case 'unchanged':
        return reply.status(200).send(result.profile);
      case 'not_found':
        return sendError(reply, 404, 'profile_not_found');
      case 'revision_conflict':
        return reply.status(409).send({
          error: 'revision_conflict',
          currentRevision: result.currentRevision,
          profile: result.profile,
        });
    }
  }

  app.post('/nocni-hlidac/player-profile/equipment/weapon/unlock', { preHandler: nocniHlidacAuth }, async (request, reply) => {
    const parsed = parseObject13PlayerProfileWeaponOperation(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_request');
    if (!isWeaponId(parsed.data.weaponId)) return sendError(reply, 400, 'invalid_request');

    try {
      const result = await unlockObject13PlayerProfileWeapon(parsed.data.discordUserId, parsed.data.weaponId, parsed.data.expectedRevision);
      return sendUnlockResult(reply, result);
    } catch (err) {
      request.log.error({ err }, 'object13 player-profile equipment weapon unlock failed');
      return sendError(reply, 500, 'internal_error');
    }
  });
}
