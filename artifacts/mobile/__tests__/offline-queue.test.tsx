/**
 * Guards the offline repair queue's delivery half: repairs queued while
 * offline must actually reach the server when flush() runs, without dupes:
 *  - flush sends each queued item via the repairs API with its clientRequestId
 *  - items are removed from the queue on success
 *  - items are kept for retry on failure (pending for network errors,
 *    failed for 4xx client errors)
 *  - the SAME clientRequestId is reused across retries so the server can
 *    de-duplicate (idempotency)
 *
 * Mock boundary is the API client (network) plus storage (AsyncStorage) —
 * the real offlineQueue module runs.
 */

// ── Mocks (network + storage boundaries only) ────────────────────────────
const mockRepairsCreate = jest.fn();
jest.mock('@workspace/api-client-react', () => ({
  repairsCreate: (...a: unknown[]) => mockRepairsCreate(...a),
}));

// In-memory storage so the real queue persistence logic runs.
const mockMemoryStore = new Map<string, unknown>();
jest.mock('@/utils/storage', () => ({
  storage: {
    get: jest.fn(async (key: string) => (mockMemoryStore.has(key) ? mockMemoryStore.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      mockMemoryStore.set(key, JSON.parse(JSON.stringify(value)));
    }),
    remove: jest.fn(async (key: string) => {
      mockMemoryStore.delete(key);
    }),
  },
}));

import { offlineQueue } from '@/utils/offlineQueue';

const payload = (name: string) => ({
  customerName: name,
  mobile: '9876543210',
  deviceType: 'Smartphone',
  brand: 'Samsung',
  model: 'Galaxy S23',
  problem: 'Screen cracked',
  priority: 'normal',
  repairCharge: 2500,
  expectedDate: '2026-08-15',
});

const apiError = (status: number, message: string) => {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMemoryStore.clear();
});

describe('offlineQueue.flush delivers queued repairs', () => {
  it('sends queued items via the repairs API with their clientRequestId and removes them on success', async () => {
    mockRepairsCreate.mockResolvedValue({ repair: { id: 'r1' } });
    await offlineQueue.add(payload('Asha Kumar') as never, 'cr-1');
    await offlineQueue.add(payload('Ravi Patel') as never, 'cr-2');

    const result = await offlineQueue.flush();

    expect(result).toEqual({ success: 2, failed: 0 });
    expect(mockRepairsCreate).toHaveBeenCalledTimes(2);
    expect(mockRepairsCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ customerName: 'Asha Kumar', clientRequestId: 'cr-1' }),
    );
    expect(mockRepairsCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ customerName: 'Ravi Patel', clientRequestId: 'cr-2' }),
    );
    // Nothing left to re-send — no duplicates on the next flush.
    expect(await offlineQueue.getQueue()).toEqual([]);
    await offlineQueue.flush();
    expect(mockRepairsCreate).toHaveBeenCalledTimes(2);
  });

  it('an empty queue makes no API calls', async () => {
    expect(await offlineQueue.flush()).toEqual({ success: 0, failed: 0 });
    expect(mockRepairsCreate).not.toHaveBeenCalled();
  });

  it('keeps an item as pending when the network fails, and the retry reuses the SAME clientRequestId', async () => {
    mockRepairsCreate.mockRejectedValueOnce(new TypeError('Network request failed'));
    await offlineQueue.add(payload('Asha Kumar') as never, 'cr-1');

    const first = await offlineQueue.flush();
    expect(first).toEqual({ success: 0, failed: 1 });

    // Item survives with its identity intact for retry.
    const queued = await offlineQueue.getQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].clientRequestId).toBe('cr-1');
    expect(queued[0].status).toBe('pending');
    expect(queued[0].error).toBe('Network request failed');

    // Network returns — the retry sends the exact same clientRequestId so
    // the server can de-duplicate if the first attempt actually landed.
    mockRepairsCreate.mockResolvedValueOnce({ repair: { id: 'r1' } });
    const second = await offlineQueue.flush();
    expect(second).toEqual({ success: 1, failed: 0 });
    expect(mockRepairsCreate).toHaveBeenCalledTimes(2);
    const firstId = mockRepairsCreate.mock.calls[0][0].clientRequestId;
    const secondId = mockRepairsCreate.mock.calls[1][0].clientRequestId;
    expect(secondId).toBe(firstId);
    expect(secondId).toBe('cr-1');
    expect(await offlineQueue.getQueue()).toEqual([]);
  });

  it('marks an item failed (but keeps it) on a 4xx client error', async () => {
    mockRepairsCreate.mockRejectedValueOnce(apiError(400, 'Bad Request'));
    await offlineQueue.add(payload('Asha Kumar') as never, 'cr-1');

    expect(await offlineQueue.flush()).toEqual({ success: 0, failed: 1 });

    const queued = await offlineQueue.getQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('failed');
    expect(queued[0].clientRequestId).toBe('cr-1');
    expect(queued[0].error).toBe('Bad Request');
  });

  it('a mixed flush removes only the delivered item and keeps the failed one', async () => {
    await offlineQueue.add(payload('Asha Kumar') as never, 'cr-ok');
    await offlineQueue.add(payload('Ravi Patel') as never, 'cr-bad');
    mockRepairsCreate
      .mockResolvedValueOnce({ repair: { id: 'r1' } })
      .mockRejectedValueOnce(new Error('socket hang up'));

    expect(await offlineQueue.flush()).toEqual({ success: 1, failed: 1 });

    const queued = await offlineQueue.getQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].clientRequestId).toBe('cr-bad');
    expect(queued[0].status).toBe('pending'); // no status → treated as retryable
  });
});
