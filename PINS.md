# Downgrade pins

`main` plus pins for environments whose registry mirror lags npm. Install with `pi install git:github.com/thurstonsand/pi-permissions@downgrade`; everywhere else use `npm:@thurstonsand/pi-permissions` at latest.

| Package           | Pinned   | `main` wants                      | Pinned on  | Recheck after |
| ----------------- | -------- | --------------------------------- | ---------- | ------------- |
| `web-tree-sitter` | `0.26.8` | `^0.26.8`, resolving to `0.26.11` | 2026-08-03 | 2026-10-03    |
| `brace-expansion` | `5.0.8`  | `5.0.9`, via `minimatch`          | 2026-08-03 | 2026-10-03    |
| `node-addon-api`  | `8.8.0`  | `8.9.1`, via `tree-sitter-bash`   | 2026-08-03 | 2026-10-03    |

`brace-expansion` must never be pinned below `5.0.8`. Earlier versions carry GHSA-mh99-v99m-4gvg, and `minimatch` is a runtime dependency here, so a lower pin ships the vulnerable copy.
