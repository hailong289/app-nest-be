#!/usr/bin/env node
/**
 * Sprint 0 DB ownership guardrail.
 *
 * Checks:
 *   1. Edge apps (api-gateway, socket, sfu) do not import Mongo models or the
 *      DB barrel (`libs/db/src`), which would pull model exports into edge code.
 *   2. Shared libs (libs/dto, libs/types) do not import Mongo models.
 *   3. Service apps only import owned Mongo models or legacy allowlisted models.
 *   4. No app imports legacy MongodbModule.
 *   5. Tracked env examples use the correct DB ownership convention.
 *   6. Direct cross-service gRPC clients are surfaced as legacy warnings
 *      unless --strict-grpc is supplied.
 *
 * Usage:
 *   node scripts/check-db-ownership.mjs
 *   node scripts/check-db-ownership.mjs --edge-only
 *   node scripts/check-db-ownership.mjs --env-only
 *   node scripts/check-db-ownership.mjs --grpc-only
 *   node scripts/check-db-ownership.mjs --grpc-only --strict-grpc
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const EDGE_ONLY = args.includes('--edge-only');
const ENV_ONLY = args.includes('--env-only');
const GRPC_ONLY = args.includes('--grpc-only');
const STRICT_GRPC = args.includes('--strict-grpc');
const VERBOSE = args.includes('--verbose');

const OWNERSHIP = {
  auth: {
    dbName: 'appchat_auth',
    ownedModels: ['user.model', 'otp.model', 'keys.model'],
    legacyAllowed: [],
  },
  chat: {
    dbName: 'appchat_chat',
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
      { pattern: 'user.model', removeInSprint: 5 },
      { pattern: 'keys.model', removeInSprint: 5 },
      { pattern: 'Attachment.model', removeInSprint: 5 },
      { pattern: 'Document.model', removeInSprint: 5 },
      { pattern: 'quiz.model', removeInSprint: 5 },
      { pattern: 'todo-project.model', removeInSprint: 5 },
    ],
  },
  filesystem: {
    dbName: 'appchat_filesystem',
    ownedModels: ['Attachment.model', 'Document.model'],
    legacyAllowed: [
      { pattern: 'user.model', removeInSprint: 3 },
      { pattern: 'room.model', removeInSprint: 3 },
      { pattern: 'messages.model', removeInSprint: 3 },
    ],
  },
  ai: {
    dbName: 'appchat_ai',
    ownedModels: ['AIEmbedding.model', 'AIUsageLogs.model'],
    legacyAllowed: [
      { pattern: 'user.model', removeInSprint: 1 },
      { pattern: 'messages.model', removeInSprint: 1 },
      { pattern: 'Attachment.model', removeInSprint: 1 },
      { pattern: 'Document.model', removeInSprint: 1 },
    ],
  },
  learning: {
    dbName: 'appchat_learning',
    ownedModels: [
      'quiz.model',
      'flashcard.model',
      'todo.model',
      'todo-project.model',
    ],
    legacyAllowed: [
      { pattern: 'user.model', removeInSprint: 4 },
      { pattern: 'messages.model', removeInSprint: 4 },
    ],
  },
  notification: {
    dbName: 'appchat_notification',
    ownedModels: ['notification.model'],
    legacyAllowed: [{ pattern: 'keys.model', removeInSprint: 2 }],
  },
};

const EDGE_SERVICES = ['api-gateway', 'socket', 'sfu'];
const SHARED_LIB_DIRS = ['libs/dto/src', 'libs/types/src'];
const DB_BARREL_IMPORTS = new Set(['libs/db/src', 'libs/db/src/index']);
const MONGO_MODEL_RE = /libs\/db\/src\/mongo\/model/;
const MONGODB_MODULE_RE = /(?:^|\/)mongodb\.module$/;
const ENV_DB_KEYS = ['DB_NAME', 'DB_HOST', 'DB_USER', 'DB_PASSWORD'];
const SOCKET_LEGACY_GRPC_EXPIRY = 7;
const DOMAIN_GRPC_SERVICES = new Set([
  'AUTH',
  'CHAT',
  'FILESYSTEM',
  'AI',
  'NOTIFICATION',
  'LEARNING',
]);

const BARREL_MODEL_EXPORTS = new Map(
  Object.entries({
    // auth
    User: 'user.model',
    UserSchema: 'user.model',
    userModel: 'user.model',
    UserDocument: 'user.model',
    Key: 'keys.model',
    KeySchema: 'keys.model',
    keysModel: 'keys.model',
    KeyDocument: 'keys.model',
    Otp: 'otp.model',
    otpModel: 'otp.model',
    OtpDocument: 'otp.model',

    // chat
    Room: 'room.model',
    RoomSchema: 'room.model',
    Member: 'room.model',
    MemberSchema: 'room.model',
    roomModel: 'room.model',
    RoomDocument: 'room.model',
    RoomType: 'room.model',
    roleMember: 'room.model',
    memberType: 'room.model',
    RoomEvent: 'room-events.model',
    RoomEventSchema: 'room-events.model',
    roomEventsModel: 'room-events.model',
    EventRoomType: 'room-events.model',
    RoomsState: 'rooms-state.model',
    RoomsStateSchema: 'rooms-state.model',
    roomsStateModel: 'rooms-state.model',
    RoomsStateDocument: 'rooms-state.model',
    RoomsUsersState: 'rooms-users-state.model',
    RoomsUsersStateSchema: 'rooms-users-state.model',
    roomsUsersStateModel: 'rooms-users-state.model',
    RoomsUsersStateDocument: 'rooms-users-state.model',
    Message: 'messages.model',
    MessageSchema: 'messages.model',
    messagesModel: 'messages.model',
    MessageDocument: 'messages.model',
    MsgType: 'messages.model',
    MessageRead: 'message-reads.model',
    MessageReadSchema: 'message-reads.model',
    messageReadsModel: 'message-reads.model',
    MessageReadDocument: 'message-reads.model',
    MessageReaction: 'message-reactions.model',
    MessageReactionSchema: 'message-reactions.model',
    messageReactionsModel: 'message-reactions.model',
    MessageReactionDocument: 'message-reactions.model',
    MessageHide: 'message-hides.model',
    MessageHideSchema: 'message-hides.model',
    messageHidesModel: 'message-hides.model',
    MessageHideDocument: 'message-hides.model',
    Friendship: 'friendship.model',
    friendshipModel: 'friendship.model',
    friendship: 'friendship.model',
    CallHistory: 'call-history.model',
    CallHistorySchema: 'call-history.model',
    callHistoryModel: 'call-history.model',
    CallHistoryDocument: 'call-history.model',
    CallType: 'call-history.model',
    CallStatus: 'call-history.model',

    // filesystem
    Attachment: 'Attachment.model',
    AttachmentSchema: 'Attachment.model',
    AttachmentKindEnum: 'Attachment.model',
    AttachmentContextEnumType: 'Attachment.model',
    attachmentModel: 'Attachment.model',
    AttachmentKind: 'Attachment.model',
    AttachmentStatus: 'Attachment.model',
    Document: 'Document.model',
    DocumentSchema: 'Document.model',
    DocVisibilityEnum: 'Document.model',
    sharedWithRoleEnum: 'Document.model',
    documentModel: 'Document.model',
    DocumentDocuments: 'Document.model',
    DocVisibility: 'Document.model',
    sharedWithRoleType: 'Document.model',

    // ai
    AIEmbedding: 'AIEmbedding.model',
    aIEmbeddingModel: 'AIEmbedding.model',
    AIEmbeddingDocument: 'AIEmbedding.model',
    AIEmbeddingContextType: 'AIEmbedding.model',
    AIUsageLogs: 'AIUsageLogs.model',
    aIUsageLogModel: 'AIUsageLogs.model',
    AIUsageLogsDocument: 'AIUsageLogs.model',

    // learning
    Quiz: 'quiz.model',
    QuizSchema: 'quiz.model',
    Question: 'quiz.model',
    QuestionSchema: 'quiz.model',
    Answer: 'quiz.model',
    AnswerSchema: 'quiz.model',
    UserAnswer: 'quiz.model',
    UserAnswerSchema: 'quiz.model',
    QuizResult: 'quiz.model',
    QuizResultSchema: 'quiz.model',
    quizModel: 'quiz.model',
    QuizDocument: 'quiz.model',
    QuizResultDocument: 'quiz.model',
    QuizStatus: 'quiz.model',
    QuestionType: 'quiz.model',
    Flashcard: 'flashcard.model',
    FlashcardSchema: 'flashcard.model',
    FlashcardDeck: 'flashcard.model',
    FlashcardDeckSchema: 'flashcard.model',
    FlashcardProgress: 'flashcard.model',
    FlashcardProgressSchema: 'flashcard.model',
    flashcardModel: 'flashcard.model',
    flashcardDeckModel: 'flashcard.model',
    FlashcardDocument: 'flashcard.model',
    FlashcardDeckDocument: 'flashcard.model',
    FlashcardProgressDocument: 'flashcard.model',
    todoModel: 'todo.model',
    Todo: 'todo.model',
    TodoDocument: 'todo.model',
    TodoStatus: 'todo.model',
    TodoPriority: 'todo.model',
    DEFAULT_TODO_STATUSES: 'todo.model',
    todoProjectModel: 'todo-project.model',
    TodoProject: 'todo-project.model',
    TodoProjectDocument: 'todo-project.model',

    // notification
    Notification: 'notification.model',
    NotificationSchema: 'notification.model',
    notificationModel: 'notification.model',
    NotificationDocument: 'notification.model',
    NotificationType: 'notification.model',
  }),
);

let violations = 0;
let warnings = 0;

function log(...values) {
  console.log(...values);
}

function verbose(...values) {
  if (VERBOSE) console.log('  [verbose]', ...values);
}

function reportViolation(file, message) {
  const label = file ? relative(ROOT, file) : 'workspace';
  console.error(`  x VIOLATION  ${label}`);
  console.error(`               ${message}`);
  violations++;
}

function reportWarning(file, message) {
  const label = file ? relative(ROOT, file) : 'workspace';
  console.warn(`  ! WARNING    ${label}`);
  console.warn(`               ${message}`);
  warnings++;
}

function collectTs(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...collectTs(fullPath));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function allAppNames() {
  return readdirSync(join(ROOT, 'apps')).filter((entry) =>
    statSync(join(ROOT, 'apps', entry)).isDirectory(),
  );
}

function normalizeSpecifier(raw) {
  return raw
    .trim()
    .replace(/^type\s+/, '')
    .split(/\s+as\s+/)[0]
    .trim();
}

function extractImports(content) {
  const imports = [];
  const importRe =
    /import\s+(type\s+)?(?:(\*\s+as\s+\w+)|([\w$]+)\s*,\s*)?(?:\{([^}]+)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRe.exec(content)) !== null) {
    const [, typeKeyword, namespaceImport, defaultImport, namedBlock, source] =
      match;
    const specifiers = [];
    if (namespaceImport) specifiers.push('*');
    if (defaultImport) specifiers.push(normalizeSpecifier(defaultImport));
    if (namedBlock) {
      for (const part of namedBlock.split(',')) {
        const specifier = normalizeSpecifier(part);
        if (specifier) specifiers.push(specifier);
      }
    }
    imports.push({
      source,
      specifiers,
      typeOnly: Boolean(typeKeyword),
    });
  }
  return imports;
}

function directModelFile(source) {
  if (!MONGO_MODEL_RE.test(source)) return null;
  return source.split('/').pop() || null;
}

function modelRefsFromImport(imp) {
  const direct = directModelFile(imp.source);
  if (direct) {
    return [
      {
        modelFile: direct,
        source: imp.source,
        via: 'direct',
      },
    ];
  }

  if (!DB_BARREL_IMPORTS.has(imp.source)) return [];

  const refs = [];
  for (const specifier of imp.specifiers) {
    const modelFile = BARREL_MODEL_EXPORTS.get(specifier);
    if (!modelFile) continue;
    refs.push({
      modelFile,
      source: imp.source,
      exportName: specifier,
      via: 'barrel',
    });
  }
  return refs;
}

function isModelAllowed(modelFile, allowedPatterns) {
  return allowedPatterns.some((pattern) => modelFile.includes(pattern));
}

function checkMongodbModuleImport(file, content, imports, app) {
  for (const imp of imports) {
    const importsMongodbModule =
      MONGODB_MODULE_RE.test(imp.source) ||
      imp.specifiers.includes('MongodbModule') ||
      /import\s*\{[^}]*MongodbModule[^}]*\}\s*from/.test(content);
    if (importsMongodbModule) {
      reportViolation(
        file,
        `App '${app}' must not import MongodbModule. Use the service-owned *DatabaseModule instead.`,
      );
    }
  }
}

function checkEdgeImports() {
  log('\nChecking edge services (api-gateway, socket, sfu)...');
  for (const app of EDGE_SERVICES) {
    const files = collectTs(join(ROOT, 'apps', app, 'src'));
    for (const file of files) {
      verbose(file);
      const content = readFileSync(file, 'utf8');
      const imports = extractImports(content);
      checkMongodbModuleImport(file, content, imports, app);
      for (const imp of imports) {
        if (DB_BARREL_IMPORTS.has(imp.source)) {
          reportViolation(
            file,
            `Edge app '${app}' must not import the DB barrel '${imp.source}'. Import Redis/Bull/config subpaths or shared libs instead.`,
          );
        }
        for (const ref of modelRefsFromImport(imp)) {
          reportViolation(
            file,
            `Edge app '${app}' must not import Mongo model '${ref.modelFile}' from ${ref.source}.`,
          );
        }
      }
    }
  }
}

function checkSharedLibImports() {
  log('\nChecking shared libs (libs/dto, libs/types)...');
  for (const sharedDir of SHARED_LIB_DIRS) {
    const files = collectTs(join(ROOT, sharedDir));
    for (const file of files) {
      verbose(file);
      const content = readFileSync(file, 'utf8');
      const imports = extractImports(content);
      for (const imp of imports) {
        for (const ref of modelRefsFromImport(imp)) {
          reportViolation(
            file,
            `Shared lib must not import Mongo model '${ref.modelFile}' from ${ref.source}. Move the contract type to libs/types.`,
          );
        }
      }
    }
  }
}

function checkServiceModelImports() {
  log('\nChecking service apps for model ownership...');
  for (const [service, { ownedModels, legacyAllowed }] of Object.entries(
    OWNERSHIP,
  )) {
    const files = collectTs(join(ROOT, 'apps', service, 'src'));
    for (const file of files) {
      verbose(file);
      const content = readFileSync(file, 'utf8');
      const imports = extractImports(content);
      checkMongodbModuleImport(file, content, imports, service);
      for (const imp of imports) {
        for (const ref of modelRefsFromImport(imp)) {
          const isOwned = isModelAllowed(ref.modelFile, ownedModels);
          const legacy = legacyAllowed.find((entry) =>
            ref.modelFile.includes(entry.pattern),
          );
          if (isOwned) continue;
          if (legacy) {
            reportWarning(
              file,
              `Legacy cross-service model import in '${service}': ${ref.exportName || ref.modelFile} from ${ref.source}; remove in Sprint ${legacy.removeInSprint}.`,
            );
            continue;
          }
          reportViolation(
            file,
            `Service '${service}' imports Mongo model outside ownership: ${ref.exportName || ref.modelFile} from ${ref.source}.`,
          );
        }
      }
    }
  }

  log('\nChecking for MongodbModule usage across all apps...');
  for (const app of allAppNames()) {
    const files = collectTs(join(ROOT, 'apps', app, 'src'));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      checkMongodbModuleImport(file, content, extractImports(content), app);
    }
  }
}

function parseEnv(file) {
  const values = new Map();
  if (!existsSync(file)) return values;
  const content = readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    values.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''));
  }
  return values;
}

function checkEnvExamples() {
  log('\nChecking env examples...');

  for (const [service, { dbName }] of Object.entries(OWNERSHIP)) {
    const file = join(ROOT, 'apps', service, '.env.example');
    if (!existsSync(file)) {
      reportViolation(file, `Missing apps/${service}/.env.example.`);
      continue;
    }
    const env = parseEnv(file);
    const actual = env.get('DB_NAME');
    if (actual !== dbName) {
      reportViolation(
        file,
        `Expected DB_NAME=${dbName} for service '${service}', found '${actual ?? '<missing>'}'.`,
      );
    }
  }

  for (const edge of EDGE_SERVICES) {
    const file = join(ROOT, 'apps', edge, '.env.example');
    if (!existsSync(file)) {
      reportViolation(file, `Missing apps/${edge}/.env.example.`);
      continue;
    }
    const env = parseEnv(file);
    for (const key of ENV_DB_KEYS) {
      if (env.has(key)) {
        reportViolation(
          file,
          `Edge app '${edge}' must not declare ${key} in .env.example.`,
        );
      }
    }
  }
}

function checkDirectGrpcClients() {
  log('\nChecking direct cross-service gRPC clients...');
  const appsToScan = [...EDGE_SERVICES, ...Object.keys(OWNERSHIP)];
  for (const app of appsToScan) {
    if (app === 'api-gateway') continue;
    const files = collectTs(join(ROOT, 'apps', app, 'src'));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const serviceRefs = [
        ...content.matchAll(/name:\s*SERVICES\.([A-Z_]+)/g),
        ...content.matchAll(/@Inject\(\s*SERVICES\.([A-Z_]+)\s*\)/g),
      ].map((match) => match[1]);
      if (serviceRefs.length === 0) continue;

      const containsGrpcClient =
        content.includes('ClientGrpc') ||
        content.includes('ClientsModule') ||
        content.includes('Transport.GRPC');
      if (!containsGrpcClient) continue;

      for (const serviceRef of new Set(serviceRefs)) {
        if (!DOMAIN_GRPC_SERVICES.has(serviceRef)) continue;

        const message =
          app === 'socket'
            ? `Socket has legacy direct gRPC client to ${serviceRef}; route domain data/commands through API gateway before Sprint ${SOCKET_LEGACY_GRPC_EXPIRY}.`
            : `Service '${app}' has direct gRPC client to ${serviceRef}; route cross-service data through API gateway.`;

        if (STRICT_GRPC) {
          reportViolation(file, message);
        } else {
          reportWarning(file, message);
        }
      }
    }
  }
}

if (GRPC_ONLY) {
  checkDirectGrpcClients();
} else if (ENV_ONLY) {
  checkEnvExamples();
} else {
  checkEdgeImports();
  if (EDGE_ONLY) {
    checkEnvExamples();
  } else {
    checkSharedLibImports();
    checkServiceModelImports();
    checkEnvExamples();
  }
}

log('\n' + '-'.repeat(60));
if (violations > 0) {
  console.error(
    `\ncheck:db-ownership FAILED - ${violations} violation(s), ${warnings} warning(s)\n`,
  );
  process.exit(1);
}

if (warnings > 0) {
  console.warn(
    `\ncheck:db-ownership PASSED with ${warnings} legacy warning(s) tracked for future sprints\n`,
  );
  process.exit(0);
}

log('\ncheck:db-ownership PASSED - no violations found\n');
