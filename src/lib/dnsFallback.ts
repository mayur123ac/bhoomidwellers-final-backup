// lib/dnsFallback.ts — resolve database hostnames when the system resolver won't.
//
// ── The problem this solves ─────────────────────────────────────────────────
// On some networks the local resolver refuses `*.aws.neon.tech` outright:
//
//     system getaddrinfo   -> ENOTFOUND
//     dns.resolve4         -> EREFUSED
//     8.8.8.8 / 1.1.1.1    -> 52.220.170.93, 13.228.184.177, 13.228.46.236
//
// The names are fine and the database is up; the machine in front of it simply
// will not answer for them. Node's `net.connect` uses `dns.lookup`, which is
// getaddrinfo — so `dns.setServers()` does NOT help, because that only affects
// `dns.resolve*`. Every query then dies with
// `getaddrinfo ENOTFOUND ep-…-pooler.ap-southeast-1.aws.neon.tech`, which reads
// like an outage and is not one.
//
// ── Why this is a custom lookup and not a connection by IP ──────────────────
// The obvious workaround is to put the IP in DATABASE_URL. Don't: pg only sets
// the TLS servername when the host is *not* an IP —
//
//     if (net.isIP(host) === 0) options.servername = host      (pg/lib/connection.js)
//
// — so an IP host means no SNI, and certificate verification then runs against
// an IP the certificate does not name. The usual "fix" for that is
// `rejectUnauthorized: false`, which turns a DNS problem into an unauthenticated
// TLS connection to a database.
//
// Supplying a custom `lookup` instead keeps the hostname everywhere pg looks at
// it. SNI, certificate verification and sslmode behave exactly as before; the
// only thing that changes is which resolver answers the A query.
//
// ── When it runs ────────────────────────────────────────────────────────────
// The system resolver is always tried first and is used whenever it works, so on
// a normal machine (and in production) this module changes nothing and adds no
// latency. The public resolvers are consulted only after the system lookup has
// already failed.
//
// Configure with DNS_FALLBACK_SERVERS:
//   unset            → 8.8.8.8, 1.1.1.1
//   "1.1.1.1,9.9.9.9"→ those, in order
//   "off"            → disabled; failures surface as the original DNS error
import { Resolver, lookup as systemLookup } from "dns";
import type { LookupAddress } from "dns";

const DEFAULT_SERVERS = ["8.8.8.8", "1.1.1.1"];

function configuredServers(): string[] {
  const raw = (process.env.DNS_FALLBACK_SERVERS ?? "").trim();
  if (raw.toLowerCase() === "off") return [];
  if (!raw) return DEFAULT_SERVERS;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

/** Short-lived cache so a fallback resolve is not repeated per connection. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { addresses: string[]; at: number }>();

let warned = false;

async function resolveViaFallback(hostname: string): Promise<string[]> {
  const cached = cache.get(hostname);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.addresses;

  const servers = configuredServers();
  if (servers.length === 0) throw new Error("DNS fallback disabled");

  let lastErr: unknown;
  for (const server of servers) {
    try {
      const resolver = new Resolver();
      resolver.setServers([server]);
      const addresses = await new Promise<string[]>((resolve, reject) => {
        resolver.resolve4(hostname, (err, addrs) => (err ? reject(err) : resolve(addrs)));
      });
      if (addresses.length > 0) {
        cache.set(hostname, { addresses, at: Date.now() });
        if (!warned) {
          warned = true;
          console.warn(
            `[DB] The system DNS resolver could not resolve ${hostname}; ` +
            `falling back to ${server}. Set DNS_FALLBACK_SERVERS=off to disable.`
          );
        }
        return addresses;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`No fallback resolver could resolve ${hostname}`);
}

/**
 * A `lookup` implementation for `net.connect`, matching Node's signature.
 *
 * Delegates to the system resolver and only takes over when that fails. On
 * fallback failure the ORIGINAL system error is reported, so the message still
 * says ENOTFOUND rather than something about a resolver the caller never
 * configured.
 */
export function lookupWithFallback(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
): void {
  systemLookup(hostname, options, (sysErr: NodeJS.ErrnoException | null, ...rest: any[]) => {
    if (!sysErr) return (callback as any)(null, ...rest);

    resolveViaFallback(hostname).then(
      addresses => {
        // `all: true` expects an array of {address, family}; otherwise the
        // callback takes a single address plus its family.
        if (options && options.all) {
          const all: LookupAddress[] = addresses.map(address => ({ address, family: 4 }));
          callback(null, all as any);
        } else {
          callback(null, addresses[0], 4);
        }
      },
      () => callback(sysErr)
    );
  });
}

/**
 * A `net.Socket` that resolves through {@link lookupWithFallback}.
 *
 * pg calls `stream.connect(port, host)`, which gives no opening to pass lookup
 * options — so the option is injected here instead, by rewriting the positional
 * call into the object form `connect({ port, host, lookup })`.
 */
export function createResolvingSocket() {
  // Required lazily: `net` is a Node built-in and this module is imported by
  // code that Next also traces for the browser bundle.
  const net = require("net") as typeof import("net");

  const socket = new net.Socket();
  const originalConnect = socket.connect.bind(socket);

  (socket as any).connect = function (...args: any[]) {
    const [first, second] = args;
    if (typeof first === "number" && typeof second === "string") {
      const rest = args.slice(2).find(a => typeof a === "function");
      return originalConnect(
        { port: first, host: second, lookup: lookupWithFallback } as any,
        rest as any
      );
    }
    if (first && typeof first === "object") {
      return originalConnect({ lookup: lookupWithFallback, ...first }, ...(args.slice(1) as []));
    }
    return originalConnect(...(args as [any]));
  };

  return socket;
}
