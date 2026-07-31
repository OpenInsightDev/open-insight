import { Schema } from "effect";
import validator from "validator";

export const Mode = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("no-network"),
  Schema.Literal("allowlist"),
]);
export type Mode = Schema.Schema.Type<typeof Mode>;

const fqdnOptions = {
  allow_trailing_dot: true,
  allow_wildcard: true,
  require_tld: false,
};

export const isAllowedHost = (value: string): boolean => {
  const host = value.trim();
  if (host.length === 0 || host.includes("[") || host.includes("]")) {
    return false;
  }
  return validator.isIP(host) || validator.isIPRange(host) || validator.isFQDN(host, fqdnOptions);
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
