import * as Task from "./task.js"
export * from "./task.js"

/**
 * @template T
 * @template {unknown} X
 * @template M
 * @param {Task.Task<T, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Fork<T, X, M>}
 */
export const fork = (task, options = {}) =>
  new Fork(task[Symbol.iterator](), options)

/**
 * @template T, X, M
 * @implements {Task.Fork<T, X, M>}
 */
class Fork {
  /**
   * @param {Task.Controller<T, X, M>} task
   * @param {Task.ForkOptions} options
   */
  constructor(task, options) {
    this.id = ++ID
    this.task = task
    /**
     * @type {never
     * |{done:false, value:undefined, aborted?:false}
     * |{done:true, value:T, aborted?:false}
     * |{done:true, error:X, aborted: true}
     * }
     */
    this.state = { done: false, value: undefined }
    this.group = this
    this.options = options
  }

  /**
   * @returns {Task.Controller<Task.Fork<T, X, M>, never, never>}
   */
  *spawn() {
    // Enqueue this fork, then currently running task and then suspend
    // current task. This will cause scheduler to run the spawned task
    // before it continues with the current task. This way we achieve
    // concurrency. If we were to simply enqueue this fork current task
    // may finish before this fork is even started, which is not unreasonable
    // but not what we want.
    enqueue(this)
    enqueue(current())
    yield* suspend()
    return this
  }

  [Symbol.iterator]() {
    return this.spawn()
  }
  /**
   * @returns {Task.TaskState<T, M>}
   */

  /**
   * @template C
   * @param {(task:Task.Controller<T, X, M>, context:C) => Task.TaskState<T, M>} step
   * @param {C} context
   */
  step(step, context) {
    const state = this.poll()
    if (state.done) {
      return state
    } else {
      try {
        const state = step(this.task, context)
        if (state.done) {
          this.state = state
          if (this.onsucceed) {
            this.onsucceed(state.value)
          }
        }
        return state
      } catch (error) {
        this.state = {
          done: true,
          aborted: true,
          error: /** @type {X} */ (error),
        }

        if (this.onfail) {
          this.onfail(error)
        }

        throw error
      }
    }
  }

  /**
   * @returns {Task.TaskState<T, M>}
   */
  poll() {
    const { state } = this
    if (state.aborted) {
      throw state.error
    } else {
      return state
    }
  }

  next() {
    return this.step(task => task.next(), undefined)
  }

  /**
   * @param {X} error
   */
  throw(error) {
    return this.step((task, error) => task.throw(error), error)
  }
  /**
   * @param {T} value
   */
  return(value) {
    return this.step((task, value) => task.return(value), value)
  }

  /**
   * @type {Promise<T>}
   */
  get promise() {
    const promise = new Promise((succeed, fail) => {
      const state = this.poll()
      if (state.done) {
        succeed(state.value)
      } else {
        this.onsucceed = succeed
        this.onfail = fail
      }
    })
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
    enqueue(this)
    return this.promise.then(onresolve, onreject)
  }
  /**
   * @template [U=never]
   * @param {(error:X) => U} onreject
   */
  catch(onreject) {
    return /** @type {Task.Future<T|U, never>} */ (this.then().catch(onreject))
  }
  /**
   * @param {() => void} onfinally
   * @returns {Task.Future<T, X>}
   */
  finally(onfinally) {
    return /** @type {Task.Future<T, X>} */ (this.then().finally(onfinally))
  }

  /**
   * @param {T} value
   * @returns {Task.Task<T, X, M>}
   */
  *exit(value) {
    const state = this.poll()
    if (state.done) {
      return state.value
    } else {
      this.task = Return(this.task, value)
      return yield* this.join()
    }
  }

  *join() {
    const fork = /** @type {Task.Fork<T, X, M>} */ (this)
    const [value] = yield* join(fork)
    return value
  }

  resume() {
    enqueue(this)
  }

  /**
   * @param {X} reason
   * @returns {Task.Task<T, X, M>}
   */
  *abort(reason) {
    const task = Throw(this.task, reason)
    this.task = task
    yield* this
  }
}

class Main {
  constructor() {
    this.id = ID
    this.idle = true
  }
}

let ID = 0
/** @type {Task.Fork<unknown, unknown, unknown>[]} */
const QUEUE = []
const MAIN = new Main()
const SUSPEND = undefined

/**
 * @param {Task.Fork<unknown, unknown, unknown>} task
 */
const enqueue = task => {
  while (task.group != task) {
    task = task.group
  }
  QUEUE.push(task)
  wake()
}

const wake = () => {
  if (MAIN.idle) {
    MAIN.idle = false
    while (QUEUE.length > 0) {
      const top = QUEUE[0]

      try {
        const state = top.next()
        if (!state.done && state.value !== SUSPEND) {
          QUEUE.push(top)
        }
      } catch (_) {
        // Top level task may crash and throw an error, but given this is a main
        // group we do not want to interrupt other unrelated tasks, which is why
        // we discard the error and the task that caused it.
      }
      QUEUE.shift()
    }
    MAIN.idle = true
  }
}

/**
 * @param {number} [duration]
 * @returns {Task.Task<void, never, never>}
 */
export const sleep = (duration = 0) => Sleep(duration)

/**
 * @param {number} [duration]
 * @returns {Task.Run<void, never, never>}
 */
function* Sleep(duration = 0) {
  const handle = current()
  let done = false
  const id = setTimeout(() => {
    done = true
    enqueue(handle)
  }, duration)
  try {
    // might be polled multiple times so it needs
    // to keep blocking until done
    while (!done) {
      yield* suspend()
    }
  } finally {
    clearTimeout(id)
  }
}

/**
 * @template T, [X=unknown]
 * @param {Task.Await<T>} input
 * @returns {Task.Task<T, X, never>}
 */
export const wait = input => Wait(input)

/**
 * @template T, [X=unknown]
 * @param {Task.Await<T>} input
 * @returns {Task.Run<T, X, never>}
 */
function* Wait(input) {
  const task = current()
  if (isAsync(input)) {
    /** @type {boolean|null} */
    let ok = null
    /** @type {unknown} */
    let output = undefined
    input.then(
      value => {
        ok = true
        output = value
        task.resume()
      },
      error => {
        ok = false
        output = error
        task.resume()
      }
    )

    while (ok == null) {
      yield* suspend()
    }
    if (ok) {
      return /** @type {T} */ (output)
    } else {
      throw output
    }
  } else {
    enqueue(task)
    yield
    return input
  }
}

/**
 * @template X, M
 * @template {Task.Fork<unknown, X, M>[]} Tasks
 * @param {Tasks} tasks
 * @return {Task.Task<Task.Join<Tasks>, X, M>}
 */
export function* join(...tasks) {
  const group = current()
  const queue = []
  const index = []

  for (const task of tasks) {
    task.group = group
    queue.push(task)
    index.push(task)
  }

  const output = yield* Join({
    queue,
    index,
    idle: [],
    result: new Array(queue.length),
    state: OK,
  })

  return output
}

/**
 * @template X, M
 * @template {Task.Fork<unknown, X, M>[]} Tasks
 * @param {object} state
 * @param {Task.Run<unknown, X, M>[]} state.index
 * @param {Task.Run<unknown, X, M>[]} state.queue
 * @param {Task.Run<unknown, X, M>[]} state.idle
 * @param {unknown[]} state.result
 * @param {typeof OK|X} state.state
 * @return {Task.Task<Task.Join<Tasks>, X, M>}
 */
function* Join({ index, queue, idle, result, state }) {
  try {
    // we keep looping as long as there are idle or queued tasks.
    while (queue.length + idle.length > 0) {
      // as long as we have tasks in the queue we step through them
      // concurrently. If task suspends we add them to the idle list
      // otherwise we push it back to the queue.
      while (queue.length > 0) {
        const task = queue[0]
        queue.shift()

        const next = task.next()

        if (next.done) {
          if (state == OK) {
            result[index.indexOf(task)] = next.value
          }
        } else if (next.value === SUSPEND) {
          idle.push(task)
        } else {
          queue.push(task)
          yield next.value
        }
      }

      // If we got here we no longer have tasks in the queue, which means
      // we either have nothing else to do or all tasks had been suspended.

      // When we have idle tasks that means we have suspended tasks, in that
      // case we enqueue all of them and suspend this task.
      if (idle.length > 0) {
        queue.push(...idle)
        idle.length = 0
        yield* suspend()
      }
      // If we don't have idle tasks we're done. If we were joining OK state
      // we return the result, otherwise we throw.
      else if (state === OK) {
        return /** @type {Task.Join<Tasks>} */ (result)
      } else {
        throw state
      }
    }
  } catch (reason) {
    // if we are already aborting just ignore otherwise we queue tasks to abort
    // all the existing tasks.
    if (state === OK) {
      state = /** @type {X}  */ (reason)
      for (const task of [...queue.splice(0), ...idle.splice(0)]) {
        queue.push(Throw(task, state))
      }
    }
  } finally {
    // if we still have tasks then `return` was called or exception was thrown
    // in which case we just go ahead and close things out
    for (const task of [...queue.splice(0), ...idle.splice(0)]) {
      queue.push(Return(task, undefined))
    }

    if (queue.length > 0) {
      yield* Join({ queue, index, idle, result, state })
    }
  }

  if (state === OK) {
    return /** @type {Task.Join<Tasks>} */ (result)
  } else {
    throw state
  }
}

/**
 * @template T, X, M
 * @param {Task.Fork<T, X, M>} [fork]
 * @param {T} value
 * @returns {Task.Task<T, X, M>}
 */
export function* exit(value, fork) {
  if (fork) {
    return yield* fork.exit(value)
  } else {
    const fork = /** @type {Task.Fork<T, X, M>} */ (current())

    fork.task = Return(fork.task, value)
    // const fork = current()
    // fork.return(value)
    enqueue(fork)
    yield* suspend()
    return value
  }
}

/**
 * @template T, X, M
 * @param {X} reason
 * @param {Task.Fork<T, X, M>} [fork]
 * @returns {Task.Task<T, X, M>}
 */
export function* abort(reason, fork) {
  if (fork) {
    return yield* fork.abort(reason)
  } else {
    const fork = /** @type {Task.Fork<T, X, M>} */ (current())
    return yield* fork.abort(reason)
    // enqueue(fork)
    // yield* suspend()
    // throw reason
  }
}

/**
 * @template T
 * @param {T} message
 */
export const send = function* (message) {
  yield message
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
 * @template T, X, M
 */
export const current = () => {
  if (MAIN.idle) {
    throw new RangeError(`Task.current() must be called from the running task`)
  }
  return QUEUE[0]
}

export const suspend = function* Suspend() {
  yield
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>} task
 * @param {T} value
 */
function* Return(task, value) {
  const state = task.return(value)
  if (state.done) {
    return state.value
  } else {
    yield state.value
    return yield* Continue(task)
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>} task
 * @param {X} error
 */
function* Throw(task, error) {
  const state = task.throw(error)
  if (state.done) {
    return state.value
  } else {
    yield state.value
    return yield* Continue(task)
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>} task
 */
function* Continue(task) {
  while (true) {
    const state = task.next()
    if (state.done) {
      return state.value
    } else {
      yield state.value
    }
  }
}

const OK = Symbol("OK")
