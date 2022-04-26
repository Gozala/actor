import * as Task from "./task.js"
export * from "./task.js"

/**
 * @template X
 * @template M
 * @param {Generator<M|undefined, undefined|void, undefined>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Fork<X, M>}
 */
export const fork = (task, options = {}) => new Fork(task)

/**
 * @template X
 * @template M
 * @param {Generator<M|undefined, undefined|void, undefined>} task
 */

export const spawn = function* Spawn(task) {
  enqueue(new Fork(task))
}

/**
 * @template [X=unknown]
 * @template [M=unknown]
 */
export class Fork {
  /**
   * @param {Generator<M|undefined, undefined|void, undefined>} task
   */
  constructor(task) {
    this.task = task
    /** @type {IteratorResult<M|undefined, undefined|void>} */
    this.state = { done: false, value: undefined }

    /** @type {?(value:void|undefined) => void} */
    this.onsucceed = null
    /** @type {?(error:X) => void} */
    this.onfail = null

    this.group = this
  }
  /**
   * @private
   * @param {any} error
   * @returns {never}
   */
  panic(error) {
    this.result = { ok: false, error }
    this.state = this.task.next()
    if (this.onfail) {
      this.onfail(error)
    }
    throw error
  }
  /**
   * @param {IteratorResult<M|undefined, undefined|void>} state
   */
  step(state) {
    this.state = state
    if (state.done) {
      this.result = { ok: true, value: state.value }
      if (this.onsucceed) {
        this.onsucceed(state.value)
      }
    }
    return state
  }
  next() {
    if (!this.state.done) {
      try {
        return this.step(this.task.next())
      } catch (error) {
        return this.panic(error)
      }
    }

    return this.state
  }
  tryNext() {
    if (!this.state.done) {
      try {
        return this.step(this.task.next())
      } catch (_) {}
    }

    return this.state
  }

  /**
   * @param {X} error
   */
  throw(error) {
    try {
      return this.step(this.task.throw(error))
    } catch (error) {
      return this.panic(error)
    }
  }

  /**
   * @param {X} error
   * @returns
   */
  tryThrow(error) {
    try {
      return this.step(this.task.throw(error))
    } catch (_) {
      return this.state
    }
  }

  return() {
    try {
      return (this.state = this.task.return(undefined))
    } catch (error) {
      return this.panic(error)
    }
  }

  resume() {
    enqueue(this)
  }

  join() {
    return join([this])
  }

  *exit() {
    const state = this.return()
    if (!state.done) {
      yield* this.join()
    }
  }

  /**
   * @param {X} error
   */
  *abort(error) {
    try {
      const state = this.throw(error)
      if (!state.done) {
        yield* this.join()
      }
    } catch (_) {
      // it may not handle error properly so we're just going to catch and
      // ignore we don't want to take down the parent.
    }
  }

  /**
   * @template U, [E=never]
   * @param {((value:undefined) => U | PromiseLike<U>)|undefined|null} [onresolve]
   * @param {((error:X) => E|PromiseLike<E>)|undefined|null} [onreject]
   * @returns {Promise<U|E>}
   */
  then(onresolve, onreject) {
    enqueue(this)
    return this.promise.then(onresolve, onreject)
  }

  get [Symbol.toStringTag]() {
    return "Fork"
  }

  /**
   * @type {Promise<undefined>}
   */
  get promise() {
    const promise = new Promise((succeed, fail) => {
      if (this.state.done) {
        succeed(this.state.done)
      } else {
        this.onsucceed = succeed
        this.onfail = fail
      }
    })
    Object.defineProperty(this, "promise", { value: promise })
    return promise
  }

  *[Symbol.iterator]() {
    enqueue(this)
    return this
  }
}

/**
 * @template X
 * @param {X} error
 */
function* abort(error, target) {
  const fork = target || current()
  fork.throw(error)
  yield* fork.join()
}

function* exit(target) {
  const fork = target || current()
  try {
    fork.return()
  } catch (_) {}
  yield* fork.join()
}

/** @type {Fork[]} */
const QUEUE = []
const MAIN = { idle: true }

const wake = () => {
  if (MAIN.idle) {
    MAIN.idle = false
    while (QUEUE.length > 0) {
      const top = QUEUE[0]

      try {
        let done = false
        while (!done) {
          const state = top.next()
          done = state.done || state.value === undefined
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
 * @param {Fork} fork
 */
export const enqueue = fork => {
  QUEUE.push(fork.group)
  wake()
}

/**
 * @param {Fork} fork
 */
const dequeue = fork => {
  // remove from the queue
  while (true) {
    let index = QUEUE.indexOf(fork)
    if (index >= 0) {
      QUEUE.splice(index, 1)
    } else {
      return fork
    }
  }
}

/**
 * @param {number} [ms=0]
 */
export function* sleep(ms = 0) {
  const handle = current()
  let done = false
  const id = setTimeout(() => {
    done = true
    enqueue(handle)
  }, ms)
  try {
    // might be polled multiple times so it needs
    // to keep blocking until done
    while (!done) {
      yield
    }
  } finally {
    clearTimeout(id)
  }
}

/**
 * @template T, [X=unknown]
 * @param {Task.Await<T>} input
 * @returns {Generator<undefined, T, undefined>}
 */
export function* wait(input) {
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
      yield
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
 * @param {Fork<X, M>[]} forks
 */
export function* join(forks) {
  const group = current()
  let failed = false
  /** @type {X|null} */
  let failure = null
  /** @type {typeof forks} */
  const queue = []
  for (const fork of forks) {
    if (fork.result) {
      if (!failed && !fork.result.ok) {
        failed = true
        failure = fork.result.error
      }
    } else {
      // change group so if task wakes up it can resume a right group
      // we also no longer need
      dequeue(fork).group = group
      queue.push(fork)
    }
  }

  if (failed) {
    failTasks(queue.slice(0), /** @type {X} */ (failure))
  }

  while (queue.length > 0) {
    // take all items from the queue, that way new things pushed will
    // not be processed until next awake
    try {
      for (const top of queue.slice(0)) {
        let done = false
        while (!done) {
          const state = failed ? top.tryNext() : top.next()
          if (state.done) {
            done = true
          } else if (state.value === undefined) {
            // if undefined requeue this task so we check on it in next awake
            done = true
            queue.push(top)
          } else {
            // otherwise just yield value and keep going
            yield state.value
          }
        }
        queue.shift()
      }

      // only pause if we have stuff in the queue otherwise we're done.
      if (queue.length > 0) {
        yield
      }
    } catch (error) {
      failed = true
      failure = /** @type {X} */ (error)
      // remove task that threw an error because it's done
      queue.shift()
      failTasks(queue.slice(0), failure)
    }
  }

  if (failed) {
    throw failure
  }
}

/**
 * @template X, M
 * @param {Fork<X, M>[]} tasks
 * @param {X} error
 */

const failTasks = (tasks, error) => {
  // now go over all the tasks in the queue and crash each one
  for (const top of tasks) {
    top.tryThrow(error)
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

export const current = () => {
  if (MAIN.idle) {
    throw new RangeError(`Task.current() must be called from the running task`)
  }
  return QUEUE[0]
}

export const suspend = function* Suspend() {
  yield
}
