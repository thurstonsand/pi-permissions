# Downgrade pins

`main` plus pins for environments whose registry mirror lags npm. Install with `pi install git:github.com/thurstonsand/pi-permissions@downgrade`; everywhere else use `npm:@thurstonsand/pi-permissions` at latest.

| Package           | Pinned   | `main` wants                                            | Pinned on  | Recheck after |
| ----------------- | -------- | ------------------------------------------------------- | ---------- | ------------- |
| `web-tree-sitter` | `0.26.8` | `^0.27.0`, resolving to `0.27.1`                        | 2026-08-03 | 2026-12-04    |
| `brace-expansion` | `5.0.12` | `^5.0.8` via `minimatch`, resolving to `5.0.12`         | 2026-10-04 | 2026-12-04    |
| `node-addon-api`  | `8.9.1`  | `^8.2.1` via `tree-sitter-bash`, resolving to `8.9.2`   | 2026-10-04 | 2026-12-04    |

`main`'s `web-tree-sitter` range no longer admits `0.26.8`, so `package.json` narrows it to exactly `0.26.8`; the lockfile alone cannot hold this pin.

`brace-expansion` must never be pinned below `5.0.8`. Earlier versions carry GHSA-mh99-v99m-4gvg, and `minimatch` is a runtime dependency here, so a lower pin ships the vulnerable copy.
