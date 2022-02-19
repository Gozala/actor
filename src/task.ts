export * from "./lib.js"

import type { Control } from "./lib.js"

export type Instruction<T> = Message<T> | Control

export type Await<T> = T | PromiseLike<T>

export type Result<T extends unknown = unknown, X extends unknown = Error> =
  | Success<T>
  | Failure<X>

export interface Success<T extends unknown> {
  readonly ok: true
  readonly value: T
}

export interface Failure<X extends unknown = Error> {
  readonly ok: false
  readonly error: X
}

type CompileError<Reason extends string> = `🚨 ${Reason}`

/**
 * Helper type to guard users against easy to make mistakes.
 */
export type Message<T> = T extends Task<any, any, any>
  ? CompileError<`You must 'yield * fn()' to delegate task instead of 'yield fn()' which yields generator instead`>
  : T extends (...args: any) => Generator
  ? CompileError<`You must yield invoked generator as in 'yield * fn()' instead of yielding generator function`>
  : T

/**
 * Task is a unit of computation that runs concurrently, a light-weight
 * process (in Erlang terms). You can spawn bunch of them and provided
 * cooperative scheduler will interleave their execution.
 *
 * Tasks have three type variables first two describing result of the
 * computation `Success` that corresponds to return type and `Failure`
 * describing an error type (caused by thrown exceptions). Third type
 * varibale `Message` describes type of messages this task may produce.
 *
 * Please note that that TS does not really check exceptions so `Failure`
 * type can not be guaranteed. Yet, we find them more practical that omitting
 * them as TS does for `Promise` types.
 *
 * Our tasks are generators (not the generator functions, but what you get
 * invoking them) that are executed by (library provided) provided scheduler.
 * Scheduler recognizes two special `Control` instructions yield by generator.
 * When scheduler gets `context` instruction it will resume generator with
 * a handle that can be used to resume running generator after it is suspended.
 * When `suspend` instruction is received scheduler will suspend execution until
 * it is resumed by queueing it from the outside event.
 */
export interface Task<
  Success extends unknown = unknown,
  Failure = Error,
  Message extends unknown = never
> {
  [Symbol.iterator](): Controller<Success, Failure, Message>
}

export interface Controller<
  Success extends unknown = unknown,
  Failure extends unknown = Error,
  Message extends unknown = never
> {
  throw(error: Failure): TaskState<Success, Message>
  return(value: Success): TaskState<Success, Message>
  next(
    value: Task<Success, Failure, Message> | unknown
  ): TaskState<Success, Message>
}

export type TaskState<
  Success extends unknown = unknown,
  Message = unknown
> = IteratorResult<Instruction<Message>, Success>

/**
 * Effect represents potentially asynchronous operation that results in a set
 * of events. It is often comprised of multiple `Task` and represents either
 * chain of events or a concurrent set of events (stretched over time).
 * `Effect` campares to a `Stream` the same way as `Task` compares to `Promise`.
 * It is not representation of an eventual result, but rather representation of
 * an operation which if execute will produce certain result. `Effect` can also
 * be compared to an `EventEmitter`, because very often their `Event` type
 * variable is a union of various event types, unlike `EventEmitter`s however
 * `Effect`s have inherent finality to them an in that regard they are more like
 * `Stream`s.
 *
 * You may notice that `Effect`, is just a `Task` which never fails, nor has a
 * (meaningful) result. Instead it can produce events (send messages).
 */
export interface Effect<Event> extends Task<void, never, Event> {}

export type Status = "idle" | "active" | "finished"

export type Group<T, X, M> = Main<T, X, M> | TaskGroup<T, X, M>

export interface TaskGroup<T, X, M> {
  id: number
  parent: Group<T, X, M>
  driver: Controller<T, X, M>
  stack: Stack<T, X, M>

  result?: Result<T, X>
}

export interface Main<T, X, M> {
  id: 0
  parent?: null
  status: Status
  stack: Stack<T, X, M>
}

export interface Stack<T = unknown, X = unknown, M = unknown> {
  active: Controller<T, X, M>[]
  idle: Set<Controller<T, X, M>>
}

/**
 * Like promise but lazy. It corresponds to a task that is activated when
 * then method is called.
 */
export interface Future<Success, Failure> extends PromiseLike<Success> {
  then<U = Success, G = never>(
    handle?: (value: Success) => U | PromiseLike<U>,
    onrejected?: (error: Failure) => G | PromiseLike<G>
  ): Promise<U | G>

  catch<U = never>(handle: (error: Failure) => U): Future<Success | U, never>

  finally(handle: () => void): Future<Success, Failure>
}

export interface Fork<
  Success extends unknown = unknown,
  Failure extends unknown = Error,
  Message extends unknown = never
> extends Controller<Success, Failure, Message>,
    Task<Fork<Success, Failure, Message>, never>,
    Future<Success, Failure> {
  readonly id: number

  group?: void | TaskGroup<Success, Failure, Message>

  result?: Result<Success, Failure>
  status: Status
  resume(): Task<void, never>
  join(): Task<Success, Failure, Message>

  abort(error: Failure): Task<void, never>
  exit(value: Success): Task<void, never>
}

export interface ForkOptions {
  name?: string
}

export interface StateHandler<T, X> {
  onsuccess?: (value: T) => void
  onfailure?: (error: X) => void
}
