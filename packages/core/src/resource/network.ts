import { Schema } from "effect";
import ipaddr from "ipaddr.js";

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

const DottedDecimalText = Schema.String.check(Schema.isPattern(/^\d+(?:\.\d+){3}$/));
const isDottedDecimalText = Schema.is(DottedDecimalText);

const isHostname = (value: string): boolean => {
  const hostname = value.endsWith(".") ? value.slice(0, -1) : value;
  return (
    hostname.length > 0 && hostname.length <= 253 && hostname.split(".").every(isHostnameLabel)
  );
};

const isIPv4 = (value: string): boolean => ipaddr.IPv4.isValidFourPartDecimal(value);

const looksLikeIPv4 = (value: string): boolean => isDottedDecimalText(value);

const isIPv6 = (value: string): boolean => !value.includes("%") && ipaddr.IPv6.isValid(value);

const isIpAddress = (value: string): boolean => isIPv4(value) || isIPv6(value);

const isIPv4Cidr = (value: string): boolean => {
  if (!ipaddr.IPv4.isValidCIDRFourPartDecimal(value)) {
    return false;
  }
  const [address] = ipaddr.IPv4.parseCIDR(value);
  return address.toString() === ipaddr.IPv4.networkAddressFromCIDR(value).toString();
};

const isIPv6Cidr = (value: string): boolean => {
  if (value.includes("%") || !ipaddr.IPv6.isValidCIDR(value)) {
    return false;
  }
  const [address] = ipaddr.IPv6.parseCIDR(value);
  return address.toString() === ipaddr.IPv6.networkAddressFromCIDR(value).toString();
};

const isCidr = (value: string): boolean => isIPv4Cidr(value) || isIPv6Cidr(value);

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
