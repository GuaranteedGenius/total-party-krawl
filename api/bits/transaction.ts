// ============================================================
// POST /api/bits/transaction — Record a Bits purchase action
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { gameStates, pendingBitsActions } from '../_store';
import { BitsTransactionRequest } from '../../lib/types';

const VALID_PRODUCTS = ['ultimate_strike', 'full_heal'] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    verifyToken(req);

    const body = req.body as BitsTransactionRequest;
    if (!body.channel_id || !body.product || !body.transaction_id || !body.viewer_id) {
      return res.status(400).json({ error: 'channel_id, product, transaction_id, and viewer_id are required' });
    }

    if (!VALID_PRODUCTS.includes(body.product)) {
      return res.status(400).json({ error: `Invalid product. Must be one of: ${VALID_PRODUCTS.join(', ')}` });
    }

    const state = gameStates.get(body.channel_id);
    if (!state) {
      return res.status(404).json({ error: 'No active game on this channel' });
    }

    if (state.phase === 'game_over') {
      return res.status(400).json({ error: 'Game is already over' });
    }

    if (state.match_id !== body.match_id) {
      return res.status(400).json({ error: 'match_id does not match the active game' });
    }

    // Queue the bits action for the next turn resolution
    const pending = pendingBitsActions.get(body.channel_id) ?? [];
    pending.push(body.product);
    pendingBitsActions.set(body.channel_id, pending);

    return res.status(200).json({
      queued: true,
      product: body.product,
      pending_count: pending.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/bits/transaction error:', message);
    return res.status(500).json({ error: message });
  }
}
