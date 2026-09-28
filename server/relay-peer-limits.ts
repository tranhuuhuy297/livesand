// Connection caps: each socket may buffer one partial message up to its role's maxPayload, so the count bounds memory.
export type RelayRole = 'source' | 'viewer';

export interface RelayLimits {
  /** Source sockets, including replaced ones that are still closing. */
  maxSources: number;
  maxViewers: number;
  /** All sockets from one remote address. */
  maxPerAddress: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = { maxSources: 4, maxViewers: 16, maxPerAddress: 8 };

export class RelayPeerLimits {
  private readonly perAddress = new Map<string, number>();
  private readonly perRole: Record<RelayRole, number> = { source: 0, viewer: 0 };

  constructor(private readonly limits: RelayLimits = DEFAULT_RELAY_LIMITS) {}

  /** Why one more `role` peer from `address` must be refused, or null when it fits. */
  refusal(role: RelayRole, address: string): string | null {
    if ((this.perAddress.get(address) ?? 0) >= this.limits.maxPerAddress) return `too many connections from ${address}`;
    const max = role === 'source' ? this.limits.maxSources : this.limits.maxViewers;
    return this.perRole[role] >= max ? `too many ${role} connections` : null;
  }

  add(role: RelayRole, address: string): void {
    this.perRole[role]++;
    this.perAddress.set(address, (this.perAddress.get(address) ?? 0) + 1);
  }

  remove(role: RelayRole, address: string): void {
    this.perRole[role] = Math.max(0, this.perRole[role] - 1);
    const left = (this.perAddress.get(address) ?? 1) - 1;
    if (left > 0) this.perAddress.set(address, left);
    else this.perAddress.delete(address);
  }
}
