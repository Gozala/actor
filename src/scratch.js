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

  next() {
    const state = this.poll()
    if (state.done) {
      return state
    } else {
      try {
        const state = this.task.next()
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

  /**
   * @param {X} error
   */
  throw(error) {
    const state = this.poll()
    if (!state.done) {
      this.task = Throw(this.task, error)
    }
    return state
  }
  /**
   * @param {T} value
   */
  return(value) {
    const state = this.poll()
    if (!state.done) {
      this.task = Return(this.task, value)
    }
    return state
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

  exit() {
    return exit(this)
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
   * @returns {Task.Task<null, never, never>}
   */
  abort(reason) {
    return abort(reason, this)
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
        // group we do not want to interupt other unrelated tasks, which is why
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
  const group = /** @type {Task.Fork<unknown, X, M>} */ (current())
  /** @type {Task.Run<unknown, X, M>[]} */
  const queue = []
  /** @type {typeof queue} */
  const idle = []
  /** @type {typeof queue} */
  const index = []
  const result = new Array(queue.length)

  for (const task of tasks) {
    task.group = group
    queue.push(task)
    index.push(task)
  }

  /** @type {typeof OK|X} */
  let state = OK

  while (true) {
    while (queue.length > 0) {
      const task = queue[0]
      queue.shift()

      try {
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
      } catch (reason) {
        // if we are already aborting just ignore
        if (state === OK) {
          state = /** @type {X}  */ (reason)
          for (const task of [...queue.splice(0), ...idle.splice(0)]) {
            queue.push(Throw(task, state))
          }
        }
      }
    }

    if (idle.length > 0) {
      queue.push(...idle)
      idle.length = 0
      yield* suspend()
    } else if (state === OK) {
      return /** @type {Task.Join<Tasks>} */ (result)
    } else {
      throw state
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Fork<T, X, M>} [fork]
 * @param {T} value
 */
export function* exit(value, fork) {
  const group = fork || current()
  group.return(value)
  enqueue(group)
  if (group === current()) {
    yield* suspend()
  }

  return null
}

/**
 * @template X
 * @param {X} reason
 * @param {Task.Fork<unknown, X, unknown>} [fork]
 * @returns {Task.Task<null, never, never>}
 */
export function* abort(reason, fork) {
  const group = fork || current()
  group.throw(reason)
  enqueue(group)
  if (group === current()) {
    yield* suspend()
  }

  return null
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
