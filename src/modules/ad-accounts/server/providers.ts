import { createHmac } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";
import {
  dailyRowSchema,
  discoveredSchema,
  type DailyRow,
  type DiscoveredAccount,
  type Platform,
} from "./schema";

export const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
});
export type Credentials = z.infer<typeof credentialsSchema>;
export class AdsProviderError extends Error {
  constructor(
    public code:
      | "REAUTH_REQUIRED"
      | "PROVIDER_LIMIT"
      | "PROVIDER_ERROR"
      | "DATA_TOO_LARGE"
      | "PROVIDER_CONFIG",
  ) {
    super(code);
  }
}
export function providerReady(platform: Platform) {
  return Boolean(
    env.ADFLOW_CREDENTIAL_ENCRYPTION_KEY &&
    env.APP_URL &&
    (platform === "GOOGLE"
      ? env.ADFLOW_GOOGLE_CLIENT_ID &&
        env.ADFLOW_GOOGLE_CLIENT_SECRET &&
        env.ADFLOW_GOOGLE_DEVELOPER_TOKEN
      : env.ADFLOW_META_APP_ID &&
        env.ADFLOW_META_APP_SECRET &&
        env.ADFLOW_META_API_VERSION),
  );
}
export function callbackUrl(platform: Platform) {
  if (!env.APP_URL) throw new AdsProviderError("PROVIDER_CONFIG");
  return new URL(
    `/api/adflow/oauth/${platform.toLowerCase()}`,
    env.APP_URL,
  ).toString();
}
async function json(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
    redirect: "error",
  });
  const body: unknown = await res.json().catch(() => null);
  const error = z
    .object({
      error: z
        .union([z.string(), z.object({ code: z.number().optional() })])
        .optional(),
    })
    .safeParse(body);
  if (!res.ok || (error.success && error.data.error)) {
    const e = error.success ? error.data.error : undefined;
    if (
      res.status === 401 ||
      e === "invalid_grant" ||
      (typeof e === "object" && e?.code === 190)
    )
      throw new AdsProviderError("REAUTH_REQUIRED");
    throw new AdsProviderError(
      res.status === 429 ? "PROVIDER_LIMIT" : "PROVIDER_ERROR",
    );
  }
  return body;
}
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});
export function authorizationUrl(platform: Platform, state: string) {
  if (!providerReady(platform)) throw new AdsProviderError("PROVIDER_CONFIG");
  const url = new URL(
    platform === "GOOGLE"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : `https://www.facebook.com/${env.ADFLOW_META_API_VERSION}/dialog/oauth`,
  );
  url.search = new URLSearchParams({
    client_id: (platform === "GOOGLE"
      ? env.ADFLOW_GOOGLE_CLIENT_ID
      : env.ADFLOW_META_APP_ID)!,
    redirect_uri: callbackUrl(platform),
    state,
    response_type: "code",
    scope:
      platform === "GOOGLE"
        ? "openid https://www.googleapis.com/auth/adwords"
        : "ads_read",
  }).toString();
  if (platform === "GOOGLE") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.toString();
}
export async function exchangeCode(platform: Platform, code: string) {
  let data: z.infer<typeof tokenSchema>;
  if (platform === "GOOGLE") {
    data = tokenSchema.parse(
      await json("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          code,
          client_id: env.ADFLOW_GOOGLE_CLIENT_ID!,
          client_secret: env.ADFLOW_GOOGLE_CLIENT_SECRET!,
          redirect_uri: callbackUrl(platform),
          grant_type: "authorization_code",
        }),
      }),
    );
    if (!data.refresh_token) throw new AdsProviderError("REAUTH_REQUIRED");
  } else {
    const url = new URL(
      `https://graph.facebook.com/${env.ADFLOW_META_API_VERSION}/oauth/access_token`,
    );
    url.search = new URLSearchParams({
      code,
      client_id: env.ADFLOW_META_APP_ID!,
      client_secret: env.ADFLOW_META_APP_SECRET!,
      redirect_uri: callbackUrl(platform),
    }).toString();
    data = tokenSchema.parse(await json(url.toString()));
    url.search = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.ADFLOW_META_APP_ID!,
      client_secret: env.ADFLOW_META_APP_SECRET!,
      fb_exchange_token: data.access_token,
    }).toString();
    data = tokenSchema.parse(await json(url.toString()));
  }
  const identity =
    platform === "GOOGLE"
      ? z.object({ sub: z.string() }).parse(
          await json("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${data.access_token}` },
          }),
        ).sub
      : z
          .object({ id: z.string() })
          .parse(await metaGet("me", data.access_token, { fields: "id" })).id;
  return {
    identity,
    credentials: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined,
    },
  };
}
export async function accessToken(
  platform: Platform,
  credentials: Credentials,
) {
  if (platform === "META") {
    if (credentials.expiresAt && credentials.expiresAt <= Date.now())
      throw new AdsProviderError("REAUTH_REQUIRED");
    return credentials.accessToken;
  }
  if (!credentials.refreshToken) throw new AdsProviderError("REAUTH_REQUIRED");
  return tokenSchema.parse(
    await json("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.ADFLOW_GOOGLE_CLIENT_ID!,
        client_secret: env.ADFLOW_GOOGLE_CLIENT_SECRET!,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    }),
  ).access_token;
}
async function metaGet(
  path: string,
  token: string,
  params: Record<string, string>,
) {
  const url = new URL(
    `https://graph.facebook.com/${env.ADFLOW_META_API_VERSION}/${path}`,
  );
  url.search = new URLSearchParams({
    ...params,
    appsecret_proof: createHmac("sha256", env.ADFLOW_META_APP_SECRET!)
      .update(token)
      .digest("hex"),
  }).toString();
  return json(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
}
async function metaPages(
  path: string,
  token: string,
  params: Record<string, string>,
) {
  const rows: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const result = z
      .object({
        data: z.array(z.unknown()),
        paging: z
          .object({
            next: z.string().optional(),
            cursors: z.object({ after: z.string().optional() }).optional(),
          })
          .optional(),
      })
      .parse(
        await metaGet(path, token, {
          ...params,
          limit: "500",
          ...(after ? { after } : {}),
        }),
      );
    rows.push(...result.data);
    if (rows.length > 100000) throw new AdsProviderError("DATA_TOO_LARGE");
    if (!result.paging?.next) return rows;
    const next = result.paging.cursors?.after;
    if (!next || next === after) throw new AdsProviderError("PROVIDER_ERROR");
    after = next;
  }
  throw new AdsProviderError("DATA_TOO_LARGE");
}
async function googleQuery(
  customer: string,
  token: string,
  query: string,
  managerId?: string,
) {
  const rows: unknown[] = [];
  let pageToken = "";
  for (let page = 0; page < 1000; page++) {
    const result = z
      .object({
        results: z.array(z.unknown()).optional(),
        nextPageToken: z.string().optional(),
      })
      .parse(
        await json(
          `https://googleads.googleapis.com/${env.ADFLOW_GOOGLE_API_VERSION}/customers/${customer}/googleAds:search`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "developer-token": env.ADFLOW_GOOGLE_DEVELOPER_TOKEN!,
              "Content-Type": "application/json",
              ...(managerId ? { "login-customer-id": managerId } : {}),
            },
            body: JSON.stringify({
              query,
              ...(pageToken ? { pageToken } : {}),
            }),
          },
        ),
      );
    rows.push(...(result.results ?? []));
    if (rows.length > 100000) throw new AdsProviderError("DATA_TOO_LARGE");
    if (!result.nextPageToken) return rows;
    if (result.nextPageToken === pageToken)
      throw new AdsProviderError("PROVIDER_ERROR");
    pageToken = result.nextPageToken;
  }
  throw new AdsProviderError("DATA_TOO_LARGE");
}
export async function discover(
  platform: Platform,
  token: string,
): Promise<DiscoveredAccount[]> {
  if (platform === "META") {
    return (
      await metaPages("me/adaccounts", token, {
        fields: "account_id,name,currency,timezone_name",
      })
    ).map((raw) => {
      const a = z
        .object({
          account_id: z.string(),
          name: z.string(),
          currency: z.string(),
          timezone_name: z.string(),
        })
        .parse(raw);
      return discoveredSchema.parse({
        externalId: a.account_id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone_name,
      });
    });
  }
  const roots = z
    .object({ resourceNames: z.array(z.string()).default([]) })
    .parse(
      await json(
        `https://googleads.googleapis.com/${env.ADFLOW_GOOGLE_API_VERSION}/customers:listAccessibleCustomers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "developer-token": env.ADFLOW_GOOGLE_DEVELOPER_TOKEN!,
          },
        },
      ),
    );
  const found = new Map<string, DiscoveredAccount>();
  for (const resource of roots.resourceNames) {
    const root = resource.split("/").pop()!;
    if (!/^\d+$/.test(root)) throw new AdsProviderError("PROVIDER_ERROR");
    const records = await googleQuery(
      root,
      token,
      "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client",
      root,
    );
    for (const raw of records) {
      const { customerClient: a } = z
        .object({
          customerClient: z.object({
            id: z.string(),
            descriptiveName: z.string().optional(),
            currencyCode: z.string(),
            timeZone: z.string(),
            manager: z.boolean().optional(),
          }),
        })
        .parse(raw);
      if (!a.manager)
        found.set(
          a.id,
          discoveredSchema.parse({
            externalId: a.id,
            managerId: root === a.id ? undefined : root,
            name: a.descriptiveName ?? a.id,
            currency: a.currencyCode,
            timezone: a.timeZone,
          }),
        );
    }
  }
  return [...found.values()];
}
const numeric = z.coerce.number().finite().nonnegative();
export async function readMetrics(
  platform: Platform,
  token: string,
  account: DiscoveredAccount,
  start: string,
  end: string,
): Promise<DailyRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
    throw new Error("INVALID_RANGE");
  if (platform === "GOOGLE") {
    const data = await googleQuery(
      account.externalId,
      token,
      `SELECT segments.date, campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE segments.date BETWEEN '${start}' AND '${end}'`,
      account.managerId,
    );
    return data.map((raw) => {
      const r = z
        .object({
          segments: z.object({ date: z.string() }),
          campaign: z.object({ name: z.string() }),
          adGroup: z.object({ name: z.string() }),
          adGroupAd: z.object({
            ad: z.object({ id: z.string(), name: z.string().optional() }),
          }),
          metrics: z.object({
            impressions: numeric.default(0),
            clicks: numeric.default(0),
            costMicros: numeric.default(0),
            conversions: numeric.nullish(),
            conversionsValue: numeric.nullish(),
          }),
        })
        .parse(raw);
      return dailyRowSchema.parse({
        date: r.segments.date,
        entityId: r.adGroupAd.ad.id,
        name: r.adGroupAd.ad.name ?? r.adGroupAd.ad.id,
        campaign: r.campaign.name,
        group: r.adGroup.name,
        impressions: r.metrics.impressions,
        clicks: r.metrics.clicks,
        spendMicros: r.metrics.costMicros,
        conversions: r.metrics.conversions ?? null,
        conversionValue: r.metrics.conversionsValue ?? null,
      });
    });
  }
  const data = await metaPages(`act_${account.externalId}/insights`, token, {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: start, until: end }),
    action_attribution_windows: JSON.stringify(["7d_click"]),
    action_report_time: "conversion",
    fields:
      "ad_id,ad_name,campaign_name,adset_name,date_start,impressions,clicks,spend,actions,action_values",
  });
  return data.map((raw) => {
    const action = z.object({ action_type: z.string(), value: numeric });
    const r = z
      .object({
        ad_id: z.string(),
        ad_name: z.string(),
        campaign_name: z.string(),
        adset_name: z.string(),
        date_start: z.string(),
        impressions: numeric,
        clicks: numeric,
        spend: numeric,
        actions: z.array(action).optional(),
        action_values: z.array(action).optional(),
      })
      .parse(raw);
    // Select one disjoint conversion type; never sum overlapping purchase aliases.
    return dailyRowSchema.parse({
      date: r.date_start,
      entityId: r.ad_id,
      name: r.ad_name,
      campaign: r.campaign_name,
      group: r.adset_name,
      impressions: r.impressions,
      clicks: r.clicks,
      spendMicros: Math.round(r.spend * 1000000),
      conversions:
        r.actions?.find(
          (a) => a.action_type === "offsite_conversion.fb_pixel_purchase",
        )?.value ?? null,
      conversionValue:
        r.action_values?.find(
          (a) => a.action_type === "offsite_conversion.fb_pixel_purchase",
        )?.value ?? null,
    });
  });
}
