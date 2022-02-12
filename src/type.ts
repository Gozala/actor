export type Await<T> = T | PromiseLike<T>
export declare function wait<T extends unknown>(value: Await<T>): Task<T>

export declare function perform<T, M>(
  effect: Task<T>,
  message: (data: T) => M
): Effect<M>

export declare function subscribe<T, M>(
  task: Task<void, T>,
  message: (data: T) => M
): Effect<M>

export declare function promise<T>(
  task: Generator<Promise<unknown>, T, unknown>
): Await<T>

// export declare function fork <T> (task: Task<T, never>):Task<Fork<T>>

// export interface Fork<T> {
//   result: Await<T>
// }

export interface Task<T extends unknown = unknown, M = never, X = Error>
  extends Generator<Instruction<M>, T, Actor<any, any, any>> {
  throw(error: X): TaskState<T, M>
  return(value: T): TaskState<T, M>
  next(value?: unknown): TaskState<T, M>
}

export type TaskState<
  T extends unknown = unknown,
  M = unknown
> = IteratorResult<Instruction<M>, T>

export interface Send<M> {
  type: "send"
  message: M
}

export declare function send<M>(message: M): Task<void, M>

export interface Wait {
  type: "wait"
  promise: PromiseLike<unknown>
}

export interface Effect<T> extends Task<void, T> {}

export interface Suspend {
  type: "suspend"
}

interface Self {
  type: "self"
}

export interface Continue {
  type: "continue"
}

export interface TaskView {
  resume(): void

  // spawn <T, M, X>(task:Task<T, M, X>):TaskView
}

export type Instruction<M> = Send<M> | Suspend | Self

export type Status = "idle" | "active"

export type ExecutionState<T, M> =
  | TaskState<T, M>
  | { done: true; value: Suspend }
  | { done: false; value: Continue }

export type Actor<T, M, X> = Main | Fork<T, M, X>

export interface Fork<T, M, X> {
  supervisor: Actor<T, M, X>
  status: Status
  stack: Stack<T, M, X>
  task: Task<T, M, X>

  resume(): void
  fork(task: Task<void, M, X>): Task<void, never, never>
  join(): Task<void, M, X>
}

export interface Main {
  supervisor?: undefined
  status: Status
  stack: Stack<any, any, any>
}

export interface Stack<T, M, X> {
  active: Task<T, M, X>[]
  idle: Set<Task<T, M, X>>
}
