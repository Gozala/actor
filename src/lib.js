import * as Task from "./type.js"

export * from "./type.js"

/**
 * @template {string} Tag
 * @template T
 * @param {{ [K in Tag]: Task.Task<T, void> }} source
 * @returns {Task.Effect<Tagged<Tag, T>>}
 */
export const perform = function* (source) {
  const [tag, task] =
    /** @type {[Tag, Task.Task<T>]} */
    (Object.entries(source)[0])

  const message = yield* task
  yield* send(withTag(tag, message))
}

/**
 * @returns {Task.Task<void, never, never>}
 */
export const suspend = function* () {
  yield SUSPEND
}

/**
 * @template T, M, X
 * @returns {Task.Task<Task.Task<T, M, X>, never, never>}
 */
export function* context() {
  return /** @type {Task.Task<T, M, X>} */ (yield CONTEXT)
}

/**
 * @param {number} duration
 * @returns {Task.Task<void, never, never>}
 */
export function* sleep(duration, tag = "🥸") {
  const task = yield* context()
  task.tag = tag

  const id = setTimeout(function () {
    enqueue(task)
  }, duration)
  try {
    yield* suspend()
  } finally {
    clearTimeout(id)
  }
}

// /**
//  * @template T, M, X
//  * @returns {Task.Task<Task.Fork<T, M, X>}
//  */
// export function* self() {
//   return /** @type {Task.Fork<T, M, X>} */ (yield { type: "self" })
// }

/**
 * @template T, [X=unknown]
 * @param {Task.Await<T>} input
 * @returns {Task.Task<T, never, X>}
 */
export const wait = function* (input) {
  if (isAsync(input)) {
    const task = yield* context()
    let failed = false
    let output
    input.then(
      value => {
        failed = false
        output = value
        enqueue(task)
      },
      error => {
        failed = true
        output = error
        enqueue(task)
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
 * @returns {Task.Effect<T>}
 */
export const send = function* (message) {
  yield message
}

/**
 * @template {string} Tag
 * @template T
 * @param {{ [K in Tag]: Task.Effect<T> }} source
 * @returns {Task.Effect<Tagged<Tag, T>>}
 */
export const listen = function* (source) {
  const [tag, task] =
    /** @type {[Tag, Task.Task<void, T>]} */
    (Object.entries(source)[0])

  for (const op of task) {
    switch (op) {
      case SUSPEND:
      case CONTEXT:
        yield op
      default:
        yield withTag(tag, /** @type {T} */ (op))
    }
  }
}

/**
 * @type {Task.Effect<never>}
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

// /**
//  * @template {string} Tag
//  * @template T
//  * @param {Task.Effect<T>} effect
//  * @param {Tag} tag
//  * @returns {Task.Effect<{type: Tag} & {[K in Tag]: T}>}
//  */
// export const tag = function* (effect, tag) {
//   for (const op of effect) {
//     if (op.type === "send") {
//       yield { type: "send", message: withTag(tag, op.message) }
//     }
//   }
// }

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
 * @param {Task.Task<T, M, X>} task
 */
export const execute = task => enqueue(task)

/**
 * @template T, M, X
 * @param {Task.Task<T, M, X>} task
 * @returns {Promise<T>}
 */
export const promise = task =>
  new Promise((resolve, reject) => execute(then(task, resolve, reject)))

/**
 * Kind of like promise.then which is handy when you want to extract result
 * from the given task from the outside.
 *
 * @template T, M, X, U
 * @param {Task.Task<T, M, X>} task
 * @param {(value:T) => U} resolve
 * @param {(error:X) => U} reject
 * @returns {Task.Task<U, M, never>}
 */
export function* then(task, resolve, reject) {
  try {
    return resolve(yield* task)
  } catch (error) {
    return reject(/** @type {X} */ (error))
  }
}

const SUSPEND = Symbol("suspend")
const CONTEXT = Symbol("context")
/** @typedef {typeof SUSPEND|typeof CONTEXT} Instruction */

/**
 * @template T, M, X
 */
class Stack {
  /**
   * @param {Task.Task<T, M, X>[]} [active]
   * @param {Set<Task.Task<T, M, X>>} [idle]
   */
  constructor(active = [], idle = new Set()) {
    this.active = active
    this.idle = idle
  }
}

/** @typedef {'idle'|'active'} TaskStatus */
/** @type {TaskStatus} */
const IDLE = "idle"
const ACTIVE = "active"

/**
 * @template M, X
 * @implements {Task.TaskGroup<M, X>}
 */
class Group {
  /**
   * @param {Task.Task<unknown, M, X>} driver
   * @param {Task.Task<void, M, X>[]} [active]
   * @param {Set<Task.Task<void, M, X>>} [idle]
   * @param {Task.Stack<void, M, X>} [stack]
   */
  constructor(
    driver,
    active = [],
    idle = new Set(),
    stack = new Stack(active, idle)
  ) {
    this.driver = driver
    this.parent = driver.group || MAIN
    this.stack = stack
    this.id = ++ID
  }
}

/**
 * @template M, X
 * @implements {Task.Main<M, X>}
 */
class Main {
  constructor() {
    this.status = IDLE
    this.stack = new Stack()
  }
}

// /**
//  * @param {Task.Group} group
//  * @returns {Task.Task<void, unknown, never>}
//  */
// const run = function* (group) {
//   while (isPending(group)) {
//     yield* step(group)

//     yield* suspend()
//   }
// }

// /**
//  * @template T, M, X
//  * @implements {Task.Fork<T, M, X>}
//  * @implements {Task.TaskView}
//  */
// class Fork {
//   /**
//    * @param {Task.Actor<void, M, X>} supervisor
//    * @param {Task.Task<T, M, X>[]} [active]
//    * @param {Set<Task.Task<T, M, X>>} [idle]
//    * @param {TaskStatus} [status]
//    * @param {Task.Stack<T, M, X>} [stack]
//    */
//   constructor(
//     supervisor,
//     active = [],
//     idle = new Set(),
//     status = IDLE,
//     stack = new Stack(active, idle)
//   ) {
//     /** @type {Task.Task<void, M, X>} */
//     // this.task = Object.assign(run(this), { tag: "Fork.run" })
//     this.supervisor = supervisor
//     this.status = status
//     this.stack = stack

//     /** @type {() => void}  */
//   }
// }

/**
 * Task to drive group to completion.
 *
 * @template M, X
 * @param {Task.Group<M, X>} group
 * @returns {Task.Task<void, M, X>}
 */
const drive = function* (group) {
  // Unless group has no work
  while (true) {
    yield* step(group)
    if (!isEmpty(group.stack)) {
      yield* suspend()
    } else {
      break
    }
  }
}

/**
 * @param {Task.Stack} stack
 */
const isEmpty = stack => stack.idle.size === 0 && stack.active.length === 0

/**
 * @template T, M, X
 * @param {Task.Task<T, M, X>} task
 */
export const enqueue = task => {
  // If task is not a member of any group assign it to main group
  let group = task.group || MAIN
  group.stack.active.push(task)
  group.stack.idle.delete(task)

  // then walk up the group chain and unblock their driver tasks.
  while (group.parent) {
    const { idle, active } = group.parent.stack
    if (idle.has(group.driver)) {
      idle.delete(group.driver)
      active.push(group.driver)
    } else {
      console.error("group driver is not idle", Task.id(group.driver))
      // if driver was not blocked it must have been unblocked by
      // other task so stop there.
      break
    }

    group = group.parent
  }

  if (MAIN.status === IDLE) {
    MAIN.status = ACTIVE
    for (const message of step(MAIN)) {
    }

    MAIN.status = IDLE
  }
}

/**
 * @template T, M, X
 * @param {Task.Task<T, M, X>} task
 */
export const id = task =>
  `${task.tag || ""}:${task.id || (task.id = ++ID)}@${
    task.group ? task.group.id : "main"
  }`

let DEPTH = 0
/**
 * @template M, X
 * @param {Task.Group<M, X>} context
 */

const step = function* (context) {
  const { active } = context.stack
  let task = top(context)
  while (task) {
    // we never actually set task.state just use it to infer type
    const { group } = task
    let state = task.next(task)
    // Keep processing insturctions until task is done, it send suspend request
    // or it's group changed.
    // ⚠️ Group changes require extra care so please make sure to understand
    // the detail here. It occurs when spawned task(s) are joined into a group
    // which will change the task driver, that is why if group changes we need
    // to drop the task otherwise race condition will occur due to task been
    // driven by multiple concurrent schedulers.
    loop: while (!state.done && task.group === group) {
      try {
        const instruction = state.value
        switch (instruction) {
          // if task is suspended we add it to the idle list and break the loop
          // to move to a next task.
          case SUSPEND:
            context.stack.idle.add(task)
            break loop
          // if task requested a context (which is usually to suspend itself)
          // pass back a task reference and continue.
          case CONTEXT:
            state = task.next(task)
            break
          default:
            // otherwise task sent a message which we yield to the driver and
            // continue
            state = task.next(yield instruction)
            break
        }
      } catch (error) {
        state = task.throw(/** @type {X} */ (error))
      }
    }

    // If task is complete, or got suspended we move to a next task
    active.shift()
    task = top(context)
  }
}

/**
 * @template M, X
 * @param {Task.Group<M, X>} group
 */

const top = group => group.stack.active[0]

class AbortError extends Error {
  get name() {
    return "AbortError"
  }

  get [Symbol.toStringTag]() {
    return "AbortError"
  }
}

// /**
//  * @template T, M, X
//  * @param {API.Task<T, M, X>} task
//  * @param {API.Actor<T, M, X>} actor
//  */
// const dispatch = (task, actor) => {
//   while (actor) {
//     const { idle, active } = actor.stack
//     if (idle.has(task)) {
//       idle.delete(task)
//       active.push(task)

//       if (actor.supervisor) {
//         task = actor.task
//         actor = actor.supervisor
//       } else {
//         // this means we reached the main thread here so we
//         // just conusme current batch of messages
//         // eslint-disable-next-line no-unused-vars
//         for (const _message of wake(actor)) {
//         }
//         return
//       }
//     } else {
//       return
//     }
//   }
// }

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

/** @type {Task.Main<unknown, unknown>} */
const MAIN = new Main()
let ID = 0

/**
 * @template T, M, X
 * @param {Task.Task<T, M, X>} task
 * @returns {Task.Task<Task.Task<T, M, X>, M, X>}
 */

export function* spawn(task) {
  enqueue(task)

  return task
}

/**
 * @template M, X
 * @param {Task.Task<void, M, X>[]} tasks
 * @returns {Task.Task<void, M, X>}
 */
export function* join(...tasks) {
  const self = yield* context()
  /** @type {Task.TaskGroup<M, X>} */
  const group = new Group(self)

  for (const task of tasks) {
    move(task, group)
  }

  yield* drive(group)
}

// /**
//  * @template M, X
//  * @returns {Task.Task<void, never, X>}
//  */
// export function* join(...forks) {
//   const actor = yield* context()
//   const active = forks
//   // const active = forks.filter(isPending)
//   console.log(">>>>", actor.stack)
//   if (active.length > 1) {
//     active.shift()
//     const actor = yield* context()
//     // const task = top(actor)
//     // const join = new Fork(actor)
//     for (const fork of active) {
//       yield* fork.task
//       // fork.task.actor = join

//       // actor.stack.idle.delete(fork.wrapper)
//       // join.stack.idle.add(fork.task)
//       //   fork.supervisor.stack.idle.delete(fork.task)
//       //   fork.supervisor.stack.idle.add(join.task)
//       //   // fork.task = task

//       //   // fork.supervisor = join
//       //   join.stack.active.push(fork.task)

//       //   console.log("?", fork)
//       //   // fork.task.return()
//       //   // join.stack.active.push(run(fork))
//     }
//     // yield* join.task
//     console.log("joined")
//     // console.log("<<", join)
//   } else if (active.length === 1) {
//     // const actor = yield* context()
//     // const task = top(actor)
//     const [fork] = active

//     // const rest = fork.task
//     // fork.task = task

//     // enqueue(task, actor)
//     // yield* rest
//     // if (actor.stack.)
//     dequeue(fork.task, actor)

//     yield* fork.task
//   }
//   // const task = top(actor)
//   // if (task.fork) {
//   //   enqueue(task, actor)
//   //   const rest = task.fork.task
//   //   task.fork.task = task
//   //   // parent.fork.task.return()
//   //   // yield * run(parent.fork)
//   //   yield* rest
//   // }
// }

/**
 * @template M, X
 * @param {Task.Task<void, M, X>} task
 * @param {Group<M, X>} to
 */
const move = (task, to) => {
  const from = task.group || MAIN
  if (from !== to) {
    const { active, idle } = from.stack
    const target = to.stack
    // If it is idle just move from one group to the other
    // and update the group task thinks it belongs to.
    if (idle.has(task)) {
      idle.delete(task)
      target.idle.add(task)
      task.group = to
    } else {
      const index = active.indexOf(task)
      // If task is in the job queue, we move it to a target job queue. Moving
      // top task in the queue requires extra care so it does not end up
      // processed by two groups which would lead to race. For that reason
      // `step` loop checks for group changes on each turn.
      if (index >= 0) {
        active.splice(index, 1)
        target.active.push(task)
        task.group = to
      }
      // otherwise task is complete
    }
  }
}
