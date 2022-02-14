import * as Task from "./type.js"

export * from "./type.js"

/**
 * Turns a task (that never fails) into an effect of it's success result.
 *
 * @template T
 * @param {Task.Task<T, never>} task
 * @returns {Task.Effect<T>}
 */
export const perform = function* (task) {
  const message = yield* task
  yield* send(message)
}

/**
 * Gets a handle to the actor that invokes it. Useful when actor needs to
 * suspend execution until some outside event occurs, in which case handle
 * can be used resume execution (see `suspend` code example for more details)
 *
 * @template T, M, X
 * @returns {Task.Task<Task.Actor<T, X, M>, never>}
 */
export function* current() {
  return /** @type {Task.Actor<T, X, M>} */ (yield CONTEXT)
}

/**
 * Suspends the current actor (actor that invokes it),  which can then be
 * resumed from another actor or an outside event (e.g. `setTimeout` callback)
 * by calling the `resume` with an actor's handle.
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
 * import { context, suspend, resume } from "actor"
 * function * sleep(duration) {
 *    // get a reference to this task so we can resume it.
 *    const self = yield * context()
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
 * @param {number} duration
 * @returns {Task.Task<void, never>}
 */
export function* sleep(duration) {
  const task = yield* current()

  const id = setTimeout(function () {
    enqueue(task)
  }, duration)
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
 * @returns {Task.Task<T, X>}
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
    enqueue(task)
    yield* suspend()
    return input
  }
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
 *    read: perfom(dbRead),
 *    write: perfrom(dbWrite)
 * })
 * ```
 *
 * @template {string} Tag
 * @template T
 * @param {{ [K in Tag]: Task.Effect<T> }} source
 * @returns {Task.Effect<Tagged<Tag, T>>}
 */
export const listen = function* (source) {
  /** @type {Task.Effect<Tagged<Tag, T>>[]} */
  const effects = []
  for (const entry of Object.entries(source)) {
    const [name, effect] = /** @type {[Tag, Task.Effect<T>]} */ (entry)

    const task = yield* Task.spawn(tag(effect, name))
    effects.push(task)
  }

  yield* Task.join(...effects)
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
 * @template T
 * @param {Task.Effect<T>} effect
 * @param {Tag} tag
 * @returns {Task.Effect<Tagged<Tag, T>>}
 */
export const tag = function* (effect, tag) {
  for (const instruction of effect) {
    switch (instruction) {
      case SUSPEND:
      case CONTEXT:
        yield instruction
      default: {
        const message = /** @type {Task.Message<T>} */ (instruction)
        const out = withTag(tag, message)

        yield /** @type {Task.Message<Tagged<Tag, T>>} */ (out)
      }
    }
  }
}

function* empty() {}

/**
 * Returns empty effect, that is effect that produces no messages.
 *
 * @type {Task.Effect<never>}
 */
export const nofx = empty()

// /**
//  * @template T
//  * @param {API.Task<T>[]} tasks
//  * @returns {API.Task<T[]>}
//  */
// export const all = function * (tasks) {
//   const results = []
//   for (const task of tasks) {
//     const { result } = yield * fork(task)
//     results.push(result)
//   }

//   const values = []
//   for (const result of results) {
//     const value = yield * wait(result)
//     values.push(value)
//   }

//   return values
// }

// /**
//  * @template T
//  * @param {API.Task<T>[]} tasks
//  * @returns {API.Effect<T>}
//  */
// export const batch = function * (tasks) {
//   const results = []
//   for (const task of tasks) {
//     const { result } = yield * fork(task)
//     results.push(result)
//   }

//   for (const result of results) {
//     const value = yield * wait(result)
//     yield * send(value)
//   }
// }

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
 * Executes given actor
 *
 * @template T, X, M
 * @param {Task.Actor<T, X, M>} task
 */
export const execute = task => enqueue(task)

/**
 * Executes a task and returns a promise of the result.
 *
 * @template T, X
 * @param {Task.Task<T, X>} task
 * @returns {Promise<T>}
 */
export const promise = task =>
  new Promise((resolve, reject) => execute(then(task, resolve, reject)))

/**
 * Kind of like promise.then which is handy when you want to extract result
 * from the given task from the outside.
 *
 * @template T, U, X, M
 * @param {Task.Actor<T, X, M>} task
 * @param {(value:T) => U} resolve
 * @param {(error:X) => U} reject
 * @returns {Task.Actor<U, never, M>}
 */
export function* then(task, resolve, reject) {
  try {
    return resolve(yield* task)
  } catch (error) {
    return reject(/** @type {X} */ (error))
  }
}

// Special control instructions recognized by a scheduler.
const CONTEXT = Symbol("context")
const SUSPEND = Symbol("suspend")
/** @typedef {typeof SUSPEND|typeof CONTEXT} Control */

/**
 * @param {unknown} value
 * @returns {value is Task.Control}
 */
export const isInstruction = value => {
  switch (value) {
    case SUSPEND:
    case CONTEXT:
      return true
    default:
      return false
  }
}

/** @typedef {'idle'|'active'} TaskStatus */
/** @type {TaskStatus} */
const IDLE = "idle"
const ACTIVE = "active"

/**
 * @template X, M
 * @implements {Task.TaskGroup<X, M>}
 */
class Group {
  /**
   * @param {Task.Actor<unknown, X, M>} driver
   * @param {Task.Actor<void, X, M>[]} [active]
   * @param {Set<Task.Actor<void, X, M>>} [idle]
   * @param {Task.Stack<void, X, M>} [stack]
   */
  constructor(
    driver,
    active = [],
    idle = new Set(),
    stack = new Stack(active, idle)
  ) {
    this.driver = driver
    this.parent = driver.group || MAIN
    this.stack = stack
    this.id = ++ID
  }
}

/**
 * @template X, M
 * @implements {Task.Main<X, M>}
 */
class Main {
  constructor() {
    this.status = IDLE
    this.stack = new Stack()
  }
}

/**
 * @template T, X, M
 */
class Stack {
  /**
   * @param {Task.Actor<T, X, M>[]} [active]
   * @param {Set<Task.Actor<T, X, M>>} [idle]
   */
  constructor(active = [], idle = new Set()) {
    this.active = active
    this.idle = idle
  }
}

/**
 * Task to drive group to completion.
 *
 * @template X, M
 * @param {Task.Group<X, M>} group
 * @returns {Task.Actor<void, X, M>}
 */
const drive = function* (group) {
  // Unless group has no work
  while (true) {
    yield* step(group)
    if (!isEmpty(group.stack)) {
      yield* suspend()
    } else {
      break
    }
  }
}

/**
 * @param {Task.Stack} stack
 */
const isEmpty = stack => stack.idle.size === 0 && stack.active.length === 0

/**
 * @template T, X, M
 * @param {Task.Actor<T, X, M>} task
 */
export const enqueue = task => {
  // If task is not a member of any group assign it to main group
  let group = task.group || MAIN
  group.stack.active.push(task)
  group.stack.idle.delete(task)

  // then walk up the group chain and unblock their driver tasks.
  while (group.parent) {
    const { idle, active } = group.parent.stack
    if (idle.has(group.driver)) {
      idle.delete(group.driver)
      active.push(group.driver)
    } else {
      console.error("group driver is not idle", Task.id(group.driver))
      // if driver was not blocked it must have been unblocked by
      // other task so stop there.
      break
    }

    group = group.parent
  }

  if (MAIN.status === IDLE) {
    MAIN.status = ACTIVE
    for (const message of step(MAIN)) {
    }

    MAIN.status = IDLE
  }
}

export const resume = enqueue

/**
 * @template T, M, X
 * @param {Task.Actor<T, X, M>} task
 */
export const id = task =>
  `${task.tag || ""}:${task.id || (task.id = ++ID)}@${
    task.group ? task.group.id : "main"
  }`

/**
 * @template X, M
 * @param {Task.Group<X, M>} context
 */

const step = function* (context) {
  const { active } = context.stack
  let task = active[0]
  while (task) {
    // we never actually set task.state just use it to infer type
    const { group } = task
    let state = task.next(task)
    // Keep processing insturctions until task is done, it send suspend request
    // or it's group changed.
    // ⚠️ Group changes require extra care so please make sure to understand
    // the detail here. It occurs when spawned task(s) are joined into a group
    // which will change the task driver, that is why if group changes we need
    // to drop the task otherwise race condition will occur due to task been
    // driven by multiple concurrent schedulers.
    loop: while (!state.done && task.group === group) {
      try {
        const instruction = state.value
        switch (instruction) {
          // if task is suspended we add it to the idle list and break the loop
          // to move to a next task.
          case SUSPEND:
            context.stack.idle.add(task)
            break loop
          // if task requested a context (which is usually to suspend itself)
          // pass back a task reference and continue.
          case CONTEXT:
            state = task.next(task)
            break
          default:
            // otherwise task sent a message which we yield to the driver and
            // continue
            state = task.next(yield instruction)
            break
        }
      } catch (error) {
        state = task.throw(/** @type {X} */ (error))
      }
    }

    // If task is complete, or got suspended we move to a next task
    active.shift()
    task = active[0]
  }
}

// /**
//  * @template T, M, X
//  * @param {API.Task<T, M, X>} task
//  * @param {TaskGroup<T, M, X>} group
//  */
// const abort = (task, group) => {
//   if (group.blocked.has(task)) {
//     group.blocked.delete(task)
//   }
//   // @ts-ignore - AbortError is not really an X
//   task.throw(new AbortError('Task was aborted'))
// }

/** @type {Task.Main<any, any>} */
const MAIN = new Main()
let ID = 0

/**
 * @template T, M, X
 * @param {Task.Actor<M, T, X>} task
 * @returns {Task.Task<Task.Actor<M, T, X>, never>}
 */

export function* spawn(task) {
  enqueue(task)

  return task
}

/**
 * @template X, M
 * @param {Task.Actor<void, X, M>[]} tasks
 * @returns {Task.Actor<void, X, M>}
 */
export function* join(...tasks) {
  const self = yield* current()
  /** @type {Task.TaskGroup<X, M>} */
  const group = new Group(self)

  for (const task of tasks) {
    move(task, group)
  }

  yield* drive(group)
}

/**
 * @template X, M
 * @param {Task.Actor<void, X, M>} task
 * @param {Task.TaskGroup<X, M>} to
 */
const move = (task, to) => {
  const from = task.group || MAIN
  if (from !== to) {
    const { active, idle } = from.stack
    const target = to.stack
    // If it is idle just move from one group to the other
    // and update the group task thinks it belongs to.
    if (idle.has(task)) {
      idle.delete(task)
      target.idle.add(task)
      task.group = to
    } else {
      const index = active.indexOf(task)
      // If task is in the job queue, we move it to a target job queue. Moving
      // top task in the queue requires extra care so it does not end up
      // processed by two groups which would lead to race. For that reason
      // `step` loop checks for group changes on each turn.
      if (index >= 0) {
        active.splice(index, 1)
        target.active.push(task)
        task.group = to
      }
      // otherwise task is complete
    }
  }
}
