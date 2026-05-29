#!/usr/bin/env node
/**
 * check-db-ownership.mjs
 *
 * Sprint 0 guardrail: scan TypeScript sources and fail if any file violates
 * the DB ownership rules:
 *
 *   1. Edge apps (api-gateway, socket, sfu) must NOT import
 *      libs/db/src/mongo/model/* or MongodbModule.
 *
 *   2. Shared libs (libs/dto, libs/types) must NOT import
 *      libs/db/src/mongo/model/*.
 *
 *   3. App services may only import models that belong to their owned
 *      *DatabaseModule (plus legacy-allowlisted models with a sprint expiry).
 *
 *   4. No app should import MongodbModule (the legacy global module).
 *
 * Usage:
 *   node scripts/check-db-ownership.mjs
 *   node scripts/check-db-ownership.mjs --edge-only    (only run edge checks)
 *   node scripts/check-db-ownership.mjs --verbose      (print every scanned file)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/**
 * Ownership matrix.
 * `ownedModels` – patterns the service is allowed to import from libs/db/src/mongo/model/.
 * `legacyAllowed` – patterns allowed temporarily with a sprint target for removal.
 */
const OWNERSHIP = {
  auth: {
    ownedModels: ['user.model', 'otp.model', 'keys.model'],
    legacyAllowed: [], // no legacy cross-service reads
  },
  chat: {
    ownedModels: [
      'room.model',
      'room-events.model',
      'rooms-state.model',
      'rooms-users-state.model',
      'messages.model',
      'message-reads.model',
      'message-hides.model',
      'message-reactions.model',
      'friendship.model',
      'call-history.model',
    ],
    legacyAllowed: [
      // Sprint 5 – replace with API gateway -> auth
      { pattern: 'user.model', removeInSprint: 5 },
      { pattern: 'keys.model', removeInSprint: 5 },
      // Sprint 5 – replace with API gateway -> filesystem
      { pattern: 'Attachment.model', removeInSprint: 5 },
      { pattern: 'Document.model', removeInSprint: 5 },
      // Sprint 5 – replace with API gateway -> learning
      { pattern: 'quiz.model', removeInSprint: 5 },
      { pattern: 'todo-project.model', removeInSprint: 5 },
    ],
  },
  filesystem: {
    ownedModels: ['Attachment.model', 'Document.model'],
    legacyAllowed: [
      // Sprint 3 – replace with API gateway -> auth/chat
      { pattern: 'user.model', removeInSprint: 3 },
      { pattern: 'room.model', removeInSprint: 3 },
      { pattern: 'messages.model', removeInSprint: 3 },
    ],
  },
  ai: {
    ownedModels: ['AIEmbedding.model', 'AIUsageLogs.model'],
    legacyAllowed: [
      // Sprint 1 – replace with Kafka payload/snapshot
      { pattern: 'user.model', removeInSprint: 1 },
      { pattern: 'messages.model', removeInSprint: 1 },
      { pattern: 'Attachment.model', removeInSprint: 1 },
      { pattern: 'Document.model', removeInSprint: 1 },
    ],
  },
  learning: {
    ownedModels: [
      'quiz.model',
      'flashcard.model',
      'todo.model',
      'todo-project.model',
    ],
    legacyAllowed: [
      // Sprint 4 – replace with API gateway -> auth/chat
      { pattern: 'user.model', removeInSprint: 4 },
      { pattern: 'messages.model', removeInSprint: 4 },
    ],
  },
  notification: {
    ownedModels: ['notification.model'],
    legacyAllowed: [
      // Sprint 2 – replace with Redis first, then API gateway -> auth fallback
      { pattern: 'keys.model', removeInSprint: 2 },
    ],
  },
};

/** Edge services: must have NO Mongo dependency at all. */
const EDGE_SERVICES = ['api-gateway', 'socket', 'sfu'];

/** Pattern that identifies a Mongo model import path. */
const MONGO_MODEL_RE = /libs\/db\/src\/mongo\/model/;

/** Pattern that identifies MongodbModule import. */
const MONGODB_MODULE_RE = /MongodbModule/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const EDGE_ONLY = args.includes('--edge-only');
const VERBOSE = args.includes('--verbose');

function log(...a) {
  console.log(...a);
}
function verbose(...a) {
  if (VERBOSE) console.log('  [verbose]', ...a);
}

/** Recursively collect *.ts files under a directory. */
function collectTs(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        results.push(...collectTs(fullPath));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist (e.g. scripts dir)
  }
  return results;
}

/** Extract all import/from strings from a file's content. */
function extractImports(content) {
  const importRe = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  const results = [];
  let m;
  while ((m = importRe.exec(content)) !== null) {
    results.push(m[1]);
  }
  return results;
}

/** Check if a model import path is in an allowed list. */
function isModelAllowed(importPath, allowedPatterns) {
  return allowedPatterns.some((p) => importPath.includes(p));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let violations = 0;
let warnings = 0;

function reportViolation(file, message) {
  console.error(`  ✗ VIOLATION  ${relative(ROOT, file)}`);
  console.error(`               ${message}`);
  violations++;
}

function reportWarning(file, message) {
  console.warn(`  ⚠ WARNING    ${relative(ROOT, file)}`);
  console.warn(`               ${message}`);
  warnings++;
}

// ── 1. Edge services: no Mongo model or MongodbModule imports ─────────────────
log('\n🔍 Checking edge services (api-gateway, socket, sfu)...');

for (const edgeApp of EDGE_SERVICES) {
  const appDir = join(ROOT, 'apps', edgeApp, 'src');
  const files = collectTs(appDir);
  for (const file of files) {
    verbose(file);
    const content = readFileSync(file, 'utf8');
    const imports = extractImports(content);
    for (const imp of imports) {
      if (MONGO_MODEL_RE.test(imp)) {
        reportViolation(file, `Edge app '${edgeApp}' must NOT import Mongo model: ${imp}`);
      }
      if (MONGODB_MODULE_RE.test(imp) && imp.includes('libs/db')) {
        reportViolation(file, `Edge app '${edgeApp}' must NOT import MongodbModule`);
      }
    }
  }
}

if (!EDGE_ONLY) {
  // ── 2. Shared libs: no Mongo model imports ─────────────────────────────────
  log('\n🔍 Checking shared libs (libs/dto, libs/types)...');

  for (const sharedLib of ['libs/dto/src', 'libs/types/src']) {
    const libDir = join(ROOT, sharedLib);
    const files = collectTs(libDir);
    for (const file of files) {
      verbose(file);
      const content = readFileSync(file, 'utf8');
      const imports = extractImports(content);
      for (const imp of imports) {
        if (MONGO_MODEL_RE.test(imp)) {
          reportViolation(file, `Shared lib must NOT import Mongo model: ${imp}`);
        }
      }
    }
  }

  // ── 3. Service apps: only owned models + legacy allowlist ──────────────────
  log('\n🔍 Checking service apps for model ownership...');

  for (const [service, { ownedModels, legacyAllowed }] of Object.entries(OWNERSHIP)) {
    const appDir = join(ROOT, 'apps', service, 'src');
    const files = collectTs(appDir);

    for (const file of files) {
      verbose(file);
      const content = readFileSync(file, 'utf8');
      const imports = extractImports(content);

      for (const imp of imports) {
        // Check for MongodbModule usage
        if (MONGODB_MODULE_RE.test(content) && imp.includes('MongodbModule')) {
          reportViolation(file, `Service '${service}' must NOT import MongodbModule. Use ${service.charAt(0).toUpperCase() + service.slice(1)}DatabaseModule instead.`);
          continue;
        }

        if (!MONGO_MODEL_RE.test(imp)) continue;

        // Extract the model file name from path (e.g. "user.model" from ".../user.model")
        const modelFile = imp.split('/').pop() || '';

        const isOwned = isModelAllowed(modelFile, ownedModels);
        const legacyEntry = legacyAllowed.find((l) => modelFile.includes(l.pattern));

        if (isOwned) {
          // OK — owned model
          continue;
        } else if (legacyEntry) {
          // Warning — legacy allowed but tracked for removal
          reportWarning(
            file,
            `Legacy cross-service model import in '${service}': ${imp} → Remove in Sprint ${legacyEntry.removeInSprint}`,
          );
        } else {
          // Violation — not owned and not in legacy allowlist
          reportViolation(
            file,
            `Service '${service}' imports model outside its ownership: ${imp}`,
          );
        }
      }
    }
  }

  // ── 4. Any app using MongodbModule ─────────────────────────────────────────
  log('\n🔍 Checking for MongodbModule usage across all apps...');

  const allApps = readdirSync(join(ROOT, 'apps'));
  for (const app of allApps) {
    const appDir = join(ROOT, 'apps', app, 'src');
    const files = collectTs(appDir);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const imports = extractImports(content);
      for (const imp of imports) {
        if (imp.includes('MongodbModule') || (imp.includes('libs/db') && content.includes('MongodbModule'))) {
          if (content.match(/import\s*\{[^}]*MongodbModule[^}]*\}\s*from/)) {
            reportViolation(file, `App '${app}' must NOT import MongodbModule (legacy deprecated). Use *DatabaseModule instead.`);
          }
        }
      }
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

log('\n' + '─'.repeat(60));
if (violations > 0) {
  console.error(`\n❌ check:db-ownership FAILED — ${violations} violation(s), ${warnings} warning(s)\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`\n⚠️  check:db-ownership PASSED with ${warnings} legacy warning(s) (tracked for future sprints)\n`);
  process.exit(0);
} else {
  log('\n✅ check:db-ownership PASSED — no violations found\n');
  process.exit(0);
}
