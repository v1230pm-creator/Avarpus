import { storage } from './storage';
import { repairsCreate } from '@workspace/api-client-react';

const QUEUE_KEY = 'vmc_offline_repairs_queue';

export interface QueuedRepair {
  clientRequestId: string;
  payload: Parameters<typeof repairsCreate>[0];
  createdAt: string;
  status: 'pending' | 'failed';
  error?: string;
}

export const offlineQueue = {
  async getQueue(): Promise<QueuedRepair[]> {
    const queue = await storage.get<QueuedRepair[]>(QUEUE_KEY);
    return queue || [];
  },

  async add(payload: Parameters<typeof repairsCreate>[0], clientRequestId: string): Promise<void> {
    const queue = await this.getQueue();
    queue.push({
      clientRequestId,
      payload,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    await storage.set(QUEUE_KEY, queue);
  },

  async remove(clientRequestId: string): Promise<void> {
    const queue = await this.getQueue();
    const updated = queue.filter(q => q.clientRequestId !== clientRequestId);
    await storage.set(QUEUE_KEY, updated);
  },
  
  async updateStatus(clientRequestId: string, status: 'pending' | 'failed', error?: string): Promise<void> {
    const queue = await this.getQueue();
    const updated = queue.map(q => q.clientRequestId === clientRequestId ? { ...q, status, error } : q);
    await storage.set(QUEUE_KEY, updated);
  },

  async flush(): Promise<{ success: number; failed: number }> {
    const queue = await this.getQueue();
    if (queue.length === 0) return { success: 0, failed: 0 };

    let successCount = 0;
    let failedCount = 0;

    for (const item of queue) {
      try {
        await repairsCreate({
          ...item.payload,
          clientRequestId: item.clientRequestId
        });
        await this.remove(item.clientRequestId);
        successCount++;
      } catch (e: any) {
        // If it's a 4xx error (e.g. 400 Bad Request), surface it as failed
        const isClientError = e?.status >= 400 && e?.status < 500;
        await this.updateStatus(item.clientRequestId, isClientError ? 'failed' : 'pending', e?.message || 'Network error');
        failedCount++;
      }
    }

    return { success: successCount, failed: failedCount };
  }
};
