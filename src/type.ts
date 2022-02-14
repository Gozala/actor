export * from "./lib.js"

import type { Control } from "./lib.js"

export type Instruction<T> = Message<T> | Control

export type Await<T> = T | PromiseLike<T>

type CompileError<Reason extends string> = `🚨 ${Reason}`

export type Message2<T> = Exclude<T, Generator>
/**
 * Helper type to guard users against easy to make mistakes.
 */
export type Message<T> = T extends Generator
  ? CompileError<`You must 'yield * fn()' to delegate task instead of 'yield fn()' which yields generator instead`>
  : T extends (...args: any) => Generator
  ? CompileError<`You must yield invoked generator as in 'yield * fn()' instead of yielding generator function`>
  : T

/**
 * An actor is a unit of computation that runs concurrently, a light-weight
 * process (in Erlang terms). You can use spawn bunch of them and provided
 * cooperative scheduler will interleave their execution.
 *
 * Actors have three type variables first two describing result of the
 * computation `Success` that corresponds to return type and `Failure`
 * describing an error type (caused by thrown exceptions). Third type
 * varibale `Message` describes type of messages this actor may produce.
 *
 * Please note that that TS does not really check exceptions so `Failure`
 * type can not be guaranteed. Yet, we find them more practical that omitting
 * them as TS dose for `Promise` types.
 *
 * Our actors are generators (not the generator functions, but what you get
 * invoking them) that are executed by (library provided) provided scheduler.
 * Scheduler recognizes two special `Control` instructions yield by generator.
 * When scheduler gets `context` instruction it will resume generator with
 * a handle that can be used to resume running generator after it is suspended.
 * When `suspend` instruction is received scheduler will suspend execution until
 * it is resumed by queueing it from the outside event.
 */
export interface Actor<
  Success extends unknown = unknown,
  Failure = Error,
  Message extends unknown = unknown
> extends Generator<
    Instruction<Message>,
    Success,
    Actor<Success, Failure, Message> | unknown
  > {
  throw(error: Failure): ActorState<Success, Message>
  return(value: Success): ActorState<Success, Message>
  next(
    value: Actor<Success, Failure, Message> | unknown
  ): ActorState<Success, Message>

  group?: TaskGroup<Failure, Message>

  tag?: string
  id?: number
}

export type ActorState<
  T extends unknown = unknown,
  M = unknown
> = IteratorResult<Instruction<M>, T>

/**
 * Task represents potentially asynchronous operation that may fail, like an
 * HTTP request or DB write. It is like `Promise`, however unlike promise it
 * not a result of an in-flight operation. It is an operation which you can
 * execute, in which case it will either succeed or fail. You can also think
 * of them like lazy promises, they will not do anything until you ask them to.
 *
 * As you may notice `Task` is an `Actor` that never sends a `Message`.
 */
export interface Task<Success, Failure>
  extends Actor<Success, Failure, never> {}

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
 * You may notice that `Effect`, just like `Task` is an `Actor`, but in this
 * case it is a one that never fails, nor has (meaningful) result instead, but
 * can produce events (send messages).
 */
export interface Effect<Event> extends Actor<void, never, Event> {}

export type Status = "idle" | "active"

export type Group<X, M> = Main<X, M> | TaskGroup<X, M>

export interface TaskGroup<X, M> {
  id: number
  parent: Group<X, M>
  driver: Actor<unknown, X, M>
  stack: Stack<unknown, X, M>
}

export interface Main<X, M> {
  parent?: null
  status: Status
  stack: Stack<unknown, X, M>
}

export interface Stack<T = unknown, X = unknown, M = unknown> {
  active: Actor<T, X, M>[]
  idle: Set<Actor<T, X, M>>
}
