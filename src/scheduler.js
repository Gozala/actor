import * as Task from "./api.js"
import { SUSPEND, UNIT } from "./constant.js"

/** @type {Task.Workflow<*, *, *>[]} */
const QUEUE = []

let idle = true

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
  if (idle) {
    throw new RangeError(`Task.current() must be called from the running task`)
  }
  return QUEUE[0]
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
 * @param {Task.Workflow<*, *, *>} work
 */
export const resume = work => {
  QUEUE.push(work)

  // If the main loop is idle, call occurred from outside of any task, in which
  // case we wake the main loop after a tick so that we could return workflow
  // before execution starts.
  // ⚠️ It is very important to wait a tick here
  // otherwise behavior will be different depending on whether there are some
  // active tasks or not. It also allows the caller to `abort` the workflow
  // before it starts executing.
  if (idle) {
    setImmediate(wake)
  }
}

export const wake = () => {
  if (idle) {
    idle = false
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
    idle = true
  }
}

const setImmediate =
  /* c8 ignore next */
  globalThis.setImmediate || Promise.prototype.finally.bind(Promise.resolve())
