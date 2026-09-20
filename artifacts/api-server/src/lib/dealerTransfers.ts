import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  dealerTransferRequestsTable,
  repairPhotosTable,
  repairsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

// ── Dealer-to-dealer transfer requests ─────────────────────────────────────
// Shop A offers one of ITS OWN repair rows to shop B. The request row is the
// only thing that exists until B accepts; on accept the receiving repair row
// is created (routes/dealerTransactions.ts) and from then on the existing
// dealer-transaction machinery (shared detail, ledger, chat, notifications)
// operates on that row exactly as before.

export type TransferRow = typeof dealerTransferRequestsTable.$inferSelect;
export type RepairRow = typeof repairsTable.$inferSelect;

export const TRANSFER_STATUSES = ["pending", "accepted", "declined", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

// Repair statuses under which an accepted transfer still "holds" the device
// at the other shop, so the sender cannot offer the same row elsewhere.
export const ACTIVE_RESULT_STATUSES = ["received", "diagnosing", "repairing", "testing", "ready"];

// Device photo kinds that describe the handset itself and travel with it.
// Bills and customer identity documents stay with the sending shop.
const TRANSFERABLE_PHOTO_KINDS = new Set(["front", "back", "left", "right", "top", "bottom", "damage", "other"]);
const MAX_TRANSFER_PHOTOS = 12;

export function dealerCodeOf(shopId: string): string {
  return shopId.slice(0, 8).toUpperCase();
}

function text(value: string | null | undefined): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return items.length ? items : undefined;
}

/**
 * The saved device facts a receiving shop may see about an offered repair —
 * before accepting (preview) and as the import source on accept. Only
 * non-empty values are included; the sender's end-customer name/mobile are
 * never part of this projection.
 */
export function transferDeviceOf(r: RepairRow, photoCount: number) {
  return {
    sourceTicket: r.repairId,
    deviceType: r.deviceType,
    brand: r.brand,
    model: r.model,
    imei: text(r.imei),
    imei2: text(r.imei2),
    serialNumber: text(r.serialNumber),
    color: text(r.color),
    storage: text(r.storage),
    ram: text(r.ram),
    problem: r.problem,
    deviceCondition: text(r.deviceCondition),
    accessories: text(r.accessories),
    accessoriesList: stringList(r.accessoriesList),
    priority: r.priority,
    receiveDate: r.receiveDate,
    expectedDate: text(r.expectedDate),
    photoCount,
  };
}

/** Column values imported into the receiving shop's new repair row. */
export function importedRepairFields(source: RepairRow) {
  const accessoriesList = stringList(source.accessoriesList);
  const physicalCondition =
    source.physicalCondition && typeof source.physicalCondition === "object" && !Array.isArray(source.physicalCondition)
      && Object.keys(source.physicalCondition as object).length > 0
      ? (source.physicalCondition as Record<string, boolean>)
      : null;
  return {
    deviceType: source.deviceType,
    brand: source.brand,
    model: source.model,
    imei: text(source.imei) ?? null,
    imei2: text(source.imei2) ?? null,
    serialNumber: text(source.serialNumber) ?? null,
    color: text(source.color) ?? null,
    storage: text(source.storage) ?? null,
    ram: text(source.ram) ?? null,
    devicePassword: text(source.devicePassword) ?? null,
    simPresent: source.simPresent,
    memoryCardPresent: source.memoryCardPresent,
    accessories: text(source.accessories) ?? null,
    accessoriesList: accessoriesList ?? null,
    physicalCondition,
    problem: source.problem,
    deviceCondition: text(source.deviceCondition) ?? null,
    priority: source.priority,
  };
}

export async function transferablePhotoCounts(repairIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (repairIds.length === 0) return counts;
  const rows = await db
    .select({ repairId: repairPhotosTable.repairId, kind: repairPhotosTable.kind, n: sql<number>`count(*)::int` })
    .from(repairPhotosTable)
    .where(inArray(repairPhotosTable.repairId, repairIds))
    .groupBy(repairPhotosTable.repairId, repairPhotosTable.kind);
  for (const row of rows) {
    if (!TRANSFERABLE_PHOTO_KINDS.has(row.kind)) continue;
    counts.set(row.repairId, (counts.get(row.repairId) ?? 0) + row.n);
  }
  return counts;
}

/**
 * Copy the sender's device photos into the receiving shop's own storage
 * namespace and attach them to the new repair row. Best-effort and bounded:
 * a failed copy is logged and skipped, never a failed acceptance.
 */
export async function importTransferPhotos(input: {
  sourceRepairId: string;
  targetRepair: { id: string; shopId: string };
  importedByName: string;
}): Promise<number> {
  const photos = await db
    .select()
    .from(repairPhotosTable)
    .where(eq(repairPhotosTable.repairId, input.sourceRepairId))
    .orderBy(repairPhotosTable.createdAt)
    .limit(MAX_TRANSFER_PHOTOS * 2);
  let copied = 0;
  for (const photo of photos) {
    if (!TRANSFERABLE_PHOTO_KINDS.has(photo.kind)) continue;
    if (copied >= MAX_TRANSFER_PHOTOS) break;
    try {
      const objectPath = await objectStorageService.copyObjectEntityToPrefix(
        photo.objectPath,
        `${input.targetRepair.shopId}/repairs/${input.targetRepair.id}`,
      );
      await db.insert(repairPhotosTable).values({
        shopId: input.targetRepair.shopId,
        repairId: input.targetRepair.id,
        kind: photo.kind,
        objectPath,
        uploadedById: null,
        uploadedByName: input.importedByName,
      });
      copied += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`dealer transfer photo import skipped (${photo.id}):`, err);
    }
  }
  return copied;
}

type Party = { shopId: string; businessName: string; ownerUserId?: string; ownerName: string };

async function partiesFor(shopIds: string[]): Promise<Map<string, Party>> {
  const out = new Map<string, Party>();
  if (shopIds.length === 0) return out;
  const rows = await db
    .select({
      shopId: shopsTable.id,
      businessName: shopsTable.businessName,
      ownerUserId: usersTable.id,
      ownerName: usersTable.name,
    })
    .from(shopsTable)
    .leftJoin(usersTable, eq(usersTable.id, shopsTable.dealerId))
    .where(inArray(shopsTable.id, shopIds));
  for (const row of rows) {
    out.set(row.shopId, {
      shopId: row.shopId,
      businessName: row.businessName,
      ownerUserId: row.ownerUserId ?? undefined,
      ownerName: row.ownerName ?? "",
    });
  }
  return out;
}

/**
 * Project transfer requests for one calling shop. Loads every referenced
 * repair/shop once, so list endpoints stay at a fixed number of queries.
 */
export async function transferRequestsOut(rows: TransferRow[], callerShopId: string) {
  if (rows.length === 0) return [];
  const repairIds = Array.from(
    new Set(rows.flatMap((r) => [r.sourceRepairId, r.resultRepairId].filter((x): x is string => !!x))),
  );
  const shopIds = Array.from(new Set(rows.flatMap((r) => [r.sourceShopId, r.receiverShopId])));
  const [repairs, parties, photoCounts] = await Promise.all([
    db.select().from(repairsTable).where(inArray(repairsTable.id, repairIds)),
    partiesFor(shopIds),
    transferablePhotoCounts(rows.map((r) => r.sourceRepairId)),
  ]);
  const repairById = new Map(repairs.map((r) => [r.id, r]));
  const empty: Party = { shopId: "", businessName: "", ownerName: "" };
  return rows.map((r) => {
    const source = repairById.get(r.sourceRepairId);
    const result = r.resultRepairId ? repairById.get(r.resultRepairId) : undefined;
    const side = r.sourceShopId === callerShopId ? ("sender" as const) : ("receiver" as const);
    return {
      id: r.id,
      status: r.status as TransferStatus,
      side,
      sender: parties.get(r.sourceShopId) ?? { ...empty, shopId: r.sourceShopId },
      receiver: parties.get(r.receiverShopId) ?? { ...empty, shopId: r.receiverShopId },
      sentByName: r.sentByName,
      message: text(r.message),
      device: source
        ? transferDeviceOf(source, photoCounts.get(source.id) ?? 0)
        : {
            sourceTicket: "",
            deviceType: "",
            brand: "",
            model: "",
            problem: "",
            priority: "normal",
            receiveDate: "",
            photoCount: 0,
          },
      // The sender's own row id is only meaningful (and only openable) on
      // the sender's side; the receiver never learns it.
      sourceRepairId: side === "sender" ? r.sourceRepairId : undefined,
      resultRepairId: r.resultRepairId ?? undefined,
      resultStatus: result?.status,
      respondedByName: r.respondedByName ?? undefined,
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : undefined,
      declineReason: text(r.declineReason),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export type RepairTransferSummary = {
  requestId: string;
  status: TransferStatus;
  receiverShopId: string;
  receiverBusinessName: string;
  receiverOwnerName?: string;
  resultRepairId?: string;
  resultStatus?: string;
  createdAt: string;
  respondedAt?: string;
};

/**
 * For repairs a shop HOLDS: the latest transfer request per repair (if any),
 * so the sender's list/detail can say "Waiting for X to accept" / "Accepted
 * by X" / "Declined by X" without a second round trip.
 */
export async function transferSummariesFor(repairIds: string[]): Promise<Map<string, RepairTransferSummary>> {
  const out = new Map<string, RepairTransferSummary>();
  if (repairIds.length === 0) return out;
  const rows = await db
    .select()
    .from(dealerTransferRequestsTable)
    .where(inArray(dealerTransferRequestsTable.sourceRepairId, repairIds))
    .orderBy(desc(dealerTransferRequestsTable.createdAt));
  const latest = new Map<string, TransferRow>();
  for (const row of rows) if (!latest.has(row.sourceRepairId)) latest.set(row.sourceRepairId, row);
  if (latest.size === 0) return out;
  const latestRows = Array.from(latest.values());
  const resultIds = latestRows.map((r) => r.resultRepairId).filter((x): x is string => !!x);
  const [parties, results] = await Promise.all([
    partiesFor(Array.from(new Set(latestRows.map((r) => r.receiverShopId)))),
    resultIds.length
      ? db.select({ id: repairsTable.id, status: repairsTable.status }).from(repairsTable).where(inArray(repairsTable.id, resultIds))
      : Promise.resolve([] as { id: string; status: string }[]),
  ]);
  const resultStatus = new Map(results.map((r) => [r.id, r.status]));
  for (const r of latestRows) {
    const receiver = parties.get(r.receiverShopId);
    out.set(r.sourceRepairId, {
      requestId: r.id,
      status: r.status as TransferStatus,
      receiverShopId: r.receiverShopId,
      receiverBusinessName: receiver?.businessName ?? "",
      receiverOwnerName: receiver?.ownerName || undefined,
      resultRepairId: r.resultRepairId ?? undefined,
      resultStatus: r.resultRepairId ? resultStatus.get(r.resultRepairId) : undefined,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : undefined,
    });
  }
  return out;
}

/** Extra fields on a receiving shop's repair row that came from a transfer. */
export async function sourceRepairFacts(rows: RepairRow[]): Promise<Map<string, { ticket: string; receiveDate: string }>> {
  const ids = rows.map((r) => r.sourceRepairId).filter((x): x is string => !!x);
  const out = new Map<string, { ticket: string; receiveDate: string }>();
  if (ids.length === 0) return out;
  const sources = await db
    .select({ id: repairsTable.id, repairId: repairsTable.repairId, receiveDate: repairsTable.receiveDate })
    .from(repairsTable)
    .where(inArray(repairsTable.id, ids));
  for (const s of sources) out.set(s.id, { ticket: s.repairId, receiveDate: s.receiveDate });
  return out;
}

/** The request row that produced a receiving shop's repair (if any). */
export async function transferForResultRepair(repairId: string): Promise<TransferRow | null> {
  const [row] = await db
    .select()
    .from(dealerTransferRequestsTable)
    .where(and(eq(dealerTransferRequestsTable.resultRepairId, repairId), eq(dealerTransferRequestsTable.status, "accepted")))
    .limit(1);
  return row ?? null;
}
