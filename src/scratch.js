import * as Task from "./task.js"
export * from "./task.js"

/**
 * @template T
 * @template {unknown} X
 * @template M
 * @param {Task.Task<T, X, M>} task
 * @param {Task.ForkOptions} [options]
 * @returns {Task.Thread<T, X, M>}
 */
export const fork = (task, options = {}) => new Fork(task[Symbol.iterator]())

// /**
//  * @template [X=unknown]
//  * @template [M=unknown]
//  */
// export class Fork {
//   /**
//    * @param {Task.Controller<void|undefined, X, M>} task
//    */
//   constructor(task) {
//     this.task = task
//     /** @type {IteratorResult<M|undefined, undefined|void>} */
//     this.state = { done: false, value: undefined }

//     /** @type {?(value:void|undefined) => void} */
//     this.onsucceed = null
//     /** @type {?(error:X) => void} */
//     this.onfail = null

//     this.group = this

//     /** @type {Set<Fork<X, M>>} */
//     this.linked = new Set()

//     this.id = ++ID
//   }
//   /**
//    * @param {Fork<X, M>} task
//    */
//   link(task) {
//     // change group so if task wakes up it can resume a right group
//     // we also no longer need
//     // TODO: I think it would make more sense to allow associating
//     // tasks with multiple groups not just one that way when task
//     // will just notify all the groups it belongs to.
//     dequeue(task).group = this
//     this.linked.add(task)
//   }
//   /**
//    * @param {Fork<X, M>} task
//    */
//   unlink(task) {
//     this.linked.delete(task)
//     task.group = task
//   }
//   /**
//    * @private
//    * @param {any} error
//    * @returns {never}
//    */
//   panic(error) {
//     this.result = { ok: false, error }
//     this.state = this.task.next()
//     if (this.onfail) {
//       this.onfail(error)
//     }
//     throw error
//   }
//   /**
//    * @param {IteratorResult<M|undefined, undefined|void>} state
//    */
//   step(state) {
//     this.state = state
//     if (state.done) {
//       this.result = { ok: true, value: state.value }
//       if (this.onsucceed) {
//         this.onsucceed(state.value)
//       }
//     }
//     return state
//   }
//   next() {
//     if (!this.state.done) {
//       try {
//         return this.step(this.task.next())
//       } catch (error) {
//         return this.panic(error)
//       }
//     } else if (this.result?.error) {
//       throw this.result.error
//     }

//     return this.state
//   }
//   tryNext() {
//     if (!this.state.done) {
//       try {
//         return this.step(this.task.next())
//       } catch (_) {}
//     }

//     return this.state
//   }

//   /**
//    * @param {X} error
//    */
//   throw(error) {
//     try {
//       return this.step(this.task.throw(error))
//     } catch (error) {
//       return this.panic(error)
//     }
//   }

//   /**
//    * @param {X} error
//    * @returns
//    */
//   tryThrow(error) {
//     try {
//       return this.step(this.task.throw(error))
//     } catch (_) {
//       return this.state
//     }
//   }

//   return() {
//     try {
//       return (this.state = this.task.return(undefined))
//     } catch (error) {
//       return this.panic(error)
//     }
//   }

//   resume() {
//     enqueue(this)
//   }

//   join() {
//     return join([this])
//   }

//   *exit() {
//     const state = this.return()
//     if (!state.done) {
//       yield* this.join()
//     }
//   }

//   /**
//    * @param {X} error
//    */
//   *abort(error) {
//     try {
//       const state = this.throw(error)
//       if (!state.done) {
//         yield* this.join()
//       }
//     } catch (_) {
//       // it may not handle error properly so we're just going to catch and
//       // ignore we don't want to take down the parent.
//     }
//   }

//   /**
//    * @template U, [E=never]
//    * @param {((value:undefined) => U | PromiseLike<U>)|undefined|null} [onresolve]
//    * @param {((error:X) => E|PromiseLike<E>)|undefined|null} [onreject]
//    * @returns {Promise<U|E>}
//    */
//   then(onresolve, onreject) {
//     enqueue(this)
//     return this.promise.then(onresolve, onreject)
//   }

//   get [Symbol.toStringTag]() {
//     return "Fork"
//   }

//   /**
//    * @type {Promise<undefined>}
//    */
//   get promise() {
//     const promise = new Promise((succeed, fail) => {
//       if (this.state.done) {
//         succeed(this.state.done)
//       } else {
//         this.onsucceed = succeed
//         this.onfail = fail
//       }
//     })
//     Object.defineProperty(this, "promise", { value: promise })
//     return promise
//   }

//   *[Symbol.iterator]() {
//     enqueue(this)
//     return this
//   }
// }

/**
 * @template T, X, M
 * @implements {Task.Thread<T, X, M>}
 */
class Fork {
  /**
   * @param {Task.Run<T, X, M>} task
   */
  constructor(task) {
    this.id = ++ID
    this.task = task
    /** @type {(Task.TaskState<T, M> & {error?:undefined}) | {done:true, error:X, value?:T}} */
    this.state = { done: false, value: undefined }
    /** @type {Task.Queue<T, X, M>} */
    this.group = MAIN
  }

  enqueue() {
    this.resume()
  }

  /**
   * @returns {Task.TaskState<T, M>}
   */

  next() {
    const { state } = this
    if (state.done) {
      if (state.error != null) {
        throw state.error
      } else {
        return /** @type {Task.TaskState<T, M>} */ (state)
      }
    } else {
      try {
        const state = this.task.next()
        this.state = state
        if (state.done && this.onsucceed) {
          this.onsucceed(state.value)
        }
        return state
      } catch (error) {
        this.state = {
          done: true,
          error: /** @type {X} */ (error),
        }

        if (this.onfail) {
          this.onfail(error)
        }

        throw error
      }
    }
  }

  resume() {
    this.group.enqueue(this)
  }

  *join() {
    const [value] = yield* join(/** @type {Task.Thread<T, X, M>} */ (this))
    return value
  }

  /**
   *
   * @param {T} value
   */

  return(value) {
    this.task = Return(this.task, value)
    return this.next()
  }
  /**
   * @param {X} error
   */
  throw(error) {
    this.task = Throw(this.task, error)
    return this.next()
  }

  /**
   * @type {Promise<T>}
   */
  get promise() {
    const { state } = this
    const promise = new Promise((succeed, fail) => {
      if (state.done) {
        if (state.error) {
          fail(state.error)
        } else {
          succeed(/** @type {T} */ (state.value))
        }
      } else {
        this.onsucceed = succeed
        this.onfail = fail
      }
    })
    Object.defineProperty(this, "promise", { value: promise })
    return promise
  }

  *[Symbol.iterator]() {
    enqueue(this)
    enqueue(current())
    yield SUSPEND
    return this
  }

  /**
   * @template U, [E=never]
   * @param {((value:T) => U | PromiseLike<U>)|undefined|null} [onresolve]
   * @param {((error:X) => E|PromiseLike<E>)|undefined|null} [onreject]
   * @returns {Promise<U|E>}
   */
  then(onresolve, onreject) {
    enqueue(this)
    return this.promise.then(onresolve, onreject)
  }

  /**
   * @template [U=never]
   * @param {(error:X) => U} onreject
   */
  catch(onreject) {
    return /** @type {Task.Future<T|U, never>} */ (this.then().catch(onreject))
  }

  exit() {
    return exit(this)
  }

  /**
   * @param {X} reason
   */
  abort(reason) {
    return abort(reason, this)
  }
}

class Main {
  constructor() {
    /** @type {Task.Thread[]} */
    this.queue = []
    this.id = ID
    this.idle = true
  }
  /**
   * @param {Task.Thread} fork
   */
  enqueue(fork) {
    QUEUE.push(fork)
    wake()
  }
}

let ID = 0
/** @type {Task.Thread[]} */
const QUEUE = []
const MAIN = new Main()
const SUSPEND = undefined

const wake = () => {
  if (MAIN.idle) {
    MAIN.idle = false
    while (QUEUE.length > 0) {
      const top = QUEUE[0]

      try {
        const state = top.next()
        if (!state.done && state.value !== SUSPEND) {
          QUEUE.push(top)
        }
      } catch (_) {
        // Top level task may crash and throw an error, but given this is a main
        // group we do not want to interupt other unrelated tasks, which is why
        // we discard the error and the task that caused it.
      }
      QUEUE.shift()
    }
    MAIN.idle = true
  }
}

/**
 * @param {Task.Thread} fork
 */
export const enqueue = fork => {
  fork.group.enqueue(fork)
}

/**
 * @param {Task.Thread} fork
 */
const dequeue = fork => {
  // remove from the queue
  while (true) {
    let index = QUEUE.indexOf(fork)
    if (index >= 0) {
      QUEUE.splice(index, 1)
    } else {
      return fork
    }
  }
}

/**
 * @param {number} [duration]
 * @returns {Task.Task<void, never>}
 */
export function* sleep(duration = 0) {
  const handle = current()
  let done = false
  const id = setTimeout(() => {
    done = true
    enqueue(handle)
  }, duration)
  try {
    // might be polled multiple times so it needs
    // to keep blocking until done
    while (!done) {
      yield
    }
  } finally {
    clearTimeout(id)
  }
}

/**
 * @template T, [X=unknown]
 * @param {Task.Await<T>} input
 * @returns {Generator<undefined, T, undefined>}
 */
export function* wait(input) {
  const task = current()
  if (isAsync(input)) {
    /** @type {boolean|null} */
    let ok = null
    /** @type {unknown} */
    let output = undefined
    input.then(
      value => {
        ok = true
        output = value
        task.resume()
      },
      error => {
        ok = false
        output = error
        task.resume()
      }
    )

    while (ok == null) {
      yield
    }
    if (ok) {
      return /** @type {T} */ (output)
    } else {
      throw output
    }
  } else {
    enqueue(task)
    yield
    return input
  }
}

/**
 * @template X, M
 * @template {Task.Run<unknown, X, M>[]} Tasks
 * @param {Tasks & Task.Run<unknown, X, M>[]} tasks
 * @return {Task.Task<Task.Join<Tasks>, X, M>}
 */
export function* join(...tasks) {
  const group = current()
  for (const task of tasks) {
    task.group = group
  }

  return yield* Join(tasks)
}

/**
 * @template T, X, M
 * @param {Task.Thread<T, X, M>} [group]
 */
export function* exit(group) {
  if (!group) {
    const group = current()
    group.task = Exit(group.task, undefined)
    enqueue(group)
    yield SUSPEND
  } else {
    const task = Exit(group.task, undefined)
    group.task = task

    return yield* group.task
  }
}

/**
 * @template X, M
 * @param {X} reason
 * @param {Task.Thread<unknown, X, M>} [group]
 * @returns {Task.Task<null, never, never>}
 */
export function* abort(reason, group = current()) {
  group.task = Throw(group.task, reason)
  enqueue(group)
  if (group === current()) {
    yield SUSPEND
  }

  return null
}

/**
 * @template T
 * @param {T} message
 */
export const send = function* (message) {
  yield message
}

/**
 * Checks if value value is a promise (or it's lookalike).
 *
 * @template T
 * @param {any} node
 * @returns {node is PromiseLike<T>}
 */

const isAsync = node =>
  node != null &&
  typeof (/** @type {{then?:unknown}} */ (node).then) === "function"

export const current = () => {
  if (MAIN.idle) {
    throw new RangeError(`Task.current() must be called from the running task`)
  }
  return QUEUE[0]
}

export const suspend = function* Suspend() {
  yield
}

// /**
//  * @template T, X, M
//  * @param {Task.Controller<T, X, M>[]} queue
//  * @returns {Task.Task<T, X, M> & Task.Controller<T, X, M>}
//  */
// function* Join(queue) {
//   /** @type {T|undefined} */
//   let value = undefined
//   while (queue.length > 0) {
//     try {
//       while (queue.length > 0) {
//         try {
//           value = yield* Next(queue)
//           if (queue.length > 0) {
//             yield SUSPEND
//           }
//         } catch (reason) {
//           // If there was a crash or an abort we need to propagate it to
//           // all the tasks in the queue. So we iterate over each one and
//           // call throw on them. After loop continues as normal because tasks
//           // may catch those errors and continue e.g cleanup.
//           yield* Throw(queue, /** @type {X} */ (reason))
//         }
//       }
//     } finally {
//       // task may be exited early we handle this case by exiting all the tasks
//       // in the queue.
//       yield* Return(queue, undefined)
//     }
//   }
//   return /** @type {T} */ (value)
// }

// /**
//  * @template T, X, M
//  * @param {Task.Controller<T, X, M>[]} queue
//  * @param {X} error
//  * @returns {Generator<M, void>}
//  */
// function* Throw(queue, error) {
//   /** @type {X|undefined} */
//   let failure = error
//   while (failure && queue.length > 0) {
//     failure = undefined
//     for (const top of queue.slice(0)) {
//       try {
//         const state = top.throw(error)
//         // If done we can just remove from the queue and go to next task
//         if (state.done) {
//           queue.shift()
//         }
//         // if task blocks we push it into the end of the queue.
//         else if (state.value === SUSPEND) {
//           queue.shift()
//           queue.push(top)
//         }
//         // otherwise we propagate the message
//         else {
//           yield state.value
//         }
//       } catch (error) {
//         failure = failure === undefined ? /** @type {X} */ (error) : failure
//         // if task throws as we abort just remove it from the queue and move on.
//         queue.shift()
//       }
//     }
//   }

//   if (failure) {
//     throw failure
//   }
// }

// /**
//  * @template T, X, M
//  * @param {Task.Controller<T, X, M>[]} queue
//  * @param {T} value
//  */
// function* Return(queue, value) {
//   for (const top of queue.slice(0)) {
//     try {
//       const state = top.return(value)
//       if (state.done) {
//         queue.shift()
//       } else if (state.value === SUSPEND) {
//         queue.shift()
//         queue.push(top)
//       } else {
//         yield state.value
//       }
//     } catch (reason) {
//       yield* Throw(queue, /** @type {X} */ (reason))
//       throw reason
//     }
//   }
// }

// // /**
// //  * @template T, X, M
// //  * @param {Task.Task<T, X, M> & Task.Controller<T, X, M>} task
// //  * @param {X} reason
// //  */
// // function* Abort(task, reason) {
// //   const state = task.throw(reason)
// //   if (!state.done) {
// //     yield state.value
// //     return yield* task
// //   }
// // }

// /**
//  * @template X
//  * @param {X} reason
//  * @returns {Task.Task<never, X, never>}
//  */
// function* Abort(reason) {
//   throw reason
// }

/**
 * @template T, X, M
 * @param {Task.Run<T, X, M>} task
 * @param {T} value
 */
function* Return(task, value) {
  const state = task.return(value)
  if (state.done) {
    return state.value
  } else {
    yield state.value
    return yield* task
  }
}

/**
 * @template T, X, M
 * @param {Task.Run<T, X, M>} task
 * @param {X} error
 */
function* Throw(task, error) {
  const state = task.throw(error)
  if (state.done) {
    return state.value
  } else {
    yield state.value
    // TODO: Figure out a better way to go about this, fork yielding task
    // introduces problematic behavior where `yield* fork` yields fork and
    // instead of task
    while (true) {
      const state = task.next()
      if (state.done) {
        return state.value
      } else {
        yield state.value
      }
    }
  }
}

// /**
//  * @template T, X, M
//  * @param {Task.Controller<T, X, M>[]} queue
//  * @returns {Generator<M, T>}
//  */
// function* Next(queue) {
//   /** @type {T|undefined} */
//   let value = undefined
//   for (const top of queue.slice(0)) {
//     while (true) {
//       queue.shift()
//       const state = top.next()
//       if (state.done) {
//         value = state.value
//         break
//       } else if (state.value === undefined) {
//         queue.push(top)
//         break
//       } else {
//         yield state.value
//       }
//     }
//   }
//   return /** @type {T} */ (value)
// }

const OK = Symbol("OK")

/**
 * @template X, M
 * @template {Task.Run<unknown, X, M>[]} Tasks
 * @param {Tasks} tasks
 * @return {Task.Run<Task.Join<Tasks>, X, M>}
 */
function* Join(tasks) {
  /** @type {Task.Run<unknown, X, M>[]} */
  const queue = [...tasks]
  /** @type {Task.Run<unknown, X, M>[]} */
  const idle = []
  const index = [...queue]
  const result = new Array(queue.length)

  /** @type {typeof OK|X} */
  let state = OK

  while (true) {
    while (queue.length > 0) {
      const task = queue[0]
      queue.shift()

      try {
        const next = task.next()

        if (next.done) {
          if (state == OK) {
            result[index.indexOf(task)] = next.value
          }
        } else if (next.value === SUSPEND) {
          idle.push(task)
        } else {
          queue.push(task)
          yield next.value
        }
      } catch (reason) {
        // if we are already aborting just ignore
        if (state === OK) {
          state = /** @type {X}  */ (reason)
          for (const task of [...queue.splice(0), ...idle.splice(0)]) {
            queue.push(Throw(task, state))
          }
        }
      }
    }

    if (idle.length > 0) {
      queue.push(...idle)
      idle.length = 0
      yield SUSPEND
    } else if (state === OK) {
      return /** @type {Task.Join<Tasks>} */ (result)
    } else {
      throw state
    }
  }
}

/**
 * @template T, X, M
 * @param {Task.Task<T, X, M>} task
 * @return {Task.Run<T, X, M>}
 */
const activate = function* (task) {
  return yield* task
}

// /**
//  * @template X, M
//  * @template {Task.Task<unknown, X, M>[]} Tasks
//  */

// class TaskJoin {
//   /**
//    * @param {Tasks} tasks
//    */
//   constructor(tasks) {
//     this.tasks = tasks.map(activate)
//     this.stack = [...this.tasks]
//     /** @type {typeof this.stack} */
//     this.queue = []
//     /** @type {Task.State<Tasks, X, M>} */
//     this.state = { done: false, ok: true, value: new Array(this.tasks.length) }
//   }

//   /**
//    * @returns {Task.TaskState<Task.Join<X, M, Tasks>, M>}
//    */
//   next() {
//     const { tasks, stack, queue } = this
//     while (stack.length > 0) {
//       const { state } = this
//       // remove the task from the top of the stack and run it.
//       const task = stack[0]
//       stack.shift()

//       try {
//         const next = task.next()

//         if (next.done) {
//           if (state.ok) {
//             state.value[tasks.indexOf(task)] = next.value
//           }
//         } else if (next.value === SUSPEND) {
//           queue.push(task)
//         } else {
//           stack.push(task)
//           return next
//         }
//       } catch (reason) {
//         // if we are already aborting just ignore
//         if (state.ok) {
//           this.abort(/** @type {X}  */ (reason))
//         }
//       }
//     }

//     // ⚠️ Please not that that `this.state` may change in a while loop above
//     // so we need to dereference here

//     const { state } = this

//     if (queue.length > 0) {
//       return { done: false, value: SUSPEND }
//     } else if (state.ok) {
//       state.done = true
//       return /** @type {Task.Return<Task.Join<X, M, Tasks>>} */ (state)
//     } else {
//       throw state.error
//     }
//   }
//   /**
//    *
//    * @param {X} error
//    */
//   abort(error) {
//     const { stack, queue } = this
//     this.state = { ok: false, error }
//     for (const task of [...stack.splice(0), ...queue.splice(0)]) {
//       stack.push(abortWith(error, task))
//     }
//   }

//   /**
//    * @param {X} error
//    */
//   throw(error) {
//     this.abort(error)
//     return this.next()
//   }

//   /**
//    * @param {Task.Join<X, M, Tasks>} value
//    */
//   return(value) {
//     if (this.state.ok) {
//     } else {
//       return this.next()
//     }
//   }
// }
