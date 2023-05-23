import * as Task from "./api.js"
export * from "./api.js"
import { SUSPEND, YIELD, UNIT, CONTINUE, Yield, OK } from "./constant.js"
import { resume, current, suspend } from "./scheduler.js"
import * as Channel from "./channel.js"
export { current, suspend }

/**
 * @template {Task.Task<unknown, unknown, {}>} Task
 * @param {() => Task} work
 * @returns {Task.Spawn<Task>}
 */
export const spawn = work => /** @type {*} */ (fork(work()))

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
 * @template {{}} X
 * @template {{}} M
 * @param {Task.Task<T, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Workflow<T, X, M>}
 */
export const fork = (task, options = { name: "fork" }) =>
  Workflow.new(task, options).resume()

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
 * @template {{}} X
 * @template {{}} M
 * @template {[]|Task.Tuple<Task.Workflow<unknown, X, M>>} Work
 * @param {Work|Iterable<Task.Workflow<unknown, X, M>>} work
 * @return {Task.Task<Task.GroupResult<Work>, X, M>}
 */
export function* join(work) {
  const group = current()
  const active = []

  for (const fork of work) {
    fork.group = group
    active.push(fork)
  }

  yield* run(/** @type {Work} */ (active))

  const result = []
  for (const fork of work) {
    result.push(fork.state.ok)
  }

  return /** @type {Task.GroupResult<Work>} */ (result)
}

/**
 * Takes iterable of tasks and runs them concurrently, returning array of
 * results in an order of tasks (not the order of completion). If any of the
 * tasks fail all the rest are aborted and error is throw into calling task.
 *
 * > This is basically equivalent of `Promise.all` except cancelation logic
 * because tasks unlike promises can be cancelled.
 *
 * @template {{}} X
 * @template {Task.Tuple<Task.Task<unknown, X>>} Tasks
 * @param {Tasks} tasks
 * @returns {Task.Task<Task.GroupResult<Tasks>, X>}
 */
export const all = function* (tasks) {
  const work = []
  for (const task of tasks) {
    work.push(Workflow.new(task, { name: "all" }))
  }

  yield* run(work)

  const result = []
  for (const top of work) {
    result.push(top.state.ok)
  }

  return /** @type {Task.GroupResult<Tasks>} */ (result)
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
 * Creates a task that succeeds with given value.
 *
 * @template T
 * @param {T} value
 * @returns {Task.Task<T, never, never>}
 */
export function* succeed(value) {
  return value
}

/**
 * Creates a task that fails with given error.
 *
 * @template X
 * @param {X} error
 * @returns {Task.Task<never, X, never>}
 */
export function* fail(error) {
  throw error
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
    resume(task)
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
 * @template {{}} X
 * @template {{}} M
 * @template {(message:M) => Task.Task<unknown, X, M>} Next
 * @param {Task.Task<unknown, X, M>} init
 * @param {Next} next
 * @returns {Task.Task<Task.Unit, X, M>}
 */
export const loop = function* loop(init, next) {
  /**
   * We maintain two queues of tasks, one for active tasks and one for pending
   * tasks. Active tasks are tasks that are currently running, while pending
   * tasks are tasks that are suspended and waiting to be resumed.
   */
  return yield* run([Workflow.new(init)], next)
}

/**
 * @template {{}} X
 * @template {{}} M
 * @template {(message:M) => Task.Task<unknown, X, M>} Next
 * @param {Task.Workflow<unknown, X, M>[]} work
 * @param {Next} [spawn]
 * @returns {Task.Task<Task.Unit, X, M>}
 */
function* run(work, spawn) {
  /**
   * We maintain two queues of work, one for active workflows and one for
   * parked workflows.
   */
  const active = [...work]
  const parked = []
  /**
   * We keep track of thrown exceptions that we have caught, which we will use
   * in the `finally` block to decide whether to exit the tasks or let them
   * finish cleanup.
   * @type {X[]}
   */
  const errors = []

  // The outer "main" loop keeps running until we exhaust all of the work. Unlike
  // inner "work" loop it never breaks, even on exceptions, because those are
  // caught by the try / catch blocks inside. Inner "work" loop on the other
  // hand breaks on exceptions, when that happens we abort all remaining
  // workflows and let the "main" loop take care of driving them to completion,
  // which allows them to recover from errors with `try / catch` or do a cleanup
  // using `finally`.
  main: while (active.length > 0) {
    try {
      // The inner loop keeps running until there are no more active tasks after
      // which we suspend the whole workflow until some task is resumed at which
      // point this loop will resume until no more tasks are left or exception
      // is thrown.
      work: while (active.length > 0) {
        // The "active" loop iterates over all the active tasks and attempts to
        // advance them. Unlike the outer "work" loop it does not suspend and
        // is done when after active tasks have either completed or got
        // suspended.
        active: while (active.length > 0) {
          // Remove the top task from the active stack and attempt to advance it.
          const top = active[0]
          active.shift()

          const state = top.next()

          // If task is complete there is nothing to do so we move on to the
          // next one.
          if (state.done) {
            continue
          }
          // Otherwise we check the state of the task and act accordingly.
          else {
            switch (state.value) {
              // If task requested suspension we move it into the parked queue.
              case SUSPEND:
                parked.push(top)
                break
              // If task yields we simply push it back to the active queue so
              // we can advance it further after all other active tasks.
              case YIELD:
                active.push(top)
                break
              // Otherwise task yielded a message, which we propagate to the
              // out and push task back to the active queue.
              default: {
                // If we have a `spawn` handler we call it to create concurrent
                // task which we then push into the active queue.
                if (spawn) {
                  const task = spawn(/** @type {M} */ (state.value))
                  active.push(Workflow.new(task))
                }
                active.push(top)
                yield state.value
              }
            }
          }
        }

        // If we got here "active" loop advanced all the tasks it could, yet we
        // may have some suspended tasks left. In that case we suspend the whole
        // workflow until one of the suspended tasks resume after which we'll
        // resume the loop. If we have no suspended tasks we break out of the
        // "work" and "main" loops and return the result.
        if (parked.length > 0) {
          active.push(...parked)
          parked.length = 0
          yield* suspend()
        }
      }
    } catch (cause) {
      const error = /** @type {X} */ (cause)
      // If we have not seen this error before we add it to the list of errors
      // and abort all the tasks. If we have seen this error we ignore it
      // because it is just one of the aborted tasks that did not handle it.
      if (!errors.includes(error)) {
        errors.push(error)
        // Signal all the tasks to abort and move them into the active queue to
        // be driven to completion by the "main" loop.
        for (const top of [...active.splice(0), ...parked.splice(0)]) {
          top.abort(error)
          active.push(top)
        }
      }
    } finally {
      // If we have not caught any errors yet we either have exhausted all the
      // work or this task had been exited while it was suspended. If later
      // we signal all tasks exit to exit and let the "main" loop drive them to
      // completion. If we have caught any errors we do not do anything as the
      // catch block above will have already aborted all the tasks and we just
      // let the "main" loop drive them to completion.
      if (errors.length === 0) {
        // if we still have tasks then `return` was called or exception was thrown
        // in which case we just go ahead and exit all the tasks.
        for (const top of [...active.splice(0), ...parked.splice(0)]) {
          top.exit(/** @type {*} */ (undefined))
          active.push(top)
        }

        // If exit was called we will not be able to go back to the "main" loop
        // which is why we recurse here instead.
        yield* run(active, spawn)
      }
    }
  }

  // If we have not caught any errors we return unit as the result, otherwise
  // we return the first error we have caught as that is the one that caused
  // the whole workflow to abort.
  if (errors.length) {
    throw errors[0]
  } else {
    return UNIT
  }
}

/**
 * @template {unknown} T
 * @template {{}} X
 * @template {{}} M
 * @implements {Task.Workflow<T, X, M>}
 */
class Workflow {
  /**
   * @template {unknown} T
   * @template {{}} X
   * @template {{}} M
   * @param {Task.Task<T, X, M>} task
   * @param {Task.ForkOptions} [options]
   * @returns {Task.Workflow<T, X, M>}
   */
  static new(task, options) {
    return new this(task[Symbol.iterator](), options)
  }
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

  resume() {
    resume(this)

    return this
  }

  /**
   * @returns {Task.Task<T, X, M>}
   */
  *join() {
    this.group = current()
    if (this.group !== this) {
      const [result] = yield* join([
        /** @type {Task.Workflow<T, X, M>} */
        (this),
      ])
      return result
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

    /** @type {Task.Channel<Task.Send<M>>} */
    const channel = Channel.open()
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
  //  */
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
let ID = 0

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
