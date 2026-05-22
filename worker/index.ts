import { collectCursorOutput, createCursorCompletion, resolveCursorModel, streamCursorText } from "./cursor";
import { bearerToken, errorResponse, HttpError, json, notFound, openAiError, optionsResponse, parseJsonBody, sseResponse, unauthorized } from "./http";
import {
  chatChunk,
  chatCompletionResponse,
  chatUsageChunk,
  completionCharsFromOutput,
  doneChunk,
  modelList,
  prepareChatRequest,
  prepareResponsesRequest,
  responseCreatedEvents,
  responseDeltaEvent,
  responseDoneEvents,
  responseObject,
  toOpenAiToolCalls
} from "./openai";
import { encodeSse } from "./sse";
import type { Deps, Env } from "./types";
import type { OpenAiToolSpec } from "./openai";

const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID()
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx, defaultDeps);
  }
};

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext, deps: Deps = defaultDeps): Promise<Response> {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const route = matchOpenAiRoute(new URL(request.url).pathname);
    if (!route) return notFound();
    return await handleOpenAiRoute(request, env, ctx, deps, route);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleOpenAiRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: Deps,
  route: OpenAiRoute
): Promise<Response> {
  const cursorApiKey = authenticate(request);
  if (!cursorApiKey) return unauthorized();

  if (route.kind === "models") {
    if (request.method !== "GET") return notFound();
    return json(modelList({ opencode: route.surface === "opencode" }));
  }

  if (request.method !== "POST") return notFound();

  const body = await parseJsonBody<unknown>(request);
  const requestedModel = typeof (body as { model?: unknown })?.model === "string" ? (body as { model: string }).model : "composer-2.5";
  const cursorModel = resolveCursorModel(requestedModel);
  const prepared =
    route.kind === "chat"
      ? prepareChatRequest(body, cursorModel, { forceAgentMode: route.surface === "opencode" })
      : prepareResponsesRequest(body, cursorModel);
  const id = `${route.kind === "chat" ? "chatcmpl" : "resp"}_${crypto.randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(deps.now().getTime() / 1000);

  const completion = await createCursorCompletion(env, deps, cursorApiKey, {
    prompt: prepared.prompt,
    model: prepared.cursorModel,
    conversationKey: route.surface === "opencode" ? sessionAffinity(request) : undefined
  });

  if (prepared.stream) {
    return streamOpenAiResponse(route.kind, completion.stream, {
      id,
      created,
      model: prepared.model,
      promptChars: prepared.promptChars,
      includeUsage: prepared.includeUsage,
      metadata: prepared.responseMetadata,
      tools: prepared.tools
    }, ctx);
  }

  const output = await collectCursorOutput(completion.stream);
  const toolCalls = toOpenAiToolCalls({
    toolCalls: output.toolCalls,
    tools: prepared.tools,
    responseId: id
  });

  if (route.kind === "chat") {
    return json(
      chatCompletionResponse({
        id,
        created,
        model: prepared.model,
        text: output.text,
        reasoningText: output.reasoningText,
        toolCalls,
        promptChars: prepared.promptChars,
        metadata: prepared.responseMetadata
      })
    );
  }

  return json(
    responseObject({
      id,
      created,
      model: prepared.model,
      text: output.text,
      toolCalls,
      promptChars: prepared.promptChars,
      metadata: prepared.responseMetadata
    })
  );
}

function streamOpenAiResponse(
  kind: "chat" | "responses",
  cursorStream: Response,
  input: {
    id: string;
    created: number;
    model: string;
    promptChars: number;
    includeUsage: boolean;
    metadata?: Record<string, unknown>;
    tools: OpenAiToolSpec[];
  },
  ctx: ExecutionContext
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const pump = async () => {
    let text = "";
    let reasoningText = "";
    let toolCallCount = 0;
    let finishReason: "stop" | "tool_calls" = "stop";
    const streamedToolCalls: ReturnType<typeof toOpenAiToolCalls> = [];
    try {
      if (kind === "chat") {
        await writer.write(chatChunk({ id: input.id, created: input.created, model: input.model, role: "assistant" }));
      } else {
        for (const event of responseCreatedEvents(input)) await writer.write(event);
      }

      for await (const event of streamCursorText(cursorStream)) {
        if (event.type === "reasoning" && event.text) {
          reasoningText += event.text;
          if (kind === "chat") await writer.write(chatChunk({ id: input.id, created: input.created, model: input.model, reasoningDelta: event.text }));
        }
        if (event.type === "text" && event.text) {
          text += event.text;
          if (kind === "chat") await writer.write(chatChunk({ id: input.id, created: input.created, model: input.model, delta: event.text }));
          else await writer.write(responseDeltaEvent({ id: input.id, delta: event.text }));
        }
        if (event.type === "tool_call") {
          finishReason = "tool_calls";
          const [toolCall] = toOpenAiToolCalls({
            toolCalls: [event.toolCall],
            tools: input.tools,
            responseId: input.id,
            startIndex: toolCallCount
          });
          if (toolCall) streamedToolCalls.push(toolCall);
          if (kind === "chat" && toolCall) {
            await writer.write(chatChunk({ id: input.id, created: input.created, model: input.model, toolCall: { index: toolCallCount, value: toolCall } }));
          }
          toolCallCount += 1;
        }
        if (event.type === "done") {
          text = event.finalText;
          reasoningText = event.reasoningText ?? "";
        }
      }

      if (kind === "chat") {
        const completionChars = completionCharsFromOutput(text, streamedToolCalls);
        await writer.write(chatChunk({ id: input.id, created: input.created, model: input.model, finish: true, finishReason }));
        if (input.includeUsage) {
          await writer.write(
            chatUsageChunk({
              id: input.id,
              created: input.created,
              model: input.model,
              promptChars: input.promptChars,
              completionChars
            })
          );
        }
        await writer.write(doneChunk());
      } else {
        for (const event of responseDoneEvents({ ...input, text, toolCalls: streamedToolCalls })) await writer.write(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stream failed";
      await writer.write(encodeSse({ error: { message, type: "cursor_error", code: "cursor_stream_error" } }, "error"));
    } finally {
      await writer.close().catch(() => undefined);
    }
  };
  ctx.waitUntil(pump());
  return sseResponse(readable);
}

function sessionAffinity(request: Request): string | undefined {
  return (
    request.headers.get("x-session-affinity") ||
    request.headers.get("x-opencode-session-id") ||
    request.headers.get("x-opencode-session")
  )?.trim() || undefined;
}

function authenticate(request: Request): string | null {
  const token = bearerToken(request);
  if (!token) return null;
  if (token.startsWith("cmp_")) {
    throw new HttpError("Stored proxy keys are not supported by this deployment; use a Cursor API key", 401, "invalid_api_key");
  }
  return token;
}

interface OpenAiRoute {
  kind: "chat" | "responses" | "models";
  surface?: "standard" | "opencode";
}

function matchOpenAiRoute(pathname: string): OpenAiRoute | null {
  const opencodePath = pathname.startsWith("/opencode/v1/") ? pathname.slice("/opencode/v1".length) : "";
  if (opencodePath === "/chat/completions") return { kind: "chat", surface: "opencode" };
  if (opencodePath === "/models") return { kind: "models", surface: "opencode" };

  const path = pathname.startsWith("/v1/") ? pathname.slice(3) : "";
  if (path === "/chat/completions") return { kind: "chat" };
  if (path === "/responses") return { kind: "responses" };
  if (path === "/models") return { kind: "models" };
  return null;
}
