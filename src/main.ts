import "./styles.css";
import { escapeAttr, escapeHtml, hydrateIcons, icon, wireCopyButtons } from "./ui";

const origin = window.location.origin;
const baseUrl = `${origin}/v1`;

/* ---------------------------------------------------------------- routing */

const isChatRoute = (): boolean => window.location.pathname.replace(/\/+$/, "") === "/chat";

async function route(): Promise<void> {
  const landing = document.getElementById("landing");
  const chatRoot = document.getElementById("chat-root");
  if (!landing || !chatRoot) return;
  mountEarlyAccessBar();

  if (isChatRoute()) {
    landing.hidden = true;
    chatRoot.hidden = false;
    document.title = "Cursor Chat — The Unofficial Cursor API";
    const { mountChat } = await import("./chat");
    mountChat(chatRoot);
  } else {
    chatRoot.hidden = true;
    landing.hidden = false;
    document.title = "The Unofficial Cursor API";
    mountLanding();
  }
}

// Intercept same-origin links so navigation between `/` and `/chat` is instant.
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const anchor = (event.target as HTMLElement | null)?.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href") || "";
  if (href !== "/" && href !== "/chat") return;
  if (anchor.target === "_blank") return;
  event.preventDefault();
  if (window.location.pathname !== href) {
    window.history.pushState({}, "", href);
    void route();
  }
});

window.addEventListener("popstate", () => void route());

/* ----------------------------------------------------------- landing page */

let landingReady = false;

function mountLanding(): void {
  hydrateIcons(document.getElementById("landing") ?? document);
  if (landingReady) return;
  landingReady = true;

  renderEndpoints();
  renderSnippet("snippet-openai", "openai-sdk.ts", openAiSnippet());
  renderSnippet("snippet-vercel", "vercel-ai-sdk.ts", vercelSnippet());
  void loadStars();
}

function renderEndpoints(): void {
  const list = document.getElementById("endpoint-list");
  if (!list) return;
  const rows: Array<[string, string]> = [
    ["Base URL", baseUrl],
    ["Chat Completions", `${baseUrl}/chat/completions`],
    ["Responses", `${baseUrl}/responses`],
    ["Models", `${baseUrl}/models`]
  ];
  list.innerHTML = rows
    .map(
      ([label, value]) => `
      <div class="endpoint-row">
        <span class="endpoint-label">${escapeHtml(label)}</span>
        <code>${escapeHtml(value)}</code>
        <button class="icon-button" data-copy="${escapeAttr(value)}" aria-label="Copy ${escapeAttr(label)}">
          ${icon("Copy", { width: 16, height: 16 })}
        </button>
      </div>`
    )
    .join("");
  wireCopyButtons(list);
}

function renderSnippet(targetId: string, filename: string, code: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = `
    <figure class="snippet">
      <figcaption class="snippet-bar">
        <span class="snippet-name">${icon("Code2", { width: 14, height: 14 })}${escapeHtml(filename)}</span>
        <button class="snippet-copy icon-button" data-copy="${escapeAttr(code)}" aria-label="Copy ${escapeAttr(filename)}">
          ${icon("Copy", { width: 16, height: 16 })}
        </button>
      </figcaption>
      <pre><code>${escapeHtml(code)}</code></pre>
    </figure>`;
  wireCopyButtons(target);
}

function openAiSnippet(): string {
  return `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.CURSOR_API_KEY,
  baseURL: "${baseUrl}"
});

// Chat Completions — supported, drop-in compatible
const chat = await client.chat.completions.create({
  model: "composer-2.5",
  messages: [{ role: "user", content: "Explain async iterators." }]
});
console.log(chat.choices[0].message.content);

// Responses API — recommended for new projects
const response = await client.responses.create({
  model: "composer-2.5",
  input: "Explain async iterators."
});
console.log(response.output_text);`;
}

function vercelSnippet(): string {
  return `import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const openai = createOpenAI({
  apiKey: process.env.CURSOR_API_KEY,
  baseURL: "${baseUrl}"
});

const result = streamText({
  // openai.responses(id) or openai.chat(id)
  model: openai.responses("composer-2.5"),
  prompt: "Explain async iterators."
});

for await (const delta of result.textStream) {
  process.stdout.write(delta);
}`;
}

/* ----------------------------------------------------- GitHub star count */

function formatStars(count: number): string {
  if (count >= 1000) {
    const thousands = count / 1000;
    return `${thousands.toFixed(thousands >= 10 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return String(count);
}

async function loadStars(): Promise<void> {
  const starValue = document.getElementById("star-value");
  if (!starValue) return;
  try {
    const response = await fetch("https://api.github.com/repos/standardagents/composer-api", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
    const data = (await response.json()) as { stargazers_count?: number };
    if (typeof data.stargazers_count !== "number") throw new Error("Missing star count");
    starValue.textContent = formatStars(data.stargazers_count);
  } catch {
    starValue.textContent = "Star";
  }
}

/* --------------------------------------------- Standard Agents CTA bar */

let earlyAccessReady = false;

function mountEarlyAccessBar(): void {
  if (earlyAccessReady) return;
  earlyAccessReady = true;

  const bar = document.createElement("aside");
  bar.id = "sa-bar";
  bar.className = "sa-bar";
  bar.setAttribute("aria-label", "Standard Agents early access");
  bar.innerHTML = `
    <div class="sa-bar-inner">
      <div class="sa-bar-pitch">
        <img class="sa-bar-mark" src="/standard-agents-logo.svg" alt="Standard Agents" />
        <p>Standard Agents is building reliable agent infrastructure. Get early access.</p>
      </div>
      <form id="sa-bar-form" class="sa-bar-form" novalidate>
        <input id="sa-bar-name" name="name" type="text" placeholder="Name" autocomplete="name" required />
        <input id="sa-bar-email" name="email" type="email" placeholder="Email" autocomplete="email" required />
        <button id="sa-bar-submit" class="sa-bar-submit" type="submit">
          <span class="sa-bar-submit-label">Request access</span>
          ${icon("ArrowRight", { width: 16, height: 16, class: "sa-bar-arrow" })}
          ${icon("Loader2", { width: 16, height: 16, class: "sa-bar-spinner spin" })}
        </button>
      </form>
      <p id="sa-bar-status" class="sa-bar-status" role="status"></p>
    </div>`;
  document.body.appendChild(bar);
  bindEarlyAccessForm(bar);
}

function bindEarlyAccessForm(bar: HTMLElement): void {
  const form = bar.querySelector<HTMLFormElement>("#sa-bar-form");
  const submit = bar.querySelector<HTMLButtonElement>("#sa-bar-submit");
  const status = bar.querySelector<HTMLElement>("#sa-bar-status");
  const nameInput = bar.querySelector<HTMLInputElement>("#sa-bar-name");
  const emailInput = bar.querySelector<HTMLInputElement>("#sa-bar-email");
  const label = submit?.querySelector<HTMLElement>(".sa-bar-submit-label");
  const arrow = submit?.querySelector<SVGElement>(".sa-bar-arrow");
  const spinner = submit?.querySelector<SVGElement>(".sa-bar-spinner");
  if (!form) return;

  const setStatus = (text: string, tone?: "ok" | "err"): void => {
    if (!status) return;
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const setBusy = (busy: boolean): void => {
    if (submit) submit.disabled = busy;
    if (label) label.style.display = busy ? "none" : "";
    if (arrow) arrow.style.display = busy ? "none" : "";
    if (spinner) spinner.style.display = busy ? "" : "none";
  };
  setBusy(false);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput?.value.trim() || "";
    const email = emailInput?.value.trim() || "";
    if (!name || !email) {
      setStatus("Add your name and email first.", "err");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email })
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } | string };
      if (!response.ok || !data.ok) {
        const message = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(message || "Could not submit right now.");
      }
      bar.classList.add("sa-bar--done");
      setStatus("You're on the list — we'll be in touch.", "ok");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong.", "err");
      setBusy(false);
    }
  });
}

void route();
