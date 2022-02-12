import * as API from "./type.js"

export * from "./type.js"

/**
 * @template {string} Tag
 * @template T
 * @param {{ [K in Tag]: API.Task<T, void> }} source
 * @returns {API.Effect<Tagged<Tag, T>>}
 */
export const perform = function* (source) {
  const [tag, task] =
    /** @type {[Tag, API.Task<T>]} */
    (Object.entries(source)[0])

  const message = yield* task
  yield* send(withTag(tag, message))
}

/**
 * @returns {API.Task<void, never, never>}
 */
export const suspend = function* () {
  yield { type: "suspend" }
}

/**
 * @param {number} duration
 * @returns {API.Task<void, never, never>}
 */
export function* sleep(duration) {
  const actor = yield* context()
  const task = top(actor)
  const id = setTimeout(dispatch, duration, task, actor)
  try {
    yield* suspend()
  } finally {
    clearTimeout(id)
  }
}

/**
 * @template T, M, X
 * @returns {API.Task<API.Fork<T, M, X>}
 */
export function* self() {
  return /** @type {API.Fork<T, M, X>} */ (yield { type: "self" })
}

/**
 * @template T, M, X
 * @returns {API.Task<API.Fork<T, M, X>}
 */
export function* context() {
  return /** @type {API.Fork<T, M, X>} */ (yield { type: "context" })
}

/**
 * @template T, [X=unknown]
 * @param {API.Await<T>} input
 * @returns {API.Task<T, never, X>}
 */
export const wait = function* (input) {
  if (isAsync(input)) {
    const actor = yield* context()
    const task = top(actor)
    let failed = false
    let output
    input.then(
      value => {
        failed = false
        output = value
        dispatch(task, actor)
      },
      error => {
        failed = true
        output = error
        dispatch(task, actor)
      }
    )

    yield* suspend()
    if (failed) {
      throw output
    } else {
      // @ts-ignore
      return output
    }
  } else {
    return input
  }
}

/**
 * @template T
 * @param {any} node
 * @returns {node is PromiseLike<T>}
 */

const isAsync = node =>
  node != null &&
  typeof (/** @type {{then?:unknown}} */ (node).then) === "function"

/**
 * @template T
 * @param {T} message
 * @returns {API.Effect<T>}
 */
export const send = function* (message) {
  yield { type: "send", message }
}

/**
 * @template {string} Tag
 * @template T
 * @param {{ [K in Tag]: API.Effect<T> }} source
 * @returns {API.Effect<Tagged<Tag, T>>}
 */
export const listen = function* (source) {
  const [tag, task] =
    /** @type {[Tag, API.Task<void, T>]} */
    (Object.entries(source)[0])

  for (const op of task) {
    if (op.type === "send") {
      yield { type: "send", message: withTag(tag, op.message) }
    } else {
      yield op
    }
  }
}

/**
 * @type {API.Effect<never>}
 */
export const nofx = (function* () {})()

// /**
//  * @template T
//  * @param {API.Task<T>[]} tasks
//  * @returns {API.Task<T[]>}
//  */
// export const all = function * (tasks) {
//   const results = []
//   for (const task of tasks) {
//     const { result } = yield * fork(task)
//     results.push(result)
//   }

//   const values = []
//   for (const result of results) {
//     const value = yield * wait(result)
//     values.push(value)
//   }

//   return values
// }

// /**
//  * @template T
//  * @param {API.Task<T>[]} tasks
//  * @returns {API.Effect<T>}
//  */
// export const batch = function * (tasks) {
//   const results = []
//   for (const task of tasks) {
//     const { result } = yield * fork(task)
//     results.push(result)
//   }

//   for (const result of results) {
//     const value = yield * wait(result)
//     yield * send(value)
//   }
// }

/**
 * @template {string} Tag
 * @template T
 * @param {API.Effect<T>} effect
 * @param {Tag} tag
 * @returns {API.Effect<{type: Tag} & {[K in Tag]: T}>}
 */
export const tag = function* (effect, tag) {
  for (const op of effect) {
    if (op.type === "send") {
      yield { type: "send", message: withTag(tag, op.message) }
    }
  }
}

/**
 * @template {string} Tag
 * @template T
 * @typedef {{type: Tag} & {[K in Tag]: T}} Tagged
 */

/**
 * @template {string} Tag
 * @template T
 * @param {Tag} tag
 * @param {T} value
 */
const withTag = (tag, value) =>
  /** @type {Tagged<Tag, T>} */
  ({ type: tag, [tag]: value })

/**
 * @template T, M, X
 * @param {API.Task<T, M, X>} task
 */
export const execute = task => enqueue(task)

/**
 * @template T, M, X
 * @param {API.Task<T, M, X>} task
 * @returns {Promise<T>}
 */
export const promise = task =>
  new Promise((resolve, reject) => execute(then(task, resolve, reject)))

/**
 * @template T, M, X, U
 * @param {API.Task<T, M, X>} task
 * @param {(value:T) => U} resolve
 * @param {(error:X) => U} reject
 * @returns {API.Task<U, M, never>}
 */
function* then(task, resolve, reject) {
  try {
    return resolve(yield* task)
  } catch (error) {
    return reject(/** @type {X} */ (error))
  }
}

/** @type {{done:true, value: API.Suspend }} */
const SUSPEND = { done: true, value: { type: "suspend" } }
/** @type {{done:false, value: API.Continue}} */
const CONTINUE = { done: false, value: { type: "continue" } }

/**
 * @template T, M, X
 * @param {API.Task<T, M, X>} _task
 * @returns {API.ExecutionState<T, M>}
 */
const init = _task => CONTINUE

/**
 * @template T, M, X
 */
class Stack {
  /**
   * @param {API.Task<T, M, X>[]} [active]
   * @param {Set<API.Task<T, M, X>>} [idle]
   */
  constructor(active = [], idle = new Set()) {
    this.active = active
    this.idle = idle
  }
}

/** @typedef {'idle'|'active'} TaskStatus */
const IDLE = "idle"
const ACTIVE = "active"

/**
 * @template T, M, X
 */
class Main {
  /**
   * @param {TaskStatus} [status]
   * @param {API.Stack<T, M, X>} [stack]
   */
  constructor(status = IDLE, stack = new Stack()) {
    this.status = status
    this.stack = stack
  }
}

/**
 * @template T, M, X
 * @implements {API.Fork<T, M, X>}
 * @implements {API.TaskView}
 */
class Fork {
  /**
   * @template M, X
   * @param {API.Actor<void, M, X>} actor
   */
  static of(actor) {
    const task = top(actor)
    if (task.fork) {
      return task.fork
    } else {
      const fork = new Fork(actor)
      task.fork = fork
      return fork
    }
  }
  /**
   * @param {API.Actor<void, M, X>} supervisor
   * @param {TaskStatus} [status]
   * @param {API.Stack<T, M, X>} [stack]
   */
  constructor(supervisor, status = IDLE, stack = new Stack()) {
    /** @type {API.Task<void, M, X>} */
    this.task = run(this)
    this.supervisor = supervisor
    this.status = status
    this.stack = stack

    /** @type {() => void}  */
    this.resume = () => resume(this)
  }

  /**
   * @param {API.Task<void, M, X>} task
   */
  *fork(task) {
    // @ts-ignore
    this.stack.active.push(task)
  }

  /**
   * @returns {API.Task<void, M, X>}
   */
  *join() {
    yield* run(this)
  }
}

/**
 * @template T, M, X
 * @param {API.Actor<T, M, X>} actor
 */
const resume = actor => {
  while (actor) {
    const { supervisor } = actor
    if (supervisor) {
      const { idle, active } = supervisor.stack
      // if (idle.has(actor.task)) {
      idle.delete(actor.task)
      active.push(actor.task)

      // Basically we do a recursion here
      actor = supervisor
      // } else {
      // console.log('task was not suspended', actor)
      // return
      // }
    } else {
      actor
      // this means we reached the main thread here so we
      // just conusme current batch of messages
      // eslint-disable-next-line no-unused-vars
      for (const _message of wake(actor)) {
      }
      return
    }
  }
}

/**
 * @template T, M, X
 * @param {API.Actor<T, M, X>} actor
 */
export const iterate = function* (actor) {
  for (const send of wake(actor)) {
    yield send.message
  }
}

/**
 * @template T, M, X
 * @param {API.Actor<T, M, X>} actor
 */
const run = function* (actor) {
  while (true) {
    const result = yield* wake(actor)

    if (actor.stack.idle.size > 0) {
      yield* suspend()
    } else {
      actor.ended = true
      return result
    }
  }
}

/**
 * @template T, M, X
 * @param {API.Actor<T, M, X>} actor
 */

const wake = function* (actor) {
  if (actor.status === IDLE) {
    actor.status = ACTIVE

    const { active } = actor.stack
    let task = top(actor)
    while (task) {
      let state = init(task)
      // console.log(task)
      // keep processing insturctions until task is done (or until it is
      // suspendend)
      while (!state.done) {
        // console.log(state, '>>')
        state = yield* step(actor, task, state.value)
        // console.log(state, '<<')
      }

      // If task is complete, or got suspended we move to a next task
      active.shift()
      task = top(actor)
    }

    actor.status = IDLE
  }
}

/**
 * @template T, M, X
 * @param {API.Actor<T, M, X>} actor
 * @returns {API.Task<T, M, X>} actor
 */

const top = actor => actor.stack.active[0]

/**
 * @template T, M, X
 * @param {API.Actor<T, M, X>} actor
 * @param {API.Task<T, M, X>} task
 * @param {API.Instruction<M>|API.Continue} instruction
 */
const step = function* (actor, task, instruction) {
  try {
    switch (instruction.type) {
      // All tasks start and resume with continue, so we just step through
      case "continue":
        return task.next()
      // // if task requested a reference to self create a view for it and pass
      // // it back in.
      // case "self":
      //   return task.next(new Fork(task, actor))
      // if task is suspended we add it to the blocked tasks and change
      // state to "done" so that outer loop will move on to the next task.
      case "suspend":
        actor.stack.idle.add(task)
        return SUSPEND
      // if task has sent a message delegate to the executor and continue
      // execution with a returned value.
      case "send":
        return task.next(yield instruction)
      // if instruction is unknown ask executor to interpret it and
      // act upon it's command.
      // @ts-ignore
      case "context":
        return task.next(actor)
      default:
        return task.throw(
          // @ts-expect-error - This does not match expected error type,
          // however I'm not sure how to handle this better.
          new AbortError(`Unknown instruction ${JSON.stringify(instruction)}`)
        )
    }
  } catch (error) {
    return task.throw(/** @type {X} */ (error))
  }
}

class AbortError extends Error {
  get name() {
    return "AbortError"
  }

  get [Symbol.toStringTag]() {
    return "AbortError"
  }
}

/**
 * @template T, M, X
 * @param {API.Task<T, M, X>} task
 * @param {API.Actor<T, M, X>} actor
 */
export const enqueue = (task, actor = main()) => {
  actor.stack.active.push(task)
  resume(actor)
}

/**
 * @template T, M, X
 * @param {API.Task<T, M, X>} task
 * @param {API.Actor<T, M, X>} actor
 */
const dispatch = (task, actor) => {
  while (actor) {
    const { idle, active } = actor.stack
    if (idle.has(task)) {
      idle.delete(task)
      active.push(task)

      if (actor.supervisor) {
        task = actor.task
        actor = actor.supervisor
      } else {
        // this means we reached the main thread here so we
        // just conusme current batch of messages
        // eslint-disable-next-line no-unused-vars
        for (const _message of wake(actor)) {
        }
        return
      }
    } else {
      return
    }
  }
}

// /**
//  * @template T, M, X
//  * @param {API.Task<T, M, X>} task
//  * @param {TaskGroup<T, M, X>} group
//  */
// const abort = (task, group) => {
//   if (group.blocked.has(task)) {
//     group.blocked.delete(task)
//   }
//   // @ts-ignore - AbortError is not really an X
//   task.throw(new AbortError('Task was aborted'))
// }

// @ts-ignore
// const DEFAULT_GROUP = new TaskGroupView()

/** @type {API.Main} */
const MAIN = new Main()

export const main = () => MAIN

export function* fork2() {
  const actor = yield* context()
  const fork = new Fork(actor)

  enqueue(fork.task, actor)

  return fork
}

/**
 * @template T, M, X
 * @param {API.Task<void, M, X>} subtask
 * @returns {API.Task<void, M, X>}
 */

export function* spawn(subtask) {
  const actor = yield* context()
  const task = top(actor)
  if (!task.fork || task.fork.ended) {
    task.fork = new Fork(actor)
    enqueue(task.fork.task, actor)
  }
  // const fork = Fork.of(actor)
  // enqueue(fork.task, actor)

  enqueue(subtask, task.fork)
}

/**
 * @template M, X
 * @returns {API.Task<void, never, X>}
 */
export function* join() {
  const actor = yield* context()
  const parent = top(actor)
  if (parent.fork) {
    enqueue(parent, actor)
    const rest = parent.fork.task
    parent.fork.task = parent
    // parent.fork.task.return()
    // yield * run(parent.fork)
    yield* rest
  }
}
function* demo() {
  // const fork = yield * fork2()
  console.log("spawn first")
  yield* spawn(child_demo("first"))

  console.log("parent nap")
  yield* sleep(800)

  console.log("spawn second")
  yield* spawn(child_demo("second"))

  console.log("join")
  yield* join()

  console.log("parent sleep")
  yield* sleep(0)
  console.log("perent exit")
}

function* child_demo(name, wake) {
  console.log(`> ${name} sleep`)
  if (!wake) yield* sleep(100)
  console.log(`< ${name} wake`)
}

enqueue(demo())
