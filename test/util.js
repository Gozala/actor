import { assert } from "chai"
import * as Task from "../src/task.js"

export { assert }

export const createLog = () => {
  /** @type {string[]} */
  const output = []

  return {
    output,
    /**
     * @param {string} message
     */
    log(message) {
      output.push(message)
    },
  }
}

/**
 * @template T, X, M
 * @param {Task.Task<T, X, M>} task
 * @returns {Task.Task<{ok:true, value:T, mail:M[]}|{ok:false, error:X, mail:M[]}, never, M>}
 */
export const inspect = function* (task) {
  /** @type {M[]} */
  const mail = []
  const controller = task[Symbol.iterator]()
  try {
    while (true) {
      const step = controller.next()
      if (step.done) {
        return { ok: true, value: step.value, mail }
      } else {
        if (step.value != undefined) {
          mail.push(step.value)
        }
        yield step.value
      }
    }
  } catch (error) {
    return { ok: false, error: /** @type {X} */ (error), mail }
  }
}
