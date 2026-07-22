#!/usr/bin/env node
// Flat timeline tests (no fold grouping).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    join(dir, "test_group_turns_fold.mjs"),
  ],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
