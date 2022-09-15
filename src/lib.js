import * as Task from "./task.js"
export * from "./task.js"

/**
 * Turns a task (that never fails or sends messages) into an effect of it's
 * result.
 *
 * @template T
 * @param {Task.Task<T, never>} task
 * @returns {Task.Effect<T>}
 */
export const effect = function* (task) {
  const message = yield* task
  yield* send(message)
}

/**
 * Gets a handle to the task that invoked it. Useful when task needs to
 * suspend execution until some outside event occurs, in which case handle
 * can be used resume execution (see `suspend` code example for more details)
 *
 * @template T, M, X
 * @returns {Task.Task<Task.Controller<T, X, M>, never>}
 */
export function* current() {
  return /** @type {Task.Controller<T, X, M>} */ (yield CURRENT)
}

/**
 * Suspends the current task (task that invokes it),  which can then be
 * resumed from another task or an outside event (e.g. `setTimeout` callback)
 * by calling the `resume` with an task's handle.
 *
 * Calling this in almost all cases is preceeded by call to `current()` in
 * order to obtain a `handle` which can be passed to `resume` function
 * to resume the execution.
 *
 * Note: This task never fails, although it may never resume either. However
 * you can utilize `finally` block to do a necessary cleanup in case execution
 * is aborted.
 *
 * @example
 * ```js
 * import { current, suspend, resume } from "actor"
 * function * sleep(duration) {
 *    // get a reference to this task so we can resume it.
 *    const self = yield * current()
 *    // resume this task when timeout fires
 *    const id = setTimeout(() => resume(self), duration)
 *    try {
 *      // suspend this task nothing below this line will run until task is
 *      // resumed.
 *      yield * suspend()
 *    } finally {
 *      // if task is aborted finally block will still run which given you
 *      // chance to cleanup.
 *      clearTimeout(id)
 *    }
 * }
 * ```
 *
 * @returns {Task.Task<void, never>}
 */
export const suspend = function* () {
  yield SUSPEND
}

/**
 * Suspends execution for the given duration in milliseconds, after which
 * execution is resumed (unless it was aborted in the meantime).
 *
 * @example
 * ```js
 * function * demo() {
 *    console.log("I'm going to take small nap")
 *    yield * sleep(200)
 *    console.log("I am back to work")
 * }
 * ```
 *
 * @param {number} [duration]
 * @returns {Task.Task<void, never>}
 */
export function* sleep(duration = 0) {
  const task = yield* current()
  const id = setTimeout(enqueue, duration, task)

  try {
    yield* suspend()
  } finally {
    clearTimeout(id)
  }
}

/**
 * Provides equivalent of `await` in async functions. Specifically it takes
 * a value that you can `await` on (that is `Promise<T>|T`) and suspends
 * execution until promise is settled. If promise succeeds execution is resumed
 * with `T` otherwise an error of type `X` is thrown (which is by default
 * `unknown` since promises do not encode error type).
 *
 * It is useful when you need to deal with potentially async set of operations
 * without having to check if thing is a promise at every step.
 *
 * Please note: This that execution is suspended even if given value is not a
 * promise, however scheduler will still resume it in the same tick of the event
 * loop after, just processing other scheduled tasks. This avoids problematic
 * race condititions that can otherwise occur when values are sometimes promises
 * and other times are not.
 *
 * @example
 * ```js
 * function * fetchJSON (url, options) {
 *    const response = yield * wait(fetch(url, options))
 *    const json = yield * wait(response.json())
 *    return json
 * }
 * ```
 *
 * @template T, [X=unknown]
 * @param {Task.Await<T>} input
 * @returns {Task.Task<T, Error>}
 */
export const wait = function* (input) {
  const task = yield* current()
  if (isAsync(input)) {
    let failed = false
    /** @type {unknown} */
    let output = undefined
    input.then(
      value => {
        failed = false
        output = value
        enqueue(task)
      },
      error => {
        failed = true
        output = error
        enqueue(task)
      }
    )

    yield* suspend()
    if (failed) {
      throw output
    } else {
      return /** @type {T} */ (output)
    }
  } else {
    // This may seem redundunt but it is not, by enqueuing this task we allow
    // scheduler to perform other queued tasks first. This way many race
    // conditions can be avoided when values are sometimes promises and other
    // times aren't.
    // Unlike `await` however this will resume in the same tick.
    main(wake(task))
    yield* suspend()
    return input
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>} task
 * @returns {Task.Task<void, never, never>}
 */
function* wake(task) {
  enqueue(task)
}

/**
 * Checks if value value is a promise (or it's lookalike).
 *
 * @template T
 * @param {any} node
 * @returns {node is PromiseLike<T>}
 */

const isAsync = node =>
  node != null &&
  typeof (/** @type {{then?:unknown}} */ (node).then) === "function"

/**
 * Task that sends given message (or rather an effect producing this message).
 * Please note, that while you could use `yield message` instead, but you'd risk
 * having to deal with potential breaking changes if library internals change
 * in the future, which in fact may happen as anticipated improvements in
 * TS generator inference could enable replace need for `yield *`.
 *
 * @see https://github.com/microsoft/TypeScript/issues/43632
 *
 * @template T
 * @param {T} message
 * @returns {Task.Effect<T>}
 */
export const send = function* (message) {
  yield /** @type {Task.Message<T>} */ (message)
}

/**
 * Takes several effects and merges them into a single effect of tagged
 * variants so that their source could be identified via `type` field.
 *
 * @example
 * ```js
 * listen({
 *    read: Task.effect(dbRead),
 *    write: Task.effect(dbWrite)
 * })
 * ```
 *
 * @template {string} Tag
 * @template T
 * @param {{ [K in Tag]: Task.Effect<T> }} source
 * @returns {Task.Effect<Tagged<Tag, T>>}
 */
export const listen = function* (source) {
  /** @type {Task.Fork<void, never, Tagged<Tag, T>>[]} */
  const forks = []
  for (const entry of Object.entries(source)) {
    const [name, effect] = /** @type {[Tag, Task.Effect<T>]} */ (entry)
    if (effect !== NONE) {
      forks.push(yield* fork(tag(effect, name)))
    }
  }

  yield* group(forks)
}

/**
 * Takes several tasks and creates an effect of them all.
 *
 * @example
 * ```js
 * Task.effects([
 *    dbRead,
 *    dbWrite
 * ])
 * ```
 *
 * @template {string} Tag
 * @template T
 * @param {Task.Task<T, never>[]} tasks
 * @returns {Task.Effect<T>}
 */

export const effects = tasks =>
  tasks.length > 0 ? batch(tasks.map(effect)) : NONE

/**
 * Takes several effects and combines them into a one.
 *
 * @template T
 * @param {Task.Effect<T>[]} effects
 * @returns {Task.Effect<T>}
 */
export function* batch(effects) {
  const forks = []
  for (const effect of effects) {
    forks.push(yield* fork(effect))
  }

  yield* group(forks)
}

/**
 * @template {string} Tag
 * @template T
 * @typedef {{type: Tag} & {[K in Tag]: T}} Tagged
 */
/**
 * Tags an effect by boxing each event with an object that has `type` field
 * corresponding to given tag and same named field holding original message
 * e.g. given `nums` effect that produces numbers, `tag(nums, "inc")` would
 * create an effect that produces events like `{type:'inc', inc:1}`.
 *
 * @template {string} Tag
 * @template T, M, X
 * @param {Task.Task<T, X, M>} effect
 * @param {Tag} tag
 * @returns {Task.Task<T, X, Tagged<Tag, M>>}
 */
export const tag = (effect, tag) =>
  // @ts-ignore
  effect === NONE
    ? NONE
    : effect instanceof Tagger
    ? new Tagger([...effect.tags, tag], effect.source)
    : new Tagger([tag], effect)

/**
 * @template {string} Tag
 * @template Success, Failure, Message
 *
 * @implements {Task.Task<Success, Failure, Tagged<Tag, Message>>}
 * @implements {Task.Controller<Success, Failure, Tagged<Tag, Message>>}
 */
class Tagger {
  /**
   * @param {Task.Task<Success, Failure, Message>} source
   * @param {string[]} tags
   */
  constructor(tags, source) {
    this.tags = tags
    this.source = source
    /** @type {Task.Controller<Success, Failure, Message>} */
    this.controller
  }
  /* c8 ignore next 3 */
  [Symbol.iterator]() {
    if (!this.controller) {
      this.controller = this.source[Symbol.iterator]()
    }
    return this
  }
  /**
   * @param {Task.TaskState<Success, Message>} state
   * @returns {Task.TaskState<Success, Tagged<Tag, Message>>}
   */
  box(state) {
    if (state.done) {
      return state
    } else {
      switch (state.value) {
        case SUSPEND:
        case CURRENT:
          return /** @type {Task.TaskState<Success, Tagged<Tag, Message>>} */ (
            state
          )
        default: {
          // Instead of boxing result at each transform step we perform in-place
          // mutation as we know nothing else is accessing this value.
          const tagged = /** @type {{ done: false, value: any }} */ (state)
          let { value } = tagged
          for (const tag of this.tags) {
            value = withTag(tag, value)
          }
          tagged.value = value
          return tagged
        }
      }
    }
  }
  /**
   *
   * @param {Task.Instruction<Message>} instruction
   */
  next(instruction) {
    return this.box(this.controller.next(instruction))
  }
  /**
   *
   * @param {Failure} error
   */
  throw(error) {
    return this.box(this.controller.throw(error))
  }
  /**
   * @param {Success} value
   */
  return(value) {
    return this.box(this.controller.return(value))
  }

  get [Symbol.toStringTag]() {
    return "TaggedEffect"
  }
}

/**
 * Returns empty `Effect`, that is produces no messages. Kind of like `[]` or
 * `""` but for effects.
 *
 * @type {() => Task.Effect<never>}
 */
export const none = () => NONE

/**
 * Takes iterable of tasks and runs them concurrently, returning array of
 * results in an order of tasks (not the order of completion). If any of the
 * tasks fail all the rest are aborted and error is throw into calling task.
 *
 * > This is basically equivalent of `Promise.all` except cancelation logic
 * because tasks unlike promises can be cancelled.
 *
 * @template T, X
 * @param {Iterable<Task.Task<T, X>>} tasks
 * @returns {Task.Task<T[], X>}
 */
export const all = function* (tasks) {
  const self = yield* current()

  /** @type {(id:number) => (value:T) => void} */
  const succeed = id => value => {
    delete forks[id]
    results[id] = value
    count -= 1
    if (count === 0) {
      enqueue(self)
    }
  }

  /** @type {(error:X) => void} */
  const fail = error => {
    for (const handle of forks) {
      if (handle) {
        enqueue(abort(handle, error))
      }
    }

    enqueue(abort(self, error))
  }

  /** @type {Task.Fork<void, never>[]} */
  let forks = []
  let count = 0
  for (const task of tasks) {
    forks.push(yield* fork(then(task, succeed(count++), fail)))
  }
  const results = new Array(count)

  if (count > 0) {
    yield* suspend()
  }

  return results
}

/**
 * @template {string} Tag
 * @template T
 * @param {Tag} tag
 * @param {Task.Message<T>} value
 */
const withTag = (tag, value) =>
  /** @type {Tagged<Tag, T>} */
  ({ type: tag, [tag]: value })

/**
 * Kind of like promise.then which is handy when you want to extract result
 * from the given task from the outside.
 *
 * @template T, U, X, M
 * @param {Task.Task<T, X, M>} task
 * @param {(value:T) => U} resolve
 * @param {(error:X) => U} reject
 * @returns {Task.Task<U, never, M>}
 */
export function* then(task, resolve, reject) {
  try {
    return resolve(yield* task)
  } catch (error) {
    return reject(/** @type {X} */ (error))
  }
}

// Special control instructions recognized by a scheduler.
const CURRENT = Symbol("current")
const SUSPEND = Symbol("suspend")
/** @typedef {typeof SUSPEND|typeof CURRENT} Control */

/**
 * @template M
 * @param {Task.Instruction<M>} value
 * @returns {value is M}
 */
export const isMessage = value => {
  switch (value) {
    case SUSPEND:
    case CURRENT:
      return false
    default:
      return true
  }
}

/**
 * @template M
 * @param {Task.Instruction<M>} value
 * @returns {value is Control}
 */
export const isInstruction = value => !isMessage(value)

/**
 * @template T, X, M
 * @implements {Task.TaskGroup<T, X, M>}
 */
class Group {
  /**
   * @template T, X, M
   * @param {Task.Controller<T, X, M>|Task.Fork<T, X, M>} member
   * @returns {Task.Group<T, X, M>}
   */
  static of(member) {
    return (
      /** @type {{group?:Task.TaskGroup<T, X, M>}} */ (member).group || MAIN
    )
  }

  /**
   * @template T, X, M
   * @param {(Task.Controller<T, X, M>|Task.Fork<T, X, M>) & {group?:Task.TaskGroup<T, X, M>}} member
   * @param {Task.TaskGroup<T, X, M>} group
   */
  static enqueue(member, group) {
    member.group = group
    group.stack.active.push(member)
  }
  /**
   * @param {Task.Controller<T, X, M>} driver
   * @param {Task.Controller<T, X, M>[]} [active]
   * @param {Set<Task.Controller<T, X, M>>} [idle]
   * @param {Task.Stack<T, X, M>} [stack]
   */
  constructor(
    driver,
    active = [],
    idle = new Set(),
    stack = new Stack(active, idle)
  ) {
    this.driver = driver
    this.parent = Group.of(driver)
    this.stack = stack
    this.id = ++ID
  }
}

/**
 * @template T, X, M
 * @implements {Task.Main<T, X, M>}
 */
class Main {
  constructor() {
    this.status = IDLE
    this.stack = new Stack()
    this.id = /** @type {0} */ (0)
  }
}

/**
 * @template T, X, M
 */
class Stack {
  /**
   * @param {Task.Controller<T, X, M>[]} [active]
   * @param {Set<Task.Controller<T, X, M>>} [idle]
   */
  constructor(active = [], idle = new Set()) {
    this.active = active
    this.idle = idle
  }

  /**
   *
   * @param {Task.Stack<unknown, unknown, unknown>} stack
   * @returns
   */
  static size({ active, idle }) {
    return active.length + idle.size
  }
}

/**
 * Starts a main task.
 *
 * @param {Task.Task<void, never>} task
 */
export const main = task => enqueue(task[Symbol.iterator]())

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>} task
 */
const enqueue = task => {
  let group = Group.of(task)
  group.stack.active.push(task)
  group.stack.idle.delete(task)

  // then walk up the group chain and unblock their driver tasks.
  while (group.parent) {
    const { idle, active } = group.parent.stack
    if (idle.has(group.driver)) {
      idle.delete(group.driver)
      active.push(group.driver)
    } else {
      // if driver was not blocked it must have been unblocked by
      // other task so stop there.
      break
    }

    group = group.parent
  }

  if (MAIN.status === IDLE) {
    MAIN.status = ACTIVE
    while (true) {
      try {
        for (const _message of step(MAIN)) {
        }
        MAIN.status = IDLE
        break
      } catch (_error) {
        // Top level task may crash and throw an error, but given this is a main
        // group we do not want to interupt other unrelated tasks, which is why
        // we discard the error and the task that caused it.
        MAIN.stack.active.shift()
      }
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>} task
 */
export const resume = task => enqueue(task)

/**
 * @template T, X, M
 * @param {Task.Group<T, X, M>} group
 */

const step = function* (group) {
  const { active } = group.stack
  let task = active[0]
  group.stack.idle.delete(task)
  while (task) {
    /** @type {Task.TaskState<T, M>} */
    let state = INIT
    // Keep processing insturctions until task is done, it send suspend request
    // or it's has been removed from the active queue.
    // ⚠️ Group changes require extra care so please make sure to understand
    // the detail here. It occurs when spawned task(s) are joined into a group
    // which will change the task driver, that is when `task === active[0]` will
    // became false and need to to drop the task immediately otherwise race
    // condition will occur due to task been  driven by multiple concurrent
    // schedulers.
    loop: while (!state.done && task === active[0]) {
      const instruction = state.value
      switch (instruction) {
        // if task is suspended we add it to the idle list and break the loop
        // to move to a next task.
        case SUSPEND:
          group.stack.idle.add(task)
          break loop
        // if task requested a context (which is usually to suspend itself)
        // pass back a task reference and continue.
        case CURRENT:
          state = task.next(task)
          break
        default:
          // otherwise task sent a message which we yield to the driver and
          // continue
          state = task.next(
            yield /** @type {M & Task.Message<M>}*/ (instruction)
          )
          break
      }
    }

    // If task is complete, or got suspended we move to a next task
    active.shift()
    task = active[0]
    group.stack.idle.delete(task)
  }
}

/**
 * Executes given task concurrently with a current task (task that spawned it).
 * Spawned task is detached from the task that spawned it and it can outlive it
 * and / or fail without affecting a task that spawned it. If you need to wait
 * on concurrent task completion consider using `fork` instead which can be
 * later `joined`. If you just want a to block on task execution you can just
 * `yield* work()` directly instead.
 *
 * @param {Task.Task<void, never, never>} task
 * @returns {Task.Task<void, never>}
 */
export function* spawn(task) {
  main(task)
}

/**
 * Executes given task concurrently with current task (the task that initiated
 * fork). Froked task is detached from the task that created it and it can
 * outlive it and / or fail without affecting it. You do however get a handle
 * for the fork which could be used to `join` the task, in which case `joining`
 * task will block until fork finishes execution.
 *
 * This is also a primary interface for executing tasks from the outside of the
 * task context. Function returns `Fork` which implements `Promise` interface
 * so it could be awaited. Please note that calling `fork` does not really do
 * anything, it lazily starts execution when you either `await fork(work())`
 * from arbitray context or `yield* fork(work())` in anothe task context.
 *
 * @template T, X, M
 * @param {Task.Task<T, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Fork<T, X, M>}
 */
export const fork = (task, options) => new Fork(task, options)

/**
 * Exits task succesfully with a given return value.
 *
 * @template T, M, X
 * @param  {Task.Controller<T, M, X>} handle
 * @param {T} value
 * @returns {Task.Task<void, never>}
 */
export const exit = (handle, value) => conclude(handle, { ok: true, value })

/**
 * Terminates task execution execution. Only takes task that produces no
 * result, if your task has non `void` return type you should use `exit` instead.
 *
 * @template M, X
 * @param {Task.Controller<void, X, M>} handle
 */
export const terminate = handle =>
  conclude(handle, { ok: true, value: undefined })

/**
 * Aborts given task with an error. Task error type should match provided error.
 *
 * @template T, M, X
 * @param {Task.Controller<T, X, M>} handle
 * @param {X} [error]
 */
export const abort = (handle, error) => conclude(handle, { ok: false, error })

/**
 * Aborts given task with an given error.
 *
 * @template T, M, X
 * @param {Task.Controller<T, X, M>} handle
 * @param {Task.Result<T, X>} result
 * @returns {Task.Task<void, never> & Task.Controller<void, never>}
 */
function* conclude(handle, result) {
  try {
    const task = handle
    const state = result.ok
      ? task.return(result.value)
      : task.throw(result.error)

    if (!state.done) {
      if (state.value === SUSPEND) {
        const { idle } = Group.of(task).stack
        idle.add(task)
      } else {
        enqueue(task)
      }
    }
  } catch (error) {}
}

/**
 * Groups multiple forks togather and joins joins them with current task.
 *
 * @template T, X, M
 * @param {Task.Fork<T, X, M>[]} forks
 * @returns {Task.Task<void, X, M>}
 */
export function* group(forks) {
  // Abort eraly if there'se no work todo.
  if (forks.length === 0) return

  const self = yield* current()
  /** @type {Task.TaskGroup<T, X, M>} */
  const group = new Group(self)
  /** @type {Task.Failure<X>|null} */
  let failure = null

  for (const fork of forks) {
    const { result } = fork
    if (result) {
      if (!result.ok && !failure) {
        failure = result
      }
      continue
    }
    move(fork, group)
  }

  // Keep work looping until there is nom more work to be done
  try {
    if (failure) {
      throw failure.error
    }

    while (true) {
      yield* step(group)
      if (Stack.size(group.stack) > 0) {
        yield* suspend()
      } else {
        break
      }
    }
  } catch (error) {
    for (const task of group.stack.active) {
      yield* abort(task, error)
    }

    for (const task of group.stack.idle) {
      yield* abort(task, error)
      enqueue(task)
    }

    throw error
  }
}

/**
 * @template T, X, M
 * @param {Task.Fork<T, X, M>} fork
 * @param {Task.TaskGroup<T, X, M>} group
 */
const move = (fork, group) => {
  const from = Group.of(fork)
  if (from !== group) {
    const { active, idle } = from.stack
    const target = group.stack
    fork.group = group
    // If it is idle just move from one group to the other
    // and update the group task thinks it belongs to.
    if (idle.has(fork)) {
      idle.delete(fork)
      target.idle.add(fork)
    } else {
      const index = active.indexOf(fork)
      // If task is in the job queue, we move it to a target job queue. Moving
      // top task in the queue requires extra care so it does not end up
      // processed by two groups which would lead to race. For that reason
      // `step` loop checks for group changes on each turn.
      if (index >= 0) {
        active.splice(index, 1)
        target.active.push(fork)
      }
      // otherwise task is complete
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Fork<T, X, M>} fork
 * @returns {Task.Task<T, X, M>}
 */
export function* join(fork) {
  // If fork is still idle activate it.
  if (fork.status === IDLE) {
    yield* fork
  }

  if (!fork.result) {
    yield* group([fork])
  }

  const result = /** @type {Task.Result<T, X>} */ (fork.result)
  if (result.ok) {
    return result.value
  } else {
    throw result.error
  }
}

/**
 * @template T, X
 * @implements {Task.Future<T, X>}
 */
class Future {
  /**
   * @param {Task.StateHandler<T, X>} handler
   */
  constructor(handler) {
    this.handler = handler
    /**
     * @abstract
     * @type {Task.Result<T, X>|void}
     */
    this.result
  }
  /**
   * @type {Promise<T>}
   */
  get promise() {
    const { result } = this
    const promise =
      result == null
        ? new Promise((succeed, fail) => {
            this.handler.onsuccess = succeed
            this.handler.onfailure = fail
          })
        : result.ok
        ? Promise.resolve(result.value)
        : Promise.reject(result.error)
    Object.defineProperty(this, "promise", { value: promise })
    return promise
  }

  /**
   * @template U, [E=never]
   * @param {((value:T) => U | PromiseLike<U>)|undefined|null} [onresolve]
   * @param {((error:X) => E|PromiseLike<E>)|undefined|null} [onreject]
   * @returns {Promise<U|E>}
   */
  then(onresolve, onreject) {
    return this.activate().promise.then(onresolve, onreject)
  }
  /**
   * @template [U=never]
   * @param {(error:X) => U} onreject
   */
  catch(onreject) {
    return /** @type {Task.Future<T|U, never>} */ (
      this.activate().promise.catch(onreject)
    )
  }
  /**
   * @param {() => void} onfinally
   * @returns {Task.Future<T, X>}
   */
  finally(onfinally) {
    return /** @type {Task.Future<T, X>} */ (
      this.activate().promise.finally(onfinally)
    )
  }
  /**
   * @abstract
   */
  /* c8 ignore next 3 */
  activate() {
    return this
  }
}

/**
 * @template T, X, M
 * @implements {Task.Fork<T, X, M>}
 * @implements {Task.Controller<T, X, M>}
 * @implements {Task.Task<Task.Fork<T, X, M>, never>}
 * @implements {Task.Future<T, X>}
 * @extends {Future<T, X>}
 */
class Fork extends Future {
  /**
   * @param {Task.Task<T, X, M>} task
   * @param {Task.ForkOptions} [options]
   * @param {Task.StateHandler<T, X>} [handler]
   * @param {Task.TaskState<T, M>} [state]
   */
  constructor(task, options = BLANK, handler = {}, state = INIT) {
    super(handler)
    this.id = ++ID
    this.name = options.name || ""
    /** @type {Task.Task<T, X, M>} */
    this.task = task
    this.state = state
    this.status = IDLE
    /** @type {Task.Result<T, X>} */
    this.result
    this.handler = handler

    /** @type {Task.Controller<T, X, M>} */
    this.controller
  }

  *resume() {
    resume(this)
  }

  /**
   * @returns {Task.Task<T, X, M>}
   */
  join() {
    return join(this)
  }

  /**
   * @param {X} error
   */
  abort(error) {
    return abort(this, error)
  }
  /**
   * @param {T} value
   */
  exit(value) {
    return exit(this, value)
  }
  get [Symbol.toStringTag]() {
    return "Fork"
  }

  /**
   * @returns {Task.Controller<Task.Fork<T, X, M>, never, never>}
   */
  *[Symbol.iterator]() {
    return this.activate()
  }

  activate() {
    this.controller = this.task[Symbol.iterator]()
    this.status = ACTIVE
    enqueue(this)
    return this
  }

  /**
   * @private
   * @param {any} error
   * @returns {never}
   */
  panic(error) {
    this.result = { ok: false, error }
    this.status = FINISHED
    const { handler } = this
    if (handler.onfailure) {
      handler.onfailure(error)
    }

    throw error
  }

  /**
   * @private
   * @param {Task.TaskState<T, M>} state
   */
  step(state) {
    this.state = state
    if (state.done) {
      this.result = { ok: true, value: state.value }
      this.status = FINISHED
      const { handler } = this
      if (handler.onsuccess) {
        handler.onsuccess(state.value)
      }
    }

    return state
  }

  /**
   * @param {unknown} value
   */
  next(value) {
    try {
      return this.step(this.controller.next(value))
    } catch (error) {
      return this.panic(error)
    }
  }
  /**
   * @param {T} value
   */
  return(value) {
    try {
      return this.step(this.controller.return(value))
    } catch (error) {
      return this.panic(error)
    }
  }
  /**
   * @param {X} error
   */
  throw(error) {
    try {
      return this.step(this.controller.throw(error))
    } catch (error) {
      return this.panic(error)
    }
  }
}

/**
 * @template M
 * @param {Task.Effect<M>} init
 * @param {(message:M) => Task.Effect<M>} next
 * @returns {Task.Task<void, never, never>}
 */
export const loop = function* (init, next) {
  /** @type {Task.Controller<void, never, M>} */
  const controller = yield* current()
  const group = new Group(controller)
  Group.enqueue(init[Symbol.iterator](), group)

  while (true) {
    for (const message of step(group)) {
      Group.enqueue(next(message)[Symbol.iterator](), group)
    }

    if (Stack.size(group.stack) > 0) {
      yield* suspend()
    } else {
      break
    }
  }
}

let ID = 0
/** @type {Task.Status} */
const IDLE = "idle"
const ACTIVE = "active"
const FINISHED = "finished"
/** @type {Task.TaskState<any, any>} */
const INIT = { done: false, value: CURRENT }

const BLANK = {}

/** @type {Task.Effect<never>} */
const NONE = (function* none() {})()

/** @type {Task.Main<any, any, any>} */
const MAIN = new Main()
