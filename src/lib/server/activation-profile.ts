import type {
  ActivationAudienceReadiness,
  ActivationAudienceSourceType,
  ActivationFieldMapping,
  ActivationProfile,
  ActivationProfileReadiness,
  ActivationReadinessStatus,
  ActivationSourceRef,
} from "@/lib/activation-audience-types";

type Row = Record<string, unknown>;

const DEFAULT_COUNTRY_CODE = "+91";

const ENTITY_ID_FIELDS = [
  "person_id",
  "user_id",
  "customer_id",
  "investor_id",
  "member_id",
  "profile_id",
  "distinct_id",
  "external_id",
  "external_user_id",
  "_id",
  "id",
];
const NAME_FIELDS = ["name", "full_name", "customer_name", "investor_name", "user_name", "display_name"];
const PHONE_FIELDS = ["phone_e164", "phone_number", "mobile_number", "mobile", "phone", "contact_number", "msisdn"];
const COUNTRY_CODE_FIELDS = ["country_code", "countryCode", "dial_code", "dialCode", "isd_code", "isdCode"];
const EMAIL_FIELDS = ["email", "email_address", "customer_email"];
const CONSENT_FIELDS = ["call_consent", "voice_consent", "phone_consent", "consent", "has_consent", "opted_in"];
const OPT_OUT_FIELDS = ["opted_out", "optedOut", "do_not_call", "doNotCall", "has_opted_out"];
const DND_FIELDS = ["dnd", "dnd_status", "do_not_disturb", "doNotDisturb"];
const DELETED_FIELDS = ["hasRequestedDeletion", "has_requested_deletion", "deleted", "is_deleted", "deletion_requested"];
const LANGUAGE_FIELDS = ["preferred_language", "preferredLanguage", "language", "locale"];
const TIMEZONE_FIELDS = ["timezone", "time_zone", "tz"];
const ROLE_FIELDS = ["role", "user_role", "customer_role"];
const PLATFORM_FIELDS = ["platform", "device_platform", "os"];

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function keyLookup(columns: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of columns) {
    map.set(column.toLowerCase(), column);
    map.set(normalizeKey(column), column);
  }
  return map;
}

function findField(columns: string[], candidates: string[]): string | undefined {
  const lookup = keyLookup(columns);
  for (const candidate of candidates) {
    const exact = lookup.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const normalized = lookup.get(normalizeKey(candidate));
    if (normalized) return normalized;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function rowText(row: Row, key: string | undefined): string | undefined {
  return key ? text(row[key]) : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const normalized = text(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "y", "consent", "consented", "opted_in", "opt-in"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "none", "denied", "opted_out", "opt-out"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function firstNameFrom(name: string | undefined): string | undefined {
  return name?.split(/\s+/)[0]?.trim() || undefined;
}

function normalizeCountryCode(countryCode: string | undefined, fallback = DEFAULT_COUNTRY_CODE): string | undefined {
  const raw = countryCode?.trim() || fallback;
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : undefined;
}

export function normalizeActivationPhone(
  rawPhone: string | undefined,
  countryCode?: string,
  defaultCountryCode = DEFAULT_COUNTRY_CODE,
): string | undefined {
  const raw = rawPhone?.trim();
  if (!raw) return undefined;

  if (/^\+\d{8,15}$/.test(raw.replace(/[^\d+]/g, ""))) {
    return raw.replace(/[^\d+]/g, "");
  }

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) {
    const cc = normalizeCountryCode(countryCode, defaultCountryCode);
    return cc ? `${cc}${digits}` : undefined;
  }
  return undefined;
}

function stripMappedAttributes(row: Row, mapping: ActivationFieldMapping): Row {
  const mapped = new Set(Object.values(mapping).filter((value): value is string => Boolean(value)));
  const attributes: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (mapped.has(key)) continue;
    attributes[key] = value;
  }
  return attributes;
}

export function inferActivationFieldMapping(
  columns: string[],
  overrides: Partial<ActivationFieldMapping> = {},
): ActivationFieldMapping {
  return {
    entityId: overrides.entityId || findField(columns, ENTITY_ID_FIELDS),
    name: overrides.name || findField(columns, NAME_FIELDS),
    phone: overrides.phone || findField(columns, PHONE_FIELDS),
    countryCode: overrides.countryCode || findField(columns, COUNTRY_CODE_FIELDS),
    email: overrides.email || findField(columns, EMAIL_FIELDS),
    consent: overrides.consent || findField(columns, CONSENT_FIELDS),
    optedOut: overrides.optedOut || findField(columns, OPT_OUT_FIELDS),
    dnd: overrides.dnd || findField(columns, DND_FIELDS),
    deleted: overrides.deleted || findField(columns, DELETED_FIELDS),
    language: overrides.language || findField(columns, LANGUAGE_FIELDS),
    timezone: overrides.timezone || findField(columns, TIMEZONE_FIELDS),
    role: overrides.role || findField(columns, ROLE_FIELDS),
    platform: overrides.platform || findField(columns, PLATFORM_FIELDS),
  };
}

export function activationProfileFromDatasetRow({
  row,
  mapping,
  source,
  defaultCountryCode = DEFAULT_COUNTRY_CODE,
}: {
  row: Row;
  mapping: ActivationFieldMapping;
  source: ActivationSourceRef;
  defaultCountryCode?: string;
}): ActivationProfile {
  const externalUserId = rowText(row, mapping.entityId);
  const name = rowText(row, mapping.name);
  const phoneRaw = rowText(row, mapping.phone);
  const countryCode = rowText(row, mapping.countryCode);
  const phone = normalizeActivationPhone(phoneRaw, countryCode, defaultCountryCode);
  const callConsent = boolValue(mapping.consent ? row[mapping.consent] : undefined);
  const optedOut = boolValue(mapping.optedOut ? row[mapping.optedOut] : undefined);
  const dnd = boolValue(mapping.dnd ? row[mapping.dnd] : undefined);
  const deleted = boolValue(mapping.deleted ? row[mapping.deleted] : undefined);
  const personId = externalUserId || source.memberId || phone || `row:${JSON.stringify(row).slice(0, 80)}`;

  return {
    personId,
    externalUserId,
    name,
    firstName: firstNameFrom(name),
    phone,
    phoneRaw,
    email: rowText(row, mapping.email),
    preferredLanguage: rowText(row, mapping.language),
    timezone: rowText(row, mapping.timezone),
    role: rowText(row, mapping.role),
    platform: rowText(row, mapping.platform),
    suppression: {
      callConsent,
      optedOut,
      dnd,
      deleted,
    },
    attributes: stripMappedAttributes(row, mapping),
    source,
  };
}

export interface ActioneerCdpPersonRecord {
  id?: string;
  personId?: string;
  person_id?: string;
  uuid?: string;
  properties?: Row;
  firstSeenAt?: string;
  created_at?: string;
  identified?: boolean;
  is_identified?: boolean;
}

export function activationProfileFromCdpPerson(
  person: ActioneerCdpPersonRecord,
  source: Partial<ActivationSourceRef> = {},
): ActivationProfile {
  const properties = person.properties ?? {};
  const mapping = inferActivationFieldMapping(Object.keys(properties), {
    entityId: findField(Object.keys(properties), ["id", "_id", "user_id", "customer_id"]),
  });
  const personId = person.personId || person.person_id || person.id || person.uuid || rowText(properties, mapping.entityId) || "";
  const base = activationProfileFromDatasetRow({
    row: properties,
    mapping,
    source: {
      type: "actioneer_cdp",
      sourceId: source.sourceId,
      audienceId: source.audienceId,
      memberId: source.memberId ?? personId,
    },
  });

  return {
    ...base,
    personId: personId || base.personId,
    externalUserId: rowText(properties, "id") || rowText(properties, "_id") || base.externalUserId,
    attributes: {
      ...base.attributes,
      ...(person.firstSeenAt || person.created_at ? { firstSeenAt: person.firstSeenAt ?? person.created_at } : {}),
      ...(person.identified !== undefined || person.is_identified !== undefined
        ? { identified: person.identified ?? person.is_identified }
        : {}),
    },
  };
}

export function evaluateActivationProfile(profile: ActivationProfile): ActivationProfileReadiness {
  const reasons: string[] = [];
  const suppression = profile.suppression;

  if (suppression.deleted) reasons.push("deleted_or_deletion_requested");
  if (suppression.optedOut) reasons.push("opted_out");
  if (suppression.dnd) reasons.push("dnd");

  if (reasons.length > 0) {
    return { profile, status: "suppressed", voiceReady: false, reasons };
  }

  if (suppression.callConsent === false) {
    return { profile, status: "no_consent", voiceReady: false, reasons: ["call_consent_false"] };
  }

  if (!profile.phoneRaw && !profile.phone) {
    return { profile, status: "missing_phone", voiceReady: false, reasons: ["missing_phone"] };
  }

  if (!profile.phone) {
    return { profile, status: "invalid_phone", voiceReady: false, reasons: ["invalid_phone"] };
  }

  return { profile, status: "ready", voiceReady: true, reasons: [] };
}

export function summarizeActivationReadiness({
  audienceId,
  audienceName,
  sourceType,
  sourceId,
  totalMembers,
  profiles,
  fieldMapping,
}: {
  audienceId: string;
  audienceName: string;
  sourceType: ActivationAudienceSourceType;
  sourceId?: string;
  totalMembers: number;
  profiles: ActivationProfile[];
  fieldMapping: ActivationFieldMapping;
}): ActivationAudienceReadiness {
  const evaluated = profiles.map(evaluateActivationProfile);
  const count = (status: ActivationReadinessStatus) =>
    evaluated.filter((item) => item.status === status).length;

  return {
    audienceId,
    audienceName,
    sourceType,
    sourceId,
    totalMembers,
    evaluatedMembers: evaluated.length,
    readyCount: count("ready"),
    missingPhoneCount: count("missing_phone"),
    invalidPhoneCount: count("invalid_phone"),
    suppressedCount: count("suppressed"),
    noConsentCount: count("no_consent"),
    phoneNumbers: evaluated
      .filter((item) => item.voiceReady && item.profile.phone)
      .map((item) => item.profile.phone!),
    fieldMapping,
    profiles: evaluated,
    generatedAt: new Date().toISOString(),
  };
}
