import assert from "node:assert/strict";
import test, { after } from "node:test";
process.env.ADFLOW_META_APP_SECRET = "test-secret";
process.env.ADFLOW_META_API_VERSION = "v23.0";
process.env.ADFLOW_GOOGLE_API_VERSION = "v22";
process.env.ADFLOW_GOOGLE_DEVELOPER_TOKEN = "test-token";
const { discover, readMetrics } = await import("./providers");
const original = globalThis.fetch;
after(() => {
  globalThis.fetch = original;
});
void test("should paginate Meta accounts using opaque cursors without following provider URLs", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    urls.push(url.toString());
    assert.equal(url.hostname, "graph.facebook.com");
    return Response.json(
      url.searchParams.has("after")
        ? {
            data: [
              {
                account_id: "2",
                name: "Second",
                currency: "USD",
                timezone_name: "UTC",
              },
            ],
          }
        : {
            data: [
              {
                account_id: "1",
                name: "First",
                currency: "USD",
                timezone_name: "UTC",
              },
            ],
            paging: {
              next: "https://untrusted.invalid/?access_token=secret",
              cursors: { after: "opaque-next" },
            },
          },
    );
  };
  const accounts = await discover("META", "test-token");
  assert.equal(accounts.length, 2);
  assert.equal(urls.length, 2);
  assert.ok(!urls.some((url) => url.includes("access_token")));
});
void test("should not double-count overlapping Meta purchase action aliases", async () => {
  globalThis.fetch = async () =>
    Response.json({
      data: [
        {
          ad_id: "1",
          ad_name: "Ad",
          campaign_name: "Campaign",
          adset_name: "Group",
          date_start: "2026-07-01",
          impressions: "1000",
          clicks: "30",
          spend: "12.34",
          actions: [
            { action_type: "purchase", value: "3" },
            { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
          ],
          action_values: [
            {
              action_type: "offsite_conversion.fb_pixel_purchase",
              value: "90",
            },
          ],
        },
      ],
    });
  const rows = await readMetrics(
    "META",
    "test",
    { externalId: "1", name: "Account", currency: "USD", timezone: "UTC" },
    "2026-07-01",
    "2026-07-30",
  );
  assert.equal(rows[0]?.conversions, 3);
  assert.equal(rows[0]?.spendMicros, 12340000);
});
void test("should preserve missing conversion events and reject provider auth errors without leaking body", async () => {
  globalThis.fetch = async () =>
    Response.json({
      data: [
        {
          ad_id: "1",
          ad_name: "Ad",
          campaign_name: "C",
          adset_name: "G",
          date_start: "2026-07-01",
          impressions: "1",
          clicks: "1",
          spend: "1",
        },
      ],
    });
  const rows = await readMetrics(
    "META",
    "test",
    { externalId: "1", name: "A", currency: "USD", timezone: "UTC" },
    "2026-07-01",
    "2026-07-30",
  );
  assert.equal(rows[0]?.conversions, null);
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: 190, message: "token=private-secret" } },
      { status: 400 },
    );
  await assert.rejects(() => discover("META", "test"), {
    message: "REAUTH_REQUIRED",
  });
});
