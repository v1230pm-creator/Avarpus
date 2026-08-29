import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../app";

const HS_TOKEN = "test-homeserver-token";

describe("Matrix Application Service callback", () => {
  beforeEach(() => {
    process.env.MATRIX_BASE_URL = "https://matrix.example.com";
    process.env.MATRIX_SERVER_NAME = "example.com";
    process.env.MATRIX_APP_SERVICE_URL =
      "https://api.example.com/api/matrix/appservice";
    process.env.MATRIX_APP_SERVICE_TOKEN = "test-as-token";
    process.env.MATRIX_HOMESERVER_TOKEN = HS_TOKEN;
  });

  afterEach(() => {
    delete process.env.MATRIX_BASE_URL;
    delete process.env.MATRIX_SERVER_NAME;
    delete process.env.MATRIX_APP_SERVICE_URL;
    delete process.env.MATRIX_APP_SERVICE_TOKEN;
    delete process.env.MATRIX_HOMESERVER_TOKEN;
  });

  it("rejects a transaction with the wrong homeserver token", async () => {
    const response = await request(app)
      .put("/api/matrix/appservice/_matrix/app/v1/transactions/txn-1")
      .set("Authorization", "Bearer wrong")
      .send({ events: [] });
    expect(response.status).toBe(401);
    expect(response.body.errcode).toBe("M_UNAUTHORIZED");
  });

  it("accepts a valid POST transaction at the configured callback base", async () => {
    const response = await request(app)
      .post("/api/matrix/appservice")
      .set("Authorization", `Bearer ${HS_TOKEN}`)
      .send({
        events: [
          {
            type: "m.room.message",
            sender: "@appuser-0123456789abcdef0123456789abcdef:example.com",
            room_id: "!room:example.com",
            content: { msgtype: "m.text", body: "hello" },
          },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({});
  });

  it("does not acknowledge a malformed POST transaction", async () => {
    const response = await request(app)
      .post("/api/matrix/appservice")
      .set("Authorization", `Bearer ${HS_TOKEN}`)
      .send({ events: [{ type: "m.room.message" }] });
    expect(response.status).toBe(400);
    expect(response.body.errcode).toBe("M_BAD_JSON");
  });

  it("acknowledges valid and replayed transactions", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(app)
        .put("/api/matrix/appservice/_matrix/app/v1/transactions/txn-1")
        .set("Authorization", `Bearer ${HS_TOKEN}`)
        .send({ events: [] });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    }
  });

  it("accepts only the registered virtual-user namespace", async () => {
    const valid = await request(app)
      .get("/api/matrix/appservice/_matrix/app/v1/users/%40appuser-0123456789abcdef0123456789abcdef%3Aexample.com")
      .query({ access_token: HS_TOKEN });
    expect(valid.status).toBe(200);

    const invalid = await request(app)
      .get("/api/matrix/appservice/_matrix/app/v1/users/%40other-0123456789abcdef0123456789abcdef%3Aexample.com")
      .query({ access_token: HS_TOKEN });
    expect(invalid.status).toBe(404);
  });

  it("accepts only the registered direct-room alias namespace", async () => {
    const valid = await request(app)
      .get("/api/matrix/appservice/_matrix/app/v1/rooms/%23appchat-0123456789abcdef0123456789abcdef01234567%3Aexample.com")
      .set("Authorization", `Bearer ${HS_TOKEN}`);
    expect(valid.status).toBe(200);

    const invalid = await request(app)
      .get("/api/matrix/appservice/_matrix/app/v1/rooms/%23public%3Aexample.com")
      .set("Authorization", `Bearer ${HS_TOKEN}`);
    expect(invalid.status).toBe(404);
  });

  it("reports non-secret configuration status", async () => {
    const response = await request(app)
      .get("/api/matrix/appservice/health")
      .set("Authorization", `Bearer ${HS_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      configured: true,
      baseUrl: "ok",
      serverName: "ok",
      appServiceUrl: "ok",
      appServiceToken: "ok",
      homeserverToken: "ok",
    });
    expect(JSON.stringify(response.body)).not.toContain(HS_TOKEN);
  });
});