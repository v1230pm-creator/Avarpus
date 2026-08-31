import { sql } from "drizzle-orm";
import { db, chatBlocksTable, chatRoomMembersTable, chatRoomsTable } from "@workspace/db";

/**
 * A personal contact is an active global-direct conversation participant.
 * Shop rooms are deliberately excluded: business relationships must never
 * become personal Status visibility.
 */
export async function isPersonalContact(
  viewerUserId: string,
  authorUserId: string,
): Promise<boolean> {
  if (viewerUserId === authorUserId) return true;

  const result = await db.execute(sql`
    SELECT 1
    FROM ${chatRoomMembersTable} AS mine
    INNER JOIN ${chatRoomMembersTable} AS peer
      ON peer.room_id = mine.room_id
     AND peer.user_id = ${authorUserId}
    INNER JOIN ${chatRoomsTable} AS room
      ON room.id = mine.room_id
    WHERE mine.user_id = ${viewerUserId}
      AND room.scope = 'global_direct'
      AND room.kind = 'direct'
      AND NOT EXISTS (
        SELECT 1
        FROM ${chatBlocksTable} AS blocks
        WHERE (blocks.blocker_user_id = ${viewerUserId}
           AND blocks.blocked_user_id = ${authorUserId})
           OR (blocks.blocker_user_id = ${authorUserId}
           AND blocks.blocked_user_id = ${viewerUserId})
      )
    LIMIT 1
  `);

  return result.rows.length > 0;
}

export function statusVisibilityCondition(
  statusAuthorColumn: unknown,
  statusAudienceColumn: unknown,
  viewerUserId: string,
) {
  return sql`(
    ${statusAuthorColumn} = ${viewerUserId}
    OR (
      ${statusAudienceColumn} = 'contacts'
      AND EXISTS (
        SELECT 1
        FROM ${chatRoomMembersTable} AS mine
        INNER JOIN ${chatRoomMembersTable} AS peer
          ON peer.room_id = mine.room_id
        INNER JOIN ${chatRoomsTable} AS room
          ON room.id = mine.room_id
        WHERE mine.user_id = ${viewerUserId}
          AND peer.user_id = ${statusAuthorColumn}
          AND room.scope = 'global_direct'
          AND room.kind = 'direct'
          AND NOT EXISTS (
            SELECT 1
            FROM ${chatBlocksTable} AS blocks
            WHERE (blocks.blocker_user_id = ${viewerUserId}
               AND blocks.blocked_user_id = ${statusAuthorColumn})
               OR (blocks.blocker_user_id = ${statusAuthorColumn}
               AND blocks.blocked_user_id = ${viewerUserId})
          )
      )
    )
  )`;
}