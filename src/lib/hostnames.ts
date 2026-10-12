/** A wildcard hostname (`*.example.com`) names many sites, so there's nothing to open. */
export function isOpenableHostname(hostname: string): boolean {
  return !hostname.includes('*') && hostname.includes('.');
}

export function hostnameUrl(hostname: string): string {
  return `https://${hostname}`;
}
