// A randomized, model-based test of the handle bookkeeping in src/sessions.ts.
//
// A fake native module keeps a registry of sessions as the native SDKs 3.1.1 do: one session per
// payment, a start that finds one answers AUTH_012 (after its token exchange, so the session it
// finds is registered before the first start returns), `hasPaymentSession` looks in the registry
// and never fails (neither bridge answers it with an SDK error), closing a missing session does
// nothing, and `closeAllPaymentSessions` closes every registered one. Each native call has its
// effect on the registry either at once or at a later step, and its answer at a step after that;
// steps are chosen by a seeded generator, so a run is the same every time. Starts, gets, closes,
// closeAllPaymentSessions and sessions lost natively (an `initialize` with another connection)
// interleave, on one or two payments, with no failures or with 15 % of native calls failing.
//
// Invariants, checked after every step (I1, I5) and once everything has settled (I2 to I4):
// I1  an open handle never sits on a session JS closed;
// I2  a native session with no open handle has been closed (unless a native close failed);
// I3  a closed handle answers AUTH_013 by itself, without reaching native, for good;
// I4  every call settles, and its error, if any, is its own;
// I5  a start or get that resolves with a handle has a native session behind it.
//
// On a violation the test prints the configuration, the seed and the tail of the run's log.

const mockFake: { native: Record<string, (...args: any[]) => Promise<unknown>> } = { native: {} };
const mockNativeProxy = new Proxy(
  {},
  {
    get:
      (_target, name: string) =>
      (...args: unknown[]) =>
        mockFake.native[name]!(...args),
  }
);

jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: () => mockNativeProxy,
}));

type GopaySDKType = typeof import('../GopaySDK').GopaySDK;
type Handle = import('../sessions').PaymentSession;

/** Seeds per configuration; 40 configurations. */
const SEEDS = 40;
const STEPS = 60;

/** mulberry32: a small seeded generator, so that no run depends on Math.random or the clock. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lets every promise chain run until it waits for the fake native module again. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Mix {
  start: number;
  get: number;
  close: number;
  closeAll: number;
  loss: number;
}

interface Config {
  name: string;
  mix: Mix;
  effectAtCall: boolean;
  failRate: number;
  pids: string[];
}

interface Session {
  id: number;
  pid: string;
  closedBy: 'js-close' | 'js-closeAll' | 'loss' | null;
}

type Kind = 'has' | 'start' | 'close' | 'closeAll';

interface NativeCall {
  id: number;
  kind: Kind;
  args: string[];
  op: number | null;
  stage: 'effect' | 'answer';
  failWith: { error: { code: string; message: string } } | null;
  rejectWith: Error | null;
  result?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface HandleRecord {
  n: number;
  h: Handle;
  pid: string;
  session: Session | null;
  ownerClosed: boolean;
  retired: boolean;
}

interface Op {
  id: number;
  kind: 'start' | 'get' | 'close' | 'closeAll';
  settled: boolean;
  startedLoss: number;
}

const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
beforeAll(() => process.on('unhandledRejection', onUnhandled));
afterAll(() => process.off('unhandledRejection', onUnhandled));

async function runSeed(
  seed: number,
  cfg: Config
): Promise<{ violations: string[]; log: string[] }> {
  const rnd = prng(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)]!;
  const chance = (p: number) => rnd() < p;
  const log: string[] = [];
  const say = (line: string) => log.push(line);
  const violations: string[] = [];
  let stepNo = 0;
  const violate = (text: string) => violations.push(`step ${stepNo}: ${text}`);

  // ---- the fake native module ----
  let nextSession = 1;
  const registry = new Map<string, Session>();
  const sessions: Session[] = [];
  const pending: NativeCall[] = [];
  const calls = new Map<number, NativeCall>();
  let callId = 0;
  let currentOp: number | null = null;
  const failedClosePids = new Set<string>();
  let closeAllFailed = false;
  let losses = 0;
  let statusCalls = 0;

  const removeSession = (pid: string, by: Session['closedBy']) => {
    const session = registry.get(pid);
    if (session) {
      registry.delete(pid);
      session.closedBy = by;
    }
  };

  const applyEffect = (call: NativeCall) => {
    const [pid] = call.args;
    switch (call.kind) {
      case 'has':
        call.result = { result: registry.has(pid!) };
        break;
      case 'start':
        if (call.failWith) call.result = call.failWith;
        else if (registry.has(pid!)) {
          call.result = { error: { code: 'AUTH_012', message: `start#${call.id} AUTH_012` } };
        } else {
          const session: Session = { id: nextSession++, pid: pid!, closedBy: null };
          registry.set(pid!, session);
          sessions.push(session);
          call.result = { result: pid };
        }
        break;
      case 'close':
        if (call.failWith) {
          call.result = call.failWith;
          failedClosePids.add(pid!);
        } else {
          removeSession(pid!, 'js-close');
          call.result = { result: null };
        }
        break;
      case 'closeAll':
        if (call.failWith) {
          call.result = call.failWith;
          closeAllFailed = true;
        } else {
          for (const id of [...registry.keys()]) removeSession(id, 'js-closeAll');
          call.result = { result: null };
        }
        break;
    }
    call.stage = 'answer';
  };

  const nativeCall = (kind: Kind, args: string[]): Promise<unknown> => {
    const id = ++callId;
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const call: NativeCall = {
      id,
      kind,
      args,
      op: currentOp,
      stage: 'effect',
      failWith: null,
      rejectWith: null,
      resolve,
      reject,
    };
    // `hasPaymentSession` never fails natively; any other call may.
    if (kind !== 'has' && chance(cfg.failRate)) {
      if (chance(0.5)) {
        // A rejection of the bridge itself: no effect on the registry.
        call.rejectWith = new Error(`reject ${kind}#${id}`);
        call.stage = 'answer';
        if (kind === 'close') failedClosePids.add(args[0]!);
        if (kind === 'closeAll') closeAllFailed = true;
      } else {
        const code = kind === 'start' ? 'AUTH_010' : 'INTERNAL_001';
        call.failWith = { error: { code, message: `fail ${kind}#${id}` } };
      }
    }
    // A start talks to the gateway first, so its effect always comes later.
    if (call.stage === 'effect' && cfg.effectAtCall && kind !== 'start') applyEffect(call);
    pending.push(call);
    calls.set(id, call);
    say(
      `  native ${kind}#${id}(${args[0] ?? ''})${call.rejectWith ? ' rejects' : call.failWith ? ' fails' : ''}`
    );
    return promise;
  };

  mockFake.native = {
    startPaymentSession: (pid: string, secret: string) => nativeCall('start', [pid, secret]),
    hasPaymentSession: (pid: string) => nativeCall('has', [pid]),
    closeAllPaymentSessions: () => nativeCall('closeAll', []),
    sessionClose: (pid: string) => nativeCall('close', [pid]),
    sessionGetStatus: async (pid: string) => {
      statusCalls++;
      return registry.has(pid)
        ? { result: { id: pid } }
        : { error: { code: 'AUTH_013', message: 'native: closed' } };
    },
  };

  let GopaySDK!: GopaySDKType;
  jest.isolateModules(() => {
    GopaySDK = require('../GopaySDK').GopaySDK;
  });

  // ---- the driver ----
  const handles: HandleRecord[] = [];
  const ops: Op[] = [];
  let opId = 0;
  const describe = (e: any) => (e && e.code ? `${e.code} ${e.message}` : String(e?.message ?? e));

  const issue = (kind: Op['kind'], pid?: string, record?: HandleRecord) => {
    const op: Op = { id: ++opId, kind, settled: false, startedLoss: losses };
    ops.push(op);
    currentOp = op.id;
    let promise: Promise<unknown>;
    if (kind === 'start') {
      promise = GopaySDK.startPaymentSession({ paymentId: pid!, paymentSecret: `op${op.id}` });
    } else if (kind === 'get') {
      promise = GopaySDK.getPaymentSession(pid!);
    } else if (kind === 'closeAll') {
      promise = GopaySDK.closeAllPaymentSessions();
      for (const r of handles) r.retired = true;
    } else {
      promise = record!.h.close();
      record!.ownerClosed = true;
    }
    currentOp = null;
    say(`op${op.id} ${kind}${pid ? ' ' + pid : ''}${record ? ' h' + record.n : ''}`);
    promise.then(
      (value) => {
        op.settled = true;
        if ((kind === 'start' || kind === 'get') && value) {
          const session = registry.get(pid!) ?? null;
          const r: HandleRecord = {
            n: handles.length + 1,
            h: value as Handle,
            pid: pid!,
            session,
            ownerClosed: false,
            retired: false,
          };
          handles.push(r);
          say(`  op${op.id} -> h${r.n} on ${session ? 'S' + session.id : 'nothing'}`);
          if (!session && losses === op.startedLoss) {
            violate(`I5 op${op.id} ${kind} ${pid} resolved with h${r.n}, native has no session`);
          }
        } else {
          say(`  op${op.id} -> ${value === null ? 'null' : 'ok'}`);
        }
      },
      (error) => {
        op.settled = true;
        say(`  op${op.id} rejected: ${describe(error)}`);
        const message = String(error?.message);
        const match = message.match(/(start|has|close|closeAll)#(\d+)/);
        if (!match) {
          violate(`I4 op${op.id} ${kind} unexpected error ${message}`);
          return;
        }
        const call = calls.get(Number(match[2]));
        const own =
          kind === 'start'
            ? call?.kind === 'start' && call.args[1] === `op${op.id}`
            : call?.op === op.id;
        if (!own) violate(`I4 op${op.id} ${kind} got a foreign error: ${message}`);
      }
    );
  };

  const deliver = (call: NativeCall) => {
    if (call.stage === 'effect') {
      applyEffect(call);
      say(`  effect ${call.kind}#${call.id}`);
      return;
    }
    pending.splice(pending.indexOf(call), 1);
    say(
      `  answer ${call.kind}#${call.id} ${call.rejectWith ? 'REJECT' : JSON.stringify(call.result)}`
    );
    if (call.rejectWith) call.reject(call.rejectWith);
    else call.resolve(call.result);
  };

  const checkI1 = () => {
    for (const r of handles) {
      if (r.ownerClosed || r.retired || !r.session) continue;
      if (r.session.closedBy === 'js-close' || r.session.closedBy === 'js-closeAll') {
        violate(
          `I1 open h${r.n} (${r.pid}) sits on S${r.session.id}, which JS closed (${r.session.closedBy})`
        );
        r.session = null;
      }
    }
  };

  const step = async (allowOps: boolean) => {
    stepNo++;
    if (!allowOps || (pending.length && rnd() < 0.55)) {
      if (!pending.length) return;
      deliver(pick(pending));
    } else {
      const w = rnd();
      const m = cfg.mix;
      if (w < m.start) issue('start', pick(cfg.pids));
      else if (w < m.start + m.get) issue('get', pick(cfg.pids));
      else if (w < m.start + m.get + m.close) {
        if (!handles.length) issue('start', pick(cfg.pids));
        else {
          const open = handles.filter((r) => !r.ownerClosed);
          issue('close', undefined, open.length && chance(0.85) ? pick(open) : pick(handles));
        }
      } else if (w < m.start + m.get + m.close + m.closeAll) issue('closeAll');
      else {
        losses++;
        const all = chance(0.5);
        say(`LOSS${all ? ' all' : ''}`);
        for (const pid of [...registry.keys()]) if (all || chance(0.5)) removeSession(pid, 'loss');
      }
    }
    await flush();
    checkI1();
  };

  const settle = async () => {
    for (let guard = 0; pending.length && guard < 10000; guard++) await step(false);
    await flush();
    for (const op of ops) if (!op.settled) violate(`I4 op${op.id} ${op.kind} never settled`);
  };

  const quiescentChecks = async (label: string) => {
    for (const r of handles) {
      if (!r.ownerClosed && !r.retired) continue;
      const before = statusCalls;
      try {
        await r.h.getStatus();
        violate(`I3 ${label} closed h${r.n} still works`);
      } catch (e: any) {
        if (e?.code !== 'AUTH_013') violate(`I3 ${label} closed h${r.n} threw ${describe(e)}`);
      }
      if (statusCalls !== before) violate(`I3 ${label} closed h${r.n} reached native`);
    }
    // An open handle on a live session must work: nothing retired it by mistake.
    for (const r of handles) {
      if (r.ownerClosed || r.retired || !r.session || r.session.closedBy) continue;
      try {
        await r.h.getStatus();
      } catch (e) {
        violate(`I3 ${label} open h${r.n} on live S${r.session.id} answers ${describe(e)}`);
      }
    }
    for (const pid of cfg.pids) {
      const session = registry.get(pid);
      if (!session) continue;
      const open = handles.some((r) => r.pid === pid && !r.ownerClosed && !r.retired);
      if (open || failedClosePids.has(pid) || closeAllFailed) continue;
      violate(`I2 ${label} ${pid}: native S${session.id} is open with no open handle`);
    }
  };

  for (let i = 0; i < STEPS; i++) await step(true);
  await settle();
  await quiescentChecks('settled');
  // Close every handle, some twice, and check again.
  for (const r of [...handles]) {
    issue('close', undefined, r);
    if (chance(0.3)) issue('close', undefined, r);
  }
  await flush();
  await settle();
  await quiescentChecks('all closed');
  if (unhandled.length) {
    violate(`I4 unhandled rejection: ${unhandled.map(describe).join('; ')}`);
    unhandled.length = 0;
  }
  return { violations, log };
}

const MIXES: Record<string, Mix> = {
  balanced: { start: 0.3, get: 0.15, close: 0.3, closeAll: 0.1, loss: 0.15 },
  noCloseAll: { start: 0.4, get: 0.2, close: 0.4, closeAll: 0, loss: 0 },
  closeAllHeavy: { start: 0.3, get: 0.1, close: 0.25, closeAll: 0.35, loss: 0 },
  strict: { start: 0.5, get: 0.1, close: 0.4, closeAll: 0, loss: 0 },
  getHeavy: { start: 0.2, get: 0.4, close: 0.3, closeAll: 0.05, loss: 0.05 },
};

const CONFIGS: Config[] = [];
for (const [mixName, mix] of Object.entries(MIXES)) {
  for (const effectAtCall of [false, true]) {
    for (const failRate of [0, 0.15]) {
      for (const pids of [['p1'], ['p1', 'p2']]) {
        CONFIGS.push({
          name: `${mixName}/${effectAtCall ? 'effect at call' : 'effect later'}/fail ${failRate}/${pids.length} payment(s)`,
          mix,
          effectAtCall,
          failRate,
          pids,
        });
      }
    }
  }
}

describe('handle bookkeeping against a model of the native registry', () => {
  it.each(CONFIGS.map((cfg) => [cfg.name, cfg] as const))(
    '%s',
    async (_name, cfg) => {
      const failures: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { violations, log } = await runSeed(seed, cfg);
        if (violations.length && failures.length < 3) {
          const tail = log.length > 40 ? ['  …', ...log.slice(-40)] : log;
          failures.push(`seed ${seed}: ${violations[0]}\n${tail.join('\n')}`);
        }
      }
      if (failures.length) throw new Error(`${cfg.name}\n\n${failures.join('\n\n')}`);
    },
    30000
  );
});
