import * as Task from "./api.js"
export * from "./api.js"
import { SUSPEND, YIELD, TICK, UNIT, CONTINUE, Yield } from "./constant.js"

/**
 * Starts executing given task in concurrent {@link Task.Workflow}. Can be
 * called from inside another task or outside of any tasks. When invoked from
 * inside the task forked task is detached from the task calling a `fork`,
 * implying that it can outlive it and / or fail without affecting it. You can
 * however call `.join()` on returned workflow, in which case caller task will
 * be blocked until forked task finishes execution.
 *
 * This is also a primary interface for executing tasks from the outside of the
 * task context. Function returns a {@link Task.Workflow} which implements
 * `Promise` API so that task result can be awaited. It also implements
 * `AsyncGenerator` interface that can be used to iterate over messages sent
 * through `for await` loop.
 *
 * @template {unknown} T
 * @template {unknown} X
 * @template {{}} M
 * @param {Task.Task<T, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Workflow<T, X, M>}
 */
export const fork = (task, options = { name: "fork" }) => {
  // Create a workflow containing this task and add it to the queue.
  const work = new Workflow(task[Symbol.iterator](), options)
  QUEUE.push(work)
  // If the main loop is idle, call occurred from outside of any task, in which
  // case we wake the main loop after a tick so that we could return workflow
  // before execution starts.
  // ⚠️ It is very important to wait a tick here
  // otherwise behavior will be different depending on whether there are some
  // active tasks or not. It also allows the caller to `abort` the workflow
  // before it starts executing.
  if (MAIN.idle) {
    TICK.then(wake)
  }

  return work
}

/**
 * Gets a currently running {@link Task.Workflow}. Useful when task needs to
 * suspend execution until some outside event occurs, in which case
 * `workflow.resume()` can be used to resume execution (see `suspend` code
 * example for more details)
 *
 * ⚠️ Note that it is unsafe to call this function outside of the task context
 * and it will throw an error if no task is running.
 *
 * @returns {Task.Workflow<unknown, unknown, {}>}
 */
export const current = () => {
  if (MAIN.idle) {
    throw new RangeError(`Task.current() must be called from the running task`)
  }
  return QUEUE[0]
}

/**
 * Waits for the given {@link Task.Workflow}s to to finish and returns
 * corresponding results. If any of them fail, the error will propagate to the
 * caller (which can be can be caught using try/catch).
 *
 * @example
 * ```ts
 * function *main() {
 *   const a = Task.fork(workerA())
 *   const b = Task.fork(workerB())
 *   const [aResult, bResult] = yield* Task.join([a, b])
 * }
 * ```
 *
 * @template X
 * @template {{}} M
 * @template {Task.Tuple<Task.Workflow<unknown, X, M>>|Iterable<Task.Workflow<unknown, X, M>>} Tasks
 * @param {Tasks} tasks
 * @return {Task.Task<Task.Join<Tasks>, X, M>}
 */
export function* join(tasks) {
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
 * Suspends the current task (task that invoked it), which can then be
 * resumed from another task or an outside event (e.g. `setTimeout` callback)
 * by calling the `workflow.resume()` on the task's workflow.
 *
 * Calling this in almost all cases is preceded by a call to {@link current}
 * that returns a reference to the current task's {@link Task.Workflow} which
 * has a `resume` method that can be used to resume the execution.
 *
 * Note: While this task may fail if it's aborted while it is suspended, which
 * is why it is recommended to always wrap it in a try .. catch/finally so that
 * you can handle the failure or at least perform a cleanup in case execution
 * is aborted.
 *
 * @example
 * ```js
 * import { current, suspend, resume } from "actor"
 * function * sleep(duration) {
 *    // get a reference to this task so we can resume it.
 *    const work = current()
 *    // resume this task when timeout fires
 *    const id = setTimeout(() => work.resume(), duration)
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
 * @returns {Task.Task<{}, never>}
 */
export const suspend = function* Suspend() {
  yield SUSPEND

  return UNIT
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
 * @returns {Task.Task<{}, never, never>}
 */
export function* sleep(duration = 0) {
  // we need to keep track of whether `setTimeout` has been invoked or not
  // because it is possible that task will be resumed several times before
  // timeout is reached.
  let done = false
  const work = current()
  const id = setTimeout(() => {
    done = true
    work.resume()
  }, duration)

  try {
    // we need to keep suspending until timeout is reached, however task
    // might be polled multiple times which is why keep suspending until
    // timeout is reached.
    while (!done) {
      yield* suspend()
    }
    return UNIT
  } finally {
    // If task is aborted or exited before timeout is reached we need to clear
    // the timeout to avoid waking up the task after it has been aborted.
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
 * race conditions that can otherwise occur when values are sometimes promises
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
 * @returns {Task.Task<T, X, never>}
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
 * Task sends given message (or rather an effect producing this message).
 * Please note, you could use `yield message` instead, but you'd risk
 * having to deal with potential breaking changes if library internals change
 * in the future, which in fact may happen as anticipated improvements in
 * TS generator inference could enable replace need for `yield *`.
 *
 * @see https://github.com/microsoft/TypeScript/issues/43632
 *
 * @template T
 * @param {T} message
 */
export const send = function* (message) {
  yield message
}

/**
 * @template {unknown} T
 * @template {unknown} X
 * @template {{}} M
 * @implements {Task.Task<T, X, M>}
 */
class JoinWorkflow {
  /**
   *
   * @param {Workflow<T, X, M>} workflow
   */
  constructor(workflow) {
    this.workflow = workflow
  }
  [Symbol.iterator]() {
    return this.workflow
  }
}

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
        if (this.onsuccess) {
          this.onsuccess(next.value)
        }

        if (this.channel) {
          this.channel.close()
          delete this.channel
        }
      } else if (this.channel && next.value != null) {
        this.channel.put(next.value)
      }

      return next
    } catch (cause) {
      this.status = "error"
      this.error = /** @type {X} */ (cause)
      if (this.onfailure) {
        this.onfailure(cause)
      }

      if (this.channel) {
        this.channel.close()
        delete this.channel
      }

      throw cause
    }
  }

  /**
   * @template {unknown} T
   * @template {unknown} X
   * @template {{}} M
   * @param {Workflow<T, X, M>} self
   * @param {T} value
   */
  static succeed(self, value) {
    self.status = "ok"
    self.ok = value
    if (self.onsuccess) {
      self.onsuccess(value)
    }
  }

  /**
   * @param {X} error
   * @returns {Task.TaskState<T, M>}
   */
  throw(error) {
    this.inbox.push({ throw: error })
    return Yield
  }
  /**
   * @param {T} ok
   * @returns {Task.TaskState<T, M>}
   */
  return(ok) {
    this.inbox.push({ return: ok })
    return Yield
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
    if (this.group !== this) {
      return yield* new JoinWorkflow(this)
    } else {
      yield
      return this.ok
    }
  }

  /**
   * @returns {AsyncGenerator<Task.Send<M>, T, void>}
   */
  async *[Symbol.asyncIterator]() {
    switch (this.status) {
      case "ok":
        return this.ok
      case "error":
        throw this.error
    }

    /** @type {Channel<Task.Send<M>>} */
    const channel = new Channel()
    this.channel = channel
    while (true) {
      const message = await fork(channel.take())
      if (message === undefined) {
        switch (/** @type {keyof typeof this.state} */ (this.status)) {
          case "ok":
            return this.ok
          case "error":
            throw this.error
        }
      } else {
        yield message
      }
    }

    // /** @type {M[]} */
    // this.outbox = []

    // // TODO: This is no good because if generator is not consumed
    // // it will miss messages
    // let block = Workflow.receive(this)
    // while (this.status === "pending") {
    //   const step = await block
    //   block = Workflow.receive(this)
    //   if (step.done) {
    //     break
    //   } else if (step.value) {
    //     yield step.value
    //   }
    // }

    // return this.ok
  }
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

  get promise() {
    const promise = this._promise
    if (!promise) {
      let promise
      switch (this.status) {
        case "ok":
          promise = Promise.resolve(this.ok)
          break
        case "error":
          promise = Promise.reject(this.error)
          break
        case "pending":
          promise = new Promise((succeed, fail) => {
            this.onsuccess = succeed
            this.onfailure = fail
          })
      }

      this._promise = promise
      return promise
    }
    return promise
  }

  /**
   * @template U, [E=never]
   * @param {((value:T) => U | PromiseLike<U>)|undefined|null} [succeed]
   * @param {((error:X) => E|PromiseLike<E>)|undefined|null} [fail]
   * @returns {Promise<U|E>}
   */
  then(succeed, fail) {
    return this.promise.then(succeed, fail)
  }
  /**
   * @template [U=never]
   * @param {(error:X) => U} onfailure
   */
  catch(onfailure) {
    return /** @type {Task.Future<T|U, never>} */ (
      this.promise.catch(onfailure)
    )
  }
  /**
   * @param {() => void} onfinally
   * @returns {Task.Future<T, X>}
   */
  finally(onfinally) {
    return /** @type {Task.Future<T, X>} */ (this.promise.finally(onfinally))
  }

  get [Symbol.toStringTag]() {
    return "Workflow"
  }
}

/**
 * @template {{}} T
 */
class Channel {
  /**
   * @param {T[]} buffer
   */
  constructor(buffer = []) {
    /** @type {"open"|"closed"} */
    this.status = "open"
    this.buffer = buffer
    /** @type {Task.Workflow<*, *, *>[]} */
    this.readQueue = []
  }
  /**
   * @param {T} message
   */
  put(message) {
    if (this.status === "open") {
      this.buffer.push(message)
      const work = this.readQueue.shift()
      if (work) {
        work.resume()
      }
    } else {
      throw new Error("Channel is closed")
    }
  }

  *take() {
    const { buffer, readQueue } = this
    while (this.status === "open" && buffer.length === 0) {
      readQueue.push(current())
      yield* suspend()
    }

    return buffer.shift()
  }

  close() {
    this.status = "closed"
    if (this.buffer.length === 0) {
      for (const work of this.readQueue) {
        work.resume()
      }
      this.readQueue.length = 0
    }
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      yield await Task.fork(this.take())
    }
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

const OK = Symbol("OK")
