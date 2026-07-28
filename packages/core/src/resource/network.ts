import { Option, Schema } from "effect";

export const Mode = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("no-network"),
  Schema.Literal("allowlist"),
]);
export type Mode = Schema.Schema.Type<typeof Mode>;

const HostnameLabel = Schema.String.check(
  Schema.isMaxLength(63),
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i),
);
const isHostnameLabel = Schema.is(HostnameLabel);

const IPv4Text = Schema.String.check(Schema.isPattern(/^\d{1,3}(?:\.\d{1,3}){3}$/));
const isIPv4Text = Schema.is(IPv4Text);

const DottedDecimalText = Schema.String.check(Schema.isPattern(/^\d+(?:\.\d+){3}$/));
const isDottedDecimalText = Schema.is(DottedDecimalText);

const PrefixText = Schema.String.check(Schema.isPattern(/^\d+$/));
const isPrefixText = Schema.is(PrefixText);

const IPv4Prefix = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 32 }),
);
const IPv6Prefix = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 128 }),
);

const decodeUrl = Schema.decodeUnknownOption(Schema.URLFromString);
const decodeIPv4Prefix = Schema.decodeUnknownOption(IPv4Prefix);
const decodeIPv6Prefix = Schema.decodeUnknownOption(IPv6Prefix);

const isHostname = (value: string): boolean => {
  const hostname = value.endsWith(".") ? value.slice(0, -1) : value;
  return (
    hostname.length > 0 && hostname.length <= 253 && hostname.split(".").every(isHostnameLabel)
  );
};

const isIPv4 = (value: string): boolean =>
  isIPv4Text(value) &&
  decodeUrl(`http://${value}`).pipe(Option.exists((url) => url.hostname === value));

const looksLikeIPv4 = (value: string): boolean => isDottedDecimalText(value);

const isIPv6 = (value: string): boolean =>
  value.includes(":") && !value.includes("%") && Option.isSome(decodeUrl(`http://[${value}]`));

const isIpAddress = (value: string): boolean => isIPv4(value) || isIPv6(value);

const isCidr = (value: string): boolean => {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator !== value.lastIndexOf("/")) {
    return false;
  }
  const address = value.slice(0, separator);
  const prefixText = value.slice(separator + 1);
  if (!isPrefixText(prefixText)) {
    return false;
  }
  return isIPv4(address)
    ? Option.isSome(decodeIPv4Prefix(prefixText))
    : isIPv6(address) && Option.isSome(decodeIPv6Prefix(prefixText));
};

export const isAllowedHost = (value: string): boolean => {
  const host = value.trim();
  if (host.length === 0 || host.includes("[") || host.includes("]")) {
    return false;
  }
  if (host.includes("/") && !isCidr(host)) {
    return false;
  }
  if (isCidr(host) || isIpAddress(host)) {
    return true;
  }
  if (looksLikeIPv4(host)) {
    return false;
  }
  if (host.startsWith("*.")) {
    const suffix = host.slice(2);
    return !isIpAddress(suffix) && isHostname(suffix);
  }
  return !host.includes("*") && isHostname(host);
};

export const AllowedHost = Schema.String.check(
  Schema.makeFilter(isAllowedHost, {
    expected:
      "an exact hostname, leading-wildcard hostname, IP address, or CIDR without a URL, port, or path",
  }),
);
export type AllowedHost = Schema.Schema.Type<typeof AllowedHost>;

const PolicyFields = Schema.Struct({
  mode: Mode,
  allowedHosts: Schema.Array(AllowedHost),
}).check(
  Schema.makeFilter(({ mode, allowedHosts }) => mode === "allowlist" || allowedHosts.length === 0, {
    expected: "allowedHosts to be empty unless mode is allowlist",
  }),
);

export class Policy extends Schema.Class<Policy>("NetworkPolicy")(PolicyFields) {}

export const publicAccess = (): Policy => Policy.make({ mode: "public", allowedHosts: [] });
export const noNetwork = (): Policy => Policy.make({ mode: "no-network", allowedHosts: [] });
export const allowlist = (allowedHosts: ReadonlyArray<AllowedHost>): Policy =>
  Policy.make({ mode: "allowlist", allowedHosts });

export const isPublic = (policy: Policy): boolean => policy.mode === "public";
export const isNoNetwork = (policy: Policy): boolean => policy.mode === "no-network";
export const isAllowlist = (policy: Policy): boolean => policy.mode === "allowlist";
