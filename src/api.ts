export * from "./task.js"
import { Task, Future, Controller, TaskState, Send, Success } from "./task.js"

export interface Workflow<
  Success extends unknown = unknown,
  Failure extends unknown = unknown,
  Message extends {} = never
> extends Future<Success, Failure> {
  readonly id: number
  root: Workflow<unknown, unknown, {}>

  group: Workflow<unknown, unknown, {}>

  state: Variant<{ ok: Success; error: Failure; pending: Unit }>
  next(): TaskState<Success, Message>
  [Symbol.asyncIterator](): AsyncGenerator<Send<Message>, Success, void>

  // /**
  //  * Suspends underlying task, that is when task yields it
  //  * will not be resumed until `.resume()` is called.
  //  */
  // suspend(): void
  /**
   * Resumes underlying task, that is task will put into a queue and resumed
   * from the last yield point.
   *
   */
  resume(): this
  abort(error: Failure): this
  exit(result: Success): this

  /**
   * Return a new that resumes this one from the last yield point. Execution
   * of returned task causes this task to be moved from it's group into the
   * group of the current task.
   */
  join(): Task<Success, Failure, Message>
}

/**
 * Defines result type as per invocation spec
 *
 * @see https://github.com/ucan-wg/invocation/#6-result
 */

export type Result<T extends {} = {}, X extends {} = {}> = Variant<{
  ok: T
  error: X
}>

export type Tagged<Tag extends string, T> = { type: Tag } & { [K in Tag]: T }
/**
 * @template {string} Tag
 * @template T
 * @typedef {{type: Tag} & {[K in Tag]: T}} Tagged
 */

/**
 * @see {@link https://en.wikipedia.org/wiki/Unit_type|Unit type - Wikipedia}
 */
export interface Unit {}
/**
 * Utility type for defining a [keyed union] type as in IPLD Schema. In practice
 * this just works around typescript limitation that requires discriminant field
 * on all variants.
 *
 * ```ts
 * type Result<T, X> =
 *   | { ok: T }
 *   | { error: X }
 *
 * const demo = (result: Result<string, Error>) => {
 *   if (result.ok) {
 *   //  ^^^^^^^^^ Property 'ok' does not exist on type '{ error: Error; }`
 *   }
 * }
 * ```
 *
 * Using `Variant` type we can define same union type that works as expected:
 *
 * ```ts
 * type Result<T, X> = Variant<{
 *   ok: T
 *   error: X
 * }>
 *
 * const demo = (result: Result<string, Error>) => {
 *   if (result.ok) {
 *     result.ok.toUpperCase()
 *   }
 * }
 * ```
 *
 * [keyed union]:https://ipld.io/docs/schemas/features/representation-strategies/#union-keyed-representation
 */
export type Variant<U extends Record<string, unknown>> = {
  [Key in keyof U]: { [K in Exclude<keyof U, Key>]?: never } & {
    [K in Key]: U[Key]
  }
}[keyof U]

export type Tuple<T> = [T, ...T[]]
