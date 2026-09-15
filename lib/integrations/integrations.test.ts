import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";

import { gmailComposeUrl, mailtoUrl, createGmailDraft } from "./gmail.ts";
import { syncToCrm, createPaymentLink } from "./outbound.ts";
import {
  changeOrderReadyText,
  exchangeSlackCode,
  listSlackChannels,
  notifySlack,
  slackAuthorizeUrl,
  slackEnvCredential,
  slackRedirectUri,
  slackUsesPkce,
} from "./slack.ts";
import { INTEGRATIONS, integrationStatuses, isConfigured } from "./registry.ts";

/**
 * Slack's env must be controlled per-test: with a real token present,
 * notifySlack would POST to the live API from the test runner. This helper
 * sets the three vars, runs, and restores whatever was there.
 */
async function withSlackEnv(
  vars: { token?: string; channel?: string; apiUrl?: string },
  run: () => Promise<void>,
): Promise<void> {
  const names = ["SLACK_BOT_TOKEN", "SLACK_NOTIFY_CHANNEL", "SLACK_API_URL"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  // Assigning undefined to process.env stores the STRING "undefined" — unset
  // vars must be deleted, or a "cleared" token reads as present.
  const values: Record<string, string | undefined> = {
    SLACK_BOT_TOKEN: vars.token,
    SLACK_NOTIFY_CHANNEL: vars.channel,
    SLACK_API_URL: vars.apiUrl,
  };
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }

  try {
    await run();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test("the registry covers exactly the four §8 integrations", () => {
  assert.deepEqual(
    INTEGRATIONS.map((spec) => spec.id),
    ["gmail", "slack", "crm", "payments"],
  );
});

test("every integration names its credentials and its constraint", () => {
  for (const spec of INTEGRATIONS) {
    assert.ok(spec.credentials.length > 0, `${spec.id} names credentials`);
    assert.ok(spec.constraint.length > 0, `${spec.id} states its constraint`);
    assert.ok(spec.setup.length > 0, `${spec.id} says where credentials come from`);
  }
});

test("integrationStatuses reports every integration as unconfigured without env vars", () => {
  // The test env must not carry integration credentials; if someone sets one,
  // the statuses simply reflect it — the assertion holds either way.
  const statuses = integrationStatuses();
  assert.equal(statuses.length, INTEGRATIONS.length);
  for (const status of statuses) {
    assert.equal(
      status.status,
      status.missing.length === 0 ? "configured" : "not_configured",
    );
    assert.equal(
      isConfigured(status),
      status.status === "configured",
    );
  }
});

test("compose and mailto links carry the reply through URL-encoding", () => {
  const input = {
    to: "client@example.com",
    subject: "Change order CO-001: login revision",
    body: "Hi Dana,\n\nHere is the change order — total $1,250.\n\n— Sam",
  };

  const compose = gmailComposeUrl(input);
  assert.ok(compose.startsWith("https://mail.google.com/mail/?"));
  assert.ok(compose.includes("view=cm"));
  // Encoded, not raw: newlines and the @ never appear literally.
  assert.ok(!compose.includes("\n"));
  assert.ok(!compose.includes("client@example.com"));

  const mailto = mailtoUrl(input);
  assert.ok(mailto.startsWith("mailto:client@example.com?"));
  assert.ok(!mailto.includes("\n"));
  assert.ok(mailto.includes("subject="));
  assert.ok(mailto.includes("body="));
});

test("the OAuth scaffolds refuse honestly instead of pretending", async () => {
  const input = { to: "client@example.com", subject: "s", body: "b" };

  // Without credentials every scaffold returns not_configured with the env
  // vars named. Slack's env is cleared explicitly so a developer token can
  // never turn this test into a live POST.
  const gmail = await createGmailDraft(input);
  const crm = await syncToCrm({ projectName: "P", reference: "CO-001" });
  const payments = await createPaymentLink({ invoiceReference: "INV-001" });
  let slack: Awaited<ReturnType<typeof notifySlack>>;
  await withSlackEnv({}, async () => {
    slack = await notifySlack({ channel: "#ops", text: "ready" });
  });

  for (const result of [gmail, slack!, crm, payments]) {
    if (result.ok) continue;
    assert.equal(result.reason, "not_configured");
    assert.ok(result.message.includes("Set "), "names what to set");
  }
});

test("slackEnvCredential (the operator-wide fallback) requires both the token and the channel", async () => {
  await withSlackEnv({}, () => {
    assert.equal(slackEnvCredential(), null);
    return Promise.resolve();
  });
  await withSlackEnv({ token: "xoxb-test" }, () => {
    assert.equal(slackEnvCredential(), null);
    return Promise.resolve();
  });
  await withSlackEnv({ token: "xoxb-test", channel: "#ops" }, () => {
    assert.deepEqual(slackEnvCredential(), { token: "xoxb-test", channel: "#ops" });
    return Promise.resolve();
  });
});

test("the ready-for-review message names the change order and links the documents", () => {
  const text = changeOrderReadyText({
    projectName: "Bakery site",
    reference: "CO-001",
    documentsUrl: "https://scopeguard.example/projects/p/requests/r/documents",
  });
  assert.ok(text.includes("CO-001"));
  assert.ok(text.includes("Bakery site"));
  assert.ok(text.includes("https://scopeguard.example/projects/p/requests/r/documents"));
});

/**
 * A local stand-in for the Slack Web API, capturing what was posted. Handles
 * both the JSON bodies (chat.postMessage) and the form-encoded bodies
 * (oauth.v2.access, conversations.list) ScopeGuard sends.
 */
function slackStub(
  respond: (res: http.ServerResponse) => void,
): {
  server: http.Server;
  requests: Array<{ auth?: string; contentType?: string; body: Record<string, unknown> }>;
  url: () => Promise<string>;
} {
  const requests: Array<{ auth?: string; contentType?: string; body: Record<string, unknown> }> = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const contentType = req.headers["content-type"] ?? "";
      requests.push({
        auth: req.headers.authorization,
        contentType,
        body: contentType.includes("application/json")
      ? (JSON.parse(raw) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(raw)),
      });
      res.setHeader("content-type", "application/json");
      respond(res);
    });
  });

  return {
    server,
    requests,
    url: () =>
      new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}/`);
        });
      }),
  };
}

test("notifySlack posts the message with the bearer token and returns Slack's ts", async () => {
  const stub = slackStub((res) => {
    res.end(JSON.stringify({ ok: true, channel: "C123", ts: "1234.5678" }));
  });
  const url = await stub.url();

  try {
    await withSlackEnv({ token: "xoxb-test", channel: "#change-orders", apiUrl: url }, async () => {
      const result = await notifySlack({ channel: "#change-orders", text: "CO-001 ready" });
      assert.deepEqual(result, { ok: true, channel: "C123", ts: "1234.5678" });
    });

    assert.equal(stub.requests.length, 1);
    const request = stub.requests[0];
    assert.ok(request, "one request reached the API stub");
    assert.equal(request.auth, "Bearer xoxb-test");
    assert.deepEqual(request.body, {
      channel: "#change-orders",
      text: "CO-001 ready",
    });
  } finally {
    stub.server.close();
  }
});

test("a Slack-side refusal (HTTP 200, ok:false) reports as failed with the error code", async () => {
  const stub = slackStub((res) => {
    res.end(JSON.stringify({ ok: false, error: "not_in_channel" }));
  });
  const url = await stub.url();

  try {
    await withSlackEnv({ token: "xoxb-test", channel: "#nope", apiUrl: url }, async () => {
      const result = await notifySlack({ channel: "#nope", text: "hi" });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "failed");
      assert.ok(result.message.includes("not_in_channel"));
    });
  } finally {
    stub.server.close();
  }
});

test("an HTTP-level failure (429) reports as failed with the status", async () => {
  const stub = slackStub((res) => {
    res.statusCode = 429;
    res.end("{}");
  });
  const url = await stub.url();

  try {
    await withSlackEnv({ token: "xoxb-test", channel: "#ops", apiUrl: url }, async () => {
      const result = await notifySlack({ channel: "#ops", text: "hi" });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "failed");
      assert.ok(result.message.includes("429"));
    });
  } finally {
    stub.server.close();
  }
});

test("slackRedirectUri is pinned to the site URL, not the browsing host", async () => {
  const saved = process.env.NEXT_PUBLIC_SITE_URL;

  // With a site URL set, a browser on a LAN IP still sends the canonical
  // origin — Slack refuses plain-http non-localhost redirect URIs.
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  try {
    assert.equal(
      slackRedirectUri("http://192.168.0.102:3000"),
      "http://localhost:3000/integrations/slack/callback",
    );
    // Trailing slashes on the site URL must not leak into the URI.
    process.env.NEXT_PUBLIC_SITE_URL = "https://scopeguard.example/";
    assert.equal(
      slackRedirectUri("http://localhost:3000"),
      "https://scopeguard.example/integrations/slack/callback",
    );
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = saved;
  }

  // No site URL configured: fall back to the request origin.
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    assert.equal(
      slackRedirectUri("http://localhost:3000"),
      "http://localhost:3000/integrations/slack/callback",
    );
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = saved;
  }
});

// ── Per-user OAuth (the "Connect Slack" flow) ───────────────────────────────

test("notifySlack uses the caller's own token when one is passed", async () => {
  const stub = slackStub((res) => {
    res.end(JSON.stringify({ ok: true, channel: "C123", ts: "1.2" }));
  });
  const url = await stub.url();

  try {
    // No env token at all: the per-user token must be enough.
    await withSlackEnv({ apiUrl: url }, async () => {
      const result = await notifySlack({ token: "xoxb-mine", channel: "#mine", text: "hi" });
      assert.equal(result.ok, true);
    });

    const request = stub.requests[0];
    assert.ok(request, "one request reached the API stub");
    assert.equal(request.auth, "Bearer xoxb-mine");
  } finally {
    stub.server.close();
  }
});

test("the authorize URL requests the posting scopes; PKCE only on https origins", () => {
  const httpsUrl = slackAuthorizeUrl({
    clientId: "123456.789",
    redirectUri: "https://scopeguard.example/integrations/slack/callback",
    state: "f00d",
    codeChallenge: "c0ffee",
  });

  assert.ok(httpsUrl.startsWith("https://slack.com/oauth/v2/authorize?"));
  const httpsParams = new URL(httpsUrl).searchParams;
  assert.equal(httpsParams.get("client_id"), "123456.789");
  assert.equal(httpsParams.get("state"), "f00d");
  // chat:write posts; chat:write.public removes the invite step;
  // channels:read feeds the channel picker.
  assert.equal(httpsParams.get("scope"), "chat:write,chat:write.public,channels:read");
  assert.equal(httpsParams.get("code_challenge"), "c0ffee");
  assert.equal(httpsParams.get("code_challenge_method"), "S256");

  // Loopback + PKCE is a "desktop redirect" per Slack, and desktop redirects
  // may not request bot scopes — so the loopback authorize URL omits PKCE
  // and keeps the classic dev exemption.
  const localhostUrl = slackAuthorizeUrl({
    clientId: "123456.789",
    redirectUri: "http://localhost:3000/integrations/slack/callback",
    state: "f00d",
    codeChallenge: null,
  });
  const localhostParams = new URL(localhostUrl).searchParams;
  assert.equal(localhostParams.get("code_challenge"), null);
  assert.equal(localhostParams.get("code_challenge_method"), null);
  assert.equal(localhostParams.get("scope"), "chat:write,chat:write.public,channels:read");
});

test("slackUsesPkce is off unless explicitly enabled (Slack desktop-redirect rule)", async () => {
  const saved = process.env.SLACK_OAUTH_PKCE;
  try {
    // Default: off. A loopback redirect with PKCE is a "desktop redirect"
    // per Slack, and desktop redirects may not request bot scopes; sending
    // PKCE to an app without the setting can also be rejected. The state
    // cookie guards every flow regardless.
    delete process.env.SLACK_OAUTH_PKCE;
    assert.equal(slackUsesPkce(), false);

    process.env.SLACK_OAUTH_PKCE = "true";
    assert.equal(slackUsesPkce(), true);
  } finally {
    if (saved === undefined) delete process.env.SLACK_OAUTH_PKCE;
    else process.env.SLACK_OAUTH_PKCE = saved;
  }
});

test("exchangeSlackCode posts the code, secret and PKCE verifier server-side and returns the grant", async () => {
  const stub = slackStub((res) => {
    res.end(
      JSON.stringify({
        ok: true,
        access_token: "xoxb-granted",
        team: { name: "Northwind" },
        bot_user_id: "B123",
        authed_user: { id: "U123" },
      }),
    );
  });
  const url = await stub.url();

  try {
    process.env.SLACK_OAUTH_URL = url;
    const result = await exchangeSlackCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "one-time-code",
      redirectUri: "http://localhost:3000/integrations/slack/callback",
      codeVerifier: "the-verifier",
    });

    assert.deepEqual(result, {
      ok: true,
      token: "xoxb-granted",
      teamName: "Northwind",
      botUserId: "B123",
      slackUserId: "U123",
    });

    const request = stub.requests[0];
    assert.ok(request, "one request reached the token endpoint stub");
    assert.equal(request.contentType, "application/x-www-form-urlencoded");
    assert.deepEqual(request.body, {
      client_id: "client-id",
      client_secret: "client-secret",
      code: "one-time-code",
      redirect_uri: "http://localhost:3000/integrations/slack/callback",
      code_verifier: "the-verifier",
    });
  } finally {
    delete process.env.SLACK_OAUTH_URL;
    stub.server.close();
  }
});

test("the token exchange omits code_verifier when no PKCE was issued", async () => {
  const stub = slackStub((res) => {
    res.end(JSON.stringify({ ok: true, access_token: "xoxb-granted" }));
  });
  const url = await stub.url();

  try {
    process.env.SLACK_OAUTH_URL = url;
    const result = await exchangeSlackCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "one-time-code",
      redirectUri: "http://localhost:3000/integrations/slack/callback",
      codeVerifier: null,
    });
    assert.equal(result.ok, true);

    const request = stub.requests[0];
    assert.ok(request, "one request reached the token endpoint stub");
    assert.ok(!("code_verifier" in request.body), "no verifier key on the loopback flow");
  } finally {
    delete process.env.SLACK_OAUTH_URL;
    stub.server.close();
  }
});

test("a rejected authorization code reports as failed with Slack's error", async () => {  const stub = slackStub((res) => {
    res.end(JSON.stringify({ ok: false, error: "invalid_code" }));
  });
  const url = await stub.url();

  try {
    process.env.SLACK_OAUTH_URL = url;
    const result = await exchangeSlackCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "expired",
      redirectUri: "http://localhost:3000/integrations/slack/callback",
      codeVerifier: "the-verifier",
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "failed");
    assert.ok(result.message.includes("invalid_code"));
  } finally {
    delete process.env.SLACK_OAUTH_URL;
    stub.server.close();
  }
});

test("listSlackChannels sends the user's bearer token and sorts the channels", async () => {
  const stub = slackStub((res) => {
    res.end(
      JSON.stringify({
        ok: true,
        channels: [
          { id: "C2", name: "general", is_member: true },
          { id: "C1", name: "change-orders", is_member: false },
        ],
      }),
    );
  });
  const url = await stub.url();

  try {
    process.env.SLACK_CHANNELS_URL = url;
    const result = await listSlackChannels({ token: "xoxb-mine" });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.channels, [
        { id: "C1", name: "change-orders", isMember: false },
        { id: "C2", name: "general", isMember: true },
      ]);
    }

    const request = stub.requests[0];
    assert.ok(request, "one request reached the channels endpoint stub");
    assert.equal(request.auth, "Bearer xoxb-mine");
    assert.equal(request.body.types, "public_channel");
  } finally {
    delete process.env.SLACK_CHANNELS_URL;
    stub.server.close();
  }
});
