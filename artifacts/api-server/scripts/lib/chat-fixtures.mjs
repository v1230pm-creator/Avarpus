// Shared database fixtures for the chat validation scripts.
//
// Every row a script seeds carries the run's marker in a human-readable text
// column (names, emails, bodies, notes), so cleanup and its verification can
// find leftovers by marker alone — including after a crash that skipped the
// script's own bookkeeping. `createChatFixtures` binds the helpers to one
// script's pool and marker; the scripts keep their checks, HTTP helpers and
// any extra tables they touch to themselves.
import { randomBytes, randomInt, randomUUID } from "node:crypto";

// Fixture mobiles are digits, like the real thing: a search box that treats a
// term of digits as a phone number is only exercised by numbers that look like
// phone numbers.
export function fixtureMobile(leadingDigit) {
  return `${leadingDigit}${String(randomInt(100_000_000, 1_000_000_000))}`;
}

export function createChatFixtures({ pool, marker }) {
  function marked(value) {
    return `${marker}-${value}`;
  }

  async function seedUser({ tag, role = "customer", shopId = null }) {
    const suffix = randomBytes(5).toString("hex");
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id)
       VALUES ($1, $2, $3, 'x', $4, true, $5) RETURNING id, name, mobile`,
      [
        `Report ${marked(tag)}`,
        `${marked(tag)}-${suffix}@example.com`,
        fixtureMobile(7),
        role,
        shopId,
      ],
    );
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [token, user.id],
    );
    return { userId: user.id, name: user.name, mobile: user.mobile, token, label: tag };
  }

  async function seedShop(tag) {
    const suffix = randomBytes(5).toString("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [owner] } = await client.query(
        `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
        [
          `Report Owner ${marked(tag)}`,
          `${marked(`owner-${tag}`)}-${suffix}@example.com`,
          fixtureMobile(8),
        ],
      );
      const { rows: [shop] } = await client.query(
        `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
        [owner.id, `Report Shop ${marked(tag)}`],
      );
      await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, owner.id]);
      await client.query("COMMIT");
      return { ownerId: owner.id, shopId: shop.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function ownerSession(ownerId) {
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [token, ownerId],
    );
    return { userId: ownerId, token, label: "owner" };
  }

  // A global direct room between `memberIds`. `providerRoomId` stands in for
  // the Matrix room the real provisioning path would have created; the send
  // endpoint refuses rooms without one, so scripts that send through the API
  // (against a Matrix stub) pass a fake ID and scripts that only read the
  // transcript leave it null.
  async function seedDirectRoom({ memberIds, tag, providerRoomId = null }) {
    const { rows: [room] } = await pool.query(
      `INSERT INTO chat_rooms
         (shop_id, scope, kind, name, peer_key, created_by_id, created_by_name, provider_room_id)
       VALUES (NULL, 'global_direct', 'direct', $1, $2, $3, $4, $5) RETURNING id, name`,
      [
        `Direct room ${marked(tag)}`,
        [...memberIds].sort().join(":"),
        memberIds[0],
        `Report ${marked(tag)}`,
        providerRoomId,
      ],
    );
    await pool.query(
      `INSERT INTO chat_room_members (room_id, shop_id, user_id)
       SELECT $1, NULL, unnest($2::uuid[])`,
      [room.id, memberIds],
    );
    // A run of messages, oldest first, alternating between the two people, so a
    // transcript window has something on either side of the reported message.
    const messages = [];
    for (let index = 0; index < 6; index++) {
      const { rows: [message] } = await pool.query(
        `INSERT INTO chat_messages (room_id, shop_id, sender_id, sender_name, kind, body, created_at)
         VALUES ($1, NULL, $2, $3, 'text', $4, now() - ($5 || ' minutes')::interval)
         RETURNING id, body`,
        [
          room.id,
          memberIds[index % 2],
          `Report ${marked(tag)}`,
          `history-${index}-${marked(tag)}`,
          String(60 - index),
        ],
      );
      messages.push({ id: message.id, body: message.body, senderId: memberIds[index % 2] });
    }
    return {
      roomId: room.id,
      roomName: room.name,
      messages,
      // The reported message sits mid-conversation on purpose.
      messageId: messages[3].id,
    };
  }

  // Reports are seeded with distinct ages so "newest first" is a real assertion
  // rather than an accident of insertion order.
  async function seedReport({ reporter, reported, room, reason, details, ageMinutes, messageId }) {
    const { rows: [report] } = await pool.query(
      `INSERT INTO chat_reports
         (reporter_user_id, reported_user_id, room_id, message_id, client_request_id,
          reason, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8 || ' minutes')::interval)
       RETURNING id, status, created_at`,
      [
        reporter.userId,
        reported.userId,
        room.roomId,
        messageId ?? null,
        marked(randomUUID()),
        reason,
        details,
        String(ageMinutes),
      ],
    );
    return { id: report.id, reason, details, status: report.status, createdAt: report.created_at };
  }

  // Rooms, shops and users cascade to everything hanging off them (members,
  // messages, receipts, reports, sessions, pending uploads).
  async function cleanupFixtures() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1`,
        [`%${marker}%`],
      );
      await client.query(
        `DELETE FROM shops WHERE business_name LIKE $1`,
        [`%${marker}%`],
      );
      await client.query(
        `DELETE FROM users WHERE name LIKE $1 OR email LIKE $1`,
        [`%${marker}%`],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function verifyFixtureCleanup() {
    const pattern = `%${marker}%`;
    const { rows } = await pool.query(
      `SELECT source, row_count
       FROM (
         SELECT 'users' AS source, count(*)::int AS row_count
         FROM users WHERE name LIKE $1 OR email LIKE $1
         UNION ALL
         SELECT 'shops', count(*)::int
         FROM shops WHERE business_name LIKE $1
         UNION ALL
         SELECT 'sessions', count(*)::int
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.name LIKE $1 OR u.email LIKE $1
         UNION ALL
         SELECT 'rooms', count(*)::int
         FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1
         UNION ALL
         SELECT 'messages', count(*)::int
         FROM chat_messages WHERE body LIKE $1 OR sender_name LIKE $1
         UNION ALL
         SELECT 'reports', count(*)::int
         FROM chat_reports
         WHERE client_request_id LIKE $1 OR details LIKE $1 OR review_note LIKE $1
         UNION ALL
         SELECT 'transcript views', count(*)::int
         FROM chat_report_transcript_views WHERE operator_name LIKE $1
         UNION ALL
         SELECT 'decision batches', count(*)::int
         FROM chat_report_decision_batches
         WHERE operator_name LIKE $1 OR withdrawn_by_name LIKE $1
         UNION ALL
         SELECT 'decision batch items', count(*)::int
         FROM chat_report_decision_batch_items i
         JOIN chat_report_decision_batches b ON b.id = i.batch_id
         WHERE b.operator_name LIKE $1
       ) fixture_rows
       WHERE row_count > 0`,
      [pattern],
    );
    if (rows.length > 0) {
      throw new Error(`fixture cleanup left marked rows: ${JSON.stringify(rows)}`);
    }
    console.log(`  PASS fixture cleanup removed marker ${marker}`);
  }

  return {
    marked,
    seedUser,
    seedShop,
    ownerSession,
    seedDirectRoom,
    seedReport,
    cleanupFixtures,
    verifyFixtureCleanup,
  };
}
