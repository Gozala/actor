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
  const tasks = []
  for (const entry of Object.entries(source)) {
    const [name, effect] = /** @type {[Tag, Task.Effect<T>]} */ (entry)

    const task = yield* Task.fork(tag(effect, name))
    tasks.push(task)
  }

  yield* Task.group(...tasks)
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
 * @param {Task.Actor<T, X, M>} effect
 * @param {Tag} tag
 * @returns {Task.Actor<T, X, Tagged<Tag, M>>}
 */
export const tag = (effect, tag) =>
  effect instanceof Tagger
    ? new Tagger([...effect.tags, tag], effect.source)
    : new Tagger([tag], effect)

/**
 * @template {string} Tag
 * @template Success, Failure, Message
 *
 * @implements {Task.Actor<Success, Failure, Tagged<Tag, Message>>}
 */
class Tagger {
  /**
   * @param {Task.Actor<Success, Failure, Message>} source
   * @param {string[]} tags
   */
  constructor(tags, source) {
    this.tags = tags
    this.source = source
  }
  /* c8 ignore next 3 */
  [Symbol.iterator]() {
    return this
  }
  /**
   * @param {Task.ActorState<Success, Message>} state
   * @returns {Task.ActorState<Success, Tagged<Tag, Message>>}
   */
  box(state) {
    if (state.done) {
      return state
    } else {
      switch (state.value) {
        case SUSPEND:
        case CONTEXT:
          return /** @type {Task.ActorState<Success, Tagged<Tag, Message>>} */ (
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
    return this.box(this.source.next(instruction))
  }
  /**
   *
   * @param {Failure} error
   */
  throw(error) {
    return this.box(this.source.throw(error))
  }
  /**
   * @param {Success} value
   */
  return(value) {
    return this.box(this.source.return(value))
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
 * @template T, X, M
 * @implements {Task.TaskGroup<T, X, M>}
 */
class Group {
  /**
   * @param {Task.Actor<T, X, M>} driver
   * @param {Task.Actor<T, X, M>[]} [active]
   * @param {Set<Task.Actor<T, X, M>>} [idle]
   * @param {Task.Stack<T, X, M>} [stack]
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
 * @template T, X, M
 * @param {Task.Group<T, X, M>} group
 * @returns {Task.Actor<void, X, M>}
 */
const drive = function* (group) {
  // Unless group has no work
  while (true) {
    const state = yield* step(group)
    if (!isEmpty(group.stack)) {
      yield* suspend()
    } else {
      return /** @type {T} */ (state.value)
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
  let group = task.group || (task.group = MAIN)
  group.stack.active.push(task)
  group.stack.idle.delete(task)

  // then walk up the group chain and unblock their driver tasks.
  while (group.parent) {
    const { idle, active } = group.parent.stack
    if (idle.has(group.driver)) {
      idle.delete(group.driver)
      active.push(group.driver)
    } else {
      /* c8 ignore next 5 */
      console.warn("group driver is not idle", group.driver)
      // if driver was not blocked it must have been unblocked by
      // other task so stop there.
      break
    }

    group = group.parent
  }

  if (MAIN.status === IDLE) {
    MAIN.status = ACTIVE
    try {
      for (const message of step(MAIN)) {
      }
      MAIN.status = IDLE
    } catch (error) {
      // Erroring task may throw another error while it is being resumed to
      // the error. We catch that error here so we could set the status of
      // the main back to `IDLE`. We still throw that error so that it can
      // be surfaced as uncaught exception. Note we use catch as opposed to
      // finally because later isn't as optimized in some JS engines.
      MAIN.status = IDLE
      throw error
    }
  }
}

export const resume = enqueue

/**
 * @template T, X, M
 * @param {Task.Group<T, X, M>} context
 */

const step = function* (context) {
  const { active } = context.stack
  let task = active[0]
  /** @type {Task.ActorState<T, M>} */
  let state = { done: false, value: CONTEXT }
  while (task) {
    /** @type {Task.ActorState<T, M>} */
    state = { done: false, value: CONTEXT }
    // Keep processing insturctions until task is done, it send suspend request
    // or it's has been removed from the active queue.
    // ⚠️ Group changes require extra care so please make sure to understand
    // the detail here. It occurs when spawned task(s) are joined into a group
    // which will change the task driver, that is when `task === active[0]` will
    // became false and need to to drop the task immediately otherwise race
    // condition will occur due to task been  driven by multiple concurrent
    // schedulers.
    loop: while (!state.done && task === active[0]) {
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

  return state
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

/** @type {Task.Main<any, any, any>} */
const MAIN = new Main()
let ID = 0

/**
 * @template T, M, X
 * @param {Task.Actor<T, M, X>} task
 * @returns {Task.Task<Task.Actor<T, M, X>, never>}
 */

export function* spawn(task) {
  enqueue(task)

  return task
}

/**
 * @template T, M, X
 * @param {Task.Actor<T, M, X>} task
 * @returns {Task.Fork<T, M, X>}
 */
export const fork = task => new Fork(task)
// export function* fork(task) {
//   enqueue(task)
//   return task
// }

/**
 * Abort the given task succesfully with a given value.
 *
 * @template T, M, X
 * @param  {Task.Actor<T, M, X>} task
 * @param {T} value
 * @returns {Task.Task<void, never>}
 */
export const exit = (task, value) => conclude(task, { ok: true, value })

/**
 * Abort execution of the given actor / task / effect.
 *
 * @template M, X
 * @param {Task.Actor<void, X, M>} task
 */
export const terminate = task => conclude(task, { ok: true, value: undefined })

/**
 * Aborts given task with an given error.
 *
 * @template T, M, X
 * @param {Task.Actor<T, X, M>} task
 * @param {X} [error]
 */
export const abort = (task, error) => conclude(task, { ok: false, error })

/**
 * Aborts given task with an given error.
 *
 * @template T, M, X
 * @param {Task.Actor<T, X, M>} task
 * @param {{ok:true, value:T}|{ok:false, error:X}} result
 * @returns {Task.Task<void, never>}
 */
function* conclude(task, result) {
  try {
    const state = result.ok
      ? task.return(result.value)
      : task.throw(result.error)

    if (!state.done) {
      if (state.value === SUSPEND) {
        const { idle } = (task.group || MAIN).stack
        idle.add(task)
      } else {
        enqueue(task)
      }
    }
  } catch (error) {}
}

/**
 * @template T, X, M
 * @param {Task.Actor<T, X, M>[]} tasks
 * @returns {Task.Actor<void, X, M>}
 */
export function* group(...tasks) {
  const self = yield* current()
  /** @type {Task.TaskGroup<T, X, M>} */
  const group = new Group(self)

  for (const task of tasks) {
    move(task, group)
  }

  yield* drive(group)
}

/**
 * @template T, X, M
 * @param {Task.Actor<T, X, M>} task
 * @param {Task.TaskGroup<T, X, M>} to
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

/**
 * @template T, X, M
 * @implements {Task.Fork<T, X, M>}
 * @implements {Promise<T>}
 */
class Fork {
  /**
   * @param {Task.Actor<T, X, M>} task
   */
  constructor(task) {
    this.task = task
  }
  /**
   * @param {(value:T) => any} [onresolve]
   * @param {(error:X) => any} [onreject]
   */
  then(onresolve, onreject) {
    const promise = new Promise((resolve, reject) =>
      enqueue(then(this.task, resolve, reject))
    )

    return onresolve || onreject ? promise.then(onresolve, onreject) : promise
  }
  /**
   * @param {(error:X) => any} onreject
   */
  catch(onreject) {
    return this.then().catch(onreject)
  }
  /**
   * @param {() => any} onfinally
   */
  finally(onfinally) {
    return this.then().finally(onfinally)
  }
  get [Symbol.toStringTag]() {
    return "Fork"
  }

  *[Symbol.iterator]() {
    enqueue(this.task)
    return this.task
  }
}
