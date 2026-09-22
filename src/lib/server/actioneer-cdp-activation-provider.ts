import type {
  ActivationAudienceReadiness,
  ActivationDataProvider,
  ActivationFieldMapping,
  ActivationProfile,
  ActivationSourceRef,
} from "@/lib/activation-audience-types";
import { getEffectiveCdpCredentials } from "@/lib/tenant-connections-store";
import {
  activationProfileFromCdpPerson,
  summarizeActivationReadiness,
  type ActioneerCdpPersonRecord,
} from "@/lib/server/activation-profile";

export interface ActioneerCdpActivationConfig {
  profileServiceUrl?: string;
  apiToken?: string;
  teamId?: string;
  tenantId?: string;
  appId?: string;
  authenticatedHeader?: string;
  pageSize?: number;
  audiencePageLimit?: number;
  memberLimit?: number;
  readinessProfileLimit?: number;
  requestTimeoutMs?: number;
  outcomesPath?: string;
}

interface CdpAudienceResponse {
  id?: string | number;
  audienceId?: string;
  cohort_id?: string | number;
  name?: string;
  label?: string;
  description?: string | null;
  memberCount?: number;
  userCount?: number;
  currentMembers?: number;
  member_count?: number;
  calculating?: boolean;
  last_error?: string | null;
  filters?: unknown;
  created_at?: string;
  updated_at?: string;
  last_calculated_at?: string | null;
}

export interface ActioneerCdpSnapshotFilter {
  type?: "person";
  key: string;
  operator: string;
  value: string | number | boolean;
}

export interface ActioneerCdpAudience {
  id: string;
  name: string;
  description?: string;
  memberCount?: number;
  calculating?: boolean;
  lastError?: string | null;
  lastCalculatedAt?: string | null;
  filters?: unknown;
}

export interface ActioneerCdpAudienceMembersPage {
  members: string[];
  nextPageToken?: string | null;
  pageSize: number;
}

export interface ActioneerCdpAudiencesPage {
  audiences: ActioneerCdpAudience[];
  nextPageToken?: string | null;
  pageSize: number;
}

interface CdpMemberResponse {
  id?: string;
  personId?: string;
  person_id?: string;
  userId?: string;
  user_id?: string;
  distinctId?: string;
  distinct_id?: string;
}

type CdpListAudiencesBody =
  | CdpAudienceResponse[]
  | {
      audiences?: CdpAudienceResponse[];
      segments?: CdpAudienceResponse[];
      cohorts?: CdpAudienceResponse[];
      items?: CdpAudienceResponse[];
      next_page_token?: string | null;
    };

type CdpMembersBody =
  | Array<string | CdpMemberResponse>
  | {
      members?: Array<string | CdpMemberResponse>;
      personIds?: string[];
      person_ids?: string[];
      next_page_token?: string | null;
    };

export function actioneerCdpConfigFromEnv(): ActioneerCdpActivationConfig {
  return actioneerCdpConfigFromRecord({
    profileServiceUrl: process.env.ACTIONEER_CDP_PROFILE_SERVICE_URL,
    apiToken: process.env.ACTIONEER_CDP_API_TOKEN,
    teamId: process.env.ACTIONEER_CDP_TEAM_ID,
    tenantId: process.env.ACTIONEER_CDP_TENANT_ID || process.env.ACTIONEER_CDP_TEAM_ID,
    appId: process.env.ACTIONEER_CDP_APP_ID,
    authenticatedHeader: process.env.ACTIONEER_CDP_AUTHENTICATED,
    pageSize: process.env.ACTIONEER_CDP_PAGE_SIZE,
    audiencePageLimit: process.env.ACTIONEER_CDP_AUDIENCE_PAGE_LIMIT,
    memberLimit: process.env.ACTIONEER_CDP_MEMBER_LIMIT,
    readinessProfileLimit: process.env.ACTIONEER_CDP_READINESS_PROFILE_LIMIT,
    requestTimeoutMs: process.env.ACTIONEER_CDP_REQUEST_TIMEOUT_MS,
    outcomesPath: process.env.ACTIONEER_CDP_OUTCOMES_PATH,
  });
}

function optionalNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function actioneerCdpConfigFromRecord(
  values: Record<string, string | undefined> = {},
): ActioneerCdpActivationConfig {
  return {
    profileServiceUrl: values.profileServiceUrl?.trim() || values.baseUrl?.trim(),
    apiToken: values.apiToken?.trim(),
    teamId: values.teamId?.trim(),
    tenantId: values.tenantId?.trim() || values.teamId?.trim(),
    appId: values.appId?.trim(),
    authenticatedHeader: values.authenticatedHeader?.trim() || values.authenticated?.trim() || "true",
    pageSize: optionalNumber(values.pageSize, 500),
    audiencePageLimit: optionalNumber(values.audiencePageLimit, 200),
    memberLimit: optionalNumber(values.memberLimit, 5000),
    readinessProfileLimit: optionalNumber(values.readinessProfileLimit, 500),
    requestTimeoutMs: optionalNumber(values.requestTimeoutMs, 15000),
    outcomesPath: values.outcomesPath?.trim(),
  };
}

export function actioneerCdpConfigForUser(
  userId: string,
  overrides: Partial<ActioneerCdpActivationConfig> = {},
): ActioneerCdpActivationConfig {
  return {
    ...actioneerCdpConfigFromRecord(getEffectiveCdpCredentials(userId)),
    ...overrides,
  };
}

export function actioneerCdpProviderForUser(
  userId: string,
  overrides: Partial<ActioneerCdpActivationConfig> = {},
): ActioneerCdpActivationProvider {
  return new ActioneerCdpActivationProvider(actioneerCdpConfigForUser(userId, overrides));
}

export function normalizeActioneerCdpProfile(
  person: ActioneerCdpPersonRecord,
  source?: { sourceId?: string; audienceId?: string; memberId?: string },
): ActivationProfile {
  return activationProfileFromCdpPerson(person, source);
}

function cleanBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function query(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const rendered = qs.toString();
  return rendered ? `?${rendered}` : "";
}

function audienceId(audience: CdpAudienceResponse): string {
  return String(audience.id ?? audience.audienceId ?? audience.cohort_id ?? "").trim();
}

function audienceName(audience: CdpAudienceResponse): string {
  return String(audience.name ?? audience.label ?? audienceId(audience)).trim();
}

function normalizeAudience(audience: CdpAudienceResponse): ActioneerCdpAudience | null {
  const id = audienceId(audience);
  if (!id) return null;
  return {
    id,
    name: audienceName(audience),
    description: audience.description ?? undefined,
    memberCount: audience.memberCount ?? audience.member_count ?? audience.userCount ?? audience.currentMembers,
    calculating: audience.calculating,
    lastError: audience.last_error,
    lastCalculatedAt: audience.last_calculated_at ?? null,
    filters: audience.filters,
  };
}

function memberId(member: string | CdpMemberResponse): string | undefined {
  if (typeof member === "string") return member.trim() || undefined;
  return String(
    member.personId ??
    member.person_id ??
    member.id ??
    member.userId ??
    member.user_id ??
    member.distinctId ??
    member.distinct_id ??
    "",
  ).trim() || undefined;
}

export class ActioneerCdpActivationProvider implements ActivationDataProvider {
  constructor(private readonly config: ActioneerCdpActivationConfig) {}

  private baseUrl(): string {
    const baseUrl = cleanBaseUrl(this.config.profileServiceUrl);
    if (!baseUrl) {
      throw new Error("Actioneer CDP profile service URL is not configured");
    }
    return baseUrl;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const tenantId = this.config.tenantId ?? this.config.teamId;
    const signal = init?.signal ?? AbortSignal.timeout(this.config.requestTimeoutMs || 15000);
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(this.config.apiToken ? { Authorization: `Bearer ${this.config.apiToken}` } : {}),
        ...(this.config.authenticatedHeader ? { "X-Authenticated": this.config.authenticatedHeader } : {}),
        ...(tenantId ? { "X-Tenant-Id": tenantId, "x-actioneer-team-id": tenantId } : {}),
        ...(this.config.appId ? { "x-actioneer-app-id": this.config.appId } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Actioneer CDP request failed (${res.status}): ${body || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listAudiences(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    memberCount?: number;
    source: ActivationSourceRef;
  }>> {
    const audiences: ActioneerCdpAudience[] = [];
    let pageToken: string | undefined;
    const pageSize = String(this.config.pageSize || 500);
    const pageLimit = Math.max(1, this.config.audiencePageLimit || 200);
    let pageCount = 0;

    do {
      pageCount += 1;
      const body = await this.listAudiencesPage({
        pageSize: Number(pageSize),
        pageToken,
      });
      audiences.push(...body.audiences);
      pageToken = body.nextPageToken ?? undefined;
    } while (pageToken && pageCount < pageLimit);

    return audiences
      .map((audience) => {
        const id = audience.id;
        if (!id) return null;
        return {
          id,
          name: audience.name,
          description: audience.description ?? undefined,
          memberCount: audience.memberCount,
          source: {
            type: "actioneer_cdp" as const,
            sourceId: this.config.tenantId ?? this.config.teamId,
            audienceId: id,
          },
        };
      })
      .filter((audience): audience is NonNullable<typeof audience> => Boolean(audience));
  }

  async listAudiencesPage(input: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<ActioneerCdpAudiencesPage> {
    const pageSize = Math.max(1, Math.min(input.pageSize || this.config.pageSize || 50, 200));
    const body = await this.request<CdpListAudiencesBody>(
      `/v1/cohorts${query({
        appId: this.config.appId,
        page_size: String(pageSize),
        page_token: input.pageToken,
      })}`,
    );
    const page = Array.isArray(body)
      ? body
      : body.items ?? body.audiences ?? body.segments ?? body.cohorts ?? [];
    return {
      audiences: page.map(normalizeAudience).filter((audience): audience is ActioneerCdpAudience => Boolean(audience)),
      nextPageToken: Array.isArray(body) ? null : body.next_page_token ?? null,
      pageSize,
    };
  }

  async createSnapshotAudience(input: {
    name: string;
    filters: ActioneerCdpSnapshotFilter[];
  }): Promise<ActioneerCdpAudience> {
    const body = await this.request<CdpAudienceResponse>(
      `/v1/cohorts${query({ appId: this.config.appId })}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          is_static: true,
          snapshot_from: {
            properties: {
              type: "AND",
              values: input.filters.map((filter) => ({
                type: filter.type ?? "person",
                key: filter.key,
                operator: filter.operator,
                value: filter.value,
              })),
            },
          },
        }),
      },
    );
    const audience = normalizeAudience(body);
    if (!audience) throw new Error("Actioneer CDP did not return a cohort id");
    return audience;
  }

  async getAudience(audienceId: string): Promise<ActioneerCdpAudience> {
    const body = await this.request<CdpAudienceResponse>(
      `/v1/cohorts/${encodeURIComponent(audienceId)}${query({ appId: this.config.appId })}`,
    );
    const audience = normalizeAudience(body);
    if (!audience) throw new Error("Actioneer CDP did not return a cohort id");
    return audience;
  }

  async getPerson(personId: string): Promise<ActioneerCdpPersonRecord> {
    return this.request<ActioneerCdpPersonRecord>(
      `/v1/persons/${encodeURIComponent(personId)}${query({ appId: this.config.appId })}`,
    );
  }

  async getAudienceMembers(_audienceId: string): Promise<string[]> {
    const encodedAudienceId = encodeURIComponent(_audienceId);
    const members: string[] = [];
    let pageToken: string | undefined;
    const pageSize = String(this.config.pageSize || 500);
    const memberLimit = Math.max(1, this.config.memberLimit || 5000);

    do {
      const body = await this.request<CdpMembersBody>(
        `/v1/cohorts/${encodedAudienceId}/members${query({
          appId: this.config.appId,
          page_size: pageSize,
          page_token: pageToken,
        })}`,
      );
      const page = Array.isArray(body)
        ? body
        : body.members ?? body.personIds ?? body.person_ids ?? [];
      members.push(...page.map(memberId).filter((id): id is string => Boolean(id)));
      pageToken = Array.isArray(body) ? undefined : body.next_page_token ?? undefined;
    } while (pageToken && members.length < memberLimit);

    return members.slice(0, memberLimit);
  }

  async getAudienceMembersPage(input: {
    audienceId: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<ActioneerCdpAudienceMembersPage> {
    const pageSize = Math.max(1, Math.min(input.pageSize || 50, 200));
    const body = await this.request<CdpMembersBody>(
      `/v1/cohorts/${encodeURIComponent(input.audienceId)}/members${query({
        appId: this.config.appId,
        page_size: String(pageSize),
        page_token: input.pageToken,
      })}`,
    );
    const page = Array.isArray(body)
      ? body
      : body.members ?? body.personIds ?? body.person_ids ?? [];
    return {
      members: page.map(memberId).filter((id): id is string => Boolean(id)),
      nextPageToken: Array.isArray(body) ? null : body.next_page_token ?? null,
      pageSize,
    };
  }

  async getActivationProfiles(_personIds: string[]): Promise<ActivationProfile[]> {
    const personIds = _personIds.map((id) => id.trim()).filter(Boolean);
    if (personIds.length === 0) return [];

    const profileRecords = await Promise.all(
      personIds.map((personId) =>
        this.request<ActioneerCdpPersonRecord>(
          `/v1/persons/${encodeURIComponent(personId)}${query({ appId: this.config.appId })}`,
        ).catch((err) => {
          console.warn("[actioneer-cdp] Failed to resolve person", {
            personId,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }),
      ),
    );
    return profileRecords
      .filter((profile): profile is ActioneerCdpPersonRecord => Boolean(profile))
      .map((profile) =>
        normalizeActioneerCdpProfile(profile, {
          sourceId: this.config.tenantId ?? this.config.teamId,
          memberId: profile.personId ?? profile.person_id ?? profile.id ?? profile.uuid,
        }),
      )
      .filter((profile) => profile.personId);
  }

  async getAudienceReadiness(_audienceId: string): Promise<ActivationAudienceReadiness> {
    const [audiences, memberIds] = await Promise.all([
      this.listAudiences(),
      this.getAudienceMembers(_audienceId),
    ]);
    const audience = audiences.find((item) => item.id === _audienceId);
    const profileLimit = Math.max(1, this.config.readinessProfileLimit || 500);
    const sampledMemberIds = memberIds.slice(0, profileLimit);
    const profiles = await this.getActivationProfiles(sampledMemberIds);
    const profilesByPersonId = new Map(profiles.map((profile) => [profile.personId, profile]));
    const orderedProfiles = memberIds
      .map((id) => profilesByPersonId.get(id) ?? profiles.find((profile) => profile.externalUserId === id))
      .filter((profile): profile is ActivationProfile => Boolean(profile))
      .map((profile) => ({
        ...profile,
        source: {
          ...profile.source,
          type: "actioneer_cdp" as const,
          sourceId: this.config.tenantId ?? this.config.teamId,
          audienceId: _audienceId,
        },
      }));

    return summarizeActivationReadiness({
      audienceId: _audienceId,
      audienceName: audience?.name ?? _audienceId,
      sourceType: "actioneer_cdp",
      sourceId: this.config.tenantId ?? this.config.teamId,
      totalMembers: audience?.memberCount ?? memberIds.length,
      profiles: orderedProfiles,
      fieldMapping: {} satisfies ActivationFieldMapping,
    });
  }

  async writeVoiceOutcomeEvent(_event: {
    personId: string;
    campaignId: string;
    callId: string;
    outcome: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const path = this.config.outcomesPath || "/activation/voice-outcomes";
    await this.request(path, {
      method: "POST",
      body: JSON.stringify({
        ..._event,
        teamId: this.config.tenantId ?? this.config.teamId,
        appId: this.config.appId,
      }),
    });
  }

  async testConnection(): Promise<{ ok: boolean; audienceCount?: number; error?: string }> {
    try {
      const audiences = await this.listAudiences();
      return { ok: true, audienceCount: audiences.length };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown CDP connection error",
      };
    }
  }
}
