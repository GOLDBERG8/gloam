/**
 * Fetch for agent-named URLs. gloam_fetch_paid requests whatever URL the agent
 * passes, and the agent may be steered by a page it read, so the server refuses
 * to reach loopback, private, link-local or cloud-metadata addresses, including
 * through a redirect. GLOAM_FETCH_ALLOW_PRIVATE=1 lifts this for local testing.
 *
 * For a hostname, the resolved IP is validated and pinned in the connector
 * (guardedAgent), so the IP a fetch connects to is the one that was checked,
 * which closes the DNS-rebinding window.
 */
import { lookup } from "node:dns/promises";
import { lookup as lookupCb } from "node:dns";
import { isIP } from "node:net";
import { Agent, type Dispatcher } from "undici";

const MAX_REDIRECTS = 3;

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/**
 * The 16 bytes of an IPv6 literal, or null when it does not parse. Handles "::"
 * and a dotted IPv4 tail, so every spelling of an address gives the same bytes.
 */
function v6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]!) !== 4) return null;
    const [a, b, c, d] = dotted[2]!.split(".").map(Number) as [number, number, number, number];
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === "" ? [] : h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  let all: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    all = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    if (head.length !== 8) return null;
    all = head;
  }
  return all.flatMap((g) => [g >> 8, g & 0xff]);
}

/**
 * An IPv6 address that reaches this host, a private network or metadata,
 * directly or through an IPv4 address carried inside it (mapped, translated,
 * NAT64, 6to4, Teredo).
 */
function v6Private(b: number[]): boolean {
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4At = (at: number) => v4Private(b.slice(at, at + 4).join("."));
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4At(12); // ::ffff:a.b.c.d, mapped
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && zero(10, 12)) return v4At(12); // ::ffff:0:a.b.c.d, translated
  if (zero(0, 12)) return true; // ::, ::1 and the retired IPv4-compatible ::a.b.c.d
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return zero(4, 12) ? v4At(12) : true; // 64:ff9b::/96 NAT64, and the local-use 64:ff9b:1::/48
  }
  if (b[0] === 0x20 && b[1] === 0x02) return v4At(2); // 2002::/16, 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32, Teredo
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7, unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10, link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true; // fec0::/10, old site-local
  if (b[0] === 0xff) return true; // multicast
  return false;
}

/**
 * Loopback, private, link-local, carrier-grade NAT, metadata, multicast or
 * unspecified. IPv6 is judged on its bytes, not its spelling: "::ffff:7f00:1",
 * "::ffff:127.0.0.1" and "0:0:0:0:0:ffff:7f00:1" are all 127.0.0.1. Anything that
 * is not a well-formed address counts as private, so the guard fails closed.
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  const bytes = v6Bytes(ip);
  return bytes === null ? true : v6Private(bytes);
}

/** Why the server will not fetch this URL, or null when it may. */
export async function publicUrlProblem(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Not a valid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https URLs.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) return `Could not resolve ${host}.`;
  if (addresses.some(isPrivateAddress)) {
    return `${host} points to a private or local address, which this server will not fetch.`;
  }
  return null;
}

/**
 * A dispatcher whose DNS lookup validates every resolved address with
 * isPrivateAddress and refuses if any is private, then pins the connection to the
 * address it checked. The IP a fetch connects to is the IP that was validated, so
 * DNS rebinding cannot swap a public check for a private connect. TLS SNI and
 * certificate validation still use the hostname. Literals never hit DNS and are
 * handled up front by publicUrlProblem.
 */
function guardedAgent(): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, cb) {
        lookupCb(hostname, { all: true, verbatim: true }, (err, addrs) => {
          if (err) return cb(err, "", 0);
          if (!addrs.length) return cb(new Error(`Could not resolve ${hostname}.`), "", 0);
          for (const a of addrs) {
            if (isPrivateAddress(a.address)) {
              return cb(
                new Error(`${hostname} resolves to a private or local address, which this server will not fetch.`),
                "",
                0,
              );
            }
          }
          if ((options as { all?: boolean }).all) return cb(null, addrs);
          cb(null, addrs[0]!.address, addrs[0]!.family);
        });
      },
    },
  });
}

/**
 * fetch that checks every hop (the URL and each redirect): the URL host/literal via
 * publicUrlProblem, and the resolved IP validated + pinned by guardedAgent, which
 * closes the DNS-rebinding window for hostnames.
 */
export function guardedFetch(env: Record<string, string | undefined>): typeof fetch {
  const allowPrivate = env.GLOAM_FETCH_ALLOW_PRIVATE === "1";
  const dispatcher: Dispatcher | undefined = allowPrivate ? undefined : guardedAgent();
  return async (input, init) => {
    let url = input instanceof Request ? input.url : String(input);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!allowPrivate) {
        const problem = await publicUrlProblem(url);
        if (problem) throw new Error(problem);
      }
      const res = await fetch(url, { ...init, redirect: "manual", dispatcher } as RequestInit & {
        dispatcher?: Dispatcher;
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return res;
      url = new URL(location, url).toString();
    }
    throw new Error("Too many redirects.");
  };
}
