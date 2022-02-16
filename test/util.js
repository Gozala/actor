import { assert } from "chai"
import * as Task from "../src/lib.js"

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
 */
export const inspect = task => Task.fork(inspector(task))

/**
 * @template T, X, M
 * @param {Task.Task<T, X, M>} task
 * @returns {Task.Task<{ ok: boolean, value?: T, error?: X, mail: M[] }, never>}
 */
export const inspector = function* (task) {
  /** @type {M[]} */
  const mail = []
  let input
  try {
    while (true) {
      const step = task.next(input)
      if (step.done) {
        return { ok: true, value: step.value, mail }
      } else {
        const instruction = step.value
        if (Task.isInstruction(instruction)) {
          input = yield instruction
        } else {
          mail.push(/** @type {M} */ (instruction))
        }
      }
    }
  } catch (error) {
    return { ok: false, error: /** @type {X} */ (error), mail }
  }
}
