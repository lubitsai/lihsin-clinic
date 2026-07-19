import { prisma, type Tx } from "./db";
import type { ActorType, Prisma } from "@prisma/client";

export interface AuditActor {
  type: ActorType;
  id?: string;
  name?: string;
  ip?: string;
}

export const SYSTEM_ACTOR: AuditActor = { type: "SYSTEM", name: "system" };

/**
 * 寫入稽核紀錄。detail 內不得放完整證件號、密碼、token 等敏感原文。
 */
export async function writeAudit(
  actor: AuditActor,
  action: string,
  target?: { type: string; id: string },
  detail?: Prisma.InputJsonValue,
  tx?: Tx,
) {
  const db = tx ?? prisma;
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      ip: actor.ip,
      action,
      targetType: target?.type,
      targetId: target?.id,
      detail,
    },
  });
}
