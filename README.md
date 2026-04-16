# Blue JS SDK

JavaScript/TypeScript SDK for the [Sentinel](https://sentinel.co) decentralized VPN network. WireGuard + V2Ray tunnels, Cosmos blockchain, 900+ nodes. RPC queries, typed events, CosmJS compatible.

**Also available:** [Blue C# SDK](https://github.com/Sentinel-Autonomybuilder/blue-csharp-sdk) | [Blue Agent Connect](https://github.com/Sentinel-Autonomybuilder/blue-agent-connect) (zero-config wrapper for AI agents)

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **Windows** | **Verified** | Full E2E on mainnet — WireGuard (`wireguard.exe /installtunnelservice`) + V2Ray. Native Windows service management. |
| **macOS** | Untested | Code exists (pfctl kill switch, launchctl tunnel, `wg-quick`). Needs mainnet verification. |
| **Linux** | Untested | Code exists (iptables kill switch, `wg-quick` tunnel). Needs mainnet verification. |

> **Note:** The official JS SDK (`@sentinel-official/sentinel-js-sdk`) does not work on Windows — it uses `wg-quick` (Unix-only) for WireGuard. Blue JS SDK is the only Sentinel JS SDK verified on Windows.
>
> Chain queries, wallet operations, and session management work on all platforms (pure JS). Only tunnel setup (WireGuard/V2Ray binary interaction) is platform-specific.

---

> **For AI agents:** If you just want `connect()` with one function call, use [`blue-agent-connect`](https://www.npmjs.com/package/blue-agent-connect) instead.

## Install

```bash
npm install blue-js-sdk
```

## Quick Start

```javascript
import { connectAuto, disconnect, registerCleanupHandlers } from 'sentinel-dvpn-sdk';

registerCleanupHandlers();

const result = await connectAuto({
  mnemonic: process.env.MNEMONIC,
  serviceType: 'wireguard',
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
});

console.log(`Connected: session ${result.sessionId}, IP changed`);

await disconnect();
```

## For AI Agents

Use [blue-agent-connect](https://www.npmjs.com/package/blue-agent-connect) — a zero-config wrapper with one function call from zero to encrypted tunnel.

## Features

- **WireGuard** kernel-level encrypted tunnels (requires admin)
- **V2Ray** SOCKS5 proxy with transport obfuscation (no admin needed)
- **Split tunneling** — per-app (V2Ray SOCKS5) or per-destination (WireGuard AllowedIPs)
- **276 exports** — wallet, chain, handshake, tunnel, security, pricing, state
- **Cosmos blockchain** — on-chain sessions, P2P token payments
- **4 LCD + 5 RPC failover endpoints** — no single point of failure
- **AES-256-GCM** encrypted credential storage
- **TOFU TLS** certificate pinning
- **Verify-before-capture** — safe WireGuard activation without killing internet

## Security

- All private keys zeroed with `Buffer.fill(0)` after use
- Credentials encrypted at rest (AES-256-GCM)
- File permissions 0o600 on all sensitive files
- See [SECURITY.md](https://github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk/blob/main/SECURITY.md)

## Documentation

Full documentation, protocol specs, and examples at [github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk](https://github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk).

## License

MIT — built on [Sentinel.co](https://sentinel.co)
