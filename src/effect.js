import * as Task from "./api.js"
import { send, fork, join } from "./lib.js"
import { SUSPEND, YIELD } from "./constant.js"

/**
 * Returns empty `Effect`, that is produces no messages. Kind of like `[]` or
 * `""` but for effects.
 *
 * @type {() => Task.Effect<never>}
 */
export const none = () => NONE

/**
 * Takes several effects and merges them into a single effect of tagged
 * variants so that their source could be identified via `type` field.
 *
 * @example
 * ```js
 * listen({
 *    read: Task.effect(dbRead),
 *    write: Task.effect(dbWrite)
 * })
 * ```
 *
 * @template {Record<string, Task.Effect>} Source
 * @param {Source} source
 * @returns {Task.Effect<Task.Variant<{[Tag in keyof Source]: Source[Tag] extends Task.Effect<infer M> ? M : never}>>}
 */
export const listen = function* (source) {
  const forks = []
  for (const entry of Object.entries(source)) {
    const [name, effect] = entry

    const work = fork(Tag(name, effect))
    forks.push(work)
  }

  yield* join(/** @type {*} */ (forks))
}

/**
 * Takes several effects and combines them into a one.
 *
 * @template {{}} T
 * @param {Task.Effect<T>[]} effects
 * @returns {Task.Effect<T>}
 */
export function* batch(effects) {
  const forks = []
  for (const effect of effects) {
    forks.push(fork(effect))
  }

  yield* join(forks)
}

/**
 * Executes a task and produces it's result as a message.
 *
 * @template T
 * @param {Task.Task<T, never>} task
 * @returns {Task.Effect<T>}
 */
export const perform = function* (task) {
  const message = yield* task
  yield* send(/** @type {Task.Send<T>} */ (message))
}

/**
 * @template {string} Label
 * @template T, X
 * @template {{}} M
 * @param {Label} label
 * @param {Task.Task<T, X, M>} source
 * @returns {Task.Task<Record<Label, T>, X, Record<Label, M>>}
 */
function* Tag(label, source) {
  const iterator = source[Symbol.iterator]()
  while (true) {
    const next = iterator.next()
    if (next.done) {
      return /** @type {Record<Label, T>} */ ({ [label]: next.value })
    } else {
      switch (next.value) {
        case SUSPEND:
        case YIELD:
          yield next.value
          break
        default:
          yield /** @type {Task.Send<Record<Label, M>>} */ ({
            [label]: /** @type {M} */ (next.value),
          })
      }
    }
  }
}
/** @type {Task.Effect<never>} */
const NONE = (function* none() {})()
