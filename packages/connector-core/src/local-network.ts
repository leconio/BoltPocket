function normalizedHostname(hostname: string) {
  return hostname
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^\[|\]$/gu, "")
    .replace(/\.+$/gu, "");
}

function ipv4Octets(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) =>
    /^\d{1,3}$/u.test(part) ? Number(part) : Number.NaN,
  );
  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? octets
    : null;
}

function isLocalIpv4(octets: readonly number[]) {
  const [first, second] = octets;
  return (
    (first === 0 && second === 0 && octets[2] === 0 && octets[3] === 0) ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second! >= 64 && second! <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  );
}

function ipv6Words(value: string) {
  const address = value.split("%", 1)[0]!;
  if (!address || !address.includes(":")) return null;

  let hexadecimalAddress = address;
  const lastColon = hexadecimalAddress.lastIndexOf(":");
  const possibleIpv4 = hexadecimalAddress.slice(lastColon + 1);
  if (possibleIpv4.includes(".")) {
    const octets = ipv4Octets(possibleIpv4);
    if (!octets) return null;
    const high = (octets[0]! << 8) | octets[1]!;
    const low = (octets[2]! << 8) | octets[3]!;
    hexadecimalAddress = `${hexadecimalAddress.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const compressed = hexadecimalAddress.split("::");
  if (compressed.length > 2) return null;
  const parseSide = (side: string) => {
    if (!side) return [];
    const words = side.split(":");
    if (
      words.some(
        (word) =>
          !/^[0-9a-f]{1,4}$/iu.test(word) || Number.isNaN(parseInt(word, 16)),
      )
    ) {
      return null;
    }
    return words.map((word) => parseInt(word, 16));
  };
  const left = parseSide(compressed[0]!);
  const right = parseSide(compressed[1] ?? "");
  if (!left || !right) return null;
  if (compressed.length === 1) return left.length === 8 ? left : null;
  const missingWords = 8 - left.length - right.length;
  return missingWords >= 1
    ? [...left, ...Array.from({ length: missingWords }, () => 0), ...right]
    : null;
}

function isLocalIpv6(words: readonly number[]) {
  const loopback =
    words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (loopback) return true;

  const first = words[0]!;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) {
    return true;
  }

  const ipv4Mapped =
    words.slice(0, 5).every((word) => word === 0) &&
    (words[5] === 0 || words[5] === 0xffff);
  if (!ipv4Mapped) return false;
  const high = words[6]!;
  const low = words[7]!;
  return isLocalIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

/**
 * Identifies hostnames whose cleartext traffic is intentionally limited to a
 * local network. Public hostnames and globally routable IP addresses return
 * false so callers can continue requiring TLS for them.
 */
export function isLocalNetworkHostname(hostname: string) {
  const normalized = normalizedHostname(hostname);
  if (!normalized) return false;

  const ipv4 = ipv4Octets(normalized);
  if (ipv4) return isLocalIpv4(ipv4);

  const ipv6 = ipv6Words(normalized);
  if (ipv6) return isLocalIpv6(ipv6);

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".home.arpa")
  ) {
    return true;
  }

  return (
    !normalized.includes(".") &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(normalized)
  );
}

export function isHttpsOrLocalNetworkHttpUrl(url: URL) {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLocalNetworkHostname(url.hostname))
  );
}
