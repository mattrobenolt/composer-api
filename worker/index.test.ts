import { describe, expect, it } from "vitest";
import { handleRequest } from "./index";
import type { Deps, Env } from "./types";

const env: Env = {
  ENCRYPTION_KEY: "test-encryption-secret-with-enough-entropy",
  CURSOR_API_BASE: "https://api.cursor.test",
  CURSOR_BACKEND_BASE_URL: "https://cursor-backend.test",
  CURSOR_CHAT_ENDPOINT: "/test-cursor-chat"
};

function fakeCtx(): ExecutionContext {
  return {
    waitUntil: (promise: Promise<unknown>) => void promise.catch(() => undefined),
    passThroughOnException: () => undefined,
    props: {}
  } as ExecutionContext;
}

describe("Worker", () => {
  it("serves /v1/chat/completions with a direct Cursor key", async () => {
    const { deps, exchangeAuthHeaders } = fakeDeps();

    const response = await handleRequest(
      new Request("https://composer.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer cursor_direct_key"
        },
        body: JSON.stringify({
          model: "composer-2.5",
          messages: [{ role: "user", content: "Say hello" }]
        })
      }),
      env,
      fakeCtx(),
      deps
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "chat.completion",
      choices: [{ message: { content: "Hello from Composer" } }]
    });
    expect(exchangeAuthHeaders).toEqual(["Bearer cursor_direct_key"]);
  });

  it("serves /v1/models", async () => {
    const { deps } = fakeDeps();

    const response = await handleRequest(
      new Request("https://composer.test/v1/models", {
        headers: { Authorization: "Bearer cursor_direct_key" }
      }),
      env,
      fakeCtx(),
      deps
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ object: "list" });
  });

  it("rejects hosted cmp keys instead of forwarding them", async () => {
    const { deps, exchangeAuthHeaders } = fakeDeps();

    const response = await handleRequest(
      new Request("https://composer.test/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer cmp_not_a_real_key"
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "Say hello" }] })
      }),
      env,
      fakeCtx(),
      deps
    );

    expect(response.status).toBe(401);
    expect(exchangeAuthHeaders).toHaveLength(0);
  });

  it("does not serve the old frontend or signup routes", async () => {
    const { deps } = fakeDeps();

    const signup = await handleRequest(new Request("https://composer.test/api/signup", { method: "POST" }), env, fakeCtx(), deps);
    const frontend = await handleRequest(new Request("https://composer.test/"), env, fakeCtx(), deps);

    expect(signup.status).toBe(404);
    expect(frontend.status).toBe(404);
  });
});

function fakeDeps(): { deps: Deps; exchangeAuthHeaders: string[] } {
  const exchangeAuthHeaders: string[] = [];
  const deps: Deps = {
    now: () => new Date("2026-05-20T12:00:00.000Z"),
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const auth = new Headers(init?.headers).get("authorization") || "";
      if (url.pathname === "/v1/me") {
        return Response.json({
          apiKeyName: "Test key",
          userId: 123,
          userEmail: "ada@example.com",
          userFirstName: "Ada",
          userLastName: "Lovelace",
          createdAt: "2026-05-20T00:00:00.000Z"
        });
      }
      if (url.pathname === "/auth/exchange_user_api_key" && init?.method === "POST") {
        exchangeAuthHeaders.push(auth);
        return Response.json({ accessToken: "cursor_access_token" });
      }
      if (url.pathname === "/test-cursor-chat" && init?.method === "POST") {
        expect(new Headers(init.headers).get("content-type")).toContain("application/connect+proto");
        expect(decodeRequestBody(init.body)).toContain("Say hello");
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(connectFrame(chatResponseThinking("The answer is simple.</think>\nHello from Composer")));
              controller.enqueue(connectFrame(new TextEncoder().encode("{}"), 2));
              controller.close();
            }
          }),
          { headers: { "Content-Type": "application/connect+proto" } }
        );
      }
      return new Response("not found", { status: 404 });
    }
  };
  return { deps, exchangeAuthHeaders };
}

function decodeRequestBody(body: BodyInit | null | undefined): string {
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (typeof body === "string") return body;
  return "";
}

function chatResponseThinking(text: string): Uint8Array {
  return protoMessage([protoField(2, protoMessage([protoField(25, protoMessage([protoField(1, text)]))]))]);
}

function connectFrame(payload: Uint8Array, flags = 0): Uint8Array {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = flags;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, 5);
  return frame;
}

function protoMessage(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function protoField(fieldNumber: number, value: string | Uint8Array): Uint8Array {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return protoMessage([varint((fieldNumber << 3) | 2), varint(data.length), data]);
}

function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  let current = value;
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current);
  return new Uint8Array(bytes);
}
