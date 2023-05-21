import * as Task from "./api.js"
export * from "./task.js"

/**
 * @template {unknown} T
 * @template {unknown} X
 * @template {{}} M
 * @param {Task.Task<T, X, M>} task
 * @returns {Promise<T>}
 */
export const perform = task =>
  new Promise((resolve, reject) => {
    const work = Perform(task, resolve, reject)
    const workflow = new Workflow(work, { name: "perform" })
    enqueue(workflow)
  })

/**
 * @template {{}} M
 * @param {Task.Task<void, never, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Workflow<void, never, M>}
 */
export const spawn = (task, options = { name: "spawn" }) => {
  const work = new Workflow(Spawn(task), options)
  enqueue(work)
  return work
}

const TICK = Promise.resolve()
export const tick = function* tick() {
  yield* wait(TICK)
}

/**
 * @template {{}} M
 * @param {Task.Task<void, never, M>} task
 * @returns
 */
function* Spawn(task) {
  yield* tick()
  return yield* task
}

/**
 * @template {unknown} T
 * @template {unknown} X
 * @template {{}} M
 * @param {Task.Task<T, X, M>} work
 * @param {(ok:T) => void} succeed
 * @param {(error:X) => void} fail
 */
function* Perform(work, succeed, fail) {
  try {
    const ok = yield* work
    succeed(ok)
  } catch (error) {
    fail(/** @type {X} */ (error))
  }
}

/**
 * @template {unknown} T
 * @template {unknown} X
 * @template {{}} M
 * @param {Task.Task<T, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Workflow<T, X, M>}
 */
export const fork = (task, options = { name: "fork" }) => {
  const work = new Workflow(task[Symbol.iterator](), options)
  enqueue(work)
  return work
}

const UNIT = Object.freeze({})
const CONTINUE = Object.freeze({ continue: UNIT })
/** @type {{done: true, value: any}} */
/**
 * @template {unknown} T
 * @template {unknown} X
 * @template {{}} M
 * @implements {Task.Workflow<T, X, M>}
 */
class Workflow {
  /**
   * @param {Task.Controller<T, X, M>} top
   * @param {Task.ForkOptions} [options]
   */
  constructor(top, options = {}) {
    this.id = ++ID
    this.top = top

    /** @type {Task.Workflow<*, *, *>} */
    this.group = this
    this.options = options

    /** @type {'ok'|'error'|'pending'} */
    this.status = "pending"

    /** @type {{done:true, value:T}} */
    this.done

    /** @type {T} */
    this.ok
    /** @type {X} */
    this.error

    /** @type {Array<{throw:X}|{return:T}>} */
    this.inbox = []
  }

  get state() {
    const { status, ok, error } = this
    switch (status) {
      case "ok":
        return { ok }
      case "error":
        return { error }
      case "pending":
        return { pending: UNIT }
    }
  }

  get root() {
    /** @type {Task.Workflow<*, *, *>} */
    let task = this
    while (task.group != task) {
      task = task.group
    }
    return task
  }

  /**
   * @returns {Task.TaskState<T, M>}
   */
  next() {
    const { status, top, inbox } = this
    switch (status) {
      case "ok":
        return { done: true, value: this.ok }
      case "error":
        throw this.error
    }

    try {
      const command = inbox.shift() || CONTINUE
      let next
      if ("throw" in command) {
        next = top.throw(command.throw)
      } else if ("return" in command) {
        next = top.return(command.return)
      } else {
        next = top.next()
      }

      if (next.done) {
        this.status = "ok"
        this.ok = next.value
        return next
      } else {
        return next
      }
    } catch (cause) {
      this.status = "error"
      this.error = /** @type {X} */ (cause)

      throw cause
    }
  }
  /**
   * @param {X} error
   * @returns {Task.TaskState<T, M>}
   */
  throw(error) {
    this.inbox.push({ throw: error })
    return { done: false, value: undefined }
  }
  /**
   *
   * @param {T} ok
   */
  return(ok) {
    this.inbox.push({ return: ok })
    return { done: false, value: undefined }
  }

  resume() {
    enqueue(this)

    return this
  }

  /**
   * @returns {Task.Task<T, X, M>}
   */
  *join() {
    this.group = current()
    yield* { [Symbol.iterator]: () => this }
  }
  // /**
  //  * @param {X} error
  //  * @returns {Task.Task<T, X, M>}
  //  */
  // *throw(error) {
  //   this.abort(error)

  //   return yield* this.join()
  // }
  // /**
  //  * @param {T} ok
  //  * @returns {Task.Task<T, X, M>}
  //  */
  // *return(ok) {
  //   this.exit(ok)

  //   return yield* this.join()
  // }
  /**
   * @param {X} error
   */

  abort(error) {
    if (this.status === "pending") {
      this.inbox.push({ throw: error })
    }

    return this
  }
  /**
   *
   * @param {T} value
   */
  exit(value) {
    if (this.status === "pending") {
      this.inbox.push({ return: value })
    }

    return this
  }
}

class Main {
  constructor() {
    this.id = ID
    this.idle = true
  }
}

let ID = 0
/** @type {Task.Workflow<*, *, *>[]} */
const QUEUE = []
const MAIN = new Main()

/**
 * @param {Task.Workflow<*, *, *>} work
 */
const enqueue = work => {
  QUEUE.push(work)
  wake()
}

const wake = () => {
  if (MAIN.idle) {
    MAIN.idle = false
    while (QUEUE.length > 0) {
      const work = QUEUE[0].root

      try {
        const state = work.next()
        // unless workflow is complete or has been suspended, we put it back
        // into the queue.
        if (!state.done && state.value !== SUSPEND) {
          QUEUE.push(work)
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
    handle.resume()
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
 * @template X
 * @template {{}} M
 * @template {Task.Workflow<unknown, X, M>[]} Tasks
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
 * @template X
 * @template {{}} M
 * @template {Task.Workflow<unknown, X, M>[]} Tasks
 * @param {object} state
 * @param {Task.Workflow<unknown, X, M>[]} state.index
 * @param {Task.Workflow<unknown, X, M>[]} state.queue
 * @param {Task.Workflow<unknown, X, M>[]} state.idle
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
        } else if (next.value === YIELD) {
          queue.push(task)
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
      for (const work of [...queue.splice(0), ...idle.splice(0)]) {
        work.abort(state)
        queue.push(work)
      }
    }
  } finally {
    // if we still have tasks then `return` was called or exception was thrown
    // in which case we just go ahead and close things out
    for (const work of [...queue.splice(0), ...idle.splice(0)]) {
      work.exit(undefined)
      queue.push(work)
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

const SUSPEND = null
const YIELD = undefined
const Yield = Object.freeze({ done: false, value: YIELD })
const Suspend = Object.freeze({ done: false, value: SUSPEND })

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
  yield SUSPEND
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
