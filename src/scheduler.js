import * as Task from "./api.js"
import { SUSPEND } from "./constant.js"

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

const wake = () => {
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
  globalThis.setImmediate || Promise.prototype.finally.bind(Promise.resolve())
