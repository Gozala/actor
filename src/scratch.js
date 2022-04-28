import * as Task from "./task.js"
export * from "./task.js"

/**
 * @template {unknown} X
 * @template M
 * @param {Task.Task<void, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Fork<X, M>}
 */
export const fork = (task, options = {}) => new Group([task[Symbol.iterator]()])

/**
 * @template [X=unknown]
 * @template [M=unknown]
 */
export class Fork {
  /**
   * @param {Task.Controller<void|undefined, X, M>} task
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

    /** @type {Set<Fork<X, M>>} */
    this.linked = new Set()

    this.id = ++ID
  }
  /**
   * @param {Fork<X, M>} task
   */
  link(task) {
    // change group so if task wakes up it can resume a right group
    // we also no longer need
    // TODO: I think it would make more sense to allow associating
    // tasks with multiple groups not just one that way when task
    // will just notify all the groups it belongs to.
    dequeue(task).group = this
    this.linked.add(task)
  }
  /**
   * @param {Fork<X, M>} task
   */
  unlink(task) {
    this.linked.delete(task)
    task.group = task
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
    } else if (this.result?.error) {
      throw this.result.error
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
 * @template X, M
 */
class Group {
  /**
   * @param {Task.Controller<undefined|void, X, M>[]} queue
   */
  constructor(queue = []) {
    this.queue = queue
    this.id = ++ID
    this.task = Join(queue)
    /** @type {Task.TaskState<undefined|void, M> & {error?:X}} */
    this.state = { done: false, value: undefined }

    this.group = this
  }

  /**
   * @param {Task.Task<undefined|void, X, M>} task
   */
  spawn(task) {
    this.queue.push(task[Symbol.iterator]())
  }
  /**
   * @template C
   * @param {C} context
   * @param {(task:Task.Task<undefined|void, X, M> & Task.Controller<undefined|void, X, M>, context:C) => Task.Controller<undefined|void, X, M> & Task.Task<undefined|void, X, M>} [step]
   */
  step(context, step) {
    const { state, task } = this
    if (state.done) {
      if (state.error) {
        throw state.error
      } else {
        return state
      }
    } else {
      if (step) {
        this.task = step(task, context)
      }
      try {
        this.state = this.task.next()
        if (this.state.done && this.onsucceed) {
          this.onsucceed(this.state.value)
        }
        return this.state
      } catch (error) {
        this.state = {
          done: true,
          error: /** @type {X} */ (error),
          value: undefined,
        }

        if (this.onfail) {
          this.onfail(error)
        }

        throw error
      }
    }
  }

  resume() {
    enqueue(this)
  }

  join() {
    return join([this])
  }
  next() {
    return this.step(undefined)
  }
  return() {
    return this.step(undefined, Exit)
  }
  /**
   * @param {X} error
   */
  throw(error) {
    return this.step(error, Abort)
  }

  /**
   * @type {Promise<undefined>}
   */
  get promise() {
    const promise = new Promise((succeed, fail) => {
      if (this.state.done) {
        succeed(this.state.value)
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

  exit() {
    return exit(this)
  }

  abort(reason) {
    return abort(reason, this)
  }
}

/** @type {Fork[]} */
const QUEUE = []
const MAIN = { idle: true }
let ID = 0
const SUSPEND = undefined

const wake = () => {
  if (MAIN.idle) {
    MAIN.idle = false
    while (QUEUE.length > 0) {
      const top = QUEUE[0]

      try {
        let done = false
        while (!done) {
          const state = top.next()
          done = state.done || state.value === SUSPEND
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
 * @param {number} [duration]
 * @returns {Task.Task<void, never>}
 */
export function* sleep(duration = 0) {
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
  /** @type {Fork<X, M>} */
  const group = current()
  // Update all handles to point to a new group
  for (const fork of forks) {
    fork.group = group
  }
  return yield* Join(forks)
}

/**
 * @template T, X, M
 * @param {Fork<X, M>} [group]
 * @returns {Task.Task<T, X, M>}
 */
export function* exit(group) {
  if (!group) {
    const group = current()
    group.task = Exit(group.task, undefined)
    enqueue(group)
    yield SUSPEND
  } else {
    const task = Exit(group.task, undefined)
    group.task = task

    return yield* group.task
  }
}

/**
 * @template X, M
 * @param {X} reason
 * @param {Fork<X, M>} [group]
 */
export function* abort(reason, group) {
  if (!group) {
    const group = current()
    group.task = Abort(group.task, reason)
    enqueue(group)
    yield SUSPEND
  } else {
    const task = Abort(group.task, reason)
    group.task = task
    return yield* group.task
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

/**
 * @template X, M
 * @param {Task.Controller<undefined|void, X, M>[]} queue
 * @returns {Task.Task<undefined|void, X, M> & Task.Controller<undefined|void, X, M>}
 */
function* Join(queue) {
  while (queue.length > 0) {
    /** @type {X|null} */
    let failure = null
    try {
      while (queue.length > 0) {
        try {
          yield* Next(queue)
          if (queue.length > 0) {
            yield SUSPEND
          }
        } catch (reason) {
          failure = failure || /** @type {X} */ (reason)
          // If there was a crash or an abort we need to propagate it to
          // all the tasks in the queue. So we iterate over each one and
          // call throw on them. After loop continues as normal because tasks
          // may catch those errors and continue e.g cleanup.
          yield* Throw(queue, /** @type {X} */ (reason))
        }
      }
      if (failure) {
        throw failure
      }
    } finally {
      // task may be exited early we handle this case by exiting all the tasks
      // in the queue.
      yield* Return(queue, undefined)
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>[]} queue
 * @param {X} error
 */
function* Throw(queue, error) {
  for (const top of queue.slice(0)) {
    try {
      const state = top.throw(error)
      // If done we can just remove from the queue and go to next task
      if (state.done) {
        queue.shift()
      }
      // if task blocks we push it into the end of the queue.
      else if (state.value === SUSPEND) {
        queue.shift()
        queue.push(top)
      }
      // otherwise we propagate the message
      else {
        yield state.value
      }
    } catch (_) {
      // if task throws as we abort just remove it from the queue and move on.
      queue.shift()
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M>[]} queue
 * @param {T} value
 */
function* Return(queue, value) {
  for (const top of queue.slice(0)) {
    try {
      const state = top.return(value)
      if (state.done) {
        queue.shift()
      } else if (state.value === SUSPEND) {
        queue.shift()
        queue.push(top)
      } else {
        yield state.value
      }
    } catch (reason) {
      yield* Throw(queue, /** @type {X} */ (reason))
      throw reason
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Task<T, X, M> & Task.Controller<T, X, M>} task
 * @param {X} reason
 */
function* Abort(task, reason) {
  const state = task.throw(reason)
  if (!state.done) {
    yield state.value
    return yield* task
  }
}

/**
 * @template T, X, M
 * @param {Task.Controller<T, X, M> & Task.Task<T, X, M>} task
 * @param {T} value
 */
function* Exit(task, value) {
  const state = task.return(value)
  if (!state.done) {
    yield state.value
    return yield* task
  }
}

/**
 * @template X, M
 * @param {Task.Controller<undefined|void, X, M>[]} queue
 */
function* Next(queue) {
  for (const top of queue.slice(0)) {
    while (true) {
      const state = top.next()
      if (state.done) {
        queue.shift()
        break
      } else if (state.value === undefined) {
        queue.shift()
        queue.push(top)
        break
      } else {
        yield state.value
      }
    }
  }
}
/**
 * @template X, M
 * @param {Task.Task<undefined|void, X, M>} task
 */
export const spawn = function* Spawn(task) {
  const group = current()
  group.queue.push(task)
  enqueue(group)
}
