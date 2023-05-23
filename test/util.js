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
 * @template T, X
 * @template {{}} M
 * @param {Task.Task<T, X, M>} task
 * @returns {Task.Task<{ok:true, value:T, error?:never, mail:Task.Send<M>[]}|{ok:false, error:X, value?:never, mail:Task.Send<M>[]}, never, M>}
 */
export const inspect = function* (task) {
  /** @type {Task.Send<M>[]} */
  const mail = []
  /** @type {{ok:T, error?:undefined}|{ok?:undefined, error:X}|null} */
  let result = null

  const controller = task[Symbol.iterator]()
  try {
    while (true) {
      const step = controller.next()
      if (step.done) {
        result = { ok: step.value }
        break
      } else {
        if (step.value != undefined) {
          mail.push(step.value)
        }
        yield step.value
      }
    }
  } catch (cause) {
    result = { error: /** @type {X} */ (cause) }
  } finally {
    const output =
      result == null
        ? {
            ok: /** @type {const} */ (false),
            error: /** @type {X} */ (new Error("Task was interrupted")),
            mail,
          }
        : "ok" in result
        ? {
            ok: /** @type {const} */ (true),
            value: /** @type {T} */ (result.ok),
            mail,
          }
        : { ok: /** @type {const} */ (false), error: result.error, mail }

    return output
  }
}
